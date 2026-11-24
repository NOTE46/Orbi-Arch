import type { AppSettings, FontSizeMode, ProviderId, RenderSession } from '../types/schema';
import { computeSessionStats, validateSession } from './graph';
import { MOCK_SESSIONS } from '../mocks/sessions';
import { clampCustomFontSize } from './theme';

export const ORBI_SESSIONS_KEY = 'orbi.v01.sessions';
export const ORBI_SETTINGS_KEY = 'orbi.v01.settings';
export const ORBI_THEME_KEY = 'orbi.v01.theme';
export const ORBI_FONT_SIZE_KEY = 'orbi.v01.fontSize';
export const ORBI_CUSTOM_FONT_SIZE_KEY = 'orbi.v01.customFontSize';
export const ORBI_SESSIONS_CORRUPT_KEY = 'orbi.v01.sessions.corrupt';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  fontSize: 'auto',
  customFontSize: 18,
  autosave: true,
  cheapModel: { provider: 'ollama', model: '' },
  strongModel: { provider: 'ollama', model: '' },
  providers: {
    ollama: {
      provider: 'ollama',
      label: 'Local (Ollama / llama.cpp)',
      isLocal: true,
      configured: true,
      baseUrl: 'http://127.0.0.1:11434',
    },
    openai: {
      provider: 'openai',
      label: 'OpenAI',
      isLocal: false,
      configured: false,
    },
    anthropic: {
      provider: 'anthropic',
      label: 'Anthropic',
      isLocal: false,
      configured: false,
    },
    custom: {
      provider: 'custom',
      label: 'Custom (OpenAI-compatible)',
      isLocal: false,
      configured: false,
    },
  },
};

export function validateBaseUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'URL must use http or https protocol';
    }
    return null;
  } catch {
    return 'Invalid URL format';
  }
}

export function isLocalBaseUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    let host = parsed.hostname;
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1);
    }
    if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  } catch {
    return false;
  }
}

export function maskKeyHint(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length < 12) return '••••';
  return '••••' + trimmed.slice(-4);
}

export function loadSessions(): RenderSession[] {
  try {
    if (typeof localStorage === 'undefined') return structuredClone(MOCK_SESSIONS);
    const raw = localStorage.getItem(ORBI_SESSIONS_KEY);
    if (raw === null) return structuredClone(MOCK_SESSIONS);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      localStorage.setItem(ORBI_SESSIONS_CORRUPT_KEY, raw);
      return structuredClone(MOCK_SESSIONS);
    }

    if (!Array.isArray(parsed)) {
      localStorage.setItem(ORBI_SESSIONS_CORRUPT_KEY, raw);
      return structuredClone(MOCK_SESSIONS);
    }

    if (parsed.length === 0) return [];

    let dropped = false;
    const validSessions: RenderSession[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        item.schema_version === '0.1' &&
        item.session &&
        typeof item.session.id === 'string' &&
        Array.isArray(item.containers) &&
        Array.isArray(item.nodes) &&
        Array.isArray(item.edges)
      ) {
        if (!item.overrides || typeof item.overrides !== 'object') {
          item.overrides = { positions: {}, renamed: {} };
        } else {
          item.overrides = {
            positions: item.overrides.positions ?? {},
            renamed: item.overrides.renamed ?? {},
          };
        }
        validSessions.push(item as RenderSession);
      } else {
        dropped = true;
      }
    }

    if (dropped) {
      localStorage.setItem(ORBI_SESSIONS_CORRUPT_KEY, raw);
    }

    return validSessions;
  } catch {
    return structuredClone(MOCK_SESSIONS);
  }
}

