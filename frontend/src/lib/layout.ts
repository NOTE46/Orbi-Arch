import dagre from '@dagrejs/dagre';
import type { RenderSession } from '../types/schema';
import { getLldSlice } from './graph';

export const HLD_NODE_SIZE = { width: 240, height: 96 } as const;
export const LLD_NODE_SIZE = { width: 224, height: 82 } as const;
export const EXTERNAL_NODE_SIZE = { width: 204, height: 66 } as const;

export function computeDagrePositions(
  items: Array<{ id: string; width: number; height: number }>,
  edges: Array<{ source: string; target: string }>,
  options?: { direction?: 'TB' | 'LR'; nodesep?: number; ranksep?: number; defaultColumns?: number }
): Record<string, { x: number; y: number }> {
  if (items.length === 0) return {};

  const itemMap = new Set(items.map((it) => it.id));
  const validEdges: Array<{ source: string; target: string }> = [];
  const seenEdges = new Set<string>();

  for (const e of edges) {
    if (!itemMap.has(e.source) || !itemMap.has(e.target)) continue;
    if (e.source === e.target) continue; // Skip self-loops
    const key = `${e.source}->${e.target}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    validEdges.push(e);
  }

  const gapX = options?.nodesep ?? 76;
  const gapY = options?.ranksep ?? 80;

  // If there are zero edges between items, arrange them in a clean deterministic grid
  if (validEdges.length === 0) {
    const cols = Math.max(1, options?.defaultColumns ?? (items.length <= 4 ? items.length : 3));
    const positions: Record<string, { x: number; y: number }> = {};
    items.forEach((it, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      positions[it.id] = {
        x: Math.round(24 + col * (it.width + gapX)),
        y: Math.round(24 + row * (it.height + gapY)),
      };
    });
    return positions;
  }

  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: options?.direction ?? 'TB',
    nodesep: gapX,
    ranksep: options?.ranksep ?? 100,
    marginx: 24,
    marginy: 24,
  });

  for (const it of items) {
    g.setNode(it.id, { width: it.width, height: it.height });
  }

  for (const e of validEdges) {
    g.setEdge(e.source, e.target);
  }

  let layoutOk = false;
  try {
    dagre.layout(g);
    layoutOk = true;
  } catch {
    layoutOk = false;
  }

  const colsFallback = Math.max(1, options?.defaultColumns ?? Math.ceil(Math.sqrt(items.length)));
  const positions: Record<string, { x: number; y: number }> = {};

  items.forEach((it, idx) => {
    if (layoutOk) {
      try {
        const node = g.node(it.id);
        if (node && Number.isFinite(node.x) && Number.isFinite(node.y)) {
          positions[it.id] = {
            x: Math.round(node.x - it.width / 2),
            y: Math.round(node.y - it.height / 2),
          };
          return;
        }
      } catch {
        // Fall back to clean grid below
      }
    }
    const col = idx % colsFallback;
    const row = Math.floor(idx / colsFallback);
    positions[it.id] = {
      x: Math.round(24 + col * (it.width + gapX)),
      y: Math.round(24 + row * (it.height + gapY)),
    };
  });

  return positions;
}

export function layoutHldGraph(session: RenderSession, direction?: 'TB' | 'LR'): Record<string, { x: number; y: number }> {
  const items = session.containers.map((c) => ({ id: c.id, ...HLD_NODE_SIZE }));
  const containerIds = new Set(items.map((it) => it.id));
  const edges = session.edges
    .filter((e) => e.scope === 'hld' && containerIds.has(e.source) && containerIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  const computed = computeDagrePositions(items, edges, {
    direction: direction ?? 'TB',
    nodesep: 76,
    ranksep: 100,
    defaultColumns: 3,
  });

  const saved = session.overrides?.positions ?? {};
  for (const c of session.containers) {
    const override = saved[c.id];
    if (override && Number.isFinite(override.x) && Number.isFinite(override.y)) {
      computed[c.id] = { x: Math.round(override.x), y: Math.round(override.y) };
    }
  }

  return computed;
}

export function layoutLldGraph(
  session: RenderSession,
  containerId: string,
  includeExternal: boolean,
  direction?: 'TB' | 'LR'
): Record<string, { x: number; y: number }> {
  const slice = getLldSlice(session, containerId);
  const internalItems = slice.internalNodes.map((n) => ({ id: n.id, ...LLD_NODE_SIZE }));
  const externalItems = includeExternal ? slice.externalNodes.map((n) => ({ id: n.id, ...EXTERNAL_NODE_SIZE })) : [];
  const items = [...internalItems, ...externalItems];

  const nodeIds = new Set(items.map((it) => it.id));
  const edges = slice.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  const computed = computeDagrePositions(items, edges, {
    direction: direction ?? 'LR',
    nodesep: 48,
    ranksep: 88,
    defaultColumns: 4,
  });

  const saved = session.overrides?.positions ?? {};
  for (const item of items) {
    const override = saved[item.id];
    if (override && Number.isFinite(override.x) && Number.isFinite(override.y)) {
      computed[item.id] = { x: Math.round(override.x), y: Math.round(override.y) };
    }
  }

  return computed;
}
