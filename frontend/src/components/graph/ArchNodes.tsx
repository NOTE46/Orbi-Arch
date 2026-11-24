import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { ChevronRight, ExternalLink, FileCode2 } from 'lucide-react';

const CATEGORY_DOTS: Record<string, string> = {
  frontend: 'bg-sky-400',
  api: 'bg-emerald-400',
  service: 'bg-indigo-400',
  data: 'bg-amber-400',
  external: 'bg-purple-400',
};

export interface HldNodeData {
  label: string;
  category: string;
  summary: string;
  fileCount: number;
  dimmed?: boolean;
  onDrillDown?: (id: string) => void;
}

export const HldContainerNode = memo(function HldContainerNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as HldNodeData;
  const dotColor = CATEGORY_DOTS[nodeData.category] ?? 'bg-accent';

  return (
    <div
      onDoubleClick={() => nodeData.onDrillDown?.(id)}
      className={`w-[240px] select-none rounded-xl border bg-surface px-3.5 py-2.5 transition-all duration-150 ${
        selected ? 'border-accent ring-2 ring-accent/25' : 'border-line hover:border-accent/60'
      } ${nodeData.dimmed ? 'opacity-30' : 'opacity-100'}`}
    >
      <Handle type="target" position={Position.Top} className="opacity-0 pointer-events-none" />

      <div className="flex items-center justify-between text-[10px] font-medium text-muted mb-1">
        <div className="flex items-center gap-1.5 uppercase tracking-wider">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
          <span>{nodeData.category}</span>
        </div>
        <span className="px-1.5 py-0.5 rounded bg-elevated border border-line text-[10px]">
          {nodeData.fileCount} files
        </span>
      </div>

      <div className="text-sm font-semibold text-fg truncate leading-snug">{nodeData.label}</div>
      <p className="text-xs text-muted truncate mt-0.5">{nodeData.summary}</p>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            nodeData.onDrillDown?.(id);
          }}
          className="nodrag nopan inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:text-accent-hover transition-colors cursor-pointer"
        >
          <span>Open LLD</span>
          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        </button>
      </div>

      <Handle type="source" position={Position.Bottom} className="opacity-0 pointer-events-none" />
    </div>
  );
});

export interface LldFileNodeData {
  label: string;
  path: string;
  language: string;
  lineCount: number;
  symbolCount: number;
  dimmed?: boolean;
}

const LANG_BADGES: Record<string, string> = {
  python: 'py',
  typescript: 'ts',
  javascript: 'js',
  c: 'c',
  cpp: 'c++',
  java: 'java',
  go: 'go',
  rust: 'rs',
  csharp: 'c#',
  other: 'code',
};

export const LldFileNode = memo(function LldFileNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as LldFileNodeData;
  const langBadge = LANG_BADGES[nodeData.language] ?? 'code';

  return (
    <div
      className={`w-[224px] select-none rounded-xl border bg-surface px-3 py-2 transition-all duration-150 ${
        selected ? 'border-accent ring-2 ring-accent/25' : 'border-line hover:border-accent/60'
      } ${nodeData.dimmed ? 'opacity-30' : 'opacity-100'}`}
    >
      <Handle type="target" position={Position.Left} className="opacity-0 pointer-events-none" />

      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileCode2 className="w-3.5 h-3.5 shrink-0 text-muted" />
          <span className="text-xs font-semibold text-fg truncate">{nodeData.label}</span>
        </div>
        <span className="px-1.5 py-0.2 rounded bg-elevated border border-line font-mono text-[9px] text-muted shrink-0 uppercase">
          {langBadge}
        </span>
      </div>

      <div className="text-[11px] font-mono text-muted truncate">{nodeData.path || id}</div>
      <div className="text-[11px] text-muted mt-1">
        {nodeData.symbolCount} symbols &middot; {nodeData.lineCount} lines
      </div>

      <Handle type="source" position={Position.Right} className="opacity-0 pointer-events-none" />
    </div>
  );
});

export interface ExternalFileNodeData {
  label: string;
  path: string;
  containerId: string;
  containerLabel?: string;
  dimmed?: boolean;
  onJumpToContainer?: (containerId: string, nodeId: string) => void;
}

export const ExternalFileNode = memo(function ExternalFileNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ExternalFileNodeData;

  return (
    <div
      onDoubleClick={() => nodeData.onJumpToContainer?.(nodeData.containerId, id)}
      className={`w-[204px] select-none rounded-xl border border-dashed bg-elevated px-3 py-2 transition-all duration-150 ${
        selected ? 'border-accent ring-2 ring-accent/25' : 'border-line hover:border-accent/60'
      } ${nodeData.dimmed ? 'opacity-30' : 'opacity-85'}`}
    >
      <Handle type="target" position={Position.Left} className="opacity-0 pointer-events-none" />

      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="flex items-center gap-1 text-[10px] text-muted min-w-0">
          <ExternalLink className="w-3 h-3 shrink-0" />
          <span className="truncate">{nodeData.containerLabel ?? 'External'}</span>
        </div>
        {nodeData.onJumpToContainer && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              nodeData.onJumpToContainer?.(nodeData.containerId, id);
            }}
            className="nodrag nopan text-[10px] text-accent hover:text-accent-hover underline cursor-pointer shrink-0"
          >
            Jump
          </button>
        )}
      </div>

      <div className="text-xs font-semibold text-fg truncate">{nodeData.label}</div>
      <div className="text-[11px] font-mono text-muted truncate mt-0.5">{nodeData.path || id}</div>

      <Handle type="source" position={Position.Right} className="opacity-0 pointer-events-none" />
    </div>
  );
});

export const ARCH_NODE_TYPES = {
  hldContainer: HldContainerNode,
  lldFile: LldFileNode,
  lldExternal: ExternalFileNode,
} as const;
