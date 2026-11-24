// React Flow CSS path: '@xyflow/react/dist/style.css'
import type { RenderSession, SessionOverrides } from '../../types/schema';

export type GraphLevel = 'hld' | 'lld';

export type CanvasSelection =
  | { kind: 'none' }
  | { kind: 'container'; id: string }
  | { kind: 'file'; id: string }
  | { kind: 'edge'; id: string };

export interface ArchitectureCanvasProps {
  session: RenderSession;
  activeContainerId: string | null; // null => HLD view; string => LLD view
  selection: CanvasSelection;
  showExternalNodes: boolean;
  onSelect: (next: CanvasSelection) => void;
  onEnterContainer: (containerId: string) => void;
  onExitToHld: () => void;
  onJumpToExternalNode: (containerId: string, nodeId: string) => void;
  onToggleExternalNodes: () => void;
  onSavePositions: (positions: SessionOverrides['positions']) => void | Promise<void>;
  onResetViewLayout: (nodeIdsToClear: string[]) => void | Promise<void>;
}

export interface InspectorPanelProps {
  session: RenderSession;
  activeContainerId: string | null;
  selection: CanvasSelection;
  onSelect: (next: CanvasSelection) => void;
  onEnterContainer: (containerId: string) => void;
  onJumpToExternalNode: (containerId: string, nodeId: string) => void;
  onRenameEntity: (entityId: string, newLabel: string | null) => void | Promise<void>;
}
