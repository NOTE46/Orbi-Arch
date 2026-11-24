import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, ArrowRight, GitBranch, Lock, X } from 'lucide-react';
import type { LauncherProps } from '../types/ui';

export function validateLocalPath(raw: string): string | null {
  const str = typeof raw === 'string' ? raw : ''; const path = str.trim();
  if (!path) return 'Enter an absolute folder path such as C:\\Projects\\my-app or /Users/dev/my-app.';
  if (/[;|&`$<>\r\n\0]/.test(str)) return 'Path contains disallowed shell or control characters.';
  if (/(^|[\\/])\.\.([\\/]|$)/.test(path)) return 'Parent directory traversal ("..") is not allowed.';
  return (!/^[A-Za-z]:[\\/]/.test(path) && !/^(\/|~\/)/.test(path)) ? 'Enter an absolute folder path such as C:\\Projects\\my-app or /Users/dev/my-app.' : null;
}

export function validateGitHubUrl(raw: string): string | null {
  const str = typeof raw === 'string' ? raw : ''; const url = str.trim();
  if (!url) return 'Enter a GitHub repository URL.';
  const lower = url.toLowerCase();
  if (lower.startsWith('git@') || lower.startsWith('ssh://') || lower.startsWith('http://')) return 'Only https://github.com/<owner>/<repo> URLs are allowed. For SSH/private repos, clone locally and use Open local folder.';
  if (/[@?#\s;|&`$<>\r\n\0]/.test(str)) return 'Userinfo, query strings, fragments, whitespace, and shell characters are not permitted.';
  const match = url.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) return 'Enter a valid URL in the format https://github.com/<owner>/<repo>.';
  const [, owner, repo] = match;
  return (owner === '.' || owner === '..' || repo === '.' || repo === '..') ? 'Repository owner and name cannot be "." or "..".' : null;
}

export function OrbiEmblem({ className = 'w-4 h-4 text-accent' }: { className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="8.5" ry="4" transform="rotate(-30 12 12)" />
      <circle cx="12" cy="12" r="8.5" strokeDasharray="3 3" opacity="0.5" />
    </svg>
  );
}

