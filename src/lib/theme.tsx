import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { BrandKit, ThemeId } from '../../shared/types';

interface ThemeValue {
  theme: ThemeId;
  /** A parent (Program) already renders the persistent background video. */
  bgProvided: boolean;
  /** Event brand kit (overrides theme assets where set). */
  brand: BrandKit | null;
}

const Ctx = createContext<ThemeValue>({ theme: 'classic', bgProvided: false, brand: null });

const FONTS: Record<string, string> = {
  bebas: '"Bebas Neue", "Barlow Condensed", system-ui, sans-serif',
  barlow: '"Barlow Condensed", "Inter", system-ui, sans-serif',
  sora: '"Sora", "Inter", system-ui, sans-serif',
  inter: '"Inter", system-ui, sans-serif',
  russo: '"Russo One", "Barlow Condensed", system-ui, sans-serif',
  montserrat: '"Montserrat", "Inter", system-ui, sans-serif',
};

/** CSS custom properties for a brand kit (picked up by [data-theme] rules). */
export function brandVars(brand: BrandKit | null | undefined): CSSProperties {
  const v: Record<string, string> = {};
  if (brand?.accent) v['--brand-accent'] = brand.accent;
  if (brand?.font) v['--brand-display'] = FONTS[brand.font];
  return v as CSSProperties;
}

export function ThemeProvider({ theme, bgProvided = false, brand, children }: { theme: ThemeId; bgProvided?: boolean; brand?: BrandKit | null; children: ReactNode }) {
  const parent = useContext(Ctx);
  const b = brand === undefined ? parent.brand : brand;
  return (
    <Ctx.Provider value={{ theme, bgProvided, brand: b }}>
      <div style={{ display: 'contents', ...brandVars(b) }}>{children}</div>
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
