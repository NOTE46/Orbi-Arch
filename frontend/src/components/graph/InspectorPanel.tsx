import { useState } from 'react';
import type { ArchEdge, RenderSession } from '../../types/schema';
import { getContainerFileCount, getLldSlice } from '../../lib/graph';
import type { InspectorPanelProps as BaseInspectorPanelProps } from './types';
import { ArrowRight, Check, CornerDownRight, ExternalLink, PanelRightClose, RotateCcw, X } from 'lucide-react';
import { LanguageBar } from './LanguageBar';

export interface InspectorPanelProps extends BaseInspectorPanelProps {
  onClose?: () => void;
}

function buildSourceLink(session: RenderSession, file: string, line: number): { url: string; label: string } | null {
  const ref = session.session.source_ref ? session.session.source_ref.trim() : '';
  const cleanFile = file.replace(/\\/g, '/').replace(/^\/+/, '');
  const cleanLine = Math.max(1, Math.round(line || 1));
  if (session.session.source_type === 'local' && ref) return { url: `vscode://file/${ref.replace(/\\/g, '/').replace(/\/+$/, '')}/${cleanFile}:${cleanLine}`, label: 'Open in VS Code' };
  if (session.session.source_type === 'github' && ref.startsWith('https://github.com/')) return { url: `${ref.replace(/\.git$/i, '').replace(/\/+$/, '')}/blob/${session.session.commit_sha || 'main'}/${cleanFile}#L${cleanLine}`, label: 'View on GitHub' };
  return null;
}

function RenameRow({ id, name, isOverridden, onRename }: { id: string; name: string; isOverridden: boolean; onRename: (id: string, name: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (editing) {
    const commit = () => { const t = draft.trim(); if (t) onRename(id, t); setEditing(false); };
    return (<div className="flex items-center gap-1.5"><input type="text" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }} className="flex-1 px-2.5 py-1 rounded-lg border border-accent bg-surface text-fg text-xs" /><button type="button" onClick={commit} className="p-1 rounded text-accent hover:bg-elevated cursor-pointer"><Check className="w-3.5 h-3.5" /></button><button type="button" onClick={() => setEditing(false)} className="p-1 rounded text-muted hover:text-fg hover:bg-elevated cursor-pointer"><X className="w-3.5 h-3.5" /></button></div>);
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="font-semibold text-fg text-sm truncate">{name}</div>
      <div className="flex items-center gap-1 shrink-0">
        {isOverridden && <button type="button" onClick={() => onRename(id, null)} title="Reset name" className="p-1 text-muted hover:text-fg rounded cursor-pointer"><RotateCcw className="w-3 h-3" /></button>}
        <button type="button" onClick={() => { setDraft(name); setEditing(true); }} className="text-[11px] text-muted hover:text-fg underline cursor-pointer">Rename</button>
      </div>
    </div>
  );
}

