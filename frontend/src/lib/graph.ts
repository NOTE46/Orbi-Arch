import type { ArchEdge, LldFileNode, RenderSession, VerifiedEdge } from '../types/schema';

function isValidRepoPath(p: string): boolean {
  if (!p || typeof p !== 'string') return false;
  if (p.includes('\\') || p.startsWith('/') || p.startsWith('./') || /^[a-zA-Z]:/.test(p)) return false;
  return !p.split('/').includes('..');
}

export function getContainerFileCount(session: RenderSession, containerId: string): number {
  return session.nodes.filter((n) => n.container_id === containerId).length;
}

export function getLldSlice(
  session: RenderSession,
  containerId: string
): { internalNodes: LldFileNode[]; externalNodes: LldFileNode[]; edges: ArchEdge[] } {
  const internalNodes = session.nodes.filter((n) => n.container_id === containerId);
  const internalIds = new Set(internalNodes.map((n) => n.id));
  const edges = session.edges.filter(
    (e) => e.scope === 'lld' && (internalIds.has(e.source) || internalIds.has(e.target))
  );
  const externalIds = new Set<string>();
  for (const e of edges) {
    if (!internalIds.has(e.source)) externalIds.add(e.source);
    if (!internalIds.has(e.target)) externalIds.add(e.target);
  }
  const externalNodes = session.nodes.filter(
    (n) => externalIds.has(n.id) && n.container_id !== containerId
  );
  return { internalNodes, externalNodes, edges };
}

