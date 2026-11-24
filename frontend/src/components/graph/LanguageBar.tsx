import { useMemo } from 'react';
import type { LldFileNode } from '../../types/schema';

export interface LanguageBarProps {
  nodes: LldFileNode[];
  title?: string;
}

const LANG_META: Record<string, { label: string; color: string }> = {
  typescript: { label: 'TypeScript', color: '#3178c6' },
  javascript: { label: 'JavaScript', color: '#eab308' },
  python: { label: 'Python', color: '#3572a5' },
  c: { label: 'C', color: '#6b7280' },
  cpp: { label: 'C++', color: '#f34b7d' },
  java: { label: 'Java', color: '#b07219' },
  go: { label: 'Go', color: '#00add8' },
  rust: { label: 'Rust', color: '#dea584' },
  csharp: { label: 'C#', color: '#178600' },
  other: { label: 'Other', color: '#8b93a7' },
};

export function LanguageBar({ nodes, title = 'Languages' }: LanguageBarProps) {
  const items = useMemo(() => {
    if (!nodes || nodes.length === 0) return [];

    const lineCounts: Record<string, number> = {};
    let total = 0;

    for (const node of nodes) {
      const lang = (node.language || 'other').toLowerCase();
      const lines = Math.max(1, node.line_count || 1);
      lineCounts[lang] = (lineCounts[lang] || 0) + lines;
      total += lines;
    }

    if (total === 0) return [];

    return Object.entries(lineCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([langKey, lines]) => {
        const meta = LANG_META[langKey] ?? { label: langKey ? langKey.charAt(0).toUpperCase() + langKey.slice(1) : 'Other', color: '#8b93a7' };
        const pct = (lines / total) * 100;
        const pctLabel = pct < 0.1 ? '<0.1%' : `${Number(pct.toFixed(1))}%`;
        return { key: langKey, label: meta.label, color: meta.color, pct, pctLabel, lines };
      });
  }, [nodes]);

  if (items.length === 0) return null;

  const ariaLabel = `Languages: ${items.map((i) => `${i.label} ${i.pctLabel}`).join(', ')}`;

  return (
    <div className="rounded-xl border border-line bg-canvas p-3 space-y-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</div>
      <div role="img" aria-label={ariaLabel} className="flex h-2 w-full overflow-hidden rounded-full bg-elevated gap-0.5">
        {items.map((item) => (
          <span
            key={item.key}
            title={`${item.label} ${item.pctLabel}`}
            style={{ width: `${item.pct}%`, backgroundColor: item.color }}
            className="h-full min-w-[3px]"
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <span className="font-medium text-fg">{item.label}</span>
            <span className="text-muted tabular-nums">{item.pctLabel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default LanguageBar;
