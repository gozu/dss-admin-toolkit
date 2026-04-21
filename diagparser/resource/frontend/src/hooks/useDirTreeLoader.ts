import { useState, useCallback } from 'react';
import type { DirEntry, DirTreeData, DirTreeLoaderState } from '../types';

const MAX_DEPTH = 5; // Default depth limit
const TOP_N = 10; // Keep only top N children per directory
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
const STATE_UPDATE_INTERVAL = 250; // ms — throttle React state updates

// ProjectFootprintParser walks the dir tree looking for these bucket
// directory names. They're often small (10s of MB) compared to siblings
// like code-envs or webappruns, so the top-N prune was discarding them
// from dss_data/'s child list and zeroing every project's bundle/dataset
// stats. Always rescue them from the tail before truncating.
const PROTECTED_NAMES = new Set([
  'prepared_bundles',
  'bundles',
  'managed_datasets',
  'managed_folders',
  'saved_models',
  'analysis-data',
]);

function truncateKeepingProtected(children: DirEntry[], n: number): DirEntry[] {
  if (children.length <= n) return children;
  const rescued: DirEntry[] = [];
  for (let i = n; i < children.length; i++) {
    if (PROTECTED_NAMES.has(children[i].name)) rescued.push(children[i]);
  }
  children.length = n;
  if (rescued.length > 0) children.push(...rescued);
  return children;
}

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
  loadFromStream: (stream: ReadableStream<Uint8Array>, totalSize: number) => Promise<DirTreeData | null>;
  reset: () => void;
}

