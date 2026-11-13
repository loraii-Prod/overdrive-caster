/** File checks shared by the server and the migration tool (no side effects): real type, image size, limits. */
export type AssetRole = 'portrait' | 'logo' | 'map' | 'media' | 'music' | 'image' | 'video';


/** The real type from the file's first bytes (the browser's Content-Type and the file name are not trusted). */
export function sniff(b: Buffer): { mime: string; ext: string; kind: 'image' | 'video' | 'audio' } | null {
  const s = (o: number, t: string) => b.subarray(o, o + t.length).toString('latin1') === t;
  if (b.length < 12) return null;
  if (s(0, '\x89PNG\r\n\x1a\n')) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (s(0, 'RIFF') && s(8, 'WEBP')) return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (s(0, 'GIF87a') || s(0, 'GIF89a')) return { mime: 'image/gif', ext: 'gif', kind: 'image' };
  const head = b.subarray(0, 512).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { mime: 'image/svg+xml', ext: 'svg', kind: 'image' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return /webm/.test(b.subarray(0, 64).toString('latin1')) ? { mime: 'video/webm', ext: 'webm', kind: 'video' } : { mime: 'video/x-matroska', ext: 'mkv', kind: 'video' };
  if (s(4, 'ftyp')) { const brand = b.subarray(8, 12).toString('latin1'); return /^(M4A |M4B )/.test(brand) ? { mime: 'audio/mp4', ext: 'm4a', kind: 'audio' } : /^qt  /.test(brand) ? { mime: 'video/quicktime', ext: 'mov', kind: 'video' } : { mime: 'video/mp4', ext: 'mp4', kind: 'video' }; }
  if (s(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3', kind: 'audio' };
  if (s(0, 'OggS')) return { mime: 'audio/ogg', ext: 'ogg', kind: 'audio' };
  if (s(0, 'RIFF') && s(8, 'WAVE')) return { mime: 'audio/wav', ext: 'wav', kind: 'audio' };
  if (s(0, 'fLaC')) return { mime: 'audio/flac', ext: 'flac', kind: 'audio' };
  return null;
}

/** Pixel size and transparency of PNG / JPEG / WebP / GIF (SVG: from its viewBox / width / height). */
export function imageInfo(b: Buffer, mime: string): { w: number; h: number; alpha: boolean } | null {
  try {
    if (mime === 'image/png') {
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20), ct = b[25];
      return { w, h, alpha: ct === 4 || ct === 6 || b.includes(Buffer.from('tRNS')) };
    }
    if (mime === 'image/gif') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8), alpha: true };
    if (mime === 'image/webp') {
      const c = b.subarray(12, 16).toString('latin1');
      if (c === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), alpha: (b[20] & 0x10) !== 0 };
      if (c === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, alpha: ((v >> 28) & 1) === 1 }; }
      if (c === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, alpha: false };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1], len = b.readUInt16BE(i + 2);
        if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), alpha: false };
        i += 2 + len;
      }
    }
    if (mime === 'image/svg+xml') {
      const t = b.subarray(0, 4096).toString('utf8');
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(t);
      const w = Number(/\swidth\s*=\s*["']([\d.]+)/i.exec(t)?.[1] ?? vb?.[1] ?? 0), h = Number(/\sheight\s*=\s*["']([\d.]+)/i.exec(t)?.[1] ?? vb?.[2] ?? 0);
      return { w: Math.round(w) || 1000, h: Math.round(h) || 1000, alpha: true };
    }
  } catch { /* fall through */ }
  return null;
}

const LIMIT: Record<string, number> = { image: 8 << 20, svg: 1 << 20, video: 1 << 30, audio: 60 << 20 };
/** Allowed kinds and sizes per role. Returns an error message, or null. */
export function validate(b: Buffer, role: AssetRole): { error: string } | { mime: string; ext: string; kind: 'image' | 'video' | 'audio'; info: ReturnType<typeof imageInfo> } {
  const t = sniff(b);
  if (!t) return { error: 'Unknown file type (PNG, JPG, WebP, GIF, SVG, MP4, WebM, MOV, MP3, WAV, OGG, FLAC or M4A)' };
  const wantImage = ['portrait', 'logo', 'map', 'image'].includes(role), wantAudio = role === 'music';
  if (wantImage && t.kind !== 'image') return { error: 'This needs an image (PNG, JPG, WebP, GIF or SVG)' };
  if (wantAudio && t.kind !== 'audio' && t.mime !== 'video/webm') return { error: 'This needs an audio file (MP3, OGG, WAV, FLAC or M4A)' };
  if (t.mime === 'image/svg+xml') {
    if (b.length > LIMIT.svg) return { error: 'SVG images up to 1 MB' };
    if (/<script|\son\w+\s*=|javascript:/i.test(b.toString('utf8'))) return { error: 'SVG with scripts is not allowed' };
  } else if (b.length > LIMIT[t.kind]) return { error: `${t.kind === 'image' ? 'Images up to 8 MB' : t.kind === 'audio' ? 'Audio up to 60 MB' : 'Videos up to 1 GB'}` };
  const info = t.kind === 'image' ? imageInfo(b, t.mime) : null;
  if (t.kind === 'image' && !info) return { error: 'The image could not be read (damaged file?)' };
  if (info && (info.w > 12000 || info.h > 12000)) return { error: 'Image larger than 12000 px' };
  return { ...t, info };
}

