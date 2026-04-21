import { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useDiag } from '../context/DiagContext';
import { useFileProcessor } from '../hooks/useFileProcessor';
import { useDataParser } from '../hooks/useDataParser';
import { PacmanLoader } from './PacmanLoader';

export function LandingPage() {
  const {
    setMode,
    setError,
    setExtractedFiles,
    setDiagType,
    setDsshome,
    setRootFiles,
    setProjectFiles,
    setOriginalFile,
  } = useDiag();
  const { processFile, isProcessing, progress } = useFileProcessor();
  const { parseFiles } = useDataParser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file || !file.name.endsWith('.zip')) {
        setError('Please select a valid ZIP file');
        return;
      }

      setError(null);

      try {
        const result = await processFile(file);

        setExtractedFiles(result.extractedFiles);
        setDiagType(result.diagType);
        setDsshome(result.dsshome);
        setRootFiles(result.rootFiles);
        setProjectFiles(result.projectFiles);
        setOriginalFile(result.originalFile);

        parseFiles(
          result.extractedFiles,
          result.dsshome,
          result.projectFiles
        );

        // Navigate to results AFTER processing completes
        setMode('single');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(`Error processing the file: ${errorMessage}`);
      }
    },
    [
      processFile,
      parseFiles,
      setMode,
      setExtractedFiles,
      setDiagType,
      setDsshome,
      setRootFiles,
      setProjectFiles,
      setOriginalFile,
      setError,
    ]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleSingleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Show processing state
  if (isProcessing) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          className="flex flex-col items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <PacmanLoader />
          <p className="text-lg text-[var(--text-primary)] mt-6 mb-2">Processing diagnostic file...</p>
          <p className="text-sm text-[var(--neon-cyan)] font-mono">{progress}</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-4xl">
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-3">
            Diagnostic Analyzer
          </h1>
          <p className="text-[var(--text-muted)] text-lg">
            Analyze Dataiku DSS diagnostic files for health issues and configuration
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Single Analysis Card - with drag-drop and file picker */}
          <motion.div
            className={`group relative p-8 rounded-2xl border-2 bg-[var(--bg-surface)]
                       hover:border-[var(--neon-cyan)] hover:bg-[var(--bg-glass)]
                       transition-all duration-300 text-left cursor-pointer
                       ${isDragging ? 'border-[var(--neon-cyan)] bg-[var(--bg-glass)] scale-[1.02]' : 'border-[var(--border-glass)]'}`}
            onClick={handleSingleClick}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleFileSelect}
            />
            {/* Icon */}
            <div className="w-16 h-16 rounded-xl bg-[var(--bg-glass)] border border-[var(--border-glass)]
                          flex items-center justify-center mb-6
                          group-hover:bg-[var(--neon-cyan)]/10 group-hover:border-[var(--neon-cyan)]/30
                          transition-all duration-300">
              <svg
                className="w-8 h-8 text-[var(--text-muted)] group-hover:text-[var(--neon-cyan)] transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>

            {/* Title */}
            <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3 group-hover:text-[var(--neon-cyan)] transition-colors">
              Single Analysis
            </h2>

            {/* Description */}
            <p className="text-[var(--text-muted)] text-sm leading-relaxed mb-6">
              Analyze one diagnostic file for health issues, configuration problems, and system information.
            </p>

            {/* Supported types */}
            <div className="flex flex-wrap gap-2 mb-6">
              <span className="badge badge-success text-xs">Instance Diag</span>
              <span className="badge badge-info text-xs">Job Diag</span>
              <span className="badge badge-purple text-xs">FM Diag</span>
            </div>

            {/* CTA */}
            <div className={`flex items-center text-sm font-medium text-[var(--neon-cyan)] transition-opacity ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              {isDragging ? 'Drop file here' : 'Click or drop file'}
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>

            {/* Glow effect */}
            <div className={`absolute inset-0 rounded-2xl bg-[var(--neon-cyan)]/5 transition-opacity pointer-events-none ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
          </motion.div>

          {/* Compare Two Card */}
          <motion.button
            type="button"
            className="group relative p-8 rounded-2xl border-2 border-[var(--border-glass)] bg-[var(--bg-surface)]
                       hover:border-[var(--neon-purple)] hover:bg-[var(--bg-glass)]
                       transition-all duration-300 text-left cursor-pointer"
            onClick={() => setMode('comparison')}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {/* Icon */}
            <div className="w-16 h-16 rounded-xl bg-[var(--bg-glass)] border border-[var(--border-glass)]
                          flex items-center justify-center mb-6
                          group-hover:bg-[var(--neon-purple)]/10 group-hover:border-[var(--neon-purple)]/30
                          transition-all duration-300">
              <svg
                className="w-8 h-8 text-[var(--text-muted)] group-hover:text-[var(--neon-purple)] transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                />
              </svg>
            </div>

            {/* Title */}
            <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3 group-hover:text-[var(--neon-purple)] transition-colors">
              Compare Two
              <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-400 font-normal align-middle light-white-bg">
                Experimental
              </span>
            </h2>

            {/* Description */}
            <p className="text-[var(--text-muted)] text-sm leading-relaxed mb-6">
              Compare diagnostics from different times or environments to track changes, drift, and regressions.
            </p>

            {/* Use cases */}
            <div className="flex flex-wrap gap-2 mb-6">
              <span className="px-2 py-1 rounded-md bg-[var(--bg-glass)] border border-[var(--border-glass)] text-xs text-[var(--text-muted)]">
                Pre/Post Upgrade
              </span>
              <span className="px-2 py-1 rounded-md bg-[var(--bg-glass)] border border-[var(--border-glass)] text-xs text-[var(--text-muted)]">
                Env Parity
              </span>
              <span className="px-2 py-1 rounded-md bg-[var(--bg-glass)] border border-[var(--border-glass)] text-xs text-[var(--text-muted)]">
                Troubleshooting
              </span>
            </div>

            {/* CTA */}
            <div className="flex items-center text-sm font-medium text-[var(--neon-purple)] opacity-0 group-hover:opacity-100 transition-opacity">
              Select files
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>

            {/* Glow effect */}
            <div className="absolute inset-0 rounded-2xl bg-[var(--neon-purple)]/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          </motion.button>
        </div>

        {/* Privacy note */}
        <motion.p
          className="mt-10 text-center text-sm text-[var(--text-muted)] flex items-center justify-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          Files are processed locally in your browser
        </motion.p>
      </div>
    </div>
  );
}
