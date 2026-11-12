# Running Overdrive Caster locally

Requires Node.js >= 20.

**Windows:** double-click `start.cmd`. The first run installs and builds (a few minutes), then the controller opens in your browser. After updating the files, run `start.cmd rebuild`. Passwords, port and OBS go in `settings.bat` (copy `settings.example.bat`).

Other systems:

```bash
npm install
npm run build
CONTROLLER_PASSWORD=overdrive-pass ADMIN_PASSWORD=overdrive-admin npm start
```

Then open:
- Producer dashboard: http://localhost:8787/controller
- Tournament admin:   http://localhost:8787/admin
- Full show output (add as an OBS Browser Source, 1920x1080): http://localhost:8787/output/program

For hot-reload development instead of the built/production start:
```bash
npm install
CONTROLLER_PASSWORD=overdrive-pass ADMIN_PASSWORD=overdrive-admin npm run dev
# UI:        http://localhost:5173
# API/WS:    http://localhost:8787
```
(In dev mode, open the UI at :5173, not :8787 — :8787 only serves the API/WebSocket until you've run `npm run build`.)

All Overdrive brand assets (stinger, replay/highlight overlays, blank loops, duo/trio caster backgrounds, start/BRB/end plates) are already in `public/brand/overdrive/` — verified identical to the files you supplied separately.

This is Overdrive's own standalone caster system. See README.md for the full feature/route rundown.
