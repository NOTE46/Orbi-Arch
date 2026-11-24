import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AlertTriangle, Check, ChevronDown, ShieldCheck, X } from 'lucide-react';
import { DEV_ORIGIN, KEY_STORAGE_NOTICE } from '../lib/constants';
import { isLocalBaseUrl, validateBaseUrl } from '../lib/store';
import { clampCustomFontSize } from '../lib/theme';
import type { FontSizeMode, ProviderId, ThemeMode } from '../types/schema';
import type { SettingsTab, SettingsViewProps } from '../types/ui';
import { LanguagePacksTab } from './LanguagePacksTab';

type TabId = Extract<SettingsTab, 'general' | 'api' | 'languages' | 'appearance' | 'about'>;

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'api', label: 'API Keys & Models' },
  { id: 'languages', label: 'Languages' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'about', label: 'About' },
];

const THEMES: { id: ThemeMode; label: string; desc: string }[] = [
  { id: 'light', label: 'Light', desc: 'Clean high-contrast workspace.' },
  { id: 'dark', label: 'Dark', desc: 'Deep graphite charcoal with indigo accents.' },
  { id: 'system', label: 'System', desc: 'Follows system preference.' },
];

const FONT_SIZES: { id: FontSizeMode; label: string; desc: string }[] = [
  { id: 'auto', label: 'Auto', desc: 'Scales with display' },
  { id: 'sm', label: 'Small', desc: '16px' },
  { id: 'md', label: 'Medium', desc: '18px' },
  { id: 'lg', label: 'Large', desc: '20px' },
  { id: 'custom', label: 'Custom', desc: 'Custom size' },
];