export function saveSessions(sessions: RenderSession[]): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(ORBI_SESSIONS_KEY, JSON.stringify(sessions));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(): AppSettings {
  const defaults = structuredClone(DEFAULT_SETTINGS);
  try {
    if (typeof localStorage === 'undefined') return defaults;
    const raw = localStorage.getItem(ORBI_SETTINGS_KEY);
    let settings = defaults;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          settings = {
            ...defaults,
            ...parsed,
            cheapModel: {
              ...defaults.cheapModel,
              ...(parsed.cheapModel && typeof parsed.cheapModel === 'object' ? parsed.cheapModel : {}),
            },
            strongModel: {
              ...defaults.strongModel,
              ...(parsed.strongModel && typeof parsed.strongModel === 'object' ? parsed.strongModel : {}),
            },
            providers: {
              ...defaults.providers,
            },
          };
          if (parsed.providers && typeof parsed.providers === 'object') {
            const known: ProviderId[] = ['ollama', 'openai', 'anthropic', 'custom'];
            for (const pid of known) {
              if (parsed.providers[pid] && typeof parsed.providers[pid] === 'object') {
                settings.providers[pid] = {
                  ...defaults.providers[pid],
                  ...parsed.providers[pid],
                };
              }
            }
          }
        }
      } catch {
        // Fallback to defaults
      }
    }

    // Upgrade legacy stored provider label 'Ollama (local)' to 'Local (Ollama / llama.cpp)'
    if (settings.providers?.ollama && settings.providers.ollama.label === 'Ollama (local)') {
      settings.providers.ollama.label = 'Local (Ollama / llama.cpp)';
    }

    // Validate theme
    if (settings.theme !== 'light' && settings.theme !== 'dark' && settings.theme !== 'system') {
      settings.theme = defaults.theme;
    }

    // Validate font size
    if ((settings.fontSize as string) === 'xl') {
      settings.fontSize = 'lg';
    }
    const validFontSizes: FontSizeMode[] = ['auto', 'sm', 'md', 'lg', 'custom'];
    if (!validFontSizes.includes(settings.fontSize)) {
      try {
        let stored = typeof localStorage !== 'undefined' ? (localStorage.getItem(ORBI_FONT_SIZE_KEY) as FontSizeMode) : null;
        if ((stored as string) === 'xl') stored = 'lg';
        settings.fontSize = stored && validFontSizes.includes(stored) ? stored : defaults.fontSize;
      } catch {
        settings.fontSize = defaults.fontSize;
      }
    }

    // Validate customFontSize
    let customSizeCandidate = typeof settings.customFontSize === 'number' ? settings.customFontSize : NaN;
    if (isNaN(customSizeCandidate) && typeof localStorage !== 'undefined') {
      try {
        const storedRaw = localStorage.getItem(ORBI_CUSTOM_FONT_SIZE_KEY);
        if (storedRaw !== null) {
          const parsedPx = parseInt(storedRaw, 10);
          if (!isNaN(parsedPx)) customSizeCandidate = parsedPx;
        }
      } catch {
        // Storage read error ignored
      }
    }
    settings.customFontSize = clampCustomFontSize(customSizeCandidate);

    // Validate cheap/strong model (allow empty string '', trimmed)
    const knownProviders: ProviderId[] = ['ollama', 'openai', 'anthropic', 'custom'];
    if (!knownProviders.includes(settings.cheapModel?.provider) || typeof settings.cheapModel?.model !== 'string') {
      settings.cheapModel = defaults.cheapModel;
    } else {
      settings.cheapModel.model = settings.cheapModel.model.trim();
    }
    if (!knownProviders.includes(settings.strongModel?.provider) || typeof settings.strongModel?.model !== 'string') {
      settings.strongModel = defaults.strongModel;
    } else {
      settings.strongModel.model = settings.strongModel.model.trim();
    }

    // Recompute isLocal and delete stray apiKey
    for (const pid of knownProviders) {
      const cfg = settings.providers[pid];
      if (cfg) {
        delete (cfg as unknown as Record<string, unknown>).apiKey;
        cfg.isLocal = isLocalBaseUrl(cfg.baseUrl);
      }
    }
    delete (settings as unknown as Record<string, unknown>).apiKey;
    if (settings.providers) {
      delete (settings.providers as unknown as Record<string, unknown>).apiKey;
    }

    // Check theme key disagreement
    try {
      const storedTheme = localStorage.getItem(ORBI_THEME_KEY);
      if (storedTheme !== settings.theme) {
        localStorage.setItem(ORBI_THEME_KEY, settings.theme);
      }
    } catch {
      // Storage write error should not prevent loading settings
    }

    // Check font size keys disagreement & sync
    try {
      const storedFontSize = localStorage.getItem(ORBI_FONT_SIZE_KEY);
      if (storedFontSize !== settings.fontSize) {
        localStorage.setItem(ORBI_FONT_SIZE_KEY, settings.fontSize);
      }
    } catch {
      // Storage write error ignored
    }
    try {
      const storedCustomPx = localStorage.getItem(ORBI_CUSTOM_FONT_SIZE_KEY);
      const expectedCustomPx = String(settings.customFontSize);
      if (storedCustomPx !== expectedCustomPx) {
        localStorage.setItem(ORBI_CUSTOM_FONT_SIZE_KEY, expectedCustomPx);
      }
    } catch {
      // Storage write error ignored
    }

    return settings;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(ORBI_SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem(ORBI_THEME_KEY, settings.theme);
    localStorage.setItem(ORBI_FONT_SIZE_KEY, settings.fontSize);
    localStorage.setItem(ORBI_CUSTOM_FONT_SIZE_KEY, String(clampCustomFontSize(settings.customFontSize)));
    return true;
  } catch {
    return false;
  }
}

