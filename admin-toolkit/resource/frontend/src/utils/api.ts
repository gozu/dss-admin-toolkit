export function getBackendUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const maybeDataiku = (globalThis as unknown as { dataiku?: { getWebAppBackendUrl?: (p: string) => string } }).dataiku;
  if (maybeDataiku?.getWebAppBackendUrl) {
    return maybeDataiku.getWebAppBackendUrl(path);
  }
  return path;
}

export class ApiRequestError extends Error {
  status: number;
  statusText: string;
  url: string;
  bodySnippet: string;

  constructor(status: number, statusText: string, url: string, bodySnippet: string) {
    const withBody = bodySnippet ? ` - ${bodySnippet}` : '';
    super(`Request failed: ${status} ${statusText} (${url})${withBody}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.statusText = statusText;
    this.url = url;
    this.bodySnippet = bodySnippet;
  }
}

async function toApiError(response: Response, url: string): Promise<ApiRequestError> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  const compact = body.replace(/\s+/g, ' ').trim().slice(0, 240);
  return new ApiRequestError(response.status, response.statusText, url, compact);
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = getBackendUrl(path);
  const method = init?.method ?? 'GET';
  const t0 = performance.now();
  console.log(`[api] ${method} ${path} → ${url}`);
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
  });
  const elapsed = (performance.now() - t0).toFixed(0);
  if (!response.ok) {
    console.error(`[api] ${method} ${path} → ${response.status} ${response.statusText} (${elapsed}ms)`);
    throw await toApiError(response, url);
  }
  console.log(`[api] ${method} ${path} → ${response.status} OK (${elapsed}ms)`);
  return response.json() as Promise<T>;
}

export async function fetchText(path: string, init?: RequestInit): Promise<string> {
  const url = getBackendUrl(path);
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
  });
  if (!response.ok) {
    throw await toApiError(response, url);
  }
  return response.text();
}
