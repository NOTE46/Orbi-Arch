import type { RenderSession } from '../types/schema';
import { getContainerFileCount, getLldSlice } from './graph';
import { EXTERNAL_NODE_SIZE, HLD_NODE_SIZE, LLD_NODE_SIZE, layoutHldGraph, layoutLldGraph } from './layout';

export function slugifyFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'orbi-architecture';
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] ?? c));
const escapeMermaid = (s: string) => s.replace(/["#]/g, '').replace(/[<>|]/g, ' ').replace(/\r?\n/g, ' ').trim();

export function buildMermaidDiagram(session: RenderSession, activeContainerId: string | null, showExternalNodes: boolean): string {
  const lines: string[] = [];
  const nodeMap = new Map<string, string>();
  let nextId = 0;
  const getId = (k: string) => {
    let id = nodeMap.get(k);
    if (!id) { id = `n${nextId++}`; nodeMap.set(k, id); }
    return id;
  };

  if (activeContainerId === null) {
    lines.push('flowchart TB');
    for (const c of session.containers) {
      const nid = getId(c.id);
      const label = session.overrides?.renamed?.[c.id] ?? c.label;
      lines.push(`  ${nid}["${escapeMermaid(`${label} (${getContainerFileCount(session, c.id)} files)`)}"]`);
    }
    for (const e of session.edges) {
      if (e.scope !== 'hld') continue;
      const sId = nodeMap.get(e.source); const tId = nodeMap.get(e.target);
      if (!sId || !tId || sId === tId) continue;
      const lbl = escapeMermaid(e.label || 'connects');
      lines.push(e.provenance === 'inferred' ? `  ${sId} -.->|${lbl}| ${tId}` : `  ${sId} -->|${lbl}| ${tId}`);
    }
  } else {
    lines.push('flowchart LR');
    const slice = getLldSlice(session, activeContainerId);
    const cont = session.containers.find((c) => c.id === activeContainerId);
    const contLabel = escapeMermaid(session.overrides?.renamed?.[activeContainerId] ?? cont?.label ?? 'Module');

    lines.push(`  subgraph Internal["${contLabel}"]`);
    for (const n of slice.internalNodes) {
      const nid = getId(n.id);
      lines.push(`    ${nid}["${escapeMermaid(session.overrides?.renamed?.[n.id] ?? n.label)}"]`);
    }
    lines.push('  end');

    if (showExternalNodes && slice.externalNodes.length > 0) {
      lines.push('  subgraph External["External Dependencies"]');
      for (const n of slice.externalNodes) {
        const nid = getId(n.id);
        lines.push(`    ${nid}["${escapeMermaid(session.overrides?.renamed?.[n.id] ?? n.label)}"]`);
      }
      lines.push('  end');
    }

    const visibleNodeIds = new Set([...slice.internalNodes, ...(showExternalNodes ? slice.externalNodes : [])].map((n) => n.id));
    for (const e of slice.edges) {
      if (!visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target) || e.source === e.target) continue;
      const sId = nodeMap.get(e.source); const tId = nodeMap.get(e.target);
      if (!sId || !tId) continue;
      const lbl = escapeMermaid(e.label || 'imports');
      lines.push(e.provenance === 'inferred' ? `  ${sId} -.->|${lbl}| ${tId}` : `  ${sId} -->|${lbl}| ${tId}`);
    }
  }

  return lines.join('\n');
}

export function buildArchitectureSvg(session: RenderSession, activeContainerId: string | null, showExternalNodes: boolean, isDark: boolean): string {
  const c = isDark
    ? { bg: '#101218', surface: '#151821', elevated: '#1d212d', border: '#272c3b', fg: '#f3f4f8', muted: '#8b93a7', verified: '#10b981', inferred: '#f59e0b', accent: '#6366f1' }
    : { bg: '#f8fafc', surface: '#ffffff', elevated: '#f1f5f9', border: '#e2e8f0', fg: '#0f172a', muted: '#64748b', verified: '#059669', inferred: '#d97706', accent: '#4f46e5' };

  interface SvgNode { id: string; width: number; height: number; title: string; tag: string; subtitle: string; isExternal: boolean; }
  let nodes: SvgNode[] = [];
  let edges: Array<{ source: string; target: string; provenance: string }> = [];
  let positions: Record<string, { x: number; y: number }> = {};
  let title = '';
  const isTB = activeContainerId === null;

  if (isTB) {
    positions = layoutHldGraph(session, 'TB');
    nodes = session.containers.map((cnt) => ({
      id: cnt.id, ...HLD_NODE_SIZE, title: session.overrides?.renamed?.[cnt.id] ?? cnt.label,
      tag: cnt.category.toUpperCase(), subtitle: `${getContainerFileCount(session, cnt.id)} files`, isExternal: false,
    }));
    edges = session.edges.filter((e) => e.scope === 'hld');
    title = `${session.session.name} · High-Level Architecture`;
  } else {
    positions = layoutLldGraph(session, activeContainerId, showExternalNodes, 'LR');
    const slice = getLldSlice(session, activeContainerId);
    const cont = session.containers.find((cnt) => cnt.id === activeContainerId);
    const contLbl = session.overrides?.renamed?.[activeContainerId] ?? cont?.label ?? 'Module';
    const internals: SvgNode[] = slice.internalNodes.map((n) => ({
      id: n.id, ...LLD_NODE_SIZE, title: session.overrides?.renamed?.[n.id] ?? n.label,
      tag: n.language.toUpperCase(), subtitle: `${n.symbols.length} symbols · ${n.line_count} lines`, isExternal: false,
    }));
    const externals: SvgNode[] = showExternalNodes ? slice.externalNodes.map((n) => ({
      id: n.id, ...EXTERNAL_NODE_SIZE, title: session.overrides?.renamed?.[n.id] ?? n.label,
      tag: 'EXTERNAL', subtitle: `${n.symbols.length} symbols · ${n.line_count} lines`, isExternal: true,
    })) : [];
    nodes = [...internals, ...externals];
    const nSet = new Set(nodes.map((n) => n.id));
    edges = slice.edges.filter((e) => nSet.has(e.source) && nSet.has(e.target));
    title = `${session.session.name} · LLD: ${contLbl}`;
  }

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const n of nodes) {
    const p = positions[n.id] ?? { x: 0, y: 0 };
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + n.width); maxY = Math.max(maxY, p.y + n.height);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 480; maxY = 240; }

  const W = Math.max(560, Math.round(maxX - minX + 96));
  const H = Math.max(320, Math.round(maxY - minY + 116));
  const offX = Math.round(48 - minX); const offY = Math.round(64 - minY);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const edgePaths: string[] = [];
  for (const e of edges) {
    const sn = nodeMap.get(e.source); const tn = nodeMap.get(e.target);
    const sp = positions[e.source]; const tp = positions[e.target];
    if (!sn || !tn || !sp || !tp) continue;
    let d = '';
    if (isTB) {
      const x1 = sp.x + offX + sn.width / 2; const y1 = sp.y + offY + sn.height;
      const x2 = tp.x + offX + tn.width / 2; const y2 = tp.y + offY;
      d = `M ${x1} ${y1} C ${x1} ${y1 + Math.max(25, Math.abs(y2 - y1) * 0.45)}, ${x2} ${y2 - Math.max(25, Math.abs(y2 - y1) * 0.45)}, ${x2} ${y2}`;
    } else {
      const x1 = sp.x + offX + sn.width; const y1 = sp.y + offY + sn.height / 2;
      const x2 = tp.x + offX; const y2 = tp.y + offY + tn.height / 2;
      d = `M ${x1} ${y1} C ${x1 + Math.max(25, Math.abs(x2 - x1) * 0.45)} ${y1}, ${x2 - Math.max(25, Math.abs(x2 - x1) * 0.45)} ${y2}, ${x2} ${y2}`;
    }
    const isInf = e.provenance === 'inferred';
    edgePaths.push(`    <path d="${d}" fill="none" stroke="${isInf ? c.inferred : c.verified}" stroke-width="1.8" ${isInf ? 'stroke-dasharray="6 4"' : ''} marker-end="url(#${isInf ? 'arrow-inferred' : 'arrow-verified'})" opacity="0.85" />`);
  }

  const nodeElements: string[] = [];
  for (const n of nodes) {
    const p = positions[n.id] ?? { x: 0, y: 0 };
    const x = p.x + offX; const y = p.y + offY;
    const dash = n.isExternal ? 'stroke-dasharray="5 3"' : '';
    const tTrunc = n.title.length > 24 ? `${n.title.slice(0, 23)}…` : n.title;
    nodeElements.push(`    <g id="${escapeXml(n.id)}">
      <rect x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="12" fill="${c.surface}" stroke="${c.border}" stroke-width="1.5" ${dash} />
      <text x="${x + 14}" y="${y + 24}" font-family="monospace, monospace" font-size="10" font-weight="600" fill="${c.accent}">${escapeXml(n.tag)}</text>
      <text x="${x + 14}" y="${y + 45}" font-family="system-ui, sans-serif" font-size="13" font-weight="600" fill="${c.fg}">${escapeXml(tTrunc)}</text>
      <text x="${x + 14}" y="${y + 64}" font-family="system-ui, sans-serif" font-size="11" fill="${c.muted}">${escapeXml(n.subtitle)}</text>
    </g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <marker id="arrow-verified" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="${c.verified}" /></marker>
    <marker id="arrow-inferred" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="${c.inferred}" /></marker>
  </defs>
  <rect width="100%" height="100%" fill="${c.bg}" />
  <text x="48" y="38" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="${c.fg}">${escapeXml(title)}</text>
  <g>${edgePaths.join('\n')}</g>
  <g>${nodeElements.join('\n')}</g>
  <g transform="translate(48, ${H - 24})">
    <line x1="0" y1="-4" x2="24" y2="-4" stroke="${c.verified}" stroke-width="2" />
    <text x="32" y="0" font-family="system-ui, sans-serif" font-size="11" fill="${c.muted}">Verified (AST)</text>
    <line x1="130" y1="-4" x2="154" y2="-4" stroke="${c.inferred}" stroke-width="2" stroke-dasharray="4 3" />
    <text x="162" y="0" font-family="system-ui, sans-serif" font-size="11" fill="${c.muted}">Inferred (AI)</text>
  </g>
</svg>`;
}

export function downloadSvg(svgString: string, filename: string): void {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export async function downloadPngFromSvg(svgString: string, filename: string, scale = 2): Promise<void> {
  const w = parseInt(svgString.match(/width="(\d+)"/)?.[1] ?? '800', 10);
  const h = parseInt(svgString.match(/height="(\d+)"/)?.[1] ?? '600', 10);
  const effectiveScale = Math.max(w, h) * scale > 4096 ? Math.max(1, Math.floor(4096 / Math.max(w, h))) : scale;
  const targetW = w * effectiveScale; const targetH = h * effectiveScale;

  const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load SVG for PNG conversion'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = targetW; canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas context');
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!pngBlob) throw new Error('Canvas PNG export failed');

    const pngUrl = URL.createObjectURL(pngBlob);
    try {
      const a = document.createElement('a');
      a.href = pngUrl; a.download = filename; a.click();
    } finally {
      URL.revokeObjectURL(pngUrl);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
