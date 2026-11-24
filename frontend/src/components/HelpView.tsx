import { Cpu, Keyboard, Package, ShieldCheck } from 'lucide-react';

export interface HelpViewProps {
  onNewSession: () => void;
  onOpenSettings: () => void;
  onOpenLanguages: () => void;
}

const SHORTCUTS = [
  { label: 'Fit the entire graph to screen', key: 'F' },
  { label: 'Toggle full-screen graph mode', key: 'Shift+F' },
  { label: 'Hide or show the right Inspector panel', key: 'I' },
  { label: 'Clear selection, exit LLD to HLD, or exit full-screen', key: 'Esc' },
  { label: 'Open LLD on a container or jump to external node', key: 'Double-click' },
  { label: 'Reposition any node (saved automatically; use Reset Layout to restore)', key: 'Drag' },
];

const PRIVACY_POINTS = [
  'Backend binds strictly to 127.0.0.1:8000 (never exposed to LAN).',
  '.env, private keys, credentials, node_modules, and symlink escapes are hard-blocked.',
  'API keys are write-only in your OS Credential Manager — never saved in SQLite or exposed to the browser.',
  'Cloud models receive only structural metadata (file paths, symbols, import graph) — never raw source code.',
];

export function HelpView({ onNewSession, onOpenSettings, onOpenLanguages }: HelpViewProps) {
  return (
    <div className="h-full overflow-y-auto px-6 py-8 md:px-10">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header Row */}
        <header className="flex flex-wrap items-end justify-between gap-4 pb-2 border-b border-line">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Help &amp; Reference</h1>
            <p className="text-xs sm:text-sm text-muted mt-1">
              A quick guide to scanning repositories, reading architecture graphs, and keeping your code private.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button" onClick={onNewSession}
              className="bg-surface border border-line hover:bg-elevated text-xs font-medium text-fg rounded-lg px-3 py-1.5 transition-colors cursor-pointer"
            >
              New Scan
            </button>
            <button
              type="button" onClick={onOpenLanguages}
              className="bg-surface border border-line hover:bg-elevated text-xs font-medium text-fg rounded-lg px-3 py-1.5 transition-colors cursor-pointer"
            >
              Language Packs
            </button>
            <button
              type="button" onClick={onOpenSettings}
              className="bg-surface border border-line hover:bg-elevated text-xs font-medium text-fg rounded-lg px-3 py-1.5 transition-colors cursor-pointer"
            >
              Settings
            </button>
          </div>
        </header>

        {/* Section 1 — Quick Start */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Quick Start</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-surface border border-line rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-accent">01</span>
                <span className="text-[11px] font-medium text-muted">Scan a repo</span>
              </div>
              <h3 className="text-sm font-semibold text-fg">Point &amp; Analyze</h3>
              <p className="text-xs text-muted leading-relaxed">
                Paste a local folder path or public GitHub URL. Scans are strictly read-only — target code is never executed or modified.
              </p>
            </div>
            <div className="bg-surface border border-line rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-accent">02</span>
                <span className="text-[11px] font-medium text-muted">Explore HLD to LLD</span>
              </div>
              <h3 className="text-sm font-semibold text-fg">Navigate Modules</h3>
              <p className="text-xs text-muted leading-relaxed">
                Inspect high-level subsystems (or individual modules on flat repos). Double-click any box or click Open LLD to zoom into files and symbols.
              </p>
            </div>
            <div className="bg-surface border border-line rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-accent">03</span>
                <span className="text-[11px] font-medium text-muted">Add AI when needed</span>
              </div>
              <h3 className="text-sm font-semibold text-fg">Enhance with 2-Tier AI</h3>
              <p className="text-xs text-muted leading-relaxed">
                Works out of the box with 0 tokens using local Tree-sitter AST parsing. Configure a local or cloud model in Settings anytime for summaries and inferred links.
              </p>
            </div>
          </div>
        </section>

        {/* Section 2 — How to Read the Graph */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">How to Read the Graph</h2>
          <div className="bg-surface border border-line rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-line rounded-lg p-3.5 space-y-2 bg-canvas">
                <div className="flex items-center gap-2">
                  <div className="w-8 border-t-2 border-verified" />
                  <span className="text-xs font-semibold text-verified">Verified Edge (AST)</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Solid green line swatch — proven directly from static imports. Click any edge to see exact file:line evidence and jump to VS Code or GitHub.
                </p>
              </div>

              <div className="border border-line rounded-lg p-3.5 space-y-2 bg-canvas">
                <div className="flex items-center gap-2">
                  <div className="w-8 border-t-2 border-dashed border-inferred" />
                  <span className="text-xs font-semibold text-inferred">Inferred Edge (AI)</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Dashed amber line swatch — runtime relationships (API calls, webhooks, DB traffic) suggested by the Strong-tier model with a written reason. Never overwrites Verified edges.
                </p>
              </div>

              <div className="border border-line rounded-lg p-3.5 space-y-2 bg-canvas">
                <div className="flex items-center gap-2">
                  <span className="rounded border border-dashed border-line px-1.5 py-0.5 text-[10px] text-muted font-mono">external</span>
                  <span className="text-xs font-semibold text-fg">External Boundary Nodes</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Dashed border chip — files outside the current subsystem in LLD view. Double-click or click Jump to switch containers, or toggle Hide external.
                </p>
              </div>

              <div className="border border-line rounded-lg p-3.5 space-y-2 bg-canvas">
                <div className="flex items-center gap-2">
                  <span className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-fg font-medium">Tests</span>
                  <span className="text-xs font-semibold text-fg">Independent Tests</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Test files are grouped into a standalone Tests container so file counts and language percentages stay accurate without adding test-import clutter to production arrows.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3 — Language Packs & AI Models */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Language Packs &amp; AI Models</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-surface border border-line rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold text-fg">Language Packs</h3>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Prebuilt offline Tree-sitter grammars (<span className="text-fg font-medium">Python, TypeScript/JS, C/C++, Java, Go, Rust, C#</span>) are managed on demand in <span className="text-fg font-medium">Settings &rarr; Languages</span> (install or remove anytime; zero silent background downloads).
              </p>
              <p className="text-xs text-muted leading-relaxed">
                Repos using uninstalled languages still map files cleanly and show a reminder banner to install the pack for verified AST edges and lower token usage.
              </p>
            </div>

            <div className="bg-surface border border-line rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold text-fg">2-Tier AI &amp; Local Models</h3>
              </div>
              <ul className="text-xs text-muted space-y-2 leading-relaxed">
                <li>
                  <strong className="text-fg">Fast tier:</strong> generates plain-English module/file summaries (cached locally by file SHA-256 so unchanged code is not re-analyzed).
                </li>
                <li>
                  <strong className="text-fg">Strong tier:</strong> synthesizes high-level names and inferred runtime edges from structural metadata only.
                </li>
                <li>
                  <strong className="text-fg">Local support:</strong> works with both <span className="text-fg font-mono">Ollama (:11434)</span> and <span className="text-fg font-mono">llama.cpp server (:8080)</span> OpenAI-compatible endpoints, plus OpenAI, Anthropic, and Custom endpoints.
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Section 4 — Controls, Shortcuts & Privacy */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Controls, Shortcuts &amp; Privacy</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-surface border border-line rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold text-fg">Canvas Controls &amp; Shortcuts</h3>
              </div>
              <div className="text-xs text-muted space-y-2.5">
                {SHORTCUTS.map(({ label, key }) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span>{label}</span>
                    <kbd className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-fg">{key}</kbd>
                  </div>
                ))}
                <div className="pt-1 text-[11px] text-muted border-t border-line">
                  <strong className="text-fg">Toolbar &amp; Header:</strong> Full-screen, Hide Inspector, One-click <strong className="text-fg">Re-scan</strong> (preserves layout), <strong className="text-fg">Export</strong> (Mermaid, SVG, 2x PNG, JSON), edge styles (<strong className="text-fg">Curved / Stepped / Straight</strong>), or LLD <strong className="text-fg">Tree</strong> panel.
                </div>
              </div>
            </div>

            <div className="bg-surface border border-line rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-verified" />
                <h3 className="text-sm font-semibold text-fg">Privacy &amp; Security Boundaries</h3>
              </div>
              <ul className="text-xs text-muted space-y-2 leading-relaxed">
                {PRIVACY_POINTS.map((pt, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 shrink-0" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default HelpView;
