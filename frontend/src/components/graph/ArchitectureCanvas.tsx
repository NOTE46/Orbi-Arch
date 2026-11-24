import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node, OnNodeDrag } from '@xyflow/react';
import {
  Background, BackgroundVariant, MarkerType, ReactFlow,
  ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Maximize2, Minimize2, PanelRightOpen, RotateCcw, Spline, Tag, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { ArchEdge } from '../../types/schema';
import { getContainerFileCount, getLldSlice } from '../../lib/graph';
import { layoutHldGraph, layoutLldGraph } from '../../lib/layout';
import { ARCH_NODE_TYPES } from './ArchNodes';
import type { ArchitectureCanvasProps as BaseArchitectureCanvasProps } from './types';

export interface ArchitectureCanvasProps extends BaseArchitectureCanvasProps {
  isFullscreen?: boolean; onToggleFullscreen?: () => void; inspectorOpen?: boolean; onToggleInspector?: () => void;
}

type EdgeStyleType = 'default' | 'smoothstep' | 'straight';

const EDGE_STYLE_LABELS: Record<EdgeStyleType, string> = { default: 'Curved', smoothstep: 'Stepped', straight: 'Straight' };

function mapFlowEdge(
  e: ArchEdge, selEdgeId: string | null, hoveredEdgeId: string | null,
  connNodes: Set<string>, selKind: string, total: number,
  showAllLabels: boolean, edgeStyle: EdgeStyleType
): Edge {
  const isSel = selEdgeId === e.id;
  const isHovered = hoveredEdgeId === e.id;
  const isHighlighted = isSel || isHovered;
  const isConn = selKind === 'none' || (connNodes.has(e.source) && connNodes.has(e.target));
  const isVer = e.provenance === 'verified';
  const color = isVer ? 'var(--verified)' : 'var(--inferred)';
  const showLabel = Boolean(e.label && (isHovered || isSel || (showAllLabels && total <= 20)));

  return {
    id: e.id, source: e.source, target: e.target, type: edgeStyle,
    label: showLabel ? e.label : undefined,
    labelStyle: { fill: 'var(--text-fg)', fontSize: 11, fontWeight: 500 },
    labelBgStyle: { fill: 'var(--bg-surface)', stroke: 'var(--border-line)', strokeWidth: 1, fillOpacity: 0.96 },
    labelBgPadding: [6, 3], labelBgBorderRadius: 6, zIndex: isHighlighted ? 10 : 0,
    style: { stroke: color, strokeWidth: isHighlighted ? 2.4 : 1.5, strokeDasharray: isVer ? undefined : '6 4', opacity: isConn ? 1 : 0.14 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
  };
}

function InnerCanvas({
  session, activeContainerId, selection, showExternalNodes, onSelect, onEnterContainer, onExitToHld,
  onJumpToExternalNode, onToggleExternalNodes, onSavePositions, onResetViewLayout, isFullscreen,
  onToggleFullscreen, inspectorOpen, onToggleInspector,
}: ArchitectureCanvasProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [showAllLabels, setShowAllLabels] = useState(false);
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyleType>('default');
  const [hintDismissed, setHintDismissed] = useState(false);

  const transitionTimerRef = useRef<number | null>(null);
  const lastFitKeyRef = useRef<string>('');

  const currentFitKey = `${session.session.id}:${activeContainerId ?? 'hld'}:${showExternalNodes ? 1 : 0}`;
  const lldSlice = useMemo(() => (activeContainerId ? getLldSlice(session, activeContainerId) : null), [session, activeContainerId]);

  useEffect(() => { setHoveredEdgeId(null); }, [activeContainerId, session.session.id]);
  useEffect(() => { setHintDismissed(false); }, [session.session.id]);

  const { connectedNodeIds, selectedEdgeId } = useMemo(() => {
    const nodeIds = new Set<string>();
    let edgeId: string | null = null;
    if (selection.kind === 'container' || selection.kind === 'file') {
      nodeIds.add(selection.id);
      const relevant = session.edges.filter(
        (e) => (activeContainerId ? e.scope === 'lld' : e.scope === 'hld') && (e.source === selection.id || e.target === selection.id)
      );
      for (const e of relevant) { nodeIds.add(e.source); nodeIds.add(e.target); }
    } else if (selection.kind === 'edge') {
      edgeId = selection.id;
      const tgt = session.edges.find((e) => e.id === selection.id);
      if (tgt) { nodeIds.add(tgt.source); nodeIds.add(tgt.target); }
    }
    return { connectedNodeIds: nodeIds, selectedEdgeId: edgeId };
  }, [selection, session.edges, activeContainerId]);

  const triggerDrillDown = useCallback((cId: string) => {
    void fitView({ nodes: [{ id: cId }], duration: 220, padding: 0.25 });
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      setIsTransitioning(true); onEnterContainer(cId);
      requestAnimationFrame(() => { void fitView({ duration: 220, padding: 0.2 }); setIsTransitioning(false); });
    }, 150);
  }, [fitView, onEnterContainer]);

  useEffect(() => () => { if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current); }, []);

  const { initialNodes, flowEdges, visibleNodeIds } = useMemo(() => {
    if (!activeContainerId) {
      const positions = layoutHldGraph(session, 'TB');
      const nodes: Node[] = session.containers.map((c) => ({
        id: c.id, type: 'hldContainer', position: positions[c.id] ?? { x: 0, y: 0 },
        selected: selection.kind === 'container' && selection.id === c.id,
        data: {
          label: session.overrides?.renamed?.[c.id] ?? c.label, category: c.category,
          summary: c.summary, fileCount: getContainerFileCount(session, c.id),
          dimmed: connectedNodeIds.size > 0 && !connectedNodeIds.has(c.id), onDrillDown: triggerDrillDown,
        },
      }));
      const hldEdges = session.edges.filter((e) => e.scope === 'hld');
      const edges = hldEdges.map((e) =>
        mapFlowEdge(e, selectedEdgeId, hoveredEdgeId, connectedNodeIds, selection.kind, hldEdges.length, showAllLabels, edgeStyle)
      );
      return { initialNodes: nodes, flowEdges: edges, visibleNodeIds: session.containers.map((c) => c.id) };
    }

    const cId = activeContainerId;
    const slice = lldSlice ?? getLldSlice(session, cId);
    const positions = layoutLldGraph(session, cId, showExternalNodes, 'LR');

    const internalNodes: Node[] = slice.internalNodes.map((n) => ({
      id: n.id, type: 'lldFile', position: positions[n.id] ?? { x: 0, y: 0 },
      selected: selection.kind === 'file' && selection.id === n.id,
      data: {
        label: session.overrides?.renamed?.[n.id] ?? n.label, path: n.id, language: n.language,
        lineCount: n.line_count, symbolCount: n.symbols?.length ?? 0,
        dimmed: connectedNodeIds.size > 0 && !connectedNodeIds.has(n.id),
      },
    }));

    const externalNodes: Node[] = showExternalNodes ? slice.externalNodes.map((n) => {
      const owner = session.containers.find((c) => c.id === n.container_id);
      return {
        id: n.id, type: 'lldExternal', position: positions[n.id] ?? { x: 0, y: 0 },
        selected: selection.kind === 'file' && selection.id === n.id,
        data: {
          label: session.overrides?.renamed?.[n.id] ?? n.label, path: n.id, containerId: n.container_id,
          containerLabel: owner ? session.overrides?.renamed?.[owner.id] ?? owner.label : 'External',
          dimmed: connectedNodeIds.size > 0 && !connectedNodeIds.has(n.id), onJumpToContainer: onJumpToExternalNode,
        },
      };
    }) : [];

    const allNodes = [...internalNodes, ...externalNodes];
    const visibleIds = new Set(allNodes.map((n) => n.id));
    const visibleEdges = slice.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
    const edges = visibleEdges.map((e) =>
      mapFlowEdge(e, selectedEdgeId, hoveredEdgeId, connectedNodeIds, selection.kind, visibleEdges.length, showAllLabels, edgeStyle)
    );
    return { initialNodes: allNodes, flowEdges: edges, visibleNodeIds: Array.from(visibleIds) };
  }, [session, activeContainerId, selection, connectedNodeIds, selectedEdgeId, hoveredEdgeId, showAllLabels, edgeStyle, showExternalNodes, lldSlice, triggerDrillDown, onJumpToExternalNode]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  useEffect(() => { setNodes(initialNodes); }, [initialNodes, setNodes]);

  // Clean, reliable fitView when DOM node dimensions are measured
  useEffect(() => {
    if (nodesInitialized && lastFitKeyRef.current !== currentFitKey) {
      lastFitKeyRef.current = currentFitKey;
      void fitView({ padding: 0.2, maxZoom: 1.25, duration: 180 });
    }
  }, [nodesInitialized, currentFitKey, fitView]);

  const handleNodeDragStop: OnNodeDrag = useCallback((_event, node) => {
    void onSavePositions({
      ...(session.overrides?.positions ?? {}),
      [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    });
  }, [session.overrides?.positions, onSavePositions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.key === 'f' || e.key === 'F') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        void fitView({ duration: 220, padding: 0.2 });
      } else if (e.key === 'Escape') {
        if (selection.kind !== 'none') onSelect({ kind: 'none' });
        else if (activeContainerId !== null) onExitToHld();
        else if (isFullscreen && onToggleFullscreen) onToggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitView, selection.kind, onSelect, activeContainerId, onExitToHld, isFullscreen, onToggleFullscreen]);

  const extCount = lldSlice?.externalNodes.length ?? 0;

  return (
    <div className={`w-full h-full min-h-0 relative transition-opacity duration-150 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
      <ReactFlow
        nodes={nodes} edges={flowEdges} nodeTypes={ARCH_NODE_TYPES}
        onNodesChange={onNodesChange} onNodeDragStop={handleNodeDragStop}
        onNodeClick={(_, n) => onSelect(activeContainerId ? { kind: 'file', id: n.id } : { kind: 'container', id: n.id })}
        onEdgeClick={(_, e) => onSelect({ kind: 'edge', id: e.id })}
        onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        onPaneClick={() => {
          setHoveredEdgeId(null);
          onSelect({ kind: 'none' });
        }}
        nodesDraggable={true} nodesConnectable={false} elementsSelectable={true}
        fitView={true} fitViewOptions={{ padding: 0.2, maxZoom: 1.25 }}
        minZoom={0.12} maxZoom={2} className="bg-canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border-line)" />
      </ReactFlow>

      {/* Control Toolbar */}
      <div className="absolute top-4 left-4 flex items-center gap-1.5 p-1 rounded-xl border border-line bg-surface shadow-sm z-10 text-xs">
        <button type="button" onClick={() => void zoomIn({ duration: 180 })} title="Zoom In" aria-label="Zoom In" className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-elevated transition-colors cursor-pointer"><ZoomIn className="w-4 h-4" /></button>
        <button type="button" onClick={() => void zoomOut({ duration: 180 })} title="Zoom Out" aria-label="Zoom Out" className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-elevated transition-colors cursor-pointer"><ZoomOut className="w-4 h-4" /></button>
        <button type="button" onClick={() => void fitView({ duration: 220, padding: 0.2 })} title="Fit View (F)" aria-label="Fit View (F)" className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-elevated transition-colors cursor-pointer"><Maximize2 className="w-4 h-4" /></button>
        <div className="w-[1px] h-4 bg-line my-auto mx-0.5" />
        <button type="button" onClick={() => void onResetViewLayout(visibleNodeIds)} title="Reset Layout to Auto" aria-label="Reset Layout" className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-elevated transition-colors cursor-pointer"><RotateCcw className="w-4 h-4" /></button>
        <div className="w-[1px] h-4 bg-line my-auto mx-0.5" />
        <button
          type="button"
          onClick={() => setShowAllLabels((p) => !p)}
          title="Toggle All Edge Labels"
          aria-label="Toggle All Edge Labels"
          className={`px-2 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1 transition-colors cursor-pointer shrink-0 ${
            showAllLabels ? 'border-accent bg-elevated text-fg' : 'border-line bg-canvas text-muted hover:text-fg hover:bg-elevated'
          }`}
        >
          <Tag className="w-3.5 h-3.5" />
          <span>Labels</span>
        </button>
        <button
          type="button"
          onClick={() => setEdgeStyle((curr) => (curr === 'default' ? 'smoothstep' : curr === 'smoothstep' ? 'straight' : 'default'))}
          title="Switch edge line style (Curved / Stepped / Straight)"
          aria-label="Switch edge line style (Curved / Stepped / Straight)"
          className="px-2 py-1 rounded-lg text-[11px] font-medium border border-line bg-canvas text-muted hover:text-fg hover:bg-elevated flex items-center gap-1 transition-colors cursor-pointer shrink-0"
        >
          <Spline className="w-3.5 h-3.5" />
          <span>{EDGE_STYLE_LABELS[edgeStyle]}</span>
        </button>
        {onToggleFullscreen && (
          <>
            <div className="w-[1px] h-4 bg-line my-auto mx-0.5" />
            <button
              type="button" onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen (Shift+F)' : 'Fullscreen graph (Shift+F)'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen graph'}
              aria-pressed={Boolean(isFullscreen)}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${isFullscreen ? 'bg-elevated text-accent border border-accent/40' : 'text-muted hover:text-fg hover:bg-elevated'}`}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </>
        )}
        {activeContainerId && extCount > 0 && (
          <>
            <div className="w-[1px] h-4 bg-line my-auto mx-0.5" />
            <button type="button" onClick={onToggleExternalNodes} className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-line bg-canvas text-muted hover:text-fg hover:bg-elevated transition-colors cursor-pointer shrink-0">
              {showExternalNodes ? `Hide external (${extCount})` : `Show external (${extCount})`}
            </button>
          </>
        )}
      </div>

      {/* Floating Reopen Inspector Chip */}
      {!inspectorOpen && !isFullscreen && onToggleInspector && (
        <button type="button" onClick={onToggleInspector} title="Show inspector (I)" aria-label="Show inspector" className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-elevated shadow-sm cursor-pointer transition-colors">
          <PanelRightOpen className="w-3.5 h-3.5 text-muted" /><span>Inspector</span>
        </button>
      )}

      {/* Bottom-left Stack: Hint + Legend */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-2 pointer-events-none max-w-[calc(100%-24px)]">
        {nodes.length > 0 && flowEdges.length === 0 && !hintDismissed && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-muted shadow-sm leading-relaxed">
            <span>No static cross-module imports detected — double-click a container to inspect files, or configure an AI model in Settings.</span>
            <button
              type="button"
              onClick={() => setHintDismissed(true)}
              title="Dismiss"
              aria-label="Dismiss hint"
              className="shrink-0 rounded p-0.5 text-muted hover:bg-elevated hover:text-fg cursor-pointer transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-3 px-3 py-1.5 rounded-xl border border-line bg-surface text-[11px] text-muted select-none shadow-sm">
          <div className="flex items-center gap-1.5"><span className="w-3.5 h-[2px] bg-verified rounded-full" /><span>Verified (AST)</span></div>
          <div className="w-[1px] h-3 bg-line" /><div className="flex items-center gap-1.5"><span className="w-3.5 h-[2px] border-b-2 border-dashed border-inferred" /><span>Inferred (AI)</span></div>
        </div>
      </div>
    </div>
  );
}

export function ArchitectureCanvas(props: ArchitectureCanvasProps) {
  return (
    <div className="w-full h-full min-h-0 relative">
      <ReactFlowProvider>
        <InnerCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}

export default ArchitectureCanvas;
