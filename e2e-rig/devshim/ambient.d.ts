// Sandbox typecheck only: packages without types here.
declare module 'ws' { const WebSocket: any; export default WebSocket; export const WebSocketServer: any; export type WebSocket = any; export type RawData = any; }