const PROVIDER_OPTIONS: { id: ProviderId; label: string }[] = [
  { id: 'ollama', label: 'Local (Ollama / llama.cpp)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'custom', label: 'Custom' },
];

const CLOUD_PROVIDER_MODELS: Record<'openai' | 'anthropic', { cheap: string; strong: string; presets: string[] }> = {
  openai: {
    cheap: 'gpt-6-luna',
    strong: 'gpt-6.2-sol',
    presets: ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-6.2-astra'],
  },
  anthropic: {
    cheap: 'claude-haiku-5-5',
    strong: 'claude-sonnet-5-5',
    presets: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'],
  },
};

const SECURITY_BADGES = [
  { title: 'Zero code execution', desc: 'Static AST analysis only; code is never executed.' },
  { title: 'Secrets & .env blocked', desc: 'Key files and credentials are strictly skipped.' },
  { title: 'Localhost-only 127.0.0.1', desc: 'All endpoints bind strictly to loopback interface.' },
  { title: 'Write-only credentials', desc: KEY_STORAGE_NOTICE },
];

const INPUT_CLS = 'px-3.5 py-2.5 rounded-xl border border-line bg-canvas text-fg placeholder:text-muted/60 focus:border-accent disabled:opacity-50 text-xs';
const BTN_ACCENT = 'px-4 py-2.5 rounded-xl font-medium bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-50 cursor-pointer text-xs';
const BTN_GHOST = 'px-3.5 py-2.5 rounded-xl border border-line bg-surface text-muted hover:text-fg cursor-pointer text-xs';

export function SettingsView({
  settings,
  onUpdateSettings,
  onSaveProviderKey,
  onRemoveProviderKey,
  onResetDemoData,
  initialTab,
  backendOnline = false,
  languagePacks = [],
  onInstallLanguagePack,
  onDeleteLanguagePack,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (initialTab === 'keys') return 'api';
    return (initialTab as TabId) ?? 'general';
  });

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab === 'keys' ? 'api' : (initialTab as TabId));
      setError(null);
    }
  }, [initialTab]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ProviderId | null>(null);

  const [draftModels, setDraftModels] = useState({
    cheapModel: settings.cheapModel.model,
    strongModel: settings.strongModel.model,
  });
  const [customEditingTiers, setCustomEditingTiers] = useState<{ cheapModel: boolean; strongModel: boolean }>({
    cheapModel: false,
    strongModel: false,
  });
  const [draftCustomPx, setDraftCustomPx] = useState(String(settings.customFontSize));

  useEffect(() => {
    setDraftModels({ cheapModel: settings.cheapModel.model, strongModel: settings.strongModel.model });
  }, [settings.cheapModel.model, settings.strongModel.model]);

  useEffect(() => {
    setDraftCustomPx(String(settings.customFontSize));
  }, [settings.customFontSize]);

  const [editingId, setEditingId] = useState<ProviderId | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [draftKey, setDraftKey] = useState('');
  const [inputErr, setInputErr] = useState<string | null>(null);

  const runAction = async (fn: () => Promise<void> | void, errMsg: string) => {
    setBusy(true); setError(null);
    try { await fn(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err || errMsg)); }
    finally { setBusy(false); }
  };

  const handleProviderSelect = (tier: 'cheapModel' | 'strongModel', nextProvider: ProviderId) => {
    const tierKey = tier === 'cheapModel' ? 'cheap' : 'strong';
    const nextModel = (nextProvider === 'openai' || nextProvider === 'anthropic')
      ? CLOUD_PROVIDER_MODELS[nextProvider][tierKey]
      : '';
    setCustomEditingTiers((prev) => ({ ...prev, [tier]: false }));
    setDraftModels((prev) => ({ ...prev, [tier]: nextModel }));
    void runAction(
      () => onUpdateSettings({ ...settings, [tier]: { provider: nextProvider, model: nextModel } }),
      `Failed to update ${tier} provider`
    );
  };

  const handleCommitCustomCloud = (tier: 'cheapModel' | 'strongModel') => {
    const provider = settings[tier].provider;
    if (provider !== 'openai' && provider !== 'anthropic') return;
    const tierKey = tier === 'cheapModel' ? 'cheap' : 'strong';
    const def = CLOUD_PROVIDER_MODELS[provider][tierKey];
    const trimmed = draftModels[tier].trim();

    if (!trimmed) {
      const fallback = CLOUD_PROVIDER_MODELS[provider].presets.includes(settings[tier].model)
        ? settings[tier].model
        : def;
      setCustomEditingTiers((prev) => ({ ...prev, [tier]: false }));
      setDraftModels((prev) => ({ ...prev, [tier]: fallback }));
      if (fallback !== settings[tier].model) {
        void runAction(
          () => onUpdateSettings({ ...settings, [tier]: { ...settings[tier], model: fallback } }),
          `Failed to update ${tier} model`
        );
      }
      return;
    }

    const isPreset = CLOUD_PROVIDER_MODELS[provider].presets.includes(trimmed);
    if (isPreset) {
      setCustomEditingTiers((prev) => ({ ...prev, [tier]: false }));
    }
    setDraftModels((prev) => ({ ...prev, [tier]: trimmed }));
    if (trimmed !== settings[tier].model) {
      void runAction(
        () => onUpdateSettings({ ...settings, [tier]: { ...settings[tier], model: trimmed } }),
        `Failed to update ${tier} model`
      );
    }
  };

  const handleExitCustomEdit = (tier: 'cheapModel' | 'strongModel') => {
    setCustomEditingTiers((prev) => ({ ...prev, [tier]: false }));
    const provider = settings[tier].provider;
    if (provider === 'openai' || provider === 'anthropic') {
      const isPreset = CLOUD_PROVIDER_MODELS[provider].presets.includes(settings[tier].model);
      if (!isPreset) {
        const tierKey = tier === 'cheapModel' ? 'cheap' : 'strong';
        const def = CLOUD_PROVIDER_MODELS[provider][tierKey];
        setDraftModels((prev) => ({ ...prev, [tier]: def }));
        void runAction(
          () => onUpdateSettings({ ...settings, [tier]: { ...settings[tier], model: def } }),
          `Failed to reset ${tier} model`
        );
      } else {
        setDraftModels((prev) => ({ ...prev, [tier]: settings[tier].model }));
      }
    }
  };

  const handleCancelCustomEdit = (tier: 'cheapModel' | 'strongModel') => {
    const provider = settings[tier].provider;
    if (provider !== 'openai' && provider !== 'anthropic') return;
    const isPreset = CLOUD_PROVIDER_MODELS[provider].presets.includes(settings[tier].model);
    const tierKey = tier === 'cheapModel' ? 'cheap' : 'strong';
    const def = CLOUD_PROVIDER_MODELS[provider][tierKey];
    const target = settings[tier].model || def;
    setCustomEditingTiers((prev) => ({ ...prev, [tier]: !isPreset && Boolean(settings[tier].model) }));
    setDraftModels((prev) => ({ ...prev, [tier]: target }));
  };

  const handleCommitFreeTextModel = (tier: 'cheapModel' | 'strongModel', val: string) => {
    const trimmed = val.trim();
    setDraftModels((prev) => ({ ...prev, [tier]: trimmed }));
    if (trimmed !== settings[tier].model) {
      void runAction(
        () => onUpdateSettings({ ...settings, [tier]: { ...settings[tier], model: trimmed } }),
        `Failed to update ${tier} model`
      );
    }
  };

  const handleStartEdit = (id: ProviderId) => {
    setEditingId(id);
    setInputErr(null);
    setDraftKey('');
    setDraftUrl(settings.providers[id]?.baseUrl || (id === 'ollama' ? 'http://127.0.0.1:11434' : ''));
  };

  const handleSaveOllama = () => {
    const trimmed = draftUrl.trim();
    const err = validateBaseUrl(trimmed);
    if (err) { setInputErr(err); return; }
    setInputErr(null);
    void runAction(async () => {
      await onSaveProviderKey('ollama', '', trimmed);
      setEditingId(null);
    }, 'Failed to save Ollama URL');
  };

  const handleResetOllama = () => {
    setInputErr(null);
    void runAction(async () => {
      await onSaveProviderKey('ollama', '', 'http://127.0.0.1:11434');
      setEditingId(null);
    }, 'Failed to reset Ollama URL');
  };

  const handleSaveKey = (id: 'openai' | 'anthropic') => {
    const raw = draftKey.trim();
    if (!raw) { setInputErr('API key cannot be empty'); return; }
    setInputErr(null);
    void runAction(async () => {
      await onSaveProviderKey(id, raw);
      setDraftKey('');
      setEditingId(null);
    }, `Failed to save ${id} key`);
  };

  const handleSaveCustom = () => {
    const u = draftUrl.trim(), k = draftKey.trim();
    const uErr = validateBaseUrl(u), kErr = !k ? 'API key is required for custom provider' : null;
    if (uErr || kErr) { setInputErr(uErr || kErr); return; }
    setInputErr(null);
    void runAction(async () => {
      await onSaveProviderKey('custom', k, u);
      setDraftKey('');
      setEditingId(null);
    }, 'Failed to save custom credentials');
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const nextIdx = (i + dir + TABS.length) % TABS.length;
    setActiveTab(TABS[nextIdx].id); setError(null);
    (e.currentTarget.parentElement?.children[nextIdx] as HTMLElement | undefined)?.focus();
  };

  const isAllLocal = Boolean(
    settings.providers[settings.cheapModel.provider]?.isLocal && settings.providers[settings.strongModel.provider]?.isLocal
  );

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Settings</h1>
        <p className="text-xs sm:text-sm text-muted">Configure theme, local or cloud model tiers, and session defaults.</p>
      </header>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-2 p-3.5 rounded-xl border border-dashed border-inferred text-inferred bg-surface text-xs">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className="text-muted hover:text-fg shrink-0 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Segmented pill tab bar */}
      <div role="tablist" aria-label="Settings tabs" className="bg-surface border border-line p-1 rounded-xl inline-flex gap-1">
        {TABS.map(({ id, label }, i) => (
          <button
            key={id} role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={activeTab === id} tabIndex={activeTab === id ? 0 : -1}
            type="button" onClick={() => { setActiveTab(id); setError(null); }} onKeyDown={(e) => onTabKey(e, i)}
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer ${
              activeTab === id ? 'bg-elevated text-fg border border-line/70' : 'text-muted hover:text-fg border border-transparent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1: General */}
      {activeTab === 'general' && (
        <div role="tabpanel" id="panel-general" aria-labelledby="tab-general" tabIndex={0} className="space-y-4 focus:outline-none">
          <div className="bg-surface border border-line rounded-2xl p-5 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-fg">Auto-save sessions</h3>
              <p className="text-xs text-muted">Automatically save session modifications and renames to storage.</p>
            </div>
            <button
              type="button" role="switch" aria-checked={settings.autosave} aria-label="Toggle autosave sessions" disabled={busy}
              onClick={() => void runAction(() => onUpdateSettings({ ...settings, autosave: !settings.autosave }), 'Failed to update autosave')}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${settings.autosave ? 'bg-accent' : 'bg-line'} disabled:opacity-50`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${settings.autosave ? 'translate-x-4' : 'translate-x-1'}`} />
            </button>
          </div>

          <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-medium text-fg">Storage</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl border border-line bg-canvas space-y-1">
                <span className="text-muted block">Origin</span>
                <code className="text-fg font-mono text-[11px] block">{DEV_ORIGIN}</code>
              </div>
              <div className="p-3 rounded-xl border border-line bg-canvas space-y-1">
                <span className="text-muted block">Local DB</span>
                <code className="text-fg font-mono text-[11px] block">~/.orbi/orbi.db</code>
              </div>
            </div>
          </div>

          <div className="bg-surface border border-line rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-fg">Reset demo sessions</h3>
              <p className="text-xs text-muted">Restore default demo sessions and clear custom overrides.</p>
            </div>
            {confirmReset ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted">Reset all sessions?</span>
                <button type="button" disabled={busy} onClick={() => void runAction(async () => { await onResetDemoData(); setConfirmReset(false); }, 'Failed to reset demo data')} className="px-3 py-1.5 rounded-xl text-xs font-medium bg-accent hover:bg-accent-hover text-white transition-colors cursor-pointer disabled:opacity-50">Confirm</button>
                <button type="button" disabled={busy} onClick={() => setConfirmReset(false)} className="px-3 py-1.5 rounded-xl text-xs font-medium border border-line bg-canvas text-muted hover:text-fg transition-colors cursor-pointer">Cancel</button>
              </div>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirmReset(true)} className="px-3.5 py-2 rounded-xl text-xs font-medium border border-line bg-surface text-muted hover:text-fg transition-colors cursor-pointer disabled:opacity-50 shrink-0">Reset demo sessions</button>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: API Keys & Models */}
      {activeTab === 'api' && (
        <div role="tabpanel" id="panel-api" aria-labelledby="tab-api" tabIndex={0} className="space-y-4 focus:outline-none">
          <div className="flex items-start gap-2.5 p-4 rounded-2xl bg-surface border border-line text-xs text-muted">
            <ShieldCheck className="w-4 h-4 shrink-0 text-accent mt-0.5" />
            <span>{KEY_STORAGE_NOTICE}</span>
          </div>

          <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-medium text-fg">Model Routing</h3>
            <div className="space-y-3">
              {(
                [
                  { key: 'cheapModel' as const, title: 'Fast tier', subtitle: 'Module summaries' },
                  { key: 'strongModel' as const, title: 'Strong tier', subtitle: 'Architecture synthesis' },
                ] as const
              ).map(({ key, title, subtitle }) => {
                const curProvider = settings[key].provider;
                const curModel = settings[key].model;
                const isCloud = curProvider === 'openai' || curProvider === 'anthropic';
                const cloudCfg = isCloud ? CLOUD_PROVIDER_MODELS[curProvider] : null;
                const isPreset = Boolean(cloudCfg && cloudCfg.presets.includes(curModel));
                const isEditingCustom = isCloud && ((!isPreset && Boolean(curModel.trim())) || customEditingTiers[key]);

                return (
                  <div
                    key={key}
                    className="p-3.5 rounded-xl border border-line bg-canvas grid grid-cols-1 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)_minmax(0,1.35fr)] items-center gap-3 text-xs"
                  >
                    {/* Column 1: Tier Label */}
                    <div className="min-w-0 pr-1">
                      <div className="font-medium text-fg truncate">{title}</div>
                      <div className="text-[11px] text-muted truncate">{subtitle}</div>
                    </div>

                    {/* Column 2: Provider select */}
                    <div className="w-full min-w-0">
                      <select
                        value={curProvider}
                        onChange={(e) => handleProviderSelect(key, e.target.value as ProviderId)}
                        disabled={busy}
                        aria-label={`${title} provider`}
                        className="w-full h-10 px-3.5 py-2 rounded-xl border border-line bg-canvas text-fg focus:border-accent cursor-pointer transition-colors duration-150 text-xs"
                      >
                        {PROVIDER_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Column 3: Model Control — Single Box Only */}
                    <div className="w-full min-w-0">
                      {isCloud && cloudCfg ? (
                        isEditingCustom ? (
                          <div className="relative w-full">
                            <input
                              type="text"
                              autoFocus
                              spellCheck={false}
                              placeholder="Enter model ID"
                              value={draftModels[key]}
                              onChange={(e) => setDraftModels((p) => ({ ...p, [key]: e.target.value }))}
                              onFocus={(e) => e.currentTarget.select()}
                              onBlur={() => handleCommitCustomCloud(key)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                } else if (e.key === 'Escape') {
                                  handleCancelCustomEdit(key);
                                }
                              }}
                              disabled={busy}
                              aria-label={`${title} custom model ID`}
                              className="w-full h-10 pl-3.5 pr-8 py-2 rounded-xl border border-accent bg-canvas text-fg placeholder:text-muted/60 focus:outline-none transition-colors duration-150 text-xs"
                            />
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleExitCustomEdit(key)}
                              disabled={busy}
                              title="Choose from preset models"
                              aria-label="Choose from preset models"
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-muted hover:text-fg hover:bg-elevated transition-colors cursor-pointer"
                            >
                              <ChevronDown className="w-4 h-4 shrink-0" />
                            </button>
                          </div>
                        ) : (
                          <select
                            value={isPreset ? curModel : '__custom__'}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '__custom__') {
                                setCustomEditingTiers((prev) => ({ ...prev, [key]: true }));
                                setDraftModels((prev) => ({ ...prev, [key]: curModel || '' }));
                              } else {
                                setCustomEditingTiers((prev) => ({ ...prev, [key]: false }));
                                setDraftModels((prev) => ({ ...prev, [key]: val }));
                                void runAction(
                                  () => onUpdateSettings({ ...settings, [key]: { ...settings[key], model: val } }),
                                  `Failed to update ${title} model`
                                );
                              }
                            }}
                            disabled={busy}
                            aria-label={`${title} model preset`}
                            className="w-full h-10 px-3.5 py-2 rounded-xl border border-line bg-canvas text-fg focus:border-accent cursor-pointer transition-colors duration-150 text-xs"
                          >
                            {cloudCfg.presets.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                            <option value="__custom__">Custom model...</option>
                          </select>
                        )
                      ) : (
                        <input
                          type="text"
                          value={draftModels[key]}
                          onChange={(e) => setDraftModels((p) => ({ ...p, [key]: e.target.value }))}
                          onBlur={() => handleCommitFreeTextModel(key, draftModels[key])}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCommitFreeTextModel(key, draftModels[key]);
                          }}
                          disabled={busy}
                          placeholder={
                            curProvider === 'ollama'
                              ? 'Enter local model name (e.g. Ollama or llama.cpp)'
                              : 'Enter model ID'
                          }
                          aria-label={`${title} model name`}
                          className="w-full h-10 px-3.5 py-2 rounded-xl border border-line bg-canvas text-fg focus:border-accent transition-colors duration-150 text-xs"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {isAllLocal ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-solid border-verified bg-elevated text-xs text-verified">
                <ShieldCheck className="w-4 h-4 shrink-0 text-verified" />
                <span>Local &mdash; stays on this device</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-inferred bg-elevated text-xs text-inferred">
                <AlertTriangle className="w-4 h-4 shrink-0 text-inferred" />
                <span>Cloud &mdash; structural metadata only, .env blocked</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-fg">Provider Credentials</h3>

            {PROVIDER_OPTIONS.map(({ id, label }) => {
              const cfg = settings.providers[id];
              const isEditing = editingId === id;

              return (
                <div key={id} className="bg-surface border border-line rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between pb-2.5 border-b border-line text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-fg">{label}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${cfg.isLocal ? 'border-solid border-verified text-verified' : 'border-dashed border-inferred text-inferred'}`}>
                        {cfg.isLocal ? 'Local' : 'Cloud'}
                      </span>
                    </div>
                    <span className={cfg.configured ? 'text-verified font-medium' : 'text-muted'}>{cfg.configured ? 'Configured' : 'Not configured'}</span>
                  </div>

                  {/* Configured read-only row */}
                  {cfg.configured && !isEditing && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5 text-xs">
                      <div className="space-y-1">
                        {cfg.baseUrl && (
                          <div className="space-y-1">
                            <div className="text-muted flex items-center gap-2">
                              <span>Endpoint:</span>
                              <code className="text-fg bg-elevated px-2 py-0.5 rounded text-[11px] font-mono">{cfg.baseUrl}</code>
                            </div>
                            {id === 'ollama' && (
                              <p className="text-[11px] text-muted">Supports Ollama (:11434) and llama.cpp server (:8080) OpenAI-compatible endpoints.</p>
                            )}
                            {!cfg.isLocal && (
                              <p className="text-[11px] text-inferred">Remote host: endpoint does not bind to localhost (127.0.0.1).</p>
                            )}
                          </div>
                        )}
                        {id !== 'ollama' && (
                          <div className="text-muted flex items-center gap-2">
                            <span>Key:</span>
                            <span className="font-mono text-xs px-2.5 py-0.5 rounded bg-canvas border border-line text-muted">{cfg.hint ?? '\u2022\u2022\u2022\u2022'}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={busy} onClick={() => handleStartEdit(id)} className="px-3 py-1.5 rounded-xl text-xs font-medium border border-line bg-canvas text-muted hover:text-fg transition-colors disabled:opacity-50 cursor-pointer">
                          {id === 'ollama' ? 'Change URL' : id === 'custom' ? 'Update' : 'Replace Key'}
                        </button>
                        {confirmRemove === id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-inferred font-medium">Remove?</span>
                            <button type="button" disabled={busy} onClick={() => void runAction(async () => { await onRemoveProviderKey(id); setConfirmRemove(null); }, `Failed to remove ${id}`)} className="p-1 rounded text-inferred hover:bg-elevated cursor-pointer" aria-label="Confirm remove"><Check className="w-3.5 h-3.5" /></button>
                            <button type="button" disabled={busy} onClick={() => setConfirmRemove(null)} className="p-1 rounded text-muted hover:text-fg hover:bg-elevated cursor-pointer" aria-label="Cancel remove"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ) : (
                          <button type="button" disabled={busy} onClick={() => setConfirmRemove(id)} className="px-3 py-1.5 rounded-xl text-xs font-medium border border-line bg-canvas text-muted hover:text-inferred transition-colors disabled:opacity-50 cursor-pointer">Remove</button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Editing or Not configured form */}
                  {(!cfg.configured || isEditing) && (
                    <div className="space-y-2 pt-0.5 text-xs">
                      {id === 'ollama' ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <input
                              type="url" value={draftUrl} onChange={(e) => { setDraftUrl(e.target.value); setInputErr(null); }}
                              placeholder="http://127.0.0.1:11434" autoComplete="off" spellCheck={false} disabled={busy}
                              className={`flex-1 ${INPUT_CLS}`}
                            />
                            <button type="button" disabled={busy || !draftUrl.trim()} onClick={handleSaveOllama} className={BTN_ACCENT}>Save URL</button>
                            <button type="button" disabled={busy} onClick={handleResetOllama} className={BTN_GHOST}>Reset Default</button>
                            {cfg.configured && <button type="button" disabled={busy} onClick={() => setEditingId(null)} className={BTN_GHOST}>Cancel</button>}
                          </div>
                          <p className="text-[11px] text-muted">Supports Ollama (:11434) and llama.cpp server (:8080) OpenAI-compatible endpoints.</p>
                          {draftUrl.trim() && !isLocalBaseUrl(draftUrl.trim()) && (
                            <p className="text-[11px] text-inferred">Notice: Non-localhost endpoint. Code context may leave your machine.</p>
                          )}
                        </div>
                      ) : id === 'custom' ? (
                        <div className="space-y-2">
                          <input
                            type="url" value={draftUrl} onChange={(e) => { setDraftUrl(e.target.value); setInputErr(null); }}
                            placeholder="Base URL, e.g. https://api.openai.com/v1" autoComplete="off" spellCheck={false} disabled={busy}
                            className={`w-full ${INPUT_CLS}`}
                          />
                          <input
                            type="password" value={draftKey} onChange={(e) => { setDraftKey(e.target.value); setInputErr(null); }}
                            placeholder="API Key" autoComplete="off" spellCheck={false} disabled={busy}
                            className={`w-full ${INPUT_CLS}`}
                          />
                          <div className="flex items-center gap-2">
                            <button type="button" disabled={busy || !draftUrl.trim() || !draftKey.trim()} onClick={handleSaveCustom} className={BTN_ACCENT}>Save</button>
                            {cfg.configured && <button type="button" disabled={busy} onClick={() => setEditingId(null)} className={BTN_GHOST}>Cancel</button>}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="password" value={draftKey} onChange={(e) => { setDraftKey(e.target.value); setInputErr(null); }}
                            placeholder={`Enter ${label} API key`} autoComplete="off" spellCheck={false} disabled={busy}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(id as 'openai' | 'anthropic'); }}
                            className={`flex-1 ${INPUT_CLS}`}
                          />
                          <button type="button" disabled={busy || !draftKey.trim()} onClick={() => handleSaveKey(id as 'openai' | 'anthropic')} className={BTN_ACCENT}>Save Key</button>
                          {cfg.configured && <button type="button" disabled={busy} onClick={() => setEditingId(null)} className={BTN_GHOST}>Cancel</button>}
                        </div>
                      )}
                      {inputErr && <p className="text-xs text-inferred">{inputErr}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: Languages */}
      {activeTab === 'languages' && (
        <div role="tabpanel" id="panel-languages" aria-labelledby="tab-languages" tabIndex={0} className="focus:outline-none">
          <LanguagePacksTab
            packs={languagePacks}
            backendOnline={backendOnline}
            onInstall={onInstallLanguagePack}
            onDelete={onDeleteLanguagePack}
          />
        </div>
      )}

      {/* Tab 3: Appearance */}
      {activeTab === 'appearance' && (
        <div role="tabpanel" id="panel-appearance" aria-labelledby="tab-appearance" tabIndex={0} className="space-y-4 focus:outline-none">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-fg">Interface Theme</h3>
            <div role="radiogroup" aria-label="Theme selection" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {THEMES.map(({ id, label, desc }) => (
                <button
                  key={id} type="button" role="radio" aria-checked={settings.theme === id} disabled={busy}
                  onClick={() => void runAction(() => onUpdateSettings({ ...settings, theme: id }), 'Failed to update theme')}
                  className={`flex flex-col items-start gap-1 p-4 rounded-xl border text-left transition-colors cursor-pointer ${
                    settings.theme === id ? 'border-accent bg-elevated text-fg' : 'border-line bg-surface text-muted hover:text-fg'
                  } disabled:opacity-50`}
                >
                  <div className="text-sm font-medium text-fg">{label}</div>
                  <div className="text-xs text-muted">{desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-fg">Font Size</h3>
            <div role="radiogroup" aria-label="Font size selection" className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              {FONT_SIZES.map(({ id, label, desc }) => {
                const isSelected = settings.fontSize === id;
                const displayDesc = id === 'custom' ? `${settings.customFontSize}px` : desc;
                return (
                  <button
                    key={id} type="button" role="radio" aria-checked={isSelected} disabled={busy}
                    onClick={() => void runAction(async () => { await onUpdateSettings({ ...settings, fontSize: id }); }, 'Failed to update font size')}
                    className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      isSelected ? 'border-accent bg-elevated text-fg' : 'border-line bg-surface text-muted hover:text-fg'
                    } disabled:opacity-50`}
                  >
                    <div className="text-sm font-medium text-fg">{label}</div>
                    <div className="text-xs text-muted">{displayDesc}</div>
                  </button>
                );
              })}
            </div>
            {settings.fontSize === 'custom' && (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-line bg-canvas text-xs transition-colors duration-150">
                <label htmlFor="custom-font-size-input" className="font-medium text-fg shrink-0">
                  Custom size (px)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="custom-font-size-input"
                    type="number"
                    min={14}
                    max={26}
                    step={1}
                    value={draftCustomPx}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraftCustomPx(val);
                      const parsed = parseInt(val, 10);
                      if (!isNaN(parsed) && parsed >= 14 && parsed <= 26) {
                        void runAction(
                          () => onUpdateSettings({ ...settings, fontSize: 'custom', customFontSize: parsed }),
                          'Failed to update font size'
                        );
                      }
                    }}
                    onBlur={() => {
                      const clamped = clampCustomFontSize(parseInt(draftCustomPx, 10));
                      setDraftCustomPx(String(clamped));
                      if (clamped !== settings.customFontSize) {
                        void runAction(
                          () => onUpdateSettings({ ...settings, fontSize: 'custom', customFontSize: clamped }),
                          'Failed to update font size'
                        );
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const clamped = clampCustomFontSize(parseInt(draftCustomPx, 10));
                        setDraftCustomPx(String(clamped));
                        if (clamped !== settings.customFontSize) {
                          void runAction(
                            () => onUpdateSettings({ ...settings, fontSize: 'custom', customFontSize: clamped }),
                            'Failed to update font size'
                          );
                        }
                      }
                    }}
                    disabled={busy}
                    className="w-20 px-3 py-1.5 rounded-lg border border-line bg-surface text-fg focus:border-accent font-mono text-xs transition-colors duration-150"
                  />
                  <span className="text-muted">px</span>
                  <span className="text-muted/60 text-[11px]">(14–26px)</span>
                </div>
              </div>
            )}
          </div>
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-fg">Provenance Preview</h3>
              <p className="text-xs text-muted">ORBI-ARCH clearly distinguishes verified code truth from LLM inferences.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="flex items-center justify-center p-3 rounded-xl border border-solid border-verified text-verified bg-elevated text-xs font-medium">
                Verified (AST Import)
              </div>
              <div className="flex items-center justify-center p-3 rounded-xl border border-dashed border-inferred text-inferred bg-elevated text-xs font-medium">
                Inferred (Synthesized)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: About */}
      {activeTab === 'about' && (
        <div role="tabpanel" id="panel-about" aria-labelledby="tab-about" tabIndex={0} className="space-y-4 focus:outline-none">
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-fg">ORBI-ARCH</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-elevated text-muted border border-line">Local v0.1</span>
            </div>
            <p className="text-xs text-muted leading-relaxed">Local-first interactive codebase architecture explorer.</p>
          </div>
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-medium text-fg">Core Privacy &amp; Security Guarantees</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {SECURITY_BADGES.map(({ title, desc }) => (
                <div key={title} className="p-3 rounded-xl border border-line bg-canvas space-y-1">
                  <span className="font-medium text-fg">{title}</span>
                  <p className="text-muted">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
