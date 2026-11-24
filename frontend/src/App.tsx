import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AppSettings, LanguagePackStatus, ProviderConfig, ProviderId, RenderSession, SessionOverrides } from './types/schema';
import type { ActiveView, ScanStatus, SettingsTab } from './types/ui';
import { DEV_ORIGIN } from './lib/constants';
import { applyFontSize, applyTheme, subscribeSystemTheme } from './lib/theme';
import {
  checkHealth, deleteLanguagePack, deleteProviderKey, deleteSession, getSettings,
  installLanguagePack, listLanguagePacks, listSessions, patchSession, putProviderKey,
  putSettings, rescanSession, startScan, subscribeScanEvents,
} from './lib/api';
import {
  createMockSession, isLocalBaseUrl, loadSessions, loadSettings, maskKeyHint,
  resetDemoSessions, sanitizeSessionForExport, saveSessions, saveSettings,
  syncAntiFlashKeys, validateBaseUrl,
} from './lib/store';
import { Sidebar } from './components/Sidebar';
import { SessionOverview } from './components/SessionOverview';
import { Launcher } from './components/Launcher';

const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })));

const HelpView = lazy(() => import('./components/HelpView'));

export default function App() {
  const [sessions, setSessions] = useState<RenderSession[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('launcher');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus>({ state: 'idle' });
  const [rescanStatus, setRescanStatus] = useState<ScanStatus>({ state: 'idle' });
  const [storageError, setStorageError] = useState(false);
  const [backendMode, setBackendMode] = useState<'checking' | 'online' | 'offline'>('checking');
  const [notice, setNotice] = useState<string | null>(null);
  const [languagePacks, setLanguagePacks] = useState<LanguagePackStatus[]>([]);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');

  const activeScanCleanupRef = useRef<(() => void) | null>(null);
  const latestSessionsRef = useRef(sessions);
  latestSessionsRef.current = sessions;
  const prevAutosaveRef = useRef(settings.autosave);

  const connectBackend = async () => {
    setBackendMode('checking');
    const health = await checkHealth(2000);
    if (health?.status === 'ok') {
      try {
        const [backendSessions, backendSettings, backendPacks] = await Promise.all([
          listSessions(), getSettings(), listLanguagePacks().catch(() => []),
        ]);
        setSessions(backendSessions);
        setSettings(backendSettings);
        setLanguagePacks(backendPacks);
        syncAntiFlashKeys(backendSettings);
        saveSettings(backendSettings);
        setBackendMode('online');
        setActiveSessionId((curr) => (curr && !backendSessions.some((s) => s.session.id === curr) ? (setActiveView('launcher'), null) : curr));
        return;
      } catch { /* Fallback to offline on fetch failure */ }
    }
    setBackendMode('offline');
    setLanguagePacks([]);
    setSessions((prev) => (prev.length === 0 ? loadSessions() : prev));
    setSettings(loadSettings());
  };

  useEffect(() => {
    void connectBackend();
    return () => { activeScanCleanupRef.current?.(); };
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme === 'system') return subscribeSystemTheme(() => applyTheme('system'));
  }, [settings.theme]);

  useEffect(() => {
    applyFontSize(settings.fontSize, settings.customFontSize);
  }, [settings.fontSize, settings.customFontSize]);

  useEffect(() => {
    if (backendMode !== 'offline') return;
    if (!saveSettings(settings)) setStorageError(true);
  }, [settings, backendMode]);

  useEffect(() => {
    if (backendMode !== 'offline') return;
    if (!settings.autosave) { prevAutosaveRef.current = false; return; }
    if (!prevAutosaveRef.current) {
      prevAutosaveRef.current = true;
      if (!saveSessions(latestSessionsRef.current)) setStorageError(true);
      return;
    }
    const timer = setTimeout(() => {
      if (!saveSessions(latestSessionsRef.current)) setStorageError(true);
    }, 400);
    return () => clearTimeout(timer);
  }, [sessions, settings.autosave, backendMode]);

  useEffect(() => {
    const onPageHide = () => {
      if (backendMode === 'offline' && settings.autosave) saveSessions(latestSessionsRef.current);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [settings.autosave, backendMode]);

  const handleStartScan = async (sourceType: 'local' | 'github', target: string) => {
    const trimmed = target.trim();
    if (!trimmed) return;
    if (backendMode === 'online') {
      activeScanCleanupRef.current?.();
      setNotice(null);
      setScanStatus({ state: 'running', progress: 0.05, message: 'Starting scan...' });
      try {
        const { job_id } = await startScan(sourceType, trimmed, true);
        activeScanCleanupRef.current = subscribeScanEvents(job_id, {
          onProgress: (message, progress) => setScanStatus({ state: 'running', progress, message }),
          onComplete: (newSession, warnings) => {
            setScanStatus({ state: 'idle' });
            setSessions((prev) => [newSession, ...prev.filter((s) => s.session.id !== newSession.session.id)]);
            setActiveSessionId(newSession.session.id);
            setActiveView('session');
            if (warnings?.length) setNotice(warnings[0]);
          },
          onError: (message) => setScanStatus({ state: 'error', message }),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to start scan';
        setScanStatus({ state: 'error', message: msg });
        throw err;
      }
    } else {
      const newSession = createMockSession(sourceType, trimmed);
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.session.id);
      setActiveView('session');
    }
  };

  const handleSelectSession = (id: string) => { setRescanStatus({ state: 'idle' }); setActiveSessionId(id); setActiveView('session'); };
  const handleNewSession = () => { setRescanStatus({ state: 'idle' }); setActiveSessionId(null); setActiveView('launcher'); };

  const handleRescanSession = async (sessionId: string) => {
    if (backendMode !== 'online') { setNotice('Start the local backend (127.0.0.1:8000) to re-scan repositories.'); return; }
    activeScanCleanupRef.current?.(); setNotice(null);
    setRescanStatus({ state: 'running', progress: 0.05, message: 'Starting re-scan...' });
    try {
      const { job_id } = await rescanSession(sessionId, true);
      activeScanCleanupRef.current = subscribeScanEvents(job_id, {
        onProgress: (message, progress) => setRescanStatus({ state: 'running', progress, message }),
        onComplete: (updatedSession, warnings) => {
          setRescanStatus({ state: 'idle' });
          setSessions((prev) => prev.map((s) => (s.session.id === updatedSession.session.id ? updatedSession : s)));
          setNotice(warnings?.length ? warnings[0] : 'Re-scan complete — layout overrides preserved.');
        },
        onError: (message) => setRescanStatus({ state: 'error', message }),
      });
    } catch (err: unknown) {
      setRescanStatus({ state: 'error', message: err instanceof Error ? err.message : 'Failed to start re-scan' });
    }
  };

  const handleRenameSession = async (id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const capped = trimmed.slice(0, 80);
    if (backendMode === 'online') {
      const updated = await patchSession(id, { name: capped });
      setSessions((prev) => prev.map((s) => (s.session.id === id ? updated : s)));
    } else {
      setSessions((prev) => prev.map((s) => (s.session.id === id ? { ...s, session: { ...s.session, name: capped } } : s)));
    }
  };

  const handleDeleteSession = async (id: string) => {
    const idx = sessions.findIndex((s) => s.session.id === id);
    if (idx === -1) return;
    if (backendMode === 'online') await deleteSession(id);
    const nextSessions = sessions.filter((s) => s.session.id !== id);
    if (activeSessionId === id) {
      const nextActive = nextSessions[idx] ?? nextSessions[idx - 1];
      setActiveSessionId(nextActive ? nextActive.session.id : (setActiveView('launcher'), null));
    }
    setSessions(nextSessions);
  };

  const handleUpdateOverrides = async (id: string, overrides: SessionOverrides) => {
    setSessions((prev) => prev.map((s) => (s.session.id === id ? { ...s, overrides } : s)));
    if (backendMode === 'online') {
      try {
        await patchSession(id, { overrides });
      } catch (err: unknown) {
        setNotice(err instanceof Error ? err.message : 'Failed to save layout overrides');
        throw err;
      }
    }
  };

  const handleUpdateSettings = async (next: AppSettings) => {
    if (backendMode === 'online') {
      const saved = await putSettings(next);
      syncAntiFlashKeys(saved);
      saveSettings(saved);
      setSettings(saved);
    } else {
      setSettings(next);
    }
  };

  const handleSaveProviderKey = async (provider: ProviderId, rawKey: string, baseUrl?: string) => {
    const key = rawKey.trim();
    const existingCfg = settings.providers[provider];
    let url = baseUrl?.trim() || existingCfg?.baseUrl || (provider === 'ollama' ? 'http://127.0.0.1:11434' : undefined);
    if (url && validateBaseUrl(url) !== null) return;
    if (provider === 'custom' && !url) return;
    if (provider !== 'ollama' && !key && !existingCfg?.configured) return;

    if (backendMode === 'online') {
      const updatedCfg = await putProviderKey(provider, key, url);
      const nextSettings: AppSettings = { ...settings, providers: { ...settings.providers, [provider]: updatedCfg } };
      saveSettings(nextSettings);
      setSettings(nextSettings);
    } else {
      const nextCfg: ProviderConfig = {
        ...existingCfg, configured: true, hint: key ? maskKeyHint(key) : existingCfg.hint,
        baseUrl: url, isLocal: url ? isLocalBaseUrl(url) : false,
      };
      setSettings((prev) => ({ ...prev, providers: { ...prev.providers, [provider]: nextCfg } }));
    }
  };

  const handleRemoveProviderKey = async (provider: ProviderId) => {
    if (backendMode === 'online') {
      const updatedCfg = await deleteProviderKey(provider);
      const nextSettings: AppSettings = { ...settings, providers: { ...settings.providers, [provider]: updatedCfg } };
      saveSettings(nextSettings);
      setSettings(nextSettings);
    } else {
      const existingCfg = settings.providers[provider];
      const defaultUrl = provider === 'ollama' ? 'http://127.0.0.1:11434' : undefined;
      const nextCfg: ProviderConfig = {
        ...existingCfg, configured: false, hint: undefined, baseUrl: defaultUrl,
        isLocal: defaultUrl ? isLocalBaseUrl(defaultUrl) : false,
      };
      setSettings((prev) => ({ ...prev, providers: { ...prev.providers, [provider]: nextCfg } }));
    }
  };

  const handleResetDemoData = () => {
    if (backendMode === 'online') {
      setNotice('Connected to local backend — demo reset is only available in offline demo mode.');
      return;
    }
    const demos = resetDemoSessions();
    setSessions(demos);
    setActiveSessionId(demos[0] ? (setActiveView('session'), demos[0].session.id) : (setActiveView('launcher'), null));
  };

  const handleInstallLanguagePack = async (packId: string) => {
    const updated = await installLanguagePack(packId);
    setLanguagePacks((prev) => prev.map((p) => (p.id === packId ? updated : p)));
  };
  const handleDeleteLanguagePack = async (packId: string) => {
    const updated = await deleteLanguagePack(packId);
    setLanguagePacks((prev) => prev.map((p) => (p.id === packId ? updated : p)));
  };
  const handleOpenLanguageSettings = () => { setSettingsTab('languages'); setActiveView('settings'); };
  const handleOpenSettings = () => { setSettingsTab('general'); setActiveView('settings'); };

  const handleExportJson = (session: RenderSession) => {
    try {
      const sanitized = sanitizeSessionForExport(session);
      const blob = new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const safeName = session.session.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'session';
      const a = document.createElement('a');
      a.href = url; a.download = `${safeName}.orbi.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const isNotDevOrigin = typeof window !== 'undefined' && window.location.hostname !== '127.0.0.1';
  const activeSession = sessions.find((s) => s.session.id === activeSessionId);
  const showLauncher = activeView === 'launcher' || (activeView === 'session' && !activeSession);

  return (
    <div className="h-screen overflow-hidden flex bg-canvas text-fg">
      <Sidebar
        sessions={sessions} activeSessionId={activeSessionId} activeView={activeView}
        collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        onSelectSession={handleSelectSession} onNewSession={handleNewSession}
        onOpenSettings={handleOpenSettings}
        onOpenHelp={() => setActiveView('help')} onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession} isHydrating={backendMode === 'checking'}
      />
      <main className="flex-1 min-w-0 overflow-auto">
        {backendMode === 'offline' && (
          <div className="bg-surface border-b border-line px-4 py-1.5 text-xs text-muted flex items-center justify-between">
            <span>Local backend not running on 127.0.0.1:8000 — using Demo Mode.</span>
            <button
              type="button" onClick={() => void connectBackend()}
              className="cursor-pointer text-fg hover:text-accent font-medium px-2 py-0.5 rounded border border-line bg-canvas hover:bg-surface transition-colors"
            >
              Retry
            </button>
          </div>
        )}
        {notice && (
          <div className="bg-surface border-b border-line px-4 py-1.5 text-xs text-fg flex items-center justify-between gap-3">
            <span className="truncate min-w-0">{notice}</span>
            <div className="flex items-center gap-2 shrink-0">
              {notice.includes('Settings -> Languages') && (
                <button
                  type="button" onClick={() => { handleOpenLanguageSettings(); setNotice(null); }}
                  className="font-medium text-accent hover:underline cursor-pointer"
                >
                  Open Languages
                </button>
              )}
              <button
                type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice"
                className="cursor-pointer text-muted hover:text-fg p-0.5 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        {storageError && backendMode === 'offline' && (
          <div className="bg-elevated text-inferred border-b border-line px-4 py-2 text-xs">
            Couldn&apos;t save to device storage (full or blocked). Changes are in memory only; export JSON to keep them.
          </div>
        )}
        {isNotDevOrigin && (
          <div className="bg-elevated text-muted border-b border-line px-4 py-2 text-xs">
            Sessions are stored per origin. Open ORBI-ARCH at {DEV_ORIGIN} to see your saved sessions.
          </div>
        )}

        {showLauncher && (
          <Launcher
            settings={settings} scan={scanStatus} onStartScan={handleStartScan}
            onOpenSettings={handleOpenSettings}
            isHydrating={backendMode === 'checking'} backendOnline={backendMode === 'online'}
            installedPackCount={languagePacks.filter((p) => p.installed).length}
            onOpenLanguageSettings={handleOpenLanguageSettings}
          />
        )}

        {activeView === 'session' && activeSession && (
          <SessionOverview
            session={activeSession} onUpdateOverrides={handleUpdateOverrides}
            onExportJson={handleExportJson} onBackToLauncher={handleNewSession}
            canRescan={backendMode === 'online' && !activeSession.session.is_demo}
            rescanStatus={rescanStatus} onRescanSession={handleRescanSession}
          />
        )}

        {activeView === 'settings' && (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted">Loading settings...</div>}>
            <SettingsView
              settings={settings} onUpdateSettings={handleUpdateSettings}
              onSaveProviderKey={handleSaveProviderKey} onRemoveProviderKey={handleRemoveProviderKey}
              onResetDemoData={handleResetDemoData} initialTab={settingsTab}
              backendOnline={backendMode === 'online'} languagePacks={languagePacks}
              onInstallLanguagePack={handleInstallLanguagePack} onDeleteLanguagePack={handleDeleteLanguagePack}
            />
          </Suspense>
        )}

        {activeView === 'help' && (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted">Loading help...</div>}>
            <HelpView onNewSession={handleNewSession} onOpenSettings={handleOpenSettings} onOpenLanguages={handleOpenLanguageSettings} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
