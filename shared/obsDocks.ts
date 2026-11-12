/**
 * Per-scene controllers as OBS Custom Browser Docks.
 *
 * Every Overdrive OBS scene gets a 1920×1480 controller page, /producer/scene/<target>: its own graphic on top
 * (1920×1080) and only that scene's controls below (1920×400), scaled to the dock. It is a control page: it is
 * never put into a scene (the broadcast sources stay /g/… and /output/…).
 *
 * OBS cannot create Custom Browser Docks over obs-websocket (no such request in obs-websocket 5.x; obs-browser's
 * vendor only has emit_event). OBS keeps them in its config, [BasicWindow] ExtraBrowserDocks = JSON array of
 * {title,url,uuid} (OBS 30 source: UI/window-extra-browsers.cpp, global.ini), loads them at start and rewrites
 * them on exit. So docks are installed either by hand (Docks → Custom Browser Docks…) or, with OBS closed, by the
 * installer scripts below, which merge the entries into that key (global.ini, and user.ini when it exists:
 * newer OBS versions keep window settings there).
 */
import type { TargetReport } from './obsSetup';

export interface DockEntry { id: string; title: string; url: string }

export const controllerPath = (target: string) => `/producer/scene/${target}`;
export const FOLLOW = 'follow';

/** Dock list for the scenes Build All covers (+ one controller that follows OBS Preview/Program). */
/** Controllers sign in with the producer password (cookie kept by OBS's browser); no secret is put in the URL. */
export function dockEntries(base: string, targets: Pick<TargetReport, 'id' | 'name' | 'kind' | 'inAll'>[]): DockEntry[] {
  const list = targets.filter(t => t.inAll && t.kind !== 'support').map(t => ({ id: t.id, title: `Overdrive · ${t.name}`, url: `${base}${controllerPath(t.id)}` }));
  const seen = new Set<string>();
  for (const d of list) { let n = d.title, i = 2; while (seen.has(n)) n = `${d.title} (${i++})`; seen.add(n); d.title = n; }
  return [{ id: FOLLOW, title: 'Overdrive · Follow OBS', url: `${base}${controllerPath(FOLLOW)}` }, ...list];
}

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

/** Windows PowerShell 5.1+ installer. Backs up, merges by URL, keeps every existing dock, refuses while OBS runs. */
export function dockInstallerPs1(docks: DockEntry[]): string {
  const rows = docks.map(d => `  @{ title = ${psq(d.title)}; url = ${psq(d.url)} }`).join(",\n");
  return `# Overdrive: add ${docks.length} Custom Browser Docks to OBS Studio (Windows).
# Run with OBS CLOSED:  right-click → Run with PowerShell   (or: powershell -ExecutionPolicy Bypass -File .\\overdrive-obs-docks.ps1)
# Merges into [BasicWindow] ExtraBrowserDocks of %APPDATA%\\obs-studio\\global.ini (and user.ini if present). Backups are made.
$ErrorActionPreference = 'Stop'
$docks = @(
${rows}
)
if (Get-Process -Name obs64, obs32, obs -ErrorAction SilentlyContinue) { Write-Host 'Close OBS first (OBS rewrites its dock list when it exits).' -ForegroundColor Red; exit 1 }
$dir = if ($env:OBS_CONFIG_DIR) { $env:OBS_CONFIG_DIR } else { Join-Path $env:APPDATA 'obs-studio' }
$files = @('global.ini', 'user.ini') | ForEach-Object { Join-Path $dir $_ } | Where-Object { Test-Path $_ }
if (-not $files) { Write-Host "No OBS settings found in $dir. Start and close OBS once, then run this again." -ForegroundColor Red; exit 1 }
$utf8 = New-Object System.Text.UTF8Encoding $false
foreach ($f in $files) {
  Copy-Item $f "$f.bak-overdrive-$(Get-Date -Format yyyyMMdd-HHmmss)"
  $lines = [System.Collections.Generic.List[string]]([System.IO.File]::ReadAllLines($f))
  $sec = -1; for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -eq '[BasicWindow]') { $sec = $i; break } }
  if ($sec -lt 0) { $lines.Add(''); $lines.Add('[BasicWindow]'); $sec = $lines.Count - 1 }
  $end = $lines.Count; for ($i = $sec + 1; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim().StartsWith('[')) { $end = $i; break } }
  $at = -1; $cur = @()
  for ($i = $sec + 1; $i -lt $end; $i++) { if ($lines[$i].StartsWith('ExtraBrowserDocks=')) { $at = $i; $raw = $lines[$i].Substring(18); if ($raw.Trim()) { $cur = @(ConvertFrom-Json $raw) }; break } }
  $out = New-Object System.Collections.ArrayList
  foreach ($d in $cur) { [void]$out.Add([ordered]@{ title = [string]$d.title; url = [string]$d.url; uuid = [string]$d.uuid }) }
  $added = 0
  foreach ($d in $docks) {
    $hit = $out | Where-Object { $_.url -eq $d.url } | Select-Object -First 1
    if ($hit) { $hit.title = $d.title } else { [void]$out.Add([ordered]@{ title = $d.title; url = $d.url; uuid = [guid]::NewGuid().ToString('N') }); $added++ }
  }
  $json = ConvertTo-Json -InputObject @($out) -Compress -Depth 3
  $line = "ExtraBrowserDocks=$json"
  if ($at -ge 0) { $lines[$at] = $line } else { $lines.Insert($sec + 1, $line) }
  [System.IO.File]::WriteAllLines($f, $lines, $utf8)
  Write-Host "$f : $added dock(s) added, $($out.Count) in total."
}
Write-Host 'Done. Start OBS: the docks are under Docks. First time in each dock: sign in with the producer password.' -ForegroundColor Green
`;
}

