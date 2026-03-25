import { useState, useCallback, useRef } from 'react';
import {
  BlobReader,
  ZipReader,
} from '@zip.js/zip.js';
import type { DirEntry, DirTreeData, DirIndex, DirTreeLoaderState } from '../types';

const MAX_DEPTH = 3; // Default depth limit
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
const STATE_UPDATE_INTERVAL = 250; // ms — throttle React state updates

interface ParsedLine {
  path: string;
  size: number;
  isDirectory: boolean;
}

// --- Fast parsing utilities (minimize allocations on hot path) ---

/**
 * Parse a single line from `find -ls` output using manual index walking (zero temp allocations).
 * Format: inode blocks permissions links owner group size month day time/year path
 */
function parseLine(line: string): ParsedLine | null {
  const len = line.length;
  let i = 0;

  // Skip leading whitespace
  while (i < len && line.charCodeAt(i) <= 32) i++;
  if (i >= len) return null;

  // Field 1: inode — must start with digit
  if (line.charCodeAt(i) < 48 || line.charCodeAt(i) > 57) return null;
  while (i < len && line.charCodeAt(i) > 32) i++;
  while (i < len && line.charCodeAt(i) <= 32) i++;
  if (i >= len) return null;

  // Field 2: blocks
  while (i < len && line.charCodeAt(i) > 32) i++;
  while (i < len && line.charCodeAt(i) <= 32) i++;
  if (i >= len) return null;

  // Field 3: permissions — first char 'd' (100) means directory
  const isDirectory = line.charCodeAt(i) === 100;
  while (i < len && line.charCodeAt(i) > 32) i++;
  while (i < len && line.charCodeAt(i) <= 32) i++;
  if (i >= len) return null;

  // Field 4: links
  while (i < len && line.charCodeAt(i) > 32) i++;
  while (i < len && line.charCodeAt(i) <= 32) i++;
  if (i >= len) return null;

  // Field 5: owner
  while (i < len && line.charCodeAt(i) > 32) i++;
  while (i < len && line.charCodeAt(i) <= 32) i++;
  if (i >= len) return null;

  // Field 6: group
  while (i < len && line.charCodeAt(i) > 32) i++;
  while (i < len && line.charCodeAt(i) <= 32) i++;
  if (i >= len) return null;

  // Field 7: size — parse digits inline
  let size = 0;
  while (i < len && line.charCodeAt(i) >= 48 && line.charCodeAt(i) <= 57) {
    size = size * 10 + (line.charCodeAt(i) - 48);
    i++;
  }
  while (i < len && line.charCodeAt(i) <= 32) i++;
  if (i >= len) return null;

  // Fields 8-10: month, day, time/year
  for (let f = 0; f < 3; f++) {
    while (i < len && line.charCodeAt(i) > 32) i++;
    while (i < len && line.charCodeAt(i) <= 32) i++;
    if (i >= len) return null;
  }

  // Field 11: path — trim trailing whitespace
  let end = len;
  while (end > i && line.charCodeAt(end - 1) <= 32) end--;

  return { path: line.substring(i, end), size, isDirectory };
}

/**
 * Remove trailing slashes (except for root "/").
 */
function normalizePath(path: string): string {
  if (path.length <= 1) return path;
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
  return end === path.length ? path : path.substring(0, end);
}

function getBaseName(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash < 0 ? normalized : normalized.substring(lastSlash + 1) || path;
}

function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return normalized.substring(0, lastSlash);
}

/**
 * Break V8 sliced-string reference so the parent string can be GC'd.
 * substring() returns a SlicedString that pins the entire original;
 * this forces V8 to allocate a fresh flat string.
 */
function detach(s: string): string {
  return (' ' + s).slice(1);
}

/** Count '/' characters in a string. */
function countSlashes(s: string): number {
  let n = 0;
  for (let i = 0, len = s.length; i < len; i++) {
    if (s.charCodeAt(i) === 47) n++;
  }
  return n;
}