export function InspectorPanel({ session, activeContainerId, selection, onSelect, onEnterContainer, onJumpToExternalNode, onRenameEntity, onClose }: InspectorPanelProps) {
  const activeContainer = activeContainerId ? session.containers.find((c) => c.id === activeContainerId) : null;
  const lldSlice = activeContainerId ? getLldSlice(session, activeContainerId) : null;
  const internalNodes = lldSlice?.internalNodes ?? [];

  if (selection.kind === 'none') {
    return (
      <aside className="w-80 xl:w-96 shrink-0 border-l border-line bg-surface flex flex-col min-h-0 overflow-hidden text-xs">
        <div className="p-4 border-b border-line flex items-center justify-between">
          <span className="font-semibold text-fg text-sm">{activeContainerId ? 'Container Inspector' : 'Architecture Overview'}</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-elevated border border-line text-muted">
              {activeContainerId ? activeContainer?.category : session.session.source_type}
            </span>
            {onClose && <button type="button" onClick={onClose} title="Hide inspector (I)" aria-label="Hide inspector" className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-fg hover:bg-elevated cursor-pointer transition-colors"><PanelRightClose className="w-4 h-4" /></button>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!activeContainerId ? (
            <>
              <div className="p-3 rounded-xl border border-line bg-canvas space-y-1">
                <div className="font-medium text-fg text-sm">{session.session.name}</div>
                <div className="font-mono text-[11px] text-muted truncate">{session.session.source_ref}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2.5 rounded-xl border border-line bg-canvas"><div className="font-semibold text-verified text-sm">{session.session.stats.verified_edges}</div><div className="text-[10px] text-muted">Verified Edges</div></div>
                <div className="p-2.5 rounded-xl border border-dashed border-inferred bg-canvas"><div className="font-semibold text-inferred text-sm">{session.session.stats.inferred_edges}</div><div className="text-[10px] text-muted">Inferred Edges</div></div>
              </div>
              <LanguageBar nodes={session.nodes} />
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Subsystems ({session.containers.length})</div>
                <div className="space-y-1">
                  {session.containers.map((c) => (
                    <div key={c.id} onClick={() => onSelect({ kind: 'container', id: c.id })} className="p-2 rounded-lg border border-line bg-canvas hover:bg-elevated transition-colors cursor-pointer flex items-center justify-between gap-2">
                      <span className="font-medium text-fg truncate">{session.overrides?.renamed?.[c.id] ?? c.label}</span>
                      <span className="text-[10px] text-muted shrink-0">{getContainerFileCount(session, c.id)} files</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-line bg-canvas text-muted text-[11px] leading-relaxed">Tip: Click any node or edge to inspect. Double-click a subsystem to drill into LLD.</div>
            </>
          ) : (
            <>
              <div className="p-3 rounded-xl border border-line bg-canvas space-y-1">
                <RenameRow id={activeContainerId} name={session.overrides?.renamed?.[activeContainerId] ?? activeContainer?.label ?? ''} isOverridden={Boolean(session.overrides?.renamed?.[activeContainerId])} onRename={onRenameEntity} />
                <p className="text-muted text-xs">{activeContainer?.summary}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2.5 rounded-xl border border-line bg-canvas"><div className="font-semibold text-fg text-sm">{internalNodes.length}</div><div className="text-[10px] text-muted">Internal Files</div></div>
                <div className="p-2.5 rounded-xl border border-line bg-canvas"><div className="font-semibold text-fg text-sm">{lldSlice?.externalNodes.length ?? 0}</div><div className="text-[10px] text-muted">Boundaries</div></div>
              </div>
              {internalNodes.length > 0 && <LanguageBar nodes={internalNodes} />}
              <div className="text-muted text-[11px]">Click any file or edge in the canvas to inspect symbols and dependencies.</div>
            </>
          )}
        </div>
      </aside>
    );
  }

  if (selection.kind === 'container') {
    const c = session.containers.find((item) => item.id === selection.id);
    if (!c) return null;
    const displayName = session.overrides?.renamed?.[c.id] ?? c.label;
    const edges = session.edges.filter((e) => e.scope === 'hld' && (e.source === c.id || e.target === c.id));
    const files = session.nodes.filter((n) => n.container_id === c.id);

    return (
      <aside className="w-80 xl:w-96 shrink-0 border-l border-line bg-surface flex flex-col min-h-0 overflow-hidden text-xs">
        <div className="p-4 border-b border-line flex items-center justify-between">
          <span className="font-semibold text-fg text-sm">Subsystem Details</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onSelect({ kind: 'none' })} title="Close details" aria-label="Close details" className="text-muted hover:text-fg p-1 rounded cursor-pointer"><X className="w-4 h-4" /></button>
            {onClose && <button type="button" onClick={onClose} title="Hide inspector (I)" aria-label="Hide inspector" className="text-muted hover:text-fg p-1 rounded hover:bg-elevated cursor-pointer transition-colors"><PanelRightClose className="w-4 h-4" /></button>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="p-3.5 rounded-xl border border-line bg-canvas space-y-2">
            <RenameRow id={c.id} name={displayName} isOverridden={Boolean(session.overrides?.renamed?.[c.id])} onRename={onRenameEntity} />
            <p className="text-muted text-xs leading-relaxed">{c.summary}</p>
            <div className="flex items-center gap-2 pt-1">
              <span className="px-2 py-0.5 rounded bg-elevated border border-line text-[10px] uppercase font-medium">{c.category}</span>
              <span className="px-2 py-0.5 rounded bg-elevated border border-line text-[10px] text-muted">{getContainerFileCount(session, c.id)} files</span>
            </div>
            <button type="button" onClick={() => onEnterContainer(c.id)} className="w-full mt-2 py-2 px-3 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer">
              <span>Open LLD View</span><ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Contained Files ({files.length})</div>
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {files.map((f) => (
                <div key={f.id} onClick={() => { onEnterContainer(c.id); onSelect({ kind: 'file', id: f.id }); }} className="p-2 rounded-lg border border-line bg-canvas hover:bg-elevated transition-colors cursor-pointer flex items-center justify-between gap-1.5">
                  <span className="font-mono text-[11px] text-fg truncate">{f.id}</span>
                  <span className="text-[10px] text-muted shrink-0">{f.line_count}L</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Connected Edges ({edges.length})</div>
            <div className="space-y-1">
              {edges.map((e) => {
                const isSrc = e.source === c.id;
                const peerId = isSrc ? e.target : e.source;
                const peerName = session.overrides?.renamed?.[peerId] ?? session.containers.find((x) => x.id === peerId)?.label ?? peerId;
                return (
                  <div key={e.id} onClick={() => onSelect({ kind: 'edge', id: e.id })} className="p-2 rounded-lg border border-line bg-canvas hover:bg-elevated transition-colors cursor-pointer flex items-center justify-between gap-2">
                    <div className="truncate"><span className="text-muted text-[10px] mr-1">{isSrc ? 'To:' : 'From:'}</span><span className="font-medium text-fg">{peerName}</span></div>
                    <span className={`px-1.5 py-0.2 rounded text-[9px] border ${e.provenance === 'verified' ? 'border-solid border-verified text-verified' : 'border-dashed border-inferred text-inferred'}`}>{e.provenance}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    );
  }

  if (selection.kind === 'file') {
    const node = session.nodes.find((item) => item.id === selection.id);
    if (!node) return null;
    const displayName = session.overrides?.renamed?.[node.id] ?? node.label;
    const owner = session.containers.find((c) => c.id === node.container_id);
    const isExternal = Boolean(activeContainerId && node.container_id !== activeContainerId);
    const srcLink = buildSourceLink(session, node.id, 1);
    const edges = session.edges.filter((e) => e.scope === 'lld' && (e.source === node.id || e.target === node.id));

    return (
      <aside className="w-80 xl:w-96 shrink-0 border-l border-line bg-surface flex flex-col min-h-0 overflow-hidden text-xs">
        <div className="p-4 border-b border-line flex items-center justify-between">
          <span className="font-semibold text-fg text-sm">File Node</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onSelect({ kind: 'none' })} title="Close details" aria-label="Close details" className="text-muted hover:text-fg p-1 rounded cursor-pointer"><X className="w-4 h-4" /></button>
            {onClose && <button type="button" onClick={onClose} title="Hide inspector (I)" aria-label="Hide inspector" className="text-muted hover:text-fg p-1 rounded hover:bg-elevated cursor-pointer transition-colors"><PanelRightClose className="w-4 h-4" /></button>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="p-3.5 rounded-xl border border-line bg-canvas space-y-2">
            <RenameRow id={node.id} name={displayName} isOverridden={Boolean(session.overrides?.renamed?.[node.id])} onRename={onRenameEntity} />
            <div className="font-mono text-[11px] text-muted break-all">{node.id}</div>
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-elevated border border-line font-mono text-[10px] text-muted uppercase">{node.language}</span>
              <span className="px-2 py-0.5 rounded bg-elevated border border-line text-[10px] text-muted">{node.line_count} lines</span>
              {owner && <span className="px-2 py-0.5 rounded bg-elevated border border-line text-[10px] text-muted truncate">{session.overrides?.renamed?.[owner.id] ?? owner.label}</span>}
            </div>
            {isExternal && owner && (
              <button type="button" onClick={() => onJumpToExternalNode(node.container_id, node.id)} className="w-full mt-2 py-1.5 px-3 rounded-lg border border-accent text-accent hover:bg-accent hover:text-white transition-colors font-medium text-xs cursor-pointer flex items-center justify-center gap-1.5">
                <span>Jump to {session.overrides?.renamed?.[owner.id] ?? owner.label}</span><CornerDownRight className="w-3.5 h-3.5" />
              </button>
            )}
            {srcLink && (
              <a href={srcLink.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:text-accent-hover underline text-[11px] pt-1">
                <ExternalLink className="w-3.5 h-3.5" /><span>{srcLink.label}</span>
              </a>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Symbols ({node.symbols?.length ?? 0})</div>
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {(node.symbols ?? []).map((s, i) => {
                const link = buildSourceLink(session, node.id, s.line);
                return (
                  <div key={i} className="p-2 rounded-lg border border-line bg-canvas space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono font-medium text-fg text-xs truncate">{s.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0"><span className="text-[10px] px-1 rounded bg-elevated text-muted uppercase">{s.kind}</span>{link ? <a href={link.url} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-accent hover:underline">L{s.line}</a> : <span className="text-[10px] font-mono text-muted">L{s.line}</span>}</div>
                    </div>
                    {s.summary && <p className="text-[11px] text-muted truncate">{s.summary}</p>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Edges ({edges.length})</div>
            <div className="space-y-1">
              {edges.map((e) => {
                const isOut = e.source === node.id;
                const peerId = isOut ? e.target : e.source;
                return (
                  <div key={e.id} onClick={() => onSelect({ kind: 'edge', id: e.id })} className="p-2 rounded-lg border border-line bg-canvas hover:bg-elevated transition-colors cursor-pointer flex items-center justify-between gap-2">
                    <div className="truncate"><span className="text-muted text-[10px] mr-1">{isOut ? 'To:' : 'From:'}</span><span className="font-mono text-[11px] text-fg">{peerId}</span></div>
                    <span className={`px-1.5 py-0.2 rounded text-[9px] border ${e.provenance === 'verified' ? 'border-solid border-verified text-verified' : 'border-dashed border-inferred text-inferred'}`}>{e.provenance}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    );
  }

  // State 4: Edge Selected
  const edge = session.edges.find((item) => item.id === selection.id);
  if (!edge) return null;
  const isVerified = edge.provenance === 'verified';
  const srcC = session.containers.find((c) => c.id === edge.source);
  const tgtC = session.containers.find((c) => c.id === edge.target);
  const srcName = srcC ? session.overrides?.renamed?.[srcC.id] ?? srcC.label : edge.source;
  const tgtName = tgtC ? session.overrides?.renamed?.[tgtC.id] ?? tgtC.label : edge.target;
  const isHld = edge.scope === 'hld';

  return (
    <aside className="w-80 xl:w-96 shrink-0 border-l border-line bg-surface flex flex-col min-h-0 overflow-hidden text-xs">
      <div className="p-4 border-b border-line flex items-center justify-between">
        <span className="font-semibold text-fg text-sm">Edge Inspector</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onSelect({ kind: 'none' })} title="Close details" aria-label="Close details" className="text-muted hover:text-fg p-1 rounded cursor-pointer"><X className="w-4 h-4" /></button>
          {onClose && <button type="button" onClick={onClose} title="Hide inspector (I)" aria-label="Hide inspector" className="text-muted hover:text-fg p-1 rounded hover:bg-elevated cursor-pointer transition-colors"><PanelRightClose className="w-4 h-4" /></button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="p-3.5 rounded-xl border border-line bg-canvas space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${isVerified ? 'border-solid border-verified text-verified' : 'border-dashed border-inferred text-inferred'}`}>
              {isVerified ? 'Verified (Code Truth)' : 'Inferred (AI Inference)'}
            </span>
            <span className="text-[10px] uppercase font-mono text-muted">{edge.scope}</span>
          </div>
          <div className="space-y-1 pt-1 font-mono text-xs">
            <div onClick={() => onSelect(isHld ? { kind: 'container', id: edge.source } : { kind: 'file', id: edge.source })} className="text-fg hover:text-accent cursor-pointer truncate"><span className="text-muted font-sans text-[10px] mr-1">Source:</span>{srcName}</div>
            <div onClick={() => onSelect(isHld ? { kind: 'container', id: edge.target } : { kind: 'file', id: edge.target })} className="text-fg hover:text-accent cursor-pointer truncate"><span className="text-muted font-sans text-[10px] mr-1">Target:</span>{tgtName}</div>
          </div>
          {edge.label && <div className="pt-1 text-xs text-muted"><span className="text-fg font-medium">Relationship: </span>{edge.label}</div>}
        </div>
        {isVerified ? (
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-verified uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-verified" />
              <span>AST Evidence ({(edge as ArchEdge & { evidence: { file: string; line: number }[] }).evidence.length})</span>
            </div>
            <div className="space-y-1.5">
              {(edge as ArchEdge & { evidence: { file: string; line: number }[] }).evidence.map((ev, i) => {
                const link = buildSourceLink(session, ev.file, ev.line);
                return (<div key={i} className="p-2.5 rounded-xl border border-line bg-canvas flex items-center justify-between gap-2"><div className="font-mono text-[11px] text-fg truncate">{ev.file}:{ev.line}</div>{link && <a href={link.url} target="_blank" rel="noreferrer" className="text-accent hover:underline text-[10px] shrink-0 font-medium">Go to File</a>}</div>);
              })}
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl border border-dashed border-inferred bg-canvas space-y-1">
            <div className="text-[11px] font-medium text-inferred uppercase tracking-wider">AI Inference Reason</div>
            <p className="text-xs text-muted leading-relaxed">{(edge as ArchEdge & { reason: string }).reason || 'Inferred from structural and naming conventions.'}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
