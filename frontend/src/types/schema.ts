// ACCESSIBILITY: 'verified' => solid line + --verified; 'inferred' => dashed line + --inferred.
// PATHS: every file path is repo-relative, forward-slash, no leading "./", no drive letter.
export type Provenance = 'verified' | 'inferred';

export interface EdgeEvidence { file: string; line: number; } // 1-based line

export interface CodeSymbol {
  kind: 'class' | 'function' | 'method' | 'const';
  name: string;
  line: number;
  summary: string;
}

// IDs start with "c_". Derive file count via getContainerFileCount().
export interface HldContainer {
  id: string;
  label: string;
  category: 'frontend' | 'api' | 'service' | 'data' | 'external';
  summary: string;
}

export type SupportedLanguage =
  | 'python'
  | 'typescript'
  | 'javascript'
  | 'c'
  | 'cpp'
  | 'java'
  | 'go'
  | 'rust'
  | 'csharp'
  | 'other';

// id is ALWAYS the repo-relative forward-slash file path, e.g. "src/services/order_service.py"
export interface LldFileNode {
  id: string;
  container_id: string;
  label: string;
  language: SupportedLanguage;
  summary: string;
  line_count: number;
  symbols: CodeSymbol[];
}

export interface ArchEdgeBase {
  id: string;
  scope: 'hld' | 'lld';
  source: string; // hld: container id; lld: node (file path) id
  target: string;
  label: string;
}
export interface VerifiedEdge extends ArchEdgeBase {
  provenance: 'verified';
  evidence: [EdgeEvidence, ...EdgeEvidence[]]; // non-empty tuple
}
export interface InferredEdge extends ArchEdgeBase {
  provenance: 'inferred';
  reason: string;
}
export type ArchEdge = VerifiedEdge | InferredEdge;

export interface SessionOverrides {
  positions: Record<string, { x: number; y: number }>; // keys: container or node ids
  renamed: Record<string, string>;                      // keys: container or node ids
}

export interface SessionMeta {
  id: string;
  name: string;
  source_type: 'local' | 'github';
  source_ref: string;
  commit_sha: string;
  dirty?: boolean;
  is_demo?: boolean;
  created_at: string; // ISO 8601
  stats: { files_scanned: number; verified_edges: number; inferred_edges: number }; // across BOTH scopes
}

export interface RenderSession {
  schema_version: '0.1';
  session: SessionMeta;
  containers: HldContainer[];
  nodes: LldFileNode[];
  edges: ArchEdge[];
  overrides: SessionOverrides;
}

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontSizeMode = 'auto' | 'sm' | 'md' | 'lg' | 'custom';
export type ProviderId = 'ollama' | 'openai' | 'anthropic' | 'custom';

// SECURITY: NEVER add a plaintext apiKey field here or anywhere in persisted state.
export interface ProviderConfig {
  provider: ProviderId;
  label: string;
  isLocal: boolean; // derived from baseUrl via isLocalBaseUrl(); drives the cloud privacy notice
  configured: boolean;
  hint?: string;
  baseUrl?: string;
}

export interface AppSettings {
  theme: ThemeMode;
  fontSize: FontSizeMode;
  customFontSize: number;
  autosave: boolean;
  cheapModel: { provider: ProviderId; model: string };
  strongModel: { provider: ProviderId; model: string };
  providers: Record<ProviderId, ProviderConfig>;
}

export interface LanguagePackStatus {
  id: string;
  label: string;
  extensions: string[];
  grammars: string[];
  installed: boolean;
  size_bytes: number;
}
