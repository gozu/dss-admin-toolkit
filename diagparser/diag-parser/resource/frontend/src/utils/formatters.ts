/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format camelCase or PascalCase to human-readable string
 */
export function formatCamelCase(
  str: string,
  options: { replaceDots?: boolean; expandAbbreviations?: boolean } = {}
): string {
  let result = str
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase());

  if (options.replaceDots) {
    result = result.replace(/\./g, ' ');
  }
  if (options.expandAbbreviations) {
    result = result.replace('Max', 'Maximum').replace('Min', 'Minimum');
  }

  return result.trim();
}

/**
 * Parse numeric value from string (removes non-numeric characters except decimal)
 */
export function parseNumericValue(str: string): number {
  return parseFloat(str.replace(/[^0-9.]/g, ''));
}

/**
 * Format a key for display (replace dots and underscores with spaces)
 */
export function formatKey(key: string): string {
  return key
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/Settings/g, '')
    .replace(/enabled/g, '')
    .trim();
}

/**
 * Parse size string (like "10G" or "1.5T") to GB
 */
export function parseSizeToGB(sizeStr: string): number {
  if (!sizeStr) return 0;

  const value = parseNumericValue(sizeStr);
  if (sizeStr.includes('T')) {
    return value * 1024; // TB to GB
  } else if (sizeStr.includes('G')) {
    return value; // Already in GB
  } else if (sizeStr.includes('M')) {
    return value / 1024; // MB to GB
  } else if (sizeStr.includes('K')) {
    return value / (1024 * 1024); // KB to GB
  }
  return value;
}

/**
 * Format memory value in MB to human-readable string
 */
export function formatMemory(mbValue: number): string {
  if (mbValue >= 1024) {
    return `${(mbValue / 1024).toFixed(2)} GB`;
  } else {
    return `${mbValue.toLocaleString()} MB`;
  }
}

/**
 * Format date string (YYYYMMDD format) to human-readable
 */
export function formatDateString(dateString: string): string {
  if (dateString && dateString.length === 8) {
    const year = dateString.substring(0, 4);
    const month = dateString.substring(4, 6);
    const day = dateString.substring(6, 8);
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return (
      date.getDate() +
      ' ' +
      date.toLocaleString('en-US', { month: 'short' }) +
      ' ' +
      date.getFullYear()
    );
  }
  return dateString;
}

/**
 * Truncate string with ellipsis
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}
