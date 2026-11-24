/**
 * RULES FOR LATER PROMPTS:
 * 1. Use only the semantic theme utilities (bg-canvas, bg-surface, bg-elevated, border-line, text-fg, text-muted, bg-accent, hover:bg-accent-hover, text-verified, border-verified, text-inferred, border-inferred). No arbitrary CSS-var colors, no backdrop-blur, no heavy shadows.
 * 2. Verified = solid + --verified; inferred = dashed + --inferred.
 * 3. LLD views MUST use getLldSlice(); file counts MUST use getContainerFileCount().
 * 4. Show a persistent DEMO_NOTICE badge whenever session.session.is_demo is true.
 * 5. Settings: key inputs are type="password" with autoComplete="off", cleared after save, NO reveal eye icon; display KEY_STORAGE_NOTICE; validate URLs with validateBaseUrl before saving; show a "your code will leave this machine" notice whenever the selected cheap or strong provider has isLocal === false.
 * 6. Launcher: the local source is a typed/pasted path (browsers cannot return absolute paths from a folder picker, so no Browse button); GitHub accepts only https://github.com/<owner>/<repo>; render the scan status.
 * 7. No localStorage outside store.ts. No new dependencies unless explicitly authorized. Do NOT edit frozen files; if a contract is insufficient, STOP and report instead of changing it.
 * 8. Handlers may be async: await them and surface errors cleanly.
 */
import type { AppSettings, LanguagePackStatus, ProviderId, RenderSession, SessionOverrides } from './schema';

export type ActiveView = 'launcher' | 'session' | 'settings' | 'help';
export type SettingsTab = 'general' | 'api' | 'keys' | 'languages' | 'appearance' | 'about';

export interface ScanStatus {
  state: 'idle' | 'running' | 'error';
  message?: string;
  progress?: number; // 0..1
}

// All mutation handlers allow void | Promise<void> so backend wiring needs zero signature changes.
export interface SidebarProps {
  sessions: RenderSession[];
  activeSessionId: string | null;
  activeView: ActiveView;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onRenameSession: (id: string, newName: string) => void | Promise<void>;
  onDeleteSession: (id: string) => void | Promise<void>;
  isHydrating?: boolean;
}

export interface LauncherProps {
  settings: AppSettings;
  scan?: ScanStatus;
  onStartScan: (sourceType: 'local' | 'github', target: string) => void | Promise<void>;
  onOpenSettings: () => void;
  isHydrating?: boolean;
  backendOnline?: boolean;
  installedPackCount?: number;
  onOpenLanguageSettings?: () => void;
}

export interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void | Promise<void>;
  onSaveProviderKey: (provider: ProviderId, rawKey: string, baseUrl?: string) => void | Promise<void>;
  onRemoveProviderKey: (provider: ProviderId) => void | Promise<void>;
  onResetDemoData: () => void | Promise<void>;
  initialTab?: SettingsTab;
  backendOnline?: boolean;
  languagePacks?: LanguagePackStatus[];
  onInstallLanguagePack?: (packId: string) => Promise<void>;
  onDeleteLanguagePack?: (packId: string) => Promise<void>;
}

export interface SessionOverviewProps {
  session: RenderSession;
  onUpdateOverrides: (sessionId: string, overrides: SessionOverrides) => void | Promise<void>;
  onExportJson: (session: RenderSession) => void;
  onBackToLauncher: () => void;
  canRescan?: boolean;
  rescanStatus?: ScanStatus;
  onRescanSession?: (sessionId: string) => Promise<void>;
}