export function useDirTreeLoader(): UseDirTreeLoaderReturn {
  const [state, setState] = useState<DirTreeLoaderState>({
    isLoading: false,
    progress: 0,
    progressText: '',
    error: null,
    tree: null,
  });

  const reset = useCallback(() => {
    setState({
      isLoading: false,
      progress: 0,
      progressText: '',
      error: null,
      tree: null,
    });
  }, []);

  /**
   * Load directory tree from a blob with depth-limited parsing
   */
  const loadFromBlob = useCallback(async (blob: Blob): Promise<DirTreeData | null> => {
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

      let currentByte = 0;
      let buffer = '';
      let rootPath = '';
      let rootSlashCount = 0;
      let linesProcessed = 0;
      const startTime = performance.now();
      let lastUpdateTime = 0;

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
          } else {
            // depth > MAX_DEPTH: Aggregate into nearest visible ancestor
            const ancestorPath = getAncestorAtDepthFast(path, rootSlashCount, MAX_DEPTH);
            const ancestor = nodeMap.get(ancestorPath);
            if (ancestor) {
              ancestor.size += size;
              if (!isDirectory) {
                ancestor.fileCount++;
              }
              ancestor.hasHiddenChildren = true;
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

      // Calculate cumulative sizes (bottom-up) and prune to top N
      const root = nodeMap.get(rootPath);
      if (root) {
        calculateCumulativeSizes(root);
        pruneToTopN(root, TOP_N);

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
  ): Promise<DirTreeData | null> => {
    setState(prev => ({
      ...prev,
      isLoading: true,
      progress: 0,
      progressText: 'Starting streaming parse...',
      error: null,
    }));

    try {
      // Stack-based DFS builder. `find -ls` output is DFS-sorted, so
      // stack[d] == current ancestor at depth d and parent lookup is just
      // stack[depth-1]. Eliminates the per-node full-path string key that
      // the old Map-keyed builder kept live for 11M+ entries.
      const stack: DirEntry[] = [];
      let root: DirEntry | null = null;
      let rootPath = '';
      let rootSlashCount = 0;
      let currentByte = 0;
      let buffer = '';
      let linesProcessed = 0;
      const startTime = performance.now();
      let lastUpdateTime = 0;

      const decoder = new TextDecoder();
      const rawReader = stream.getReader();
      const GC_YIELD_LINES = 50000;
      let linesSinceYield = 0;

      // When a directory pops off the stack its subtree is complete: roll
      // children sizes into the node, then sort+truncate to TOP_N so the
      // discarded subtrees become GC-eligible immediately.
      const finalizePopped = (popped: DirEntry) => {
        let childrenSize = 0;
        let childrenFiles = 0;
        for (const c of popped.children) {
          childrenSize += c.size;
          childrenFiles += c.fileCount;
        }
        popped.size += childrenSize;
        popped.fileCount += childrenFiles;
        if (popped.children.length > TOP_N) {
          popped.children.sort((a, b) => b.size - a.size);
          truncateKeepingProtected(popped.children, TOP_N);
          popped.hasHiddenChildren = true;
        }
      };

      const processLine = (line: string, lineBytes: number) => {
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

        if (!root) {
          rootPath = detach(path);
          rootSlashCount = countSlashes(rootPath);
          root = {
            name: detach(getBaseName(rootPath) || rootPath),
            path: rootPath, size, ownSize: size,
            isDirectory: true, children: [], fileCount: 0,
            depth: 0, hasHiddenChildren: false,
          };
          stack[0] = root;
          currentByte += lineBytes;
          return;
        }

        const depth = getDepthFast(path, rootSlashCount);

        if (depth > MAX_DEPTH) {
          // Aggregate deeper descendants into the MAX_DEPTH ancestor already
          // on the stack — no node created.
          const ancestor = stack[Math.min(stack.length - 1, MAX_DEPTH)];
          if (ancestor) {
            ancestor.size += size;
            if (!isDirectory) ancestor.fileCount++;
            ancestor.hasHiddenChildren = true;
          }
          currentByte += lineBytes;
          return;
        }

        while (stack.length > depth) {
          finalizePopped(stack.pop()!);
        }

        const parent = stack[stack.length - 1];
        if (!parent) { currentByte += lineBytes; return; }

        // Files at exactly MAX_DEPTH aggregate into their parent — leaves
        // can't be drilled into, and DSS job/scenario dirs hold tens of
        // millions of them.
        if (depth === MAX_DEPTH && !isDirectory) {
          parent.size += size;
          parent.fileCount++;
          parent.hasHiddenChildren = true;
          currentByte += lineBytes;
          return;
        }

        // `.path` is deliberately left empty here; synthesized post-parse on
        // the surviving (unpruned) nodes. Skipping the per-node detached
        // full-path string is the single biggest heap reduction.
        const node: DirEntry = {
          name: detach(getBaseName(path)),
          path: '',
          size, ownSize: size,
          isDirectory, children: [],
          fileCount: isDirectory ? 0 : 1,
          depth, hasHiddenChildren: false,
        };
        parent.children.push(node);
        stack[depth] = node;

        currentByte += lineBytes;
      };

      while (true) {
        const { done, value } = await rawReader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        const text = buffer.length > 0 ? buffer + chunk : chunk;
        buffer = '';
        let start = 0;
        let nlPos: number;

        while ((nlPos = text.indexOf('\n', start)) !== -1) {
          const line = text.substring(start, nlPos);
          start = nlPos + 1;
          processLine(line, line.length + 1);

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

        if (start < text.length) {
          const leftover = text.substring(start);
          buffer = leftover.length < 4096 ? (' ' + leftover).substring(1) : leftover;
        }

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

      if (buffer.length > 0) {
        processLine(buffer, buffer.length);
      }

      // Finalize remaining stack entries (and root itself) — sums subtree
      // sizes bottom-up and applies the same top-N prune incrementally.
      while (stack.length > 1) {
        finalizePopped(stack.pop()!);
      }
      if (root) {
        const rootNode: DirEntry = root;
        finalizePopped(rootNode);

        // Walk surviving tree: synthesize .path from the parent chain
        // (required by DirTreeTable's expanded: Set<string>) and sort any
        // children lists that finalizePopped didn't need to sort.
        const assignPaths = (n: DirEntry, parentPath: string) => {
          if (parentPath !== '') {
            n.path = parentPath === '/' ? '/' + n.name : parentPath + '/' + n.name;
          }
          if (n.children.length > 1) n.children.sort((a, b) => b.size - a.size);
          for (const c of n.children) assignPaths(c, n.path);
        };
        assignPaths(rootNode, '');

        const treeData: DirTreeData = {
          root: rootNode,
          totalSize: rootNode.size,
          totalFiles: rootNode.fileCount,
          rootPath,
        };

        setState({
          isLoading: false,
          progress: 100,
          progressText: `Loaded ${linesProcessed.toLocaleString()} entries`,
          error: null,
          tree: treeData,
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

  return {
    state,
    loadFromBlob,
    loadFromStream,
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

/**
 * Prune each directory's children to the top N by size.
 * Children are already sorted descending by calculateCumulativeSizes().
 * Parent sizes remain correct — they were computed before pruning.
 */
function pruneToTopN(node: DirEntry, n: number): void {
  if (!node.isDirectory) return;

  for (const child of node.children) {
    pruneToTopN(child, n);
  }

  if (node.children.length > n) {
    truncateKeepingProtected(node.children, n);
    node.hasHiddenChildren = true;
  }
}
