import { useState } from 'react';
import { Download, Trash2, X } from 'lucide-react';
import type { LanguagePackStatus } from '../types/schema';

export interface LanguagePacksTabProps {
  packs: LanguagePackStatus[];
  backendOnline: boolean;
  onInstall?: (packId: string) => Promise<void>;
  onDelete?: (packId: string) => Promise<void>;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LanguagePacksTab({ packs, backendOnline, onInstall, onDelete }: LanguagePacksTabProps) {
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const installedCount = packs.filter((p) => p.installed).length;
  const totalBytes = packs.filter((p) => p.installed).reduce((acc, p) => acc + p.size_bytes, 0);

  const handleAction = async (packId: string, action: 'install' | 'delete') => {
    if (!backendOnline || busyIds.has(packId)) return;
    setErrorMsg(null);
    setBusyIds((prev) => new Set(prev).add(packId));
    try {
      if (action === 'install') await onInstall?.(packId);
      else await onDelete?.(packId);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : `${action} failed.`);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(packId);
        return next;
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">Language Packs</h2>
          <p className="text-xs text-muted mt-0.5">Prebuilt local Tree-sitter grammars for verified AST parsing (0 LLM tokens).</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-muted bg-canvas px-2.5 py-1 rounded-lg border border-line">
          <span>{installedCount} of {packs.length} installed</span>
          <span>&middot;</span>
          <span>{formatSize(totalBytes)}</span>
        </div>
      </div>

      {errorMsg && (
        <div role="alert" className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border border-dashed border-inferred bg-surface text-xs text-inferred">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} aria-label="Dismiss error" className="text-muted hover:text-fg cursor-pointer p-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {!backendOnline && (
        <div className="rounded-xl border border-dashed border-inferred bg-surface px-4 py-3 text-xs text-muted">
          Start the local backend (127.0.0.1:8000) to install or remove language packs.
        </div>
      )}

      {backendOnline && packs.length > 0 && installedCount === 0 && (
        <div className="rounded-xl border border-dashed border-inferred bg-surface px-4 py-3 text-xs text-inferred">
          No language packs installed. Scans will skip static AST import edges and may consume more AI tokens.
        </div>
      )}

      <div className="space-y-2.5">
        {packs.map((pack) => {
          const isBusy = busyIds.has(pack.id);
          return (
            <div key={pack.id} className="rounded-xl border border-line bg-surface px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-fg">{pack.label}</span>
                  {pack.installed ? (
                    <span className="inline-flex items-center gap-1.5 border border-verified text-verified text-[11px] px-2 py-0.5 rounded-full">
                      <span>Installed</span>
                      <span className="text-muted font-mono">{formatSize(pack.size_bytes)}</span>
                    </span>
                  ) : (
                    <span className="border border-line text-muted text-[11px] px-2 py-0.5 rounded-full">
                      Not installed
                    </span>
                  )}
                </div>
                <div className="font-mono text-xs text-muted mt-1 truncate">
                  {pack.extensions.join('  ')}
                </div>
              </div>

              <div className="shrink-0">
                {pack.installed ? (
                  <button
                    type="button"
                    onClick={() => void handleAction(pack.id, 'delete')}
                    disabled={!backendOnline || isBusy}
                    className="px-3 py-1.5 rounded-lg border border-line bg-canvas hover:bg-elevated text-xs font-medium text-fg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted" />
                    <span>{isBusy ? 'Removing...' : 'Remove'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleAction(pack.id, 'install')}
                    disabled={!backendOnline || isBusy}
                    className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isBusy ? 'Installing...' : 'Install'}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted">
        Uninstalled languages still map files safely without hidden downloads; install a pack anytime for verified AST edges.
      </p>
    </div>
  );
}
