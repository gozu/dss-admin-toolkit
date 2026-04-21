import { useEffect, useMemo } from 'react';
import { useDiag } from '../context/DiagContext';
import { CodeEnvSizesParser } from '../parsers';

export function useCodeEnvSizes(): Record<string, number> {
  const { state, setParsedData } = useDiag();
  const { parsedData } = state;

  const sizes = useMemo(() => {
    if (!parsedData.dirTree?.root) return undefined;
    return new CodeEnvSizesParser(parsedData.dirTree).parse().codeEnvSizes;
  }, [parsedData.dirTree]);

  useEffect(() => {
    if (!sizes) return;
    setParsedData({ codeEnvSizes: sizes });
  }, [sizes, setParsedData]);

  return parsedData.codeEnvSizes || {};
}
