// Sandbox build of Overdrive without npm install: esbuild + Tailwind 4 from /opt/npm-tools, shims for the
// packages this sandbox lacks. Output: <out>/dist/server.js, <out>/dist/client (same layout as `npm run build`).
// Usage: node e2e-rig/devshim/build.mjs <repo> <out>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/opt/npm-tools/node_modules/');
const esbuild = require('esbuild');
const { compile } = await import('/opt/npm-tools/node_modules/tailwindcss/dist/lib.mjs');
const repo = path.resolve(process.argv[2] ?? '.'), out = path.resolve(process.argv[3] ?? '/home/claude/build');
const shim = p => path.join(repo, 'e2e-rig/devshim', p);
const nodePaths = ['/opt/npm-tools/node_modules'];
const dist = path.join(out, 'dist'), client = path.join(dist, 'client');
fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(path.join(client, 'assets'), { recursive: true });

const serverAlias = { express: shim('express.ts'), cookie: shim('cookie.ts'), qrcode: shim('qrcode.ts'), aws4fetch: shim('aws4fetch.ts'), pg: shim('pg.ts'), 'obs-websocket-js': shim('obs-websocket-js.ts'), '@msgpack/msgpack': shim('msgpack.ts') };
const t0 = Date.now();
await esbuild.build({ entryPoints: [path.join(repo, 'server/main.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(dist, 'server.js'), alias: serverAlias, nodePaths, logLevel: 'warning', banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });

// The vote service (vote/server.ts → dist/vote.js), with the rig's small Postgres wire client standing in for `pg`.
await esbuild.build({ entryPoints: [path.join(repo, 'vote/server.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(dist, 'vote.js'), alias: { ...serverAlias, pg: shim('pg-wire.ts') }, nodePaths, logLevel: 'warning', banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });

const fontStub = { name: 'fontsource', setup(b) { b.onResolve({ filter: /^@fontsource\// }, a => ({ path: a.path, namespace: 'empty-css' })); b.onResolve({ filter: /^\.\/index\.css$/ }, a => ({ path: a.path, namespace: 'empty-css' })); b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'css' })); } };
const r = await esbuild.build({ entryPoints: { main: path.join(repo, 'src/main.tsx'), vote: path.join(repo, 'src/vote/main.tsx') }, bundle: true, format: 'esm', splitting: true, outdir: path.join(client, 'assets'), jsx: 'automatic', alias: { 'motion/react': shim('motion-react.tsx'), 'react-router-dom': shim('react-router-dom.tsx'), qrcode: shim('qrcode.ts') }, nodePaths, plugins: [fontStub], external: ['/fonts/*', '/brand/*'], loader: { '.png': 'file', '.jpg': 'file', '.svg': 'file', '.webm': 'file', '.woff2': 'file', '.woff': 'file', '.mp4': 'file' }, define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"', 'process.env.NODE_ENV': '"production"' }, minify: false, logLevel: 'warning', metafile: true });

// Tailwind: candidates = every token in the sources (what the oxide scanner would find, roughly)
const files = []; const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(tsx?|html)$/.test(f.name)) files.push(p); } };
walk(path.join(repo, 'src')); walk(path.join(repo, 'shared'));
const cand = new Set(); for (const f of files) for (const t of fs.readFileSync(f, 'utf8').split(/[\s"'`{}()<>;,]+/)) if (t && t.length < 120) cand.add(t);
const loadStylesheet = async (id, base) => { const p = id === 'tailwindcss' ? '/opt/npm-tools/node_modules/tailwindcss/index.css' : id.startsWith('tailwindcss/') ? `/opt/npm-tools/node_modules/${id}.css` : path.resolve(base, id); return { path: p, base: path.dirname(p), content: fs.readFileSync(p, 'utf8') }; };
const css = (file) => compile(fs.readFileSync(file, 'utf8'), { base: path.dirname(file), loadStylesheet }).then(c => c.build([...cand]));
// Sandbox only: the @fontsource packages are not installed; stand in for the condensed display face so layouts are
// judged with a narrow font (the real build ships Barlow Condensed).
const fontStand = "@font-face{font-family:'Barlow Condensed';src:local('DejaVu Sans Condensed Bold'),local('DejaVuSansCondensed-Bold');font-weight:100 900}\n";
fs.writeFileSync(path.join(client, 'assets/app.css'), fontStand + await css(path.join(repo, 'src/index.css')));
const extraCss = Object.keys(r.metafile.outputs).filter(o => o.endsWith('.css')).map(o => path.relative(client, path.resolve(o)));
const page = (entry, title) => `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><link rel="icon" type="image/png" href="/brand/overdrive/mark.png" /><title>${title}</title><link rel="stylesheet" href="/assets/app.css" />${extraCss.filter(c => c.endsWith(`/${entry}.css`)).map(c => `<link rel="stylesheet" href="/${c}" />`).join('')}</head><body><div id="root"></div><script type="module" src="/assets/${entry}.js"></script></body></html>`;
fs.writeFileSync(path.join(client, 'index.html'), page('main', 'Overdrive · Caster Control'));
fs.writeFileSync(path.join(client, 'vote.html'), page('vote', 'Overdrive · Vote'));
// public/ → client (symlinks: vite copies public/ into dist/client)
for (const f of fs.readdirSync(path.join(repo, 'public'))) fs.symlinkSync(path.join(repo, 'public', f), path.join(client, f));
console.log(`built in ${Date.now() - t0} ms → ${dist}`);
