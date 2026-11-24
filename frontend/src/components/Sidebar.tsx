import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Check, Folder, Globe, HelpCircle, PanelLeftClose, Pencil, Pin, Search, Settings, Trash2, X } from 'lucide-react';
import type { RenderSession } from '../types/schema';
import type { SidebarProps } from '../types/ui';
import { OrbiEmblem } from './Launcher';

const RAIL_WIDTH = 64;
const MIN_WIDTH = 256;
const getMaxWidth = () => (typeof window !== 'undefined' ? Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.25)) : MIN_WIDTH);
const TRANSITION_CLS = 'transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]';

function formatRelativeTime(iso: string): string {
  try {
    const ts = new Date(iso).getTime(); if (Number.isNaN(ts)) return '';
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return 'Just now'; if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
    return d < 2592000 ? `${Math.floor(d / 86400)}d ago` : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

export function Sidebar({
  sessions, activeSessionId, activeView, collapsed, onToggleCollapse,
  onSelectSession, onNewSession, onOpenSettings, onOpenHelp, onRenameSession, onDeleteSession,
  isHydrating = false,
}: SidebarProps) {
  const [width, setWidth] = useState(MIN_WIDTH);
  const [isDragging, setIsDragging] = useState(false), [isPeeking, setIsPeeking] = useState(false);
  const isDraggingRef = useRef(false), suppressPeekRef = useRef(false);
  const enterTimerRef = useRef<number | null>(null), leaveTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null), asideRef = useRef<HTMLElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null), [editName, setEditName] = useState('');
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null), [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isExpanded = !collapsed || isPeeking;

  useEffect(() => {
    const handleResize = () => setWidth((prev) => Math.min(Math.max(prev, MIN_WIDTH), getMaxWidth()));
    const onPointerMoveWindow = (e: PointerEvent) => {
      if (suppressPeekRef.current && asideRef.current) {
        const r = asideRef.current.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) suppressPeekRef.current = false;
      }
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('pointermove', onPointerMoveWindow);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', onPointerMoveWindow);
      if (enterTimerRef.current !== null) clearTimeout(enterTimerRef.current);
      if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  useEffect(() => { if (!isExpanded) { setEditingSessionId(null); setDeletingSessionId(null); setEditName(''); } }, [isExpanded]);

  useEffect(() => {
    if (collapsed && isPeeking && !editingSessionId && !deletingSessionId) {
      const isInputFocused = searchInputRef.current ? document.activeElement === searchInputRef.current : false;
      if (!isInputFocused && !asideRef.current?.matches(':hover')) {
        if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = window.setTimeout(() => setIsPeeking(false), 160);
      }
    }
  }, [collapsed, isPeeking, editingSessionId, deletingSessionId]);

  useEffect(() => {
    if (editingSessionId && !sessions.some((s) => s.session.id === editingSessionId)) { setEditingSessionId(null); setEditName(''); }
    if (deletingSessionId && !sessions.some((s) => s.session.id === deletingSessionId)) setDeletingSessionId(null);
  }, [sessions, editingSessionId, deletingSessionId]);

  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? sessions.filter((s) => (s.session.name || '').toLowerCase().includes(query) || (s.session.source_ref || '').toLowerCase().includes(query))
    : sessions;

  const handleMouseEnter = () => {
    if (leaveTimerRef.current !== null) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
    if (collapsed && !suppressPeekRef.current) {
      if (enterTimerRef.current !== null) clearTimeout(enterTimerRef.current);
      enterTimerRef.current = window.setTimeout(() => { setIsPeeking(true); enterTimerRef.current = null; }, 90);
    }
  };

  const handleMouseLeave = () => {
    if (enterTimerRef.current !== null) { clearTimeout(enterTimerRef.current); leaveTimerRef.current = null; }
    suppressPeekRef.current = false;
    const isInputFocused = searchInputRef.current ? document.activeElement === searchInputRef.current : false;
    if (collapsed && !editingSessionId && !deletingSessionId && !isInputFocused) {
      if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = window.setTimeout(() => { setIsPeeking(false); leaveTimerRef.current = null; }, 160);
    }
  };

  const handleToggleHeader = () => {
    if (enterTimerRef.current !== null) { clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
    if (leaveTimerRef.current !== null) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
    if (!collapsed) suppressPeekRef.current = true;
    setIsPeeking(false); onToggleCollapse();
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault(); isDraggingRef.current = true; setIsDragging(true); e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) setWidth(Math.min(Math.max(e.clientX, MIN_WIDTH), getMaxWidth()));
  };
  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false; setIsDragging(false);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };

  const handleStartRename = (session: RenderSession) => {
    if (busyId) return;
    setEditingSessionId(session.session.id); setEditName(session.session.name); setDeletingSessionId(null); setErrorMessage(null);
  };
  const handleCommitRename = async (id: string) => {
    const trimmed = editName.trim(); if (!trimmed) return;
    setBusyId(id); setErrorMessage(null);
    try { await onRenameSession(id, trimmed); setEditingSessionId(null); }
    catch (err) { setErrorMessage(err instanceof Error ? err.message : 'Failed to rename session'); }
    finally { setBusyId(null); }
  };
  const handleConfirmDelete = async (id: string) => {
    setBusyId(id); setErrorMessage(null);
    try { await onDeleteSession(id); setDeletingSessionId(null); }
    catch (err) { setErrorMessage(err instanceof Error ? err.message : 'Failed to delete session'); }
    finally { setBusyId(null); }
  };

  const asideWidth = isExpanded ? width : RAIL_WIDTH;
  const layoutWidth = collapsed ? RAIL_WIDTH : width;

  return (
    <div className={`relative shrink-0 h-full ${!isDragging ? TRANSITION_CLS : ''}`} style={{ width: layoutWidth }}>
      <aside
        ref={asideRef} aria-label="Sidebar" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
        style={{ width: asideWidth }}
        className={`absolute inset-y-0 left-0 z-30 flex flex-col bg-surface border-r border-line overflow-hidden ${
          !isDragging ? TRANSITION_CLS : ''
        } ${isPeeking && collapsed ? 'border-r-accent/40 ring-1 ring-line' : ''}`}
      >
        {!collapsed && (
          <div
            role="separator" aria-orientation="vertical" aria-label="Resize sidebar"
            onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}
            onDoubleClick={() => setWidth(MIN_WIDTH)}
            className={`absolute top-0 right-0 w-1 h-full cursor-col-resize z-40 transition-colors ${isDragging ? 'bg-accent' : 'hover:bg-accent/60'}`}
          />
        )}

        {/* Header */}
        <div className={`flex items-center border-b border-line shrink-0 ${!isExpanded ? 'h-14 justify-center' : 'h-14 px-3 justify-between'}`}>
          {isExpanded && (
            <div className="flex items-center gap-2.5 min-w-0 whitespace-nowrap overflow-hidden">
              <div className="w-7 h-7 rounded-lg bg-accent text-white flex items-center justify-center shrink-0">
                <OrbiEmblem className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold tracking-tight text-sm text-fg whitespace-nowrap">ORBI-ARCH</span>
              <span className="bg-accent/15 text-accent text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap">Local</span>
            </div>
          )}
          <button
            type="button" onClick={handleToggleHeader}
            aria-label={!collapsed ? 'Collapse sidebar' : 'Pin sidebar open'}
            title={!collapsed ? 'Collapse sidebar' : 'Pin sidebar open'}
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-elevated transition-colors cursor-pointer shrink-0"
          >
            {!collapsed ? <PanelLeftClose className="w-4 h-4" /> : isPeeking ? <Pin className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4 rotate-180" />}
          </button>
        </div>

        {/* New Session Button */}
        <div className={!isExpanded ? 'p-2 flex justify-center shrink-0' : 'p-3 shrink-0'}>
          <button
            type="button" onClick={onNewSession} title="New Session" aria-label="New Session"
            className={`flex items-center justify-center gap-2 rounded-lg text-xs font-medium transition-colors bg-accent hover:bg-accent-hover text-white cursor-pointer ${
              !isExpanded ? 'w-10 h-10' : 'w-full py-2.5 px-3'
            } ${activeView === 'launcher' ? 'ring-2 ring-accent/60 ring-offset-2 ring-offset-surface' : ''}`}
          >
            <svg className="w-4 h-4 shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
            {isExpanded && <span className="whitespace-nowrap font-medium">New session</span>}
          </button>
        </div>

        {/* Past Sessions List */}
        <div className="flex-1 min-h-0 flex flex-col">
          {isExpanded && (
            <>
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase shrink-0 whitespace-nowrap">
                PAST SESSIONS{!isHydrating && ` · ${sessions.length}`}
              </div>
              {sessions.length > 0 && (
                <div className="relative px-3 py-1.5 shrink-0">
                  <Search className="w-4 h-4 text-muted/70 absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={searchInputRef} type="search" value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape' && searchQuery) { e.preventDefault(); setSearchQuery(''); } }}
                    onBlur={() => {
                      if (collapsed && isPeeking && !editingSessionId && !deletingSessionId && !asideRef.current?.matches(':hover')) {
                        if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
                        leaveTimerRef.current = window.setTimeout(() => setIsPeeking(false), 160);
                      }
                    }}
                    placeholder="Search sessions..." aria-label="Search sessions"
                    className="w-full text-sm pl-8 pr-7 py-1.5 rounded-lg bg-canvas border border-line/70 text-fg placeholder:text-muted/70 focus:border-accent"
                  />
                  {searchQuery && (
                    <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" className="absolute right-5 top-1/2 -translate-y-1/2 p-0.5 text-muted hover:text-fg cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Error Notification */}
          {errorMessage && (
            <div role="alert" className={`shrink-0 rounded-lg bg-elevated border border-line text-inferred text-xs flex items-center justify-between gap-2 ${!isExpanded ? 'm-1 p-1 justify-center' : 'mx-3 my-1.5 p-2'}`}>
              {isExpanded && <span className="flex-1 min-w-0 break-words">{errorMessage}</span>}
              <button type="button" onClick={() => setErrorMessage(null)} title={errorMessage} aria-label="Dismiss error" className="p-0.5 text-muted hover:text-fg cursor-pointer"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* Items */}
          <ul className={`flex-1 overflow-y-auto space-y-1 ${!isExpanded ? 'py-2 px-1' : 'p-2'}`}>
            {isExpanded ? (
              isHydrating ? (
                <li className="px-3 py-2 space-y-2 list-none">
                  <div className="h-9 rounded-lg bg-elevated/40" />
                  <div className="h-9 rounded-lg bg-elevated/40" />
                </li>
              ) : sessions.length === 0 ? (
                <li className="p-4 text-center text-xs text-muted list-none whitespace-nowrap">No saved sessions</li>
              ) : filtered.length === 0 ? (
                <li className="p-4 text-center space-y-2 list-none">
                  <p className="text-xs text-muted whitespace-nowrap">No matches</p>
                  <button type="button" onClick={() => setSearchQuery('')} className="text-xs text-accent hover:underline cursor-pointer whitespace-nowrap">Clear search</button>
                </li>
              ) : (
                filtered.map((s) => {
                  const isSelected = activeView === 'session' && activeSessionId === s.session.id;
                  const isEditing = editingSessionId === s.session.id;
                  const isDeleting = deletingSessionId === s.session.id;
                  const isRowBusy = busyId === s.session.id;
                  const SourceIcon = s.session.source_type === 'github' ? Globe : Folder;
                  const relTime = formatRelativeTime(s.session.created_at);
                  const displayName = s.session.name || 'Untitled';
                  const count = s.containers?.length ?? 0;

                  if (isEditing) {
                    return (
                      <li key={s.session.id} className="p-1.5 rounded-lg border border-accent bg-elevated flex items-center gap-1.5">
                        <SourceIcon className="w-3.5 h-3.5 shrink-0 text-muted" />
                        <input
                          type="text" maxLength={80} autoFocus value={editName}
                          onChange={(e) => setEditName(e.target.value)} onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); void handleCommitRename(s.session.id); }
                            else if (e.key === 'Escape' && !isRowBusy) { e.preventDefault(); setEditingSessionId(null); }
                          }}
                          disabled={isRowBusy} aria-label="Session name"
                          className="flex-1 min-w-0 text-xs bg-canvas border border-line rounded px-1.5 py-1 text-fg outline-none focus:border-accent"
                        />
                        <button type="button" onClick={() => void handleCommitRename(s.session.id)} disabled={isRowBusy || !editName.trim()} aria-label="Save session name" title="Save" className="p-1 rounded text-verified hover:bg-canvas disabled:opacity-40 transition-colors cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => setEditingSessionId(null)} disabled={isRowBusy} aria-label="Cancel rename" title="Cancel" className="p-1 rounded text-muted hover:text-fg hover:bg-canvas disabled:opacity-40 transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                      </li>
                    );
                  }

                  if (isDeleting) {
                    return (
                      <li key={s.session.id} className="p-1.5 rounded-lg border border-dashed border-inferred bg-elevated flex items-center justify-between gap-1.5">
                        <span className="truncate text-xs text-fg font-medium flex-1 whitespace-nowrap">{displayName}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[11px] text-inferred font-medium whitespace-nowrap">Delete?</span>
                          <button type="button" onClick={() => void handleConfirmDelete(s.session.id)} disabled={isRowBusy} aria-label="Confirm delete" className="p-1 rounded text-inferred hover:bg-canvas disabled:opacity-40 transition-colors cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                          <button type="button" autoFocus onClick={() => setDeletingSessionId(null)} disabled={isRowBusy} aria-label="Cancel delete" className="p-1 rounded text-muted hover:text-fg hover:bg-canvas disabled:opacity-40 transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      </li>
                    );
                  }

                  return (
                    <li key={s.session.id} className={`group relative flex items-center justify-between rounded-lg border transition-colors ${
                      isSelected ? 'bg-elevated border-line border-l-2 border-l-accent text-fg' : 'border-transparent hover:bg-elevated/70 text-muted hover:text-fg'
                    }`}>
                      <button type="button" onClick={() => onSelectSession(s.session.id)} className="flex-1 min-w-0 flex items-center gap-2.5 p-2 text-left cursor-pointer rounded-lg">
                        <div className={`w-8 h-8 rounded-lg bg-elevated border border-line/60 flex items-center justify-center shrink-0 ${
                          s.session.source_type === 'github' ? 'text-verified' : 'text-accent'
                        }`}>
                          <SourceIcon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-sm font-medium text-fg whitespace-nowrap" title={displayName}>{displayName}</div>
                          <div className="text-xs text-muted truncate whitespace-nowrap mt-0.5">
                            {relTime ? `${relTime} · ${count} components` : `${count} components`}
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
                        <button type="button" onClick={() => handleStartRename(s)} disabled={Boolean(busyId)} aria-label="Rename session" title="Rename" className="p-1 rounded text-muted hover:text-fg hover:bg-canvas transition-colors cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => { if (!busyId) { setDeletingSessionId(s.session.id); setEditingSessionId(null); setErrorMessage(null); } }} disabled={Boolean(busyId)} aria-label="Delete session" title="Delete" className="p-1 rounded text-muted hover:text-inferred hover:bg-canvas transition-colors cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </li>
                  );
                })
              )
            ) : (
              sessions.map((s) => {
                const isSelected = activeView === 'session' && activeSessionId === s.session.id;
                const SourceIcon = s.session.source_type === 'github' ? Globe : Folder;
                const displayName = s.session.name || 'Untitled';
                const count = s.containers?.length ?? 0;

                return (
                  <li key={s.session.id} className="flex justify-center py-0.5">
                    <button
                      type="button" onClick={() => onSelectSession(s.session.id)}
                      title={`${displayName} (${count} components)`} aria-label={`${displayName} (${count} components)`}
                      className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors border cursor-pointer ${
                        isSelected ? 'bg-elevated text-fg border-accent' : 'border-transparent text-muted hover:text-fg hover:bg-elevated'
                      }`}
                    >
                      <SourceIcon className={`w-4 h-4 shrink-0 ${s.session.source_type === 'github' ? 'text-verified' : 'text-accent'}`} />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {/* Footer */}
        <div className={`p-2 border-t border-line/70 flex flex-col gap-1 shrink-0 ${!isExpanded ? 'items-center' : ''}`}>
          {[
            { view: 'settings' as const, label: 'Settings', icon: Settings, action: onOpenSettings },
            { view: 'help' as const, label: 'Help', icon: HelpCircle, action: onOpenHelp },
          ].map(({ view, label, icon: Icon, action }) => (
            <button
              key={view} type="button" onClick={action} title={label} aria-label={label}
              className={`flex items-center gap-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
                !isExpanded ? 'w-10 h-10 justify-center' : 'w-full py-2 px-2.5'
              } ${activeView === view ? 'bg-elevated text-fg font-medium border border-line' : 'border border-transparent text-muted hover:text-fg hover:bg-elevated'}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {isExpanded && <span className="whitespace-nowrap">{label}</span>}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
