import { useCallback, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useDiag } from '../context/DiagContext';
import { useFileProcessor } from '../hooks/useFileProcessor';
import { useDataParser } from '../hooks/useDataParser';
import { PacmanLoader } from './PacmanLoader';

export function FileUpload() {
  const {
    setLoading,
    setError,
    setExtractedFiles,
    setDiagType,
    setDsshome,
    setRootFiles,
    setProjectFiles,
    setOriginalFile,
  } = useDiag();
  const { processFile, isProcessing, progress, error: processingError } = useFileProcessor();
  const { parseFiles } = useDataParser();

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file || !file.name.endsWith('.zip')) {
        setError('Please select a valid ZIP file');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await processFile(file);

        setExtractedFiles(result.extractedFiles);
        setDiagType(result.diagType);
        setDsshome(result.dsshome);
        setRootFiles(result.rootFiles);
        setProjectFiles(result.projectFiles);
        setOriginalFile(result.originalFile);

        // Parse all the files
        parseFiles(
          result.extractedFiles,
          result.dsshome,
          result.projectFiles
        );

        setLoading(false);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(`Error processing the file: ${errorMessage}`);
        setLoading(false);
      }
    },
    [
      processFile,
      parseFiles,
      setExtractedFiles,
      setDiagType,
      setDsshome,
      setRootFiles,
      setProjectFiles,
      setOriginalFile,
      setLoading,
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

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

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
      <motion.div
        className={`
          dropzone w-full max-w-2xl p-12 cursor-pointer
          ${isDragging ? 'dragging animate-border-glow' : ''}
        `}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex flex-col items-center text-center">
          {/* Icon */}
          <motion.div
            className={`
              w-20 h-20 rounded-full flex items-center justify-center mb-6
              ${isDragging ? 'bg-[var(--neon-cyan)]/15' : 'bg-[var(--bg-glass)]'}
              border border-[var(--border-glass)]
            `}
            animate={{
              scale: isDragging ? 1.1 : 1,
              boxShadow: isDragging ? '0 0 30px rgba(0, 245, 255, 0.3)' : 'none',
            }}
            transition={{ duration: 0.2 }}
          >
            <svg
              className={`w-10 h-10 transition-colors duration-150 ${isDragging ? 'text-[var(--neon-cyan)]' : 'text-[var(--text-muted)]'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </motion.div>

          {/* Text */}
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
            {isDragging ? 'Drop your file here' : 'Drop your diagnostic ZIP file here'}
          </h2>
          <p className="text-[var(--text-muted)] mb-6">or click to select file</p>

          {/* Supported types */}
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm mb-6">
            <span className="text-[var(--text-muted)]">Supported:</span>
            <span className="badge badge-success">
              Instance Diag
            </span>
            <span className="badge badge-info">
              Job Diag
            </span>
            <span className="badge badge-purple">
              FM Diag
            </span>
          </div>

          {/* Button */}
          <motion.button
            type="button"
            className="btn-primary px-6 py-2.5 rounded-lg font-medium"
            onClick={(e) => {
              e.stopPropagation();
              handleClick();
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Select File
          </motion.button>

          {/* Privacy note */}
          <p className="mt-8 text-sm text-[var(--text-muted)] flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            Files are processed locally in your browser
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleFileSelect}
        />
      </motion.div>

      {processingError && (
        <motion.div
          className="mt-6 p-4 card-alert-critical rounded-lg max-w-2xl absolute bottom-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {processingError}
        </motion.div>
      )}
    </div>
  );
}
