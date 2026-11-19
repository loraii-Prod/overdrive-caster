// Sandbox stub: a placeholder SVG instead of a real QR code (the real build uses the qrcode package).
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><rect x="1" y="1" width="3" height="3"/><rect x="6" y="1" width="3" height="3"/><rect x="1" y="6" width="3" height="3"/></svg>';
export const toString = async () => svg;
export const toDataURL = async () => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
export default { toString, toDataURL };
