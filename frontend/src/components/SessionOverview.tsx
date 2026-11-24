import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Braces, Check, ChevronDown, ChevronRight, Copy, Download, FileCode2, Folder, Globe, Image, ListTree, Minimize2, PanelRightClose, PanelRightOpen, RefreshCw, X } from 'lucide-react';
import { DEMO_NOTICE } from '../lib/constants';
import { getLldSlice } from '../lib/graph';
import type { SessionOverviewProps } from '../types/ui';
import type { CanvasSelection } from './graph/types';
import { InspectorPanel } from './graph/InspectorPanel';

const ArchitectureCanvas = lazy(() => import('./graph/ArchitectureCanvas'));

export function SessionOverview({ session, onUpdateOverrides, onExportJson, onBackToLauncher, canRescan = false, rescanStatus, onRescanSession }: SessionOverviewProps) {
  const [activeTab, setActiveTab] = useState<'canvas' | 'json'>('canvas');
  const [activeContainerId, setActiveContainerId] = useState<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection>({ kind: 'none' });
  const [showTreePanel, setShowTreePanel] = useState(false);
  const [showExternalNodes, setShowExternalNodes] = useState(true);
  const [asyncError, setAsyncError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false); const [mermaidCopied, setMermaidCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false); const [inspectorOpen, setInspectorOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const copyTimeoutRef = useRef<number | null>(null);
  const mermaidTimerRef = useRef<number | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveContainerId(null); setSelection({ kind: 'none' }); setShowTreePanel(false);
    setShowExternalNodes(true); setAsyncError(null); setCopied(false); setMermaidCopied(false); setExportOpen(false);
    setIsFullscreen(false);
    if (copyTimeoutRef.current !== null) { window.clearTimeout(copyTimeoutRef.current); copyTimeoutRef.current = null; }
    if (mermaidTimerRef.current !== null) { window.clearTimeout(mermaidTimerRef.current); mermaidTimerRef.current = null; }
  }, [session.session.id]);

  useEffect(() => () => {
    if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
    if (mermaidTimerRef.current !== null) window.clearTimeout(mermaidTimerRef.current);
  }, []);

  useEffect(() => {
    if (activeContainerId !== null && !session.containers.some((c) => c.id === activeContainerId)) {
      setActiveContainerId(null); setSelection({ kind: 'none' });
    }
  }, [session.containers, activeContainerId]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [exportOpen]);

  const handleToggleFullscreen = () => { setExportOpen(false); setIsFullscreen((p) => !p); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (activeTab === 'canvas') {
        if ((e.key === 'i' || e.key === 'I') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !isFullscreen) {
          e.preventDefault(); setInspectorOpen((p) => !p);
        } else if ((e.key === 'f' || e.key === 'F') && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault(); handleToggleFullscreen();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab, isFullscreen]);

  const activeContainer = useMemo(() => (activeContainerId ? session.containers.find((c) => c.id === activeContainerId) ?? null : null), [session.containers, activeContainerId]);
  const activeLabel = activeContainer ? session.overrides?.renamed?.[activeContainer.id] ?? activeContainer.label : '';
  const lldSlice = useMemo(() => (activeContainerId ? getLldSlice(session, activeContainerId) : null), [session, activeContainerId]);

  const formattedJson = useMemo(() => (activeTab === 'json' ? JSON.stringify(session, null, 2) : ''), [activeTab, session]);
  const byteSize = useMemo(() => (formattedJson ? `${(new Blob([formattedJson]).size / 1024).toFixed(1)} KB` : '0 B'), [formattedJson]);
  const isRescanning = rescanStatus?.state === 'running';

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(formattedJson);
      setCopied(true);
      if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch { /* ignored */ }
  };

  const doExport = async (action: (exp: typeof import('../lib/exportGraph')) => Promise<void> | void, errMsg: string) => {
    try {
      setExportOpen(false);
      const exp = await import('../lib/exportGraph');
      await action(exp);
    } catch (err) { setAsyncError(err instanceof Error ? err.message : errMsg); }
  };

  const handleCopyMermaid = () => void doExport(async (exp) => {
    await navigator.clipboard.writeText(exp.buildMermaidDiagram(session, activeContainerId, showExternalNodes));
    setMermaidCopied(true);
    if (mermaidTimerRef.current !== null) window.clearTimeout(mermaidTimerRef.current);
    mermaidTimerRef.current = window.setTimeout(() => setMermaidCopied(false), 1500);
  }, 'Failed to copy Mermaid diagram');

  const handleDownloadSvg = () => void doExport((exp) => {
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    exp.downloadSvg(exp.buildArchitectureSvg(session, activeContainerId, showExternalNodes, isDark), `${exp.slugifyFilename(session.session.name)}-${activeContainerId ? 'lld' : 'hld'}.svg`);
  }, 'Failed to download SVG');

  const handleDownloadPng = () => void doExport(async (exp) => {
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    exp.downloadPngFromSvg(exp.buildArchitectureSvg(session, activeContainerId, showExternalNodes, isDark), `${exp.slugifyFilename(session.session.name)}-${activeContainerId ? 'lld' : 'hld'}.png`, 2);
  }, 'Failed to download PNG');

  const handleEnterContainer = (cId: string) => { setActiveContainerId(cId); setSelection({ kind: 'none' }); };
  const handleExitToHld = () => { setActiveContainerId(null); setSelection({ kind: 'none' }); }; const handleJump = (cId: string, nId: string) => { setActiveContainerId(cId); setSelection({ kind: 'file', id: nId }); };

  const handleSavePositions = async (newPositions: Record<string, { x: number; y: number }>) => {
    try {
      setAsyncError(null); const prev = session.overrides ?? { positions: {}, renamed: {} };
      await onUpdateOverrides(session.session.id, { positions: { ...(prev.positions ?? {}), ...newPositions }, renamed: prev.renamed ?? {} });
    } catch (err) { setAsyncError(err instanceof Error ? err.message : 'Failed to save node positions'); }
  };

  const handleResetViewLayout = async (nodeIdsToClear: string[]) => {
    try {
      setAsyncError(null); const prev = session.overrides ?? { positions: {}, renamed: {} }; const nextPositions = { ...(prev.positions ?? {}) };
      nodeIdsToClear.forEach((id) => delete nextPositions[id]);
      await onUpdateOverrides(session.session.id, { positions: nextPositions, renamed: prev.renamed ?? {} });
    } catch (err) { setAsyncError(err instanceof Error ? err.message : 'Failed to reset layout'); }
  };

  const handleRenameEntity = async (entityId: string, newLabel: string | null) => {
    try {
      setAsyncError(null); const prev = session.overrides ?? { positions: {}, renamed: {} }; const nextRenamed = { ...(prev.renamed ?? {}) };
      if (newLabel === null) delete nextRenamed[entityId]; else nextRenamed[entityId] = newLabel.trim();
      await onUpdateOverrides(session.session.id, { positions: prev.positions ?? {}, renamed: nextRenamed });
    } catch (err) { setAsyncError(err instanceof Error ? err.message : 'Failed to rename entity'); }
  };

  const renderTreeNodes = (nodes: { id: string; label: string }[], isBoundary = false) => (
    <div className="space-y-0.5">
      {nodes.map((n) => (
        <button key={n.id} type="button" onClick={() => setSelection({ kind: 'file', id: n.id })}
          className={`w-full text-left px-2 py-1.5 rounded-lg truncate transition-colors cursor-pointer ${isBoundary ? 'border border-dashed border-line ' : ''}${selection.kind === 'file' && selection.id === n.id ? 'bg-accent text-white font-medium' : 'text-muted hover:text-fg hover:bg-elevated'}`}>
          {session.overrides?.renamed?.[n.id] ?? n.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-canvas text-fg overflow-hidden">
      {/* Top Header Bar */}
      <header className="shrink-0 border-b border-line bg-surface px-5 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={onBackToLauncher} aria-label="Back to Launcher"
            className="p-1.5 rounded-xl border border-line bg-surface hover:bg-elevated text-muted hover:text-fg transition-colors cursor-pointer shrink-0">
            <ArrowRight className="w-4 h-4 rotate-180" />
          </button>
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h1 className="font-semibold text-sm sm:text-base text-fg truncate">{session.session.name}</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-elevated border border-line text-muted">
              {session.session.source_type === 'local' ? <Folder className="w-3 h-3 text-accent" /> : <Globe className="w-3 h-3 text-verified" />}
              {session.session.source_type === 'local' ? 'Local' : 'GitHub'}
            </span>
            {session.session.is_demo && <span className="px-2 py-0.5 rounded text-[11px] bg-elevated border border-line text-muted" title={DEMO_NOTICE}>Demo</span>}
            {activeContainerId && (
              <div className="flex items-center gap-1.5 text-xs">
                <ChevronRight className="w-3.5 h-3.5 text-muted" />
                <button type="button" onClick={handleExitToHld} className="text-muted hover:text-fg underline cursor-pointer">HLD</button>
                <span className="text-muted">/</span>
                <span className="font-semibold text-fg truncate max-w-[140px] sm:max-w-xs">{activeLabel}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 text-xs">
            <span className="px-2 py-0.5 rounded bg-elevated border border-line text-muted">{session.session.stats.files_scanned} files</span>
            <span className="px-2 py-0.5 rounded border border-solid border-verified text-verified bg-elevated">{session.session.stats.verified_edges} verified</span>
            <span className="px-2 py-0.5 rounded border border-dashed border-inferred text-inferred bg-elevated">{session.session.stats.inferred_edges} inferred</span>
          </div>

          <button type="button" onClick={() => void onRescanSession?.(session.session.id)} disabled={!canRescan || isRescanning}
            title={canRescan ? 'Re-scan repository and preserve layout overrides' : 'Available for live local/GitHub scans when backend is running'}
            className="bg-canvas hover:bg-elevated border border-line rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${isRescanning ? 'animate-spin text-accent' : ''}`} />
            <span>{isRescanning ? 'Re-scanning...' : 'Re-scan'}</span>
          </button>

          <div className="relative" ref={exportMenuRef}>
            <button type="button" onClick={() => setExportOpen((p) => !p)} aria-haspopup="menu" aria-expanded={exportOpen}
              className="px-3 py-1.5 rounded-xl border border-line bg-surface hover:bg-elevated text-xs font-medium text-muted hover:text-fg transition-colors cursor-pointer inline-flex items-center gap-1.5">
              {mermaidCopied ? <Check className="w-3.5 h-3.5 text-verified" /> : <Download className="w-3.5 h-3.5" />}
              <span>{mermaidCopied ? 'Copied!' : 'Export'}</span>
              <ChevronDown className="w-3 h-3 text-muted" />
            </button>
            {exportOpen && (
              <div role="menu" className="absolute right-0 mt-1.5 w-52 rounded-xl border border-line bg-surface p-1 shadow-lg z-30">
                <button type="button" onClick={handleCopyMermaid} role="menuitem"
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-fg hover:bg-elevated flex items-center gap-2 cursor-pointer transition-colors">
                  <Copy className="w-3.5 h-3.5 text-muted" /><span>Copy Mermaid</span>
                </button>
                <button type="button" onClick={handleDownloadSvg} role="menuitem"
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-fg hover:bg-elevated flex items-center gap-2 cursor-pointer transition-colors">
                  <FileCode2 className="w-3.5 h-3.5 text-muted" /><span>Download SVG</span>
                </button>
                <button type="button" onClick={handleDownloadPng} role="menuitem"
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-fg hover:bg-elevated flex items-center gap-2 cursor-pointer transition-colors">
                  <Image className="w-3.5 h-3.5 text-muted" /><span>Download PNG (2x)</span>
                </button>
                <div className="my-1 border-t border-line" />
                <button type="button" onClick={() => { setExportOpen(false); onExportJson(session); }} role="menuitem"
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-fg hover:bg-elevated flex items-center gap-2 cursor-pointer transition-colors">
                  <Braces className="w-3.5 h-3.5 text-muted" /><span>Download JSON</span>
                </button>
              </div>
            )}
          </div>

          {activeTab === 'canvas' && activeContainerId && (
            <button type="button" onClick={() => setShowTreePanel((p) => !p)} title="Toggle File Tree"
              className={`p-1.5 rounded-xl border text-xs transition-colors cursor-pointer ${showTreePanel ? 'border-accent bg-elevated text-fg' : 'border-line bg-surface text-muted hover:text-fg'}`}>
              <ListTree className="w-4 h-4" />
            </button>
          )}

          {activeTab === 'canvas' && (
            <button
              type="button"
              onClick={() => setInspectorOpen((p) => !p)}
              title={inspectorOpen ? 'Hide inspector (I)' : 'Show inspector (I)'}
              aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
              aria-pressed={inspectorOpen}
              className="bg-canvas hover:bg-elevated border border-line rounded-lg px-2 py-1.5 text-xs font-medium text-fg flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              {inspectorOpen ? <PanelRightClose className="w-3.5 h-3.5 text-muted" /> : <PanelRightOpen className="w-3.5 h-3.5 text-muted" />}
            </button>
          )}

          <div className="bg-elevated border border-line p-0.5 rounded-xl inline-flex text-xs">
            <button type="button" onClick={() => { setIsFullscreen(false); setActiveTab('canvas'); }}
              className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${activeTab === 'canvas' ? 'bg-surface text-fg border border-line/70' : 'text-muted hover:text-fg'}`}>
              Canvas
            </button>
            <button type="button" onClick={() => { setIsFullscreen(false); setActiveTab('json'); }}
              className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${activeTab === 'json' ? 'bg-surface text-fg border border-line/70' : 'text-muted hover:text-fg'}`}>
              JSON
            </button>
          </div>
        </div>
      </header>

      {/* Live Re-scan Progress Strip */}
      {isRescanning && (
        <div className="bg-surface border-b border-line px-5 py-2 flex items-center gap-3 text-xs text-muted shrink-0">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
          <span className="truncate">{rescanStatus?.message ?? 'Re-scanning...'}</span>
          <span className="font-mono text-fg shrink-0">{Math.round((rescanStatus?.progress ?? 0) * 100)}%</span>
          <div className="flex-1 max-w-xs h-1.5 bg-canvas rounded-full overflow-hidden shrink-0">
            <div className="h-full bg-accent transition-all duration-300" style={{ width: `${Math.round((rescanStatus?.progress ?? 0) * 100)}%` }} />
          </div>
        </div>
      )}
      {rescanStatus?.state === 'error' && (
        <div role="alert" className="bg-surface border-b border-dashed border-inferred px-5 py-2 flex items-center justify-between text-xs text-inferred shrink-0">
          <span>{rescanStatus.message ?? 'Re-scan failed'}</span>
        </div>
      )}

      {asyncError && (
        <div role="alert" className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b border-dashed border-inferred bg-surface text-xs text-inferred">
          <span>{asyncError}</span>
          <button type="button" onClick={() => setAsyncError(null)} className="text-muted hover:text-fg cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {activeTab === 'canvas' ? (
        <div className={isFullscreen ? 'fixed inset-0 z-50 bg-canvas flex flex-col' : 'flex-1 min-h-0 flex overflow-hidden'}>
          {isFullscreen && (
            <div className="absolute top-3 right-3 z-20 flex items-center gap-2 pointer-events-auto">
              {activeContainerId && (
                <button type="button" onClick={handleExitToHld} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-elevated shadow-sm cursor-pointer transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5 text-muted" /><span>Back to HLD ({activeLabel})</span>
                </button>
              )}
              <button type="button" onClick={handleToggleFullscreen} title="Exit full-screen (Shift+F or Esc)" aria-label="Exit full-screen" className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-elevated shadow-sm cursor-pointer transition-colors">
                <Minimize2 className="w-3.5 h-3.5 text-muted" /><span>Exit</span><kbd className="text-[10px] text-muted font-mono bg-canvas border border-line px-1 py-0.5 rounded">Esc</kbd>
              </button>
            </div>
          )}

          {!isFullscreen && activeContainerId && showTreePanel && lldSlice && (
            <aside className="w-60 shrink-0 border-r border-line bg-surface overflow-y-auto p-3 space-y-3 text-xs">
              <div>
                <div className="text-[10px] uppercase font-semibold text-muted tracking-wider mb-1.5">Internal Files ({lldSlice.internalNodes.length})</div>
                {renderTreeNodes(lldSlice.internalNodes)}
              </div>
              {lldSlice.externalNodes.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase font-semibold text-muted tracking-wider mb-1.5">Boundaries ({lldSlice.externalNodes.length})</div>
                  {renderTreeNodes(lldSlice.externalNodes, true)}
                </div>
              )}
            </aside>
          )}

          <div className="flex-1 min-w-0 h-full relative">
            <Suspense fallback={
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-muted">
                <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span>Loading architecture canvas...</span>
              </div>
            }>
              <ArchitectureCanvas
                session={session} activeContainerId={activeContainerId} selection={selection}
                showExternalNodes={showExternalNodes} onSelect={setSelection} onEnterContainer={handleEnterContainer}
                onExitToHld={handleExitToHld} onJumpToExternalNode={handleJump}
                onToggleExternalNodes={() => setShowExternalNodes((p) => !p)}
                onSavePositions={handleSavePositions} onResetViewLayout={handleResetViewLayout}
                isFullscreen={isFullscreen} onToggleFullscreen={handleToggleFullscreen}
                inspectorOpen={inspectorOpen} onToggleInspector={() => setInspectorOpen((p) => !p)}
              />
            </Suspense>
          </div>

          {!isFullscreen && inspectorOpen && (
            <InspectorPanel
              session={session} activeContainerId={activeContainerId} selection={selection}
              onSelect={setSelection} onEnterContainer={handleEnterContainer}
              onJumpToExternalNode={handleJump} onRenameEntity={handleRenameEntity}
              onClose={() => setInspectorOpen(false)}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-6 overflow-hidden">
          <div className="flex items-center justify-between pb-3 text-xs text-muted">
            <span>Render Schema (v{session.schema_version}) &middot; {byteSize}</span>
            <button type="button" onClick={handleCopyJson}
              className="px-3 py-1.5 rounded-xl border border-line bg-surface hover:bg-elevated text-xs font-medium text-fg inline-flex items-center gap-1.5 cursor-pointer transition-colors">
              {copied ? <Check className="w-3.5 h-3.5 text-verified" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy JSON'}</span>
            </button>
          </div>
          <pre className="flex-1 overflow-auto p-4 rounded-2xl border border-line bg-surface font-mono text-xs text-fg leading-relaxed select-text">
            {formattedJson}
          </pre>
        </div>
      )}
    </div>
  );
}
