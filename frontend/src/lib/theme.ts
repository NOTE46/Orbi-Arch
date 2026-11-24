import type { FontSizeMode, ThemeMode } from '../types/schema';

export const MIN_CUSTOM_FONT_PX = 14;
export const MAX_CUSTOM_FONT_PX = 26;

export function clampCustomFontSize(px: number): number {
  if (!Number.isFinite(px)) return 18;
  return Math.min(MAX_CUSTOM_FONT_PX, Math.max(MIN_CUSTOM_FONT_PX, Math.round(px)));
}

export const FONT_SIZE_CSS: Record<Exclude<FontSizeMode, 'custom'>, string> = {
  auto: 'clamp(16px, 0.25vw + 13px, 20px)',
  sm: '16px',
  md: '18px',
  lg: '20px',
};

export function applyFontSize(mode: FontSizeMode, customPx?: number): void {
  if (typeof document === 'undefined') return;
  if (mode === 'custom') {
    document.documentElement.style.fontSize = `${clampCustomFontSize(customPx ?? 18)}px`;
  } else {
    document.documentElement.style.fontSize = FONT_SIZE_CSS[mode] || FONT_SIZE_CSS.auto;
  }
}

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = resolveIsDark(mode);
  root.classList.add('theme-switching');
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';
  void root.offsetWidth;
  root.classList.remove('theme-switching');
}

export function subscribeSystemTheme(cb: (isDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e: MediaQueryListEvent) => cb(e.matches);
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}
