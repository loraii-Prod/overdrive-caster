/** A QR code drawn locally (no network), crisp at any size (SVG). Draws nothing for an address that is not https. */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function Qr({ url, size, dark = '#121212', light = '#ffffff' }: { url: string; size: number; dark?: string; light?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let on = true;
    if (!/^https:\/\//.test(url)) { setSvg(''); return; }
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark, light } }).then(s => { if (on) setSvg(s); }).catch(() => on && setSvg(''));
    return () => { on = false; };
  }, [url, dark, light]);
  if (!svg) return null;
  return <div data-qr={url} style={{ width: size, height: size, lineHeight: 0 }} className="[&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