export function Launcher({
  settings, scan, onStartScan, onOpenSettings, isHydrating = false,
  backendOnline = false, installedPackCount, onOpenLanguageSettings,
}: LauncherProps) {
  const [mode, setMode] = useState<'local' | 'github'>('local');
  const [localPath, setLocalPath] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dismissedScanError, setDismissedScanError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isBusy = Boolean(scan?.state === 'running' || submitting);
  const currentTarget = mode === 'local' ? localPath : githubUrl;
  const scanError = scan?.state === 'error' && !dismissedScanError ? (scan.message ?? 'Scan failed.') : null;
  const activeError = submitError || scanError;

  const cheapCfg = settings.providers[settings.cheapModel.provider];
  const strongCfg = settings.providers[settings.strongModel.provider];
  const is100Local = Boolean(cheapCfg?.isLocal && strongCfg?.isLocal);

  const m1 = settings.cheapModel.model?.trim() || '';
  const m2 = settings.strongModel.model?.trim() || '';
  const localSummary = !m1 && !m2
    ? 'Model not set'
    : m1 && m2
    ? (m1 === m2 ? m1 : `${m1} / ${m2}`)
    : (m1 || m2);
  const c1 = !cheapCfg?.isLocal ? `${cheapCfg?.label ?? settings.cheapModel.provider}${m1 ? `: ${m1}` : ' (model not set)'}` : '';
  const c2 = !strongCfg?.isLocal ? `${strongCfg?.label ?? settings.strongModel.provider}${m2 ? `: ${m2}` : ' (model not set)'}` : '';
  const cloudSummary = c1 === c2 ? c1 : [c1, c2].filter(Boolean).join(' · ');

  const pct = typeof scan?.progress === 'number' ? Math.round(Math.min(Math.max(scan.progress, 0), 1) * 100) : null;

  useEffect(() => {
    if (scan?.state === 'running') setDismissedScanError(false);
  }, [scan?.state]);

  const handleInputChange = (val: string) => {
    if (mode === 'local') setLocalPath(val); else setGithubUrl(val);
    if (validationError) setValidationError(null);
    if (submitError) setSubmitError(null);
    if (scanError) setDismissedScanError(true);
  };

  const handleModeChange = (nextMode: 'local' | 'github') => {
    if (isBusy || nextMode === mode) return;
    setMode(nextMode); setValidationError(null); setSubmitError(null); setDismissedScanError(true);
    inputRef.current?.focus();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    const trimmed = (mode === 'local' ? localPath : githubUrl).trim();
    const err = mode === 'local' ? validateLocalPath(trimmed) : validateGitHubUrl(trimmed);
    if (err) { setValidationError(err); inputRef.current?.focus(); return; }
    setValidationError(null); setSubmitError(null); setDismissedScanError(false);
    try {
      setSubmitting(true);
      await onStartScan(mode, trimmed);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start scan.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-full flex flex-col justify-center px-6 py-10 orbi-hero-glow">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <header className="relative flex flex-col items-center text-center rounded-2xl pt-8 pb-4">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-surface border border-line text-xs text-muted font-medium mb-3">
            Local-first &middot; read-only
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.08] text-fg">
            Understand what<br />you&apos;re building.
          </h1>
          <p className="text-base text-muted max-w-lg mx-auto mt-3">
            Map any codebase&apos;s architecture in seconds, without it ever leaving your machine.
          </p>
        </header>

        <div className="bg-surface border border-line rounded-2xl p-5 mt-8">
          <div role="radiogroup" aria-label="Analysis source" className="bg-canvas border border-line/80 p-1 rounded-xl grid grid-cols-2 gap-1">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'local'}
              disabled={isBusy}
              onClick={() => handleModeChange('local')}
              className={`py-2 px-3 text-xs sm:text-sm text-center transition-colors cursor-pointer rounded-lg ${
                mode === 'local'
                  ? 'bg-elevated text-fg font-medium border border-line/70'
                  : 'text-muted hover:text-fg border border-transparent'
              } ${isBusy ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Local folder
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'github'}
              disabled={isBusy}
              onClick={() => handleModeChange('github')}
              className={`py-2 px-3 text-xs sm:text-sm text-center transition-colors cursor-pointer rounded-lg ${
                mode === 'github'
                  ? 'bg-elevated text-fg font-medium border border-line/70'
                  : 'text-muted hover:text-fg border border-transparent'
              } ${isBusy ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              GitHub import
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-4">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <label htmlFor="launcher-target-input" className="sr-only">
                {mode === 'local' ? 'Local project directory' : 'GitHub repository URL'}
              </label>
              <input
                ref={inputRef}
                id="launcher-target-input"
                type={mode === 'local' ? 'text' : 'url'}
                value={currentTarget}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder={mode === 'local' ? 'C:\\Projects\\my-app or /Users/dev/my-app' : 'https://github.com/owner/repository'}
                disabled={isBusy}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(validationError)}
                aria-describedby={validationError ? 'launcher-validation-error' : 'launcher-helper-text'}
                className="flex-1 bg-canvas border border-line focus:border-accent rounded-xl px-4 py-3 font-mono text-sm text-fg placeholder:text-muted/60 disabled:opacity-50 transition-colors"
              />
              <button
                type="submit"
                disabled={isBusy || currentTarget.trim().length === 0}
                className="bg-accent hover:bg-accent-hover disabled:opacity-45 text-white font-medium rounded-xl px-5 py-3 inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:cursor-not-allowed transition-colors"
              >
                <span>Analyze</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
            </div>

            {validationError ? (
              <p id="launcher-validation-error" role="alert" className="mt-3 text-xs text-inferred">
                {validationError}
              </p>
            ) : (
              <div id="launcher-helper-text" className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                {mode === 'local' ? (
                  <>
                    <Lock size={13} className="shrink-0" />
                    <span>Static AST analysis. Never executes or alters your code.</span>
                  </>
                ) : (
                  <>
                    <GitBranch size={13} className="shrink-0" />
                    <span>Shallow HTTPS clone into ~/.orbi/repos. Never executes repository code.</span>
                  </>
                )}
              </div>
            )}

            {scan?.state === 'running' && (
              <div className="space-y-2 pt-4">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{scan.message ?? 'Scanning repository...'}</span>
                  {pct !== null && <span>{pct}%</span>}
                </div>
                {pct !== null && (
                  <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Scan progress" className="w-full bg-elevated rounded-full h-1.5 overflow-hidden border border-line">
                    <div className="bg-accent h-1.5 rounded-full transition-all duration-150" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            )}

            {activeError && (
              <div role="alert" className="mt-4 flex items-start justify-between gap-2 p-3 rounded-xl border border-dashed border-inferred text-inferred bg-canvas text-xs">
                <span>{activeError}</span>
                <button type="button" onClick={() => { setSubmitError(null); setDismissedScanError(true); }} aria-label="Dismiss error" className="text-muted hover:text-fg shrink-0 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </form>
        </div>

        {isHydrating ? (
          <div className="mt-3.5 bg-surface border border-line rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-muted">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-muted/40 shrink-0" />
              <span>Connecting to local backend...</span>
            </div>
          </div>
        ) : is100Local ? (
          <div className="mt-3.5 bg-surface border border-solid border-verified/50 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-verified shrink-0" />
              <span className="text-verified font-medium shrink-0">Local</span>
              <span className="text-muted font-mono truncate">{localSummary}</span>
            </div>
            <button type="button" onClick={onOpenSettings} className="text-xs text-muted hover:text-fg underline shrink-0 transition-colors cursor-pointer">
              Change
            </button>
          </div>
        ) : (
          <div className="mt-3.5 bg-surface border border-dashed border-inferred/70 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-inferred shrink-0" />
              <span className="text-inferred font-medium shrink-0">Cloud</span>
              <span className="text-muted font-mono truncate">{cloudSummary || 'Cloud provider active'} &middot; Structural IR only</span>
            </div>
            <button type="button" onClick={onOpenSettings} className="text-xs text-muted hover:text-fg underline shrink-0 transition-colors cursor-pointer">
              Change
            </button>
          </div>
        )}

        {!isHydrating && backendOnline && installedPackCount === 0 && (
          <div className="mt-2.5 rounded-xl border border-dashed border-inferred bg-surface px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 text-inferred shrink-0" />
              <span className="text-fg truncate">No language packs installed &mdash; scans will skip static AST edges and use more AI tokens.</span>
            </div>
            <button type="button" onClick={onOpenLanguageSettings} className="shrink-0 font-medium text-accent hover:underline cursor-pointer">
              Install Languages
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
