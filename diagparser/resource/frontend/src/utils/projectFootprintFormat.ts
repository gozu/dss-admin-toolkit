import type { ProjectFootprintHealth, ProjectRow } from '../types';

export function formatGb(bytes: number | undefined): string {
  const gb = (bytes || 0) / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
}

export function formatAuto(bytes: number | undefined): string {
  const value = bytes || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const decimals = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)} ${units[idx]}`;
}

export function healthCellClass(value: ProjectFootprintHealth | undefined): string {
  if (!value) return 'text-[var(--text-secondary)]';
  if (value === 'green') {
    return 'text-[var(--neon-green)]';
  }
  if (value === 'yellow') {
    return 'text-[#facc15]';
  }
  if (value === 'orange') {
    return 'text-[var(--neon-amber)]';
  }
  // 'red' and legacy 'angry-red' both collapse to plain red.
  return 'text-[var(--neon-red)]';
}

export function codeEnvCountClass(count: number): string {
  if (count >= 4) return 'text-[var(--neon-red)]';
  if (count === 3) return 'text-[var(--neon-amber)]';
  if (count === 2) return 'text-[#facc15]';
  return 'text-[var(--neon-green)]';
}

export function codeStudioCountClass(count: number): string {
  if (count > 7) return 'text-[var(--neon-red)]';
  if (count > 4) return 'text-[var(--neon-amber)]';
  if (count > 2) return 'text-[#facc15]';
  return 'text-[var(--neon-green)]';
}

export function computeOtherBytes(fp: NonNullable<ProjectRow['footprint']>): number {
  const known = (fp.bundleBytes || 0) + (fp.managedDatasetsBytes || 0) + (fp.managedFoldersBytes || 0);
  return Math.max(0, (fp.totalBytes || 0) - known);
}
