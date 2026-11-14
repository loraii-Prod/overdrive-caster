/**
 * 4K size advice for uploaded images, per role. Never blocks an upload: it tells the producer when a picture has fewer
 * pixels than the largest size it is drawn at on a 4K output (it will look soft there; it is never upscaled and called 4K).
 * Sizes = largest on-air draw size in 1920×1080 grid units × 2 (measured in docs/4K-ASSET-REPORT.md).
 */
export type AssetRole = 'logo' | 'team-logo' | 'portrait' | 'map' | 'background' | 'image';
export const ROLE_4K: Record<AssetRole, { label: string; w: number; h: number; note: string }> = {
  'team-logo': { label: 'team logo', w: 256, h: 256, note: 'drawn up to 128 px high at 4K' },
  logo: { label: 'event logo', w: 760, h: 184, note: 'drawn up to 92 units high (184 px at 4K)' },
  portrait: { label: 'player portrait', w: 1000, h: 1250, note: 'player card / showcase portrait' },
  map: { label: 'map photo', w: 2320, h: 2160, note: 'map card art, 1160×1080 units' },
  background: { label: 'full-screen background', w: 3840, h: 2160, note: 'full frame' },
  image: { label: 'image', w: 0, h: 0, note: '' },
};
export const roleOf = (v: unknown): AssetRole => (typeof v === 'string' && v in ROLE_4K ? (v as AssetRole) : 'image');

export interface AssetInfo { w: number; h: number; vector: boolean }
/** null = fine for 4K (or vector, or unknown size). */
export function advice4k(role: AssetRole, info: AssetInfo | null): string | null {
  const r = ROLE_4K[role];
  if (!info || info.vector || !r.w) return null;
  const k = Math.max(r.w / info.w, r.h / info.h);
  if (k <= 1.05) return null;
  return `This ${r.label} is ${info.w}×${info.h}: at 4K it is drawn larger than its pixels (about ${Math.round(k * 10) / 10}×) and will look soft. ${r.w}×${r.h} or larger is sharp at 4K${role === 'team-logo' || role === 'logo' ? ' (an SVG is sharp at any size)' : ''}. It is fine at 1080p.`;
}

/** Pixel size of a PNG / JPEG / WebP / GIF from its bytes; SVG = vector. null = unknown. */
export function imageInfo(b: Uint8Array): AssetInfo | null {
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const u16be = (o: number) => (b[o] << 8) | b[o + 1], u16le = (o: number) => b[o] | (b[o + 1] << 8);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32(16), h: u32(20), vector: false };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: u16le(6), h: u16le(8), vector: false };
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const t = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (t === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), vector: false };
    if (t === 'VP8 ') return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff, vector: false };
    if (t === 'VP8L') { const x = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: (x & 0x3fff) + 1, h: ((x >> 14) & 0x3fff) + 1, vector: false }; }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16be(o + 7), h: u16be(o + 5), vector: false };
      o += 2 + u16be(o + 2);
    }
    return null;
  }
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return { w: 0, h: 0, vector: true };
  return null;
}