/** Depth relative to root, using pre-computed rootSlashCount. */
function getDepthFast(normalizedPath: string, rootSlashCount: number): number {
  return countSlashes(normalizedPath) - rootSlashCount;
}

/** Return ancestor path at targetDepth below root. */
function getAncestorAtDepthFast(
  normalizedPath: string,
  rootSlashCount: number,
  targetDepth: number,
): string {
  const targetSlashIndex = rootSlashCount + targetDepth;
  let count = 0;
  for (let i = 0, len = normalizedPath.length; i < len; i++) {
    if (normalizedPath.charCodeAt(i) === 47) {
      count++;
      if (count > targetSlashIndex) {
        return normalizedPath.substring(0, i);
      }
    }
  }
  return normalizedPath;
}

export interface UseDirTreeLoaderReturn {
  state: DirTreeLoaderState;
  loadFromBlob: (blob: Blob) => Promise<DirTreeData | null>;
  loadFromStream: (stream: ReadableStream<Uint8Array>, totalSize: number, file: File) => Promise<DirTreeData | null>;
  expandDirectory: (dirPath: string, newMaxDepth?: number) => Promise<DirEntry | null>;
  reset: () => void;
}

export function useDirTreeLoader(): UseDirTreeLoaderReturn {
  const [state, setState] = useState<DirTreeLoaderState>({
    isLoading: false,
    progress: 0,
    progressText: '',
    error: null,
    tree: null,
    index: new Map(),
  });

  // Store references for drill-down
  const blobRef = useRef<Blob | null>(null);
  const fileRef = useRef<File | null>(null);
  const rootPathRef = useRef<string>('');

  const reset = useCallback(() => {
    blobRef.current = null;
    fileRef.current = null;
    rootPathRef.current = '';
    setState({
      isLoading: false,
      progress: 0,
      progressText: '',
      error: null,
      tree: null,
      index: new Map(),
    });
  }, []);

  /**
   * Load directory tree from a blob with depth-limited parsing
   */
  const loadFromBlob = useCallback(async (blob: Blob): Promise<DirTreeData | null> => {
    blobRef.current = blob;
    const totalBytes = blob.size;

    setState(prev => ({
      ...prev,
      isLoading: true,
      progress: 0,
      progressText: 'Starting parsing...',
      error: null,
    }));

    try {
      const nodeMap = new Map<string, DirEntry>();
      const dirIndex = new Map<string, DirIndex>();

      let currentByte = 0;
      let buffer = '';
      let rootPath = '';
      let rootSlashCount = 0;
      let linesProcessed = 0;
      const startTime = performance.now();
      let lastUpdateTime = 0;

      let activeIndexDir: { path: string; startByte: number; size: number; fileCount: number } | null = null;

      // Process blob in chunks
      let offset = 0;
      while (offset < totalBytes) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = blob.slice(offset, chunkEnd);
        const text = await chunk.text();
        // Use indexOf-based line scanning instead of split() to avoid
        // creating a large array of sliced strings that pin the parent
        const combined = buffer.length > 0 ? buffer + text : text;
        buffer = '';
        let scanStart = 0;
        let nlIdx: number;

        while ((nlIdx = combined.indexOf('\n', scanStart)) !== -1) {
          const line = combined.substring(scanStart, nlIdx);
          scanStart = nlIdx + 1;
          const lineBytes = line.length + 1;

          // Blank-line check without trim() allocation
          let blank = true;
          for (let ci = 0, cl = line.length; ci < cl; ci++) {
            if (line.charCodeAt(ci) > 32) { blank = false; break; }
          }
          if (blank) {
            currentByte += lineBytes;
            continue;
          }

          const parsed = parseLine(line);
          if (!parsed) {
            currentByte += lineBytes;
            continue;
          }

          linesProcessed++;
          const { path: rawPath, size, isDirectory } = parsed;
          const path = normalizePath(rawPath);

          // Detect root path from first entry
          if (!rootPath) {
            rootPath = detach(path);
            rootPathRef.current = rootPath;
            rootSlashCount = countSlashes(rootPath);

            // Create root node
            const rootNode: DirEntry = {
              name: detach(getBaseName(rootPath) || rootPath),
              path: rootPath,
              size: size,
              ownSize: size,
              isDirectory: true,
              children: [],
              fileCount: 0,
              depth: 0,
              hasHiddenChildren: false,
            };
            nodeMap.set(rootPath, rootNode);
            currentByte += lineBytes;
            continue;
          }

          const depth = getDepthFast(path, rootSlashCount);

          // Close active index dir if we've left its subtree
          if (activeIndexDir && !path.startsWith(activeIndexDir.path + '/') && path !== activeIndexDir.path) {
            dirIndex.set(activeIndexDir.path, {
              path: activeIndexDir.path,
              startByte: activeIndexDir.startByte,
              endByte: currentByte,
              totalSize: activeIndexDir.size,
              fileCount: activeIndexDir.fileCount,
              depth: MAX_DEPTH,
            });
            activeIndexDir = null;
          }

          // Aggregate into active index dir if we're deeper than MAX_DEPTH
          if (depth > MAX_DEPTH && activeIndexDir) {
            activeIndexDir.size += size;
            if (!isDirectory) activeIndexDir.fileCount++;
          }

          if (depth <= MAX_DEPTH) {
            // Create actual node
            const detachedPath = detach(path);
            const node: DirEntry = {
              name: detach(getBaseName(path)),
              path: detachedPath,
              size: size,
              ownSize: size,
              isDirectory: isDirectory,
              children: [],
              fileCount: isDirectory ? 0 : 1,
              depth: depth,
              hasHiddenChildren: false,
            };
            nodeMap.set(detachedPath, node);

            // Find parent and add as child
            const parentPath = getParentPath(path);
            const parent = nodeMap.get(parentPath);
            if (parent) {
              parent.children.push(node);
            }

            // Start tracking byte index for directories at MAX_DEPTH
            if (isDirectory && depth === MAX_DEPTH) {
              activeIndexDir = {
                path: detachedPath,
                startByte: currentByte,
                size: size,
                fileCount: 0,
              };
              node.hasHiddenChildren = true; // Will have hidden children
            }
          } else {
            // depth > MAX_DEPTH: Aggregate into nearest visible ancestor
            const ancestorPath = getAncestorAtDepthFast(path, rootSlashCount, MAX_DEPTH);
            const ancestor = nodeMap.get(ancestorPath);
            if (ancestor) {
              ancestor.size += size;
              if (!isDirectory) {
                ancestor.fileCount++;
              }
            }
          }

          currentByte += lineBytes;
        }

        // Keep leftover partial line
        if (scanStart < combined.length) {
          buffer = combined.substring(scanStart);
        }

        offset = chunkEnd;

        // Throttled progress update
        const now = performance.now();
        if (now - lastUpdateTime >= STATE_UPDATE_INTERVAL) {
          lastUpdateTime = now;
          const progress = Math.round((offset / totalBytes) * 100);
          const elapsedSec = (now - startTime) / 1000;
          const entriesPerSec = elapsedSec > 0 ? Math.round(linesProcessed / elapsedSec) : 0;
          setState(prev => ({
            ...prev,
            progress,
            progressText: `Processing... ${progress}% (${linesProcessed.toLocaleString()} entries, ${entriesPerSec.toLocaleString()}/sec)`,
          }));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Process remaining buffer (last line without trailing newline)
      if (buffer.length > 0) {
        const parsed = parseLine(buffer);
        if (parsed) {
          const { path: rawPath, size, isDirectory } = parsed;
          const path = normalizePath(rawPath);
          const depth = getDepthFast(path, rootSlashCount);

          if (depth <= MAX_DEPTH && path !== rootPath) {
            const node: DirEntry = {
              name: getBaseName(path),
              path: path,
              size: size,
              ownSize: size,
              isDirectory: isDirectory,
              children: [],
              fileCount: isDirectory ? 0 : 1,
              depth: depth,
              hasHiddenChildren: false,
            };
            nodeMap.set(path, node);

            const parentPath = getParentPath(path);
            const parent = nodeMap.get(parentPath);
            if (parent) {
              parent.children.push(node);
            }
          }
        }
      }

      // Close remaining active index directory
      if (activeIndexDir) {
        dirIndex.set(activeIndexDir.path, {
          path: activeIndexDir.path,
          startByte: activeIndexDir.startByte,
          endByte: currentByte,
          totalSize: activeIndexDir.size,
          fileCount: activeIndexDir.fileCount,
          depth: MAX_DEPTH,
        });
      }

      // Calculate cumulative sizes (bottom-up)
      const root = nodeMap.get(rootPath);
      if (root) {
        calculateCumulativeSizes(root);

        const treeData: DirTreeData = {
          root,
          totalSize: root.size,
          totalFiles: root.fileCount,
          rootPath,
        };

        setState({
          isLoading: false,
          progress: 100,
          progressText: `Loaded ${linesProcessed.toLocaleString()} entries`,
          error: null,
          tree: treeData,
          index: dirIndex,
        });

        return treeData;
      }

      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Failed to build directory tree',
      }));
      return null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return null;
    }
  }, []);

  /**
   * Load directory tree from a ReadableStream (memory efficient for large files)
   */
  const loadFromStream = useCallback(async (
    stream: ReadableStream<Uint8Array>,
    totalSize: number,
    file: File
  ): Promise<DirTreeData | null> => {
    fileRef.current = file;

    setState(prev => ({
      ...prev,
      isLoading: true,
      progress: 0,
      progressText: 'Starting streaming parse...',
      error: null,
    }));

    try {
      const nodeMap = new Map<string, DirEntry>();
      const dirIndex = new Map<string, DirIndex>();

      let currentByte = 0;
      let buffer = '';
      let rootPath = '';
      let rootSlashCount = 0;
      let linesProcessed = 0;
      const startTime = performance.now();
      let lastUpdateTime = 0;

      let activeIndexDir: { path: string; startByte: number; size: number; fileCount: number } | null = null;

      // Use TextDecoder manually (avoids TextDecoderStream's extra buffering layer)
      const decoder = new TextDecoder();
      const rawReader = stream.getReader();
      const GC_YIELD_LINES = 50000;
      let linesSinceYield = 0;

      // Processes a single line (shared by main loop and final-buffer handling)
      const processLine = (line: string, lineBytes: number) => {
        // Blank-line check without allocating a trimmed string
        let blank = true;
        for (let ci = 0, cl = line.length; ci < cl; ci++) {
          if (line.charCodeAt(ci) > 32) { blank = false; break; }
        }
        if (blank) { currentByte += lineBytes; return; }

        const parsed = parseLine(line);
        if (!parsed) { currentByte += lineBytes; return; }

        linesProcessed++;
        const { path: rawPath, size, isDirectory } = parsed;
        const path = normalizePath(rawPath);

        if (!rootPath) {
          rootPath = detach(path);
          rootPathRef.current = rootPath;
          rootSlashCount = countSlashes(rootPath);
          const rootNode: DirEntry = {
            name: detach(getBaseName(rootPath) || rootPath),
            path: rootPath, size, ownSize: size,
            isDirectory: true, children: [], fileCount: 0,
            depth: 0, hasHiddenChildren: false,
          };
          nodeMap.set(rootPath, rootNode);
          currentByte += lineBytes;
          return;
        }

        const depth = getDepthFast(path, rootSlashCount);

        if (activeIndexDir && !path.startsWith(activeIndexDir.path + '/') && path !== activeIndexDir.path) {
          dirIndex.set(activeIndexDir.path, {
            path: activeIndexDir.path,
            startByte: activeIndexDir.startByte, endByte: currentByte,
            totalSize: activeIndexDir.size, fileCount: activeIndexDir.fileCount,
            depth: MAX_DEPTH,
          });
          activeIndexDir = null;
        }

        if (depth > MAX_DEPTH && activeIndexDir) {
          activeIndexDir.size += size;
          if (!isDirectory) activeIndexDir.fileCount++;
        }

        if (depth <= MAX_DEPTH) {
          const detachedPath = detach(path);
          const node: DirEntry = {
            name: detach(getBaseName(path)), path: detachedPath, size, ownSize: size,
            isDirectory, children: [],
            fileCount: isDirectory ? 0 : 1, depth, hasHiddenChildren: false,
          };
          nodeMap.set(detachedPath, node);
          const parentPath = getParentPath(path);
          const parent = nodeMap.get(parentPath);
          if (parent) parent.children.push(node);

          if (isDirectory && depth === MAX_DEPTH) {
            activeIndexDir = { path: detachedPath, startByte: currentByte, size, fileCount: 0 };
            node.hasHiddenChildren = true;
          }
        } else {
          const ancestorPath = getAncestorAtDepthFast(path, rootSlashCount, MAX_DEPTH);
          const ancestor = nodeMap.get(ancestorPath);
          if (ancestor) {
            ancestor.size += size;
            if (!isDirectory) ancestor.fileCount++;
          }
        }

        currentByte += lineBytes;
      };

      while (true) {
        const { done, value } = await rawReader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        // Merge leftover buffer with new chunk; use indexOf to scan lines
        // (avoids split() which creates a large array of sliced strings referencing the parent)
        const text = buffer.length > 0 ? buffer + chunk : chunk;
        buffer = '';
        let start = 0;
        let nlPos: number;

        while ((nlPos = text.indexOf('\n', start)) !== -1) {
          const line = text.substring(start, nlPos);
          start = nlPos + 1;
          processLine(line, line.length + 1);

          // Periodically yield to let GC collect short-lived strings
          linesSinceYield++;
          if (linesSinceYield >= GC_YIELD_LINES) {
            linesSinceYield = 0;
            const now = performance.now();
            if (now - lastUpdateTime >= STATE_UPDATE_INTERVAL) {
              lastUpdateTime = now;
              const progress = Math.round((currentByte / totalSize) * 100);
              const elapsedSec = (now - startTime) / 1000;
              const entriesPerSec = elapsedSec > 0 ? Math.round(linesProcessed / elapsedSec) : 0;
              setState(prev => ({
                ...prev,
                progress,
                progressText: `Processing... ${progress}% (${linesProcessed.toLocaleString()} entries, ${entriesPerSec.toLocaleString()}/sec)`,
              }));
            }
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        // Keep leftover partial line — force a fresh copy to break V8 sliced-string
        // reference to the large parent string so it can be GC'd
        if (start < text.length) {
          const leftover = text.substring(start);
          buffer = leftover.length < 4096 ? (' ' + leftover).substring(1) : leftover;
        }

        // Throttled progress update (also fires between GC yields for responsiveness)
        const now = performance.now();
        if (now - lastUpdateTime >= STATE_UPDATE_INTERVAL) {
          lastUpdateTime = now;
          const progress = Math.round((currentByte / totalSize) * 100);
          const elapsedSec = (now - startTime) / 1000;
          const entriesPerSec = elapsedSec > 0 ? Math.round(linesProcessed / elapsedSec) : 0;
          setState(prev => ({
            ...prev,
            progress,
            progressText: `Processing... ${progress}% (${linesProcessed.toLocaleString()} entries, ${entriesPerSec.toLocaleString()}/sec)`,
          }));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Process remaining buffer
      if (buffer.length > 0) {
        processLine(buffer, buffer.length);
      }

      // TS cannot track that processLine() mutates activeIndexDir via closure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalIdx = activeIndexDir as any as { path: string; startByte: number; size: number; fileCount: number } | null;
      if (finalIdx) {
        dirIndex.set(finalIdx.path, {
          path: finalIdx.path,
          startByte: finalIdx.startByte,
          endByte: currentByte,
          totalSize: finalIdx.size,
          fileCount: finalIdx.fileCount,
          depth: MAX_DEPTH,
        });
      }

      const root = nodeMap.get(rootPath);
      if (root) {
        calculateCumulativeSizes(root);

        const treeData: DirTreeData = {
          root,
          totalSize: root.size,
          totalFiles: root.fileCount,
          rootPath,
        };

        setState({
          isLoading: false,
          progress: 100,
          progressText: `Loaded ${linesProcessed.toLocaleString()} entries`,
          error: null,
          tree: treeData,
          index: dirIndex,
        });

        return treeData;
      }

      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Failed to build directory tree',
      }));
      return null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return null;
    }
  }, []);

  /**
   * Expand a directory by re-parsing its byte range with a deeper depth limit
   */
  const expandDirectory = useCallback(async (
    rawDirPath: string,
    newMaxDepth: number = MAX_DEPTH + 2
  ): Promise<DirEntry | null> => {
    const dirPath = normalizePath(rawDirPath);
    const blob = blobRef.current;
    const file = fileRef.current;
    const index = state.index.get(dirPath);
    const rootPath = rootPathRef.current;

    if ((!blob && !file) || !index || !rootPath) {
      return null;
    }

    setState(prev => ({
      ...prev,
      isLoading: true,
      progressText: `Expanding ${getBaseName(dirPath)}...`,
    }));

    try {
      const collectedLines: string[] = [];

      if (blob) {
        // Fast path: we have the blob in memory, just slice it
        const slice = blob.slice(index.startByte, index.endByte);
        const text = await slice.text();
        const lines = text.trim().split('\n');
        for (const l of lines) {
          if (l.trim()) collectedLines.push(l);
        }
      } else if (file) {
        // Stream from zip, collecting only lines within [startByte, endByte)
        const zipReader = new ZipReader(new BlobReader(file));
        const entries = await zipReader.getEntries();
        const dirListingEntry = entries.find(
          (e) => e.filename === 'datadir_listing.txt' || e.filename.endsWith('/datadir_listing.txt')
        );

        if (!dirListingEntry) {
          await zipReader.close();
          throw new Error('datadir_listing.txt not found');
        }

        const { readable, writable } = new TransformStream<Uint8Array>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extractPromise = (dirListingEntry as any).getData(writable);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textStream = (readable as any).pipeThrough(new TextDecoderStream());
        const streamReader = textStream.getReader() as ReadableStreamDefaultReader<string>;

        let currentByte = 0;
        let lineBuffer = '';
        let pastEnd = false;

        try {
          while (true) {
            const { done, value } = await streamReader.read();
            if (done) break;

            lineBuffer += value;
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop() || '';

            for (const line of lines) {
              const lineBytes = line.length + 1;

              if (currentByte >= index.startByte && currentByte < index.endByte) {
                if (line.trim()) collectedLines.push(line);
              }

              currentByte += lineBytes;

              if (currentByte >= index.endByte) {
                pastEnd = true;
                break;
              }
            }

            if (pastEnd) {
              await streamReader.cancel();
              break;
            }
          }
        } catch {
          /* expected: cancel propagates as an error through the stream pipeline */
        }

        try { await extractPromise; } catch { /* expected from early cancel */ }
        await zipReader.close();
      } else {
        throw new Error('No data source available');
      }

      // Build subtree with new depth limit (relative to this dir)
      const rootSlashCount = countSlashes(normalizePath(rootPath));
      const dirDepth = getDepthFast(dirPath, rootSlashCount);
      const effectiveMaxDepth = dirDepth + newMaxDepth;

      const nodeMap = new Map<string, DirEntry>();

      // Create the root of this subtree (the dir we're expanding)
      const rootNode: DirEntry = {
        name: getBaseName(dirPath),
        path: dirPath,
        size: 0,
        ownSize: 0,
        isDirectory: true,
        children: [],
        fileCount: 0,
        depth: dirDepth,
        hasHiddenChildren: false,
      };
      nodeMap.set(dirPath, rootNode);

      for (const line of collectedLines) {
        const parsed = parseLine(line);
        if (!parsed) continue;

        const { path: rawPath, size, isDirectory } = parsed;
        const path = normalizePath(rawPath);

        // Skip entries not under this directory
        if (!path.startsWith(dirPath + '/') && path !== dirPath) continue;

        const depth = getDepthFast(path, rootSlashCount);

        if (path === dirPath) {
          rootNode.ownSize = size;
          continue;
        }

        if (depth <= effectiveMaxDepth) {
          const node: DirEntry = {
            name: getBaseName(path),
            path: path,
            size: size,
            ownSize: size,
            isDirectory: isDirectory,
            children: [],
            fileCount: isDirectory ? 0 : 1,
            depth: depth,
            hasHiddenChildren: depth === effectiveMaxDepth && isDirectory,
          };
          nodeMap.set(path, node);

          // Find parent and add as child
          const parentPath = getParentPath(path);
          const parent = nodeMap.get(parentPath);
          if (parent) {
            parent.children.push(node);
          }
        } else {
          // Aggregate into nearest visible ancestor
          const ancestorPath = getAncestorAtDepthFast(path, rootSlashCount, effectiveMaxDepth);
          const ancestor = nodeMap.get(ancestorPath);
          if (ancestor) {
            ancestor.size += size;
            if (!isDirectory) {
              ancestor.fileCount++;
            }
          }
        }
      }

      // Calculate cumulative sizes
      calculateCumulativeSizes(rootNode);

      setState(prev => ({
        ...prev,
        isLoading: false,
        progressText: '',
      }));

      return rootNode;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return null;
    }
  }, [state.index]);

  return {
    state,
    loadFromBlob,
    loadFromStream,
    expandDirectory,
    reset,
  };
}