export function resetDemoSessions(): RenderSession[] {
  const demos = structuredClone(MOCK_SESSIONS);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ORBI_SESSIONS_KEY, JSON.stringify(demos));
    }
  } catch {
    // Ignore storage errors on explicit reset
  }
  return demos;
}

export function sanitizeSessionForExport(session: RenderSession): RenderSession {
  const cloned: RenderSession = structuredClone(session);
  const origRef = cloned.session.source_ref ? cloned.session.source_ref.trim() : '';

  let isUrl = false;
  try {
    const u = new URL(origRef);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      isUrl = true;
    }
  } catch {
    isUrl = false;
  }

  let rootWithSlash = '';
  let rootWithoutSlash = '';
  let rootBackslash = '';

  if (!isUrl && origRef) {
    const rootForwardSlash = origRef.replace(/\\/g, '/');
    rootBackslash = origRef.replace(/\//g, '\\');
    rootWithoutSlash = rootForwardSlash.replace(/\/+$/, '');
    rootWithSlash = rootWithoutSlash + '/';
  }

  const idMap = new Map<string, string>();
  const reverseMap = new Map<string, string>();

  function mapPath(p: string): string {
    let mapped = p.replace(/\\/g, '/');
    if (mapped.startsWith('./')) mapped = mapped.slice(2);
    if (rootWithSlash) {
      if (mapped.toLowerCase().startsWith(rootWithSlash.toLowerCase())) {
        mapped = mapped.slice(rootWithSlash.length);
      } else if (mapped.toLowerCase().startsWith(rootWithoutSlash.toLowerCase())) {
        mapped = mapped.slice(rootWithoutSlash.length);
        if (mapped.startsWith('/')) mapped = mapped.slice(1);
      }
    }
    if (mapped.startsWith('./')) mapped = mapped.slice(2);
    if (mapped.startsWith('/')) mapped = mapped.slice(1);
    return mapped;
  }

  for (const node of cloned.nodes) {
    const mapped = mapPath(node.id);
    if (reverseMap.has(mapped) && reverseMap.get(mapped) !== node.id) {
      throw new Error(`ID mapping collision: ${node.id} and ${reverseMap.get(mapped)} both map to ${mapped}`);
    }
    idMap.set(node.id, mapped);
    reverseMap.set(mapped, node.id);
  }

  function resolveMappedId(id: string): string {
    if (idMap.has(id)) return idMap.get(id)!;
    return mapPath(id);
  }

  for (const node of cloned.nodes) {
    node.id = idMap.get(node.id) ?? node.id;
  }

  for (const edge of cloned.edges) {
    if (edge.scope === 'lld') {
      edge.source = resolveMappedId(edge.source);
      edge.target = resolveMappedId(edge.target);
    }
    if (edge.provenance === 'verified') {
      for (const ev of edge.evidence) {
        ev.file = resolveMappedId(ev.file);
      }
    }
  }

  const newPositions: Record<string, { x: number; y: number }> = {};
  for (const [k, v] of Object.entries(cloned.overrides?.positions ?? {})) {
    const newK = resolveMappedId(k);
    newPositions[newK] = v;
  }
  const newRenamed: Record<string, string> = {};
  for (const [k, v] of Object.entries(cloned.overrides?.renamed ?? {})) {
    const newK = resolveMappedId(k);
    newRenamed[newK] = v;
  }
  cloned.overrides = { positions: newPositions, renamed: newRenamed };

  if (isUrl) {
    const u = new URL(origRef);
    const pathname = u.pathname.replace(/\/+$/, '');
    cloned.session.source_ref = `https://${u.host}${pathname}`;
  } else if (origRef) {
    const cleaned = origRef.replace(/[\\/]+$/, '');
    const parts = cleaned.split(/[\\/]/);
    cloned.session.source_ref = parts[parts.length - 1] || cleaned;
  }

  function scrub(str: string): string {
    if (!str || !rootWithoutSlash) return str;
    const escFwd = rootWithoutSlash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escBack = (rootBackslash.replace(/\\+$/, '')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let res = str.replace(new RegExp(escFwd, 'gi'), '<repo>');
    if (escBack) {
      res = res.replace(new RegExp(escBack, 'gi'), '<repo>');
    }
    return res;
  }

  cloned.session.name = scrub(cloned.session.name);
  for (const c of cloned.containers) {
    c.label = scrub(c.label);
    c.summary = scrub(c.summary);
  }
  for (const n of cloned.nodes) {
    n.label = scrub(n.label);
    n.summary = scrub(n.summary);
    for (const s of n.symbols) {
      s.name = scrub(s.name);
      s.summary = scrub(s.summary);
    }
  }
  for (const e of cloned.edges) {
    e.label = scrub(e.label);
    if (e.provenance === 'inferred') {
      e.reason = scrub(e.reason);
    }
  }
  for (const [k, v] of Object.entries(cloned.overrides.renamed)) {
    cloned.overrides.renamed[k] = scrub(v);
  }

  cloned.session.stats = computeSessionStats(cloned.nodes, cloned.edges);

  const errs = validateSession(cloned);
  if (errs.length > 0) {
    throw new Error(`Export validation failed: ${errs.join('; ')}`);
  }

  return cloned;
}

export function createMockSession(sourceType: 'local' | 'github', target: string): RenderSession {
  const trimmedTarget = target.trim();
  const baseSession =
    MOCK_SESSIONS.find((s) => s.session.id === (sourceType === 'github' ? 'sess_ai_assistant' : 'sess_ecommerce')) ??
    MOCK_SESSIONS[0];
  const cloned: RenderSession = structuredClone(baseSession);

  const randSuffix =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  cloned.session.id = `sess_${randSuffix}`;

  let cleaned = trimmedTarget.replace(/[\\/]+$/, '');
  if (cleaned.toLowerCase().endsWith('.git')) {
    cleaned = cleaned.slice(0, -4);
  }
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  const baseName = parts[parts.length - 1] || 'Untitled';
  cloned.session.name = baseName;
  cloned.session.source_type = sourceType;
  cloned.session.source_ref = trimmedTarget;
  cloned.session.is_demo = true;
  cloned.session.dirty = sourceType === 'local';
  cloned.session.commit_sha = 'demo000';
  cloned.session.created_at = new Date().toISOString();
  cloned.overrides = { positions: {}, renamed: {} };
  cloned.session.stats = computeSessionStats(cloned.nodes, cloned.edges);

  return cloned;
}

export function syncAntiFlashKeys(settings: AppSettings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ORBI_THEME_KEY, settings.theme);
    localStorage.setItem(ORBI_FONT_SIZE_KEY, settings.fontSize);
    localStorage.setItem(ORBI_CUSTOM_FONT_SIZE_KEY, String(settings.customFontSize));
  } catch {
    // Ignore storage quota or access errors
  }
}

