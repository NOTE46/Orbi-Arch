import type { AppSettings, LanguagePackStatus, ProviderConfig, ProviderId, RenderSession, SessionOverrides } from '../types/schema';
import { API_BASE_URL } from './constants';

export interface HealthResponse {
  status: 'ok';
  version: string;
  db_path: string;
  keyring_available: boolean;
}

export interface ScanStartResponse {
  job_id: string;
  status: 'queued' | 'running';
}

export type ScanEvent =
  | { event: 'progress'; progress: number; message: string }
  | {
      event: 'complete';
      progress: number;
      session: RenderSession;
      warnings?: string[];
      ai_applied?: boolean;
    }
  | { event: 'error'; message: string };

async function apiFetch<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller?.signal ?? init?.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const data = await res.json();
        detail = typeof data?.detail === 'string' ? data.detail : '';
      } catch {
        // Ignore non-JSON error payloads
      }
      throw new Error(detail || `Request failed (HTTP ${res.status})`);
    }
    return (await res.json()) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkHealth(timeoutMs = 2000): Promise<HealthResponse | null> {
  try {
    return await apiFetch<HealthResponse>('/api/health', undefined, timeoutMs);
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<RenderSession[]> {
  return apiFetch<RenderSession[]>('/api/sessions');
}

export async function patchSession(
  id: string,
  patch: { name?: string; overrides?: SessionOverrides }
): Promise<RenderSession> {
  return apiFetch<RenderSession>(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteSession(id: string): Promise<void> {
  await apiFetch<void>(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function getSettings(): Promise<AppSettings> {
  return apiFetch<AppSettings>('/api/settings');
}

export async function putSettings(settings: AppSettings): Promise<AppSettings> {
  return apiFetch<AppSettings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function putProviderKey(
  provider: ProviderId,
  apiKey: string,
  baseUrl?: string
): Promise<ProviderConfig> {
  return apiFetch<ProviderConfig>(`/api/providers/${encodeURIComponent(provider)}/key`, {
    method: 'PUT',
    body: JSON.stringify({ api_key: apiKey, base_url: baseUrl ?? null }),
  });
}

export async function deleteProviderKey(provider: ProviderId): Promise<ProviderConfig> {
  return apiFetch<ProviderConfig>(`/api/providers/${encodeURIComponent(provider)}/key`, {
    method: 'DELETE',
  });
}

export async function listLanguagePacks(): Promise<LanguagePackStatus[]> {
  return apiFetch<LanguagePackStatus[]>('/api/languages');
}

export async function installLanguagePack(packId: string): Promise<LanguagePackStatus> {
  return apiFetch<LanguagePackStatus>(`/api/languages/${encodeURIComponent(packId)}/install`, { method: 'POST' }, 60000);
}

export async function deleteLanguagePack(packId: string): Promise<LanguagePackStatus> {
  return apiFetch<LanguagePackStatus>(`/api/languages/${encodeURIComponent(packId)}`, { method: 'DELETE' });
}

export async function startScan(
  sourceType: 'local' | 'github',
  target: string,
  useAi = true
): Promise<ScanStartResponse> {
  return apiFetch<ScanStartResponse>('/api/scans', {
    method: 'POST',
    body: JSON.stringify({ source_type: sourceType, target, use_ai: useAi }),
  });
}

export async function rescanSession(sessionId: string, useAi = true): Promise<ScanStartResponse> {
  return apiFetch<ScanStartResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/rescan`, {
    method: 'POST',
    body: JSON.stringify({ use_ai: useAi }),
  });
}

export function subscribeScanEvents(
  jobId: string,
  handlers: {
    onProgress: (message: string, progress: number) => void;
    onComplete: (session: RenderSession, warnings: string[], aiApplied: boolean) => void;
    onError: (message: string) => void;
  }
): () => void {
  let closed = false;
  const es = new EventSource(`${API_BASE_URL}/api/scans/${encodeURIComponent(jobId)}/events`);

  const close = () => {
    if (!closed) {
      closed = true;
      es.close();
    }
  };

  es.onmessage = (evt) => {
    if (closed) return;
    try {
      const data = JSON.parse(evt.data) as ScanEvent;
      if (data.event === 'progress') {
        handlers.onProgress(data.message, data.progress);
      } else if (data.event === 'complete') {
        close();
        handlers.onComplete(data.session, data.warnings ?? [], data.ai_applied ?? false);
      } else if (data.event === 'error') {
        close();
        handlers.onError(data.message);
      }
    } catch {
      // Ignore malformed SSE chunks
    }
  };

  es.onerror = () => {
    if (!closed) {
      close();
      handlers.onError('Lost connection to local backend during scan.');
    }
  };

  return close;
}