/** macOS / Linux installer (needs python3, standard on Linux; on macOS it comes with the Command Line Tools). */
export function dockInstallerSh(docks: DockEntry[]): string {
  const json = JSON.stringify(docks.map(d => ({ title: d.title, url: d.url })));
  return `#!/bin/sh
# Overdrive: add ${docks.length} Custom Browser Docks to OBS Studio (macOS / Linux). Run with OBS CLOSED:  sh overdrive-obs-docks.sh
# Merges into [BasicWindow] ExtraBrowserDocks of global.ini (and user.ini if present) in the OBS settings folder. Backups are made.
set -e
if pgrep -x obs >/dev/null 2>&1 || pgrep -x OBS >/dev/null 2>&1; then echo "Close OBS first (OBS rewrites its dock list when it exits)."; exit 1; fi
if [ -n "$OBS_CONFIG_DIR" ]; then DIR="$OBS_CONFIG_DIR"
elif [ "$(uname)" = Darwin ]; then DIR="$HOME/Library/Application Support/obs-studio"
else DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/obs-studio"; fi
command -v python3 >/dev/null 2>&1 || { echo "python3 is needed (or add the docks by hand: Docks → Custom Browser Docks…)."; exit 1; }
DOCKS=${shq(json)} python3 - "$DIR" <<'PY'
import json, os, sys, time, uuid, shutil
d = sys.argv[1]; want = json.loads(os.environ['DOCKS'])
files = [os.path.join(d, f) for f in ('global.ini', 'user.ini') if os.path.exists(os.path.join(d, f))]
if not files: sys.exit('No OBS settings found in %s. Start and close OBS once, then run this again.' % d)
for f in files:
    shutil.copy(f, f + '.bak-overdrive-' + time.strftime('%Y%m%d-%H%M%S'))
    lines = open(f, encoding='utf-8-sig').read().splitlines()
    sec = next((i for i, l in enumerate(lines) if l.strip() == '[BasicWindow]'), None)
    if sec is None: lines += ['', '[BasicWindow]']; sec = len(lines) - 1
    end = next((i for i in range(sec + 1, len(lines)) if lines[i].strip().startswith('[')), len(lines))
    at = next((i for i in range(sec + 1, end) if lines[i].startswith('ExtraBrowserDocks=')), None)
    cur = []
    if at is not None:
        raw = lines[at][len('ExtraBrowserDocks='):].strip()
        if raw: cur = json.loads(raw)
    added = 0
    for w in want:
        hit = next((c for c in cur if c.get('url') == w['url']), None)
        if hit: hit['title'] = w['title']
        else: cur.append({'title': w['title'], 'url': w['url'], 'uuid': uuid.uuid4().hex}); added += 1
    line = 'ExtraBrowserDocks=' + json.dumps(cur, separators=(',', ':'))
    if at is None: lines.insert(sec + 1, line)
    else: lines[at] = line
    open(f, 'w', encoding='utf-8').write('\\n'.join(lines) + '\\n')
    print('%s : %d dock(s) added, %d in total.' % (f, added, len(cur)))
print('Done. Start OBS: the docks are under Docks. First time in each dock: sign in with the producer password.')
PY
`;
}

/** Overdrive control pages: these must never be a browser source inside a broadcast scene. */
export const isControllerRoute = (route: string | null) => !!route && /^\/(producer|controller|admin|login)(\/|\?|$)/.test(route);