export function rollupVerifiedHldEdges(
  nodes: LldFileNode[],
  lldEdges: ArchEdge[],
  labels?: Record<string, string>
): VerifiedEdge[] {
  const nodeContainerMap = new Map(nodes.map((n) => [n.id, n.container_id]));
  const pairs = new Map<string, { src: string; tgt: string; count: number; evidence: { file: string; line: number }[] }>();
  const seen = new Map<string, Set<string>>();

  for (const edge of lldEdges) {
    if (edge.scope !== 'lld' || edge.provenance !== 'verified' || !edge.evidence?.length) continue;
    const srcC = nodeContainerMap.get(edge.source);
    const tgtC = nodeContainerMap.get(edge.target);
    if (!srcC || !tgtC || srcC === tgtC) continue;
    const key = `${srcC}->${tgtC}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { src: srcC, tgt: tgtC, count: 0, evidence: [] };
      pairs.set(key, pair);
      seen.set(key, new Set());
    }
    pair.count++;
    const s = seen.get(key)!;
    for (const ev of edge.evidence) {
      const evKey = `${ev.file}:${ev.line}`;
      if (!s.has(evKey) && pair.evidence.length < 10) {
        s.add(evKey);
        pair.evidence.push({ file: ev.file, line: ev.line });
      }
    }
  }

  const result: VerifiedEdge[] = [];
  for (const [key, pair] of pairs.entries()) {
    if (pair.evidence.length === 0) continue;
    const label = labels?.[key] ?? `${pair.count} import${pair.count === 1 ? '' : 's'}`;
    result.push({
      id: `hld:${pair.src}->${pair.tgt}`,
      scope: 'hld',
      source: pair.src,
      target: pair.tgt,
      label,
      provenance: 'verified',
      evidence: [pair.evidence[0], ...pair.evidence.slice(1)],
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export function computeSessionStats(
  nodes: LldFileNode[],
  edges: ArchEdge[]
): { files_scanned: number; verified_edges: number; inferred_edges: number } {
  let verified_edges = 0;
  let inferred_edges = 0;
  for (const e of edges) {
    if (e.provenance === 'verified') verified_edges++;
    else if (e.provenance === 'inferred') inferred_edges++;
  }
  return { files_scanned: nodes.length, verified_edges, inferred_edges };
}

export function validateSession(session: RenderSession): string[] {
  const errs: string[] = [];
  if (session.schema_version !== '0.1') errs.push('schema_version must be "0.1"');
  const cIds = new Set<string>();
  const nIds = new Set<string>();
  const eIds = new Set<string>();
  const cCounts = new Map<string, number>();

  for (const c of session.containers ?? []) {
    if (!c.id) errs.push('Container id empty');
    if (cIds.has(c.id)) errs.push(`Duplicate container id ${c.id}`);
    cIds.add(c.id);
    cCounts.set(c.id, 0);
  }
  const nodeMap = new Map<string, LldFileNode>();
  for (const n of session.nodes ?? []) {
    if (!n.id) errs.push('Node id empty');
    if (nIds.has(n.id)) errs.push(`Duplicate node id ${n.id}`);
    if (cIds.has(n.id)) errs.push(`Node id ${n.id} collides with container id`);
    if (!isValidRepoPath(n.id)) errs.push(`Invalid node repo path ${n.id}`);
    if (!cIds.has(n.container_id)) errs.push(`Node ${n.id} references missing container ${n.container_id}`);
    else cCounts.set(n.container_id, (cCounts.get(n.container_id) ?? 0) + 1);
    for (const s of n.symbols ?? []) {
      if (!Number.isInteger(s.line) || s.line < 1 || s.line > n.line_count) errs.push(`Symbol ${s.name} line out of bounds in ${n.id}`);
    }
    nIds.add(n.id);
    nodeMap.set(n.id, n);
  }
  for (const [cId, count] of cCounts.entries()) {
    if (count === 0) errs.push(`Container ${cId} has no nodes`);
  }
  const edgePairs = new Set<string>();
  for (const e of session.edges ?? []) {
    if (!e.id) errs.push('Edge id empty');
    if (eIds.has(e.id)) errs.push(`Duplicate edge id ${e.id}`);
    eIds.add(e.id);
    if (e.source === e.target) errs.push(`Self loop in edge ${e.id}`);
    const pair = `${e.scope}:${e.source}->${e.target}`;
    if (edgePairs.has(pair)) errs.push(`Duplicate directed pair ${pair}`);
    edgePairs.add(pair);

    if (e.scope === 'hld') {
      if (!cIds.has(e.source) || !cIds.has(e.target)) errs.push(`HLD edge ${e.id} endpoints not in containers`);
    } else if (e.scope === 'lld') {
      if (!nIds.has(e.source) || !nIds.has(e.target)) errs.push(`LLD edge ${e.id} endpoints not in nodes`);
    } else {
      const raw = e as { id?: string; scope?: string };
      errs.push(`Edge ${raw.id ?? 'unknown'} invalid scope ${raw.scope}`);
    }

    if (e.provenance === 'verified') {
      if (!e.evidence || e.evidence.length === 0) errs.push(`Verified edge ${e.id} missing evidence`);
      for (const ev of e.evidence ?? []) {
        if (!isValidRepoPath(ev.file)) errs.push(`Invalid evidence path ${ev.file}`);
        const n = nodeMap.get(ev.file);
        if (!n) errs.push(`Evidence file ${ev.file} not found`);
        else {
          if (!Number.isInteger(ev.line) || ev.line < 1 || ev.line > n.line_count) errs.push(`Evidence line out of bounds for ${ev.file}`);
          if (e.scope === 'lld' && ev.file !== e.source) errs.push(`LLD evidence ${ev.file} != source ${e.source}`);
          if (e.scope === 'hld' && n.container_id !== e.source) errs.push(`HLD evidence ${ev.file} not in source container ${e.source}`);
        }
      }
    } else if (e.provenance === 'inferred') {
      if (!e.reason || !e.reason.trim()) errs.push(`Inferred edge ${e.id} missing reason`);
    } else {
      const raw = e as { id?: string; provenance?: string };
      errs.push(`Edge ${raw.id ?? 'unknown'} invalid provenance ${raw.provenance}`);
    }
  }
  for (const k of Object.keys(session.overrides?.positions ?? {})) {
    if (!cIds.has(k) && !nIds.has(k)) errs.push(`Override position key ${k} unknown`);
  }
  for (const k of Object.keys(session.overrides?.renamed ?? {})) {
    if (!cIds.has(k) && !nIds.has(k)) errs.push(`Override renamed key ${k} unknown`);
  }
  const stats = computeSessionStats(session.nodes ?? [], session.edges ?? []);
  const sStats = session.session?.stats;
  if (!sStats || sStats.files_scanned !== stats.files_scanned || sStats.verified_edges !== stats.verified_edges || sStats.inferred_edges !== stats.inferred_edges) {
    errs.push('Session stats mismatch');
  }
  return errs;
}
