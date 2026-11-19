# Sandbox build (test rig only, never shipped)

For machines where `npm install` is not possible: builds Overdrive with esbuild + Tailwind 4 from a global tools folder
(`/opt/npm-tools/node_modules`) and small stand-ins for packages that are missing there:

- `express.ts`, `cookie.ts`, `qrcode.ts` (placeholder QR), `aws4fetch.ts`, `pg.ts`;
- `obs-websocket-js.ts` (JSON protocol client), `motion-react.tsx` (no animation), `react-router-dom.tsx`;
- `react.d.ts` (a minimal React typing for `tsc`).

    node e2e-rig/devshim/build.mjs . /tmp/build          # → /tmp/build/dist/server.js + dist/client
    tsc -p e2e-rig/devshim/tsconfig.server.json          # server + shared type check
    tsc -p e2e-rig/devshim/tsconfig.client.json          # UI type check (errors about AnimatePresence props / React namespace are typing gaps of the stand-ins)

The real build is `npm run build` (tsc + Vite with the real packages). Use this rig only to run the e2e suites
(`e2e-rig/talent3/run.sh`) where the real build cannot be made.