/**
 * Calculate cumulative sizes bottom-up and sort children by size
 *
 * For nodes with hasHiddenChildren=true:
 * - node.size already contains: ownSize + aggregated hidden children sizes
 * - node.fileCount already contains: aggregated hidden children file counts
 * - We just need to recurse into visible children (to calculate their sizes) and sort
 *
 * For nodes without hidden children:
 * - We calculate: ownSize + sum of all children sizes
 */
function calculateCumulativeSizes(node: DirEntry): { size: number; fileCount: number } {
  // Base case: files or empty directories
  if (!node.isDirectory) {
    return { size: node.size, fileCount: 1 };
  }

  if (node.children.length === 0) {
    // Directory with no visible children
    // If hasHiddenChildren, size and fileCount already have aggregated values
    return { size: node.size, fileCount: node.fileCount };
  }

  // Recurse into visible children first (this also sorts them)
  for (const child of node.children) {
    calculateCumulativeSizes(child);
  }

  // Sort children by size descending
  node.children.sort((a, b) => b.size - a.size);

  if (node.hasHiddenChildren) {
    // node.size and node.fileCount already include hidden children's contributions
    // (aggregated during parsing). Just return what we have.
    return { size: node.size, fileCount: node.fileCount };
  }

  // No hidden children - calculate from visible children
  let totalSize = node.ownSize;
  let totalFiles = 0;

  for (const child of node.children) {
    totalSize += child.size;
    totalFiles += child.fileCount;
  }

  node.size = totalSize;
  node.fileCount = totalFiles;

  return { size: node.size, fileCount: node.fileCount };
}
