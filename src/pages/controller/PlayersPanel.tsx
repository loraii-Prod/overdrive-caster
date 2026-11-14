import { useEffect, useMemo, useState } from 'react';
import type { ControllerState, Show } from '../../../shared/types';
import { PlayerCamsTab } from './PlayerCamsTab';
import type { QuickOp } from '../../../shared/protocol';
import { parsePlayersTable, STORY_LABELS, type Player, type Story, type StoryKind } from '../../../shared/players';
import { ConfirmButton, Segmented } from './ui';
import { UploadButton } from '../admin/Admin';

type Send = (m: any) => void;

const DURATIONS: { value: string; label: string }[] = [
  { value: '10', label: '10s' }, { value: '15', label: '15s' }, { value: '20', label: '20s' }, { value: '30', label: '30s' }, { value: '0', label: 'Until hidden' },
];

const blankPlayer = (): Player => ({ id: `p-${Date.now().toString(36)}`, name: 'New player', input: '', camera: '', style: '', age: '', favPlayer: '', funFact: '', rival: '', photo: '', ingame: '', vdo: '' });

export function PlayersPanel({ st, now, send, quick, show, setShow }: { st: ControllerState; now: number; send: Send; quick: (op: QuickOp) => void; show: Show; setShow: (p: Partial<Show>) => void }) {
  const [q, setQ] = useState('');
  const [dur, setDur] = useState('15');
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<'cams' | 'players' | 'stories' | 'import'>('cams');
  const spot = st.showLive.spotlight;
  const spotOn = !!spot && (spot.until == null || spot.until > now);
  const seconds = Number(dur) || null;

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    const ps = [...st.players].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return k ? ps.filter(p => [p.name, p.style, p.input, p.favPlayer, p.rival].some(v => v.toLowerCase().includes(k))) : ps;
  }, [st.players, q]);
  const selected = st.players.find(p => p.id === sel) ?? null;

  return (
    <div className="space-y-5">
      {/* Spotlight status */}
      <section className={`flex items-center gap-4 rounded-lg border p-4 ${spotOn ? 'border-[#e5484d]/60 bg-[#e5484d]/10' : 'border-white/[0.08] bg-[#171717]'}`}>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-white/50">Spotlight on gameplay</div>
          <div className="mt-1 truncate text-[15px] font-semibold">
            {spotOn && spot ? (
              <>{spot.kind === 'player' ? spot.data.name : `${spot.data.label}: ${spot.data.title}`}
                <span className="ml-2 text-[12px] font-normal text-white/50">{spot.until ? `hides in ${Math.max(0, Math.ceil((spot.until - now) / 1000))}s` : 'until hidden'}</span></>
            ) : <span className="text-white/40">Nothing on screen</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11.5px] text-white/50">Show for <Segmented size="sm" value={dur} onChange={setDur} options={DURATIONS} /></div>
        <button type="button" className="btn-sm" disabled={!spotOn} onClick={() => quick({ k: 'spotlight-hide' })}>Hide</button>
      </section>
      <p className="-mt-3 px-1 text-[11.5px] text-white/40">The card appears on the Gameplay screen (and /output/player) straight away, no TAKE needed.</p>

      <Segmented value={tab} onChange={setTab} options={[{ value: 'cams', label: 'Player cams' }, { value: 'players', label: `Players (${st.players.length})` }, { value: 'stories', label: `Stories (${st.stories.length})` }, { value: 'import', label: 'Import' }]} />

      {tab === 'cams' && <PlayerCamsTab st={st} show={show} setShow={setShow} send={send} quick={quick} now={now} />}

      {tab === 'players' && (
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-5">
          <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-3">
            <div className="mb-2 flex gap-2">
              <input className="input min-w-0 flex-1" placeholder="Search name, style, rival…" value={q} onChange={e => setQ(e.target.value)} />
              <button type="button" className="btn-sm" onClick={() => { const p = blankPlayer(); send({ t: 'players-set', players: [...st.players, p] }); setSel(p.id); }}>+ Add</button>
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              {list.map(p => {
                const live = spotOn && spot?.kind === 'player' && spot.id === p.id;
                return (
                  <div key={p.id} className={`flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 ${sel === p.id ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`} onClick={() => setSel(p.id)}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold">{p.name}</div>
                      <div className="truncate text-[11.5px] text-white/45">{[p.input, p.style, p.age && `${p.age} y/o`].filter(Boolean).join(' · ')}</div>
                    </div>
                    {p.funFact && <span title="Has a fun fact" className="text-[10px] font-bold tracking-[0.14em] text-white/35">FACT</span>}
                    <button type="button" className={`btn-xs ${live ? '!border-[#e5484d] !bg-[#e5484d] !text-white' : ''}`}
                      onClick={e => { e.stopPropagation(); live ? quick({ k: 'spotlight-hide' }) : quick({ k: 'spotlight', kind: 'player', id: p.id, seconds }); }}>
                      {live ? 'ON AIR' : 'SHOW'}
                    </button>
                  </div>
                );
              })}
              {list.length === 0 && <div className="px-2 py-6 text-center text-[12px] text-white/40">No players match.</div>}
            </div>
          </section>
          <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
            {selected ? <PlayerEditor key={selected.id} p={selected} onSave={np => send({ t: 'players-set', players: st.players.map(x => (x.id === np.id ? np : x)) })}
              onDelete={() => { send({ t: 'players-set', players: st.players.filter(x => x.id !== selected.id) }); setSel(null); }}
              onShow={() => quick({ k: 'spotlight', kind: 'player', id: selected.id, seconds })} />
              : <div className="py-10 text-center text-[12.5px] text-white/40">Pick a player to see or edit their info.</div>}
          </section>
        </div>
      )}

      {tab === 'stories' && <StoriesEditor stories={st.stories} send={send} onShow={id => quick({ k: 'spotlight', kind: 'story', id, seconds })} liveId={spotOn && spot?.kind === 'story' ? spot.id : null} />}

      {tab === 'import' && <ImportPlayers current={st.players} send={send} />}
    </div>
  );
}

const FIELDS: [keyof Player, string][] = [
  ['name', 'Name'], ['input', 'Input device'], ['camera', 'Camera'], ['style', 'Favourite style'], ['age', 'Age'],
  ['favPlayer', 'Favourite player'], ['funFact', 'Fun fact'], ['rival', 'Biggest rival'], ['ingame', 'In-game name / login (for cam follow)'],
];

function PlayerEditor({ p, onSave, onDelete, onShow }: { p: Player; onSave: (p: Player) => void; onDelete: () => void; onShow: () => void }) {
  const [d, setD] = useState(p);
  useEffect(() => setD(p), [p]);
  const dirty = JSON.stringify(d) !== JSON.stringify(p);
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-semibold">{p.name}</div>
        <button type="button" className="btn-sm !border-[#e5484d]/60 !text-[#ff8a8d]" onClick={onShow}>Show on stream</button>
      </div>
      {FIELDS.map(([k, label]) => (
        <label key={k} className="block">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">{label}</div>
          {k === 'funFact' || k === 'rival'
            ? <textarea className="input h-auto w-full py-2" rows={2} value={d[k]} onChange={e => setD({ ...d, [k]: e.target.value })} />
            : <input className="input w-full" value={d[k]} onChange={e => setD({ ...d, [k]: e.target.value })} />}
        </label>
      ))}
      <div className="flex items-center gap-2">
        <input className="input min-w-0 flex-1 font-mono text-[11px]" placeholder="Photo URL (optional)" value={d.photo} onChange={e => setD({ ...d, photo: e.target.value })} />
        <UploadButton label="Upload photo" role="portrait" onUrl={url => setD({ ...d, photo: url })} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" className="btn-sm !border-white !bg-white !text-[#111]" disabled={!dirty} onClick={() => onSave(d)}>Save</button>
        {dirty && <button type="button" className="btn-sm" onClick={() => setD(p)}>Discard</button>}
        <div className="flex-1" />
        <ConfirmButton onConfirm={onDelete} confirmLabel="Delete player?">Delete</ConfirmButton>
      </div>
    </div>
  );
}

function StoriesEditor({ stories, send, onShow, liveId }: { stories: Story[]; send: Send; onShow: (id: string) => void; liveId: string | null }) {
  const [items, setItems] = useState(stories);
  useEffect(() => setItems(stories), [stories]);
  const dirty = JSON.stringify(items) !== JSON.stringify(stories);
  const upd = (i: number, p: Partial<Story>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
      <div className="space-y-2">
        {items.map((s, i) => (
          <div key={s.id} className={`grid grid-cols-[130px_minmax(0,0.8fr)_minmax(0,2fr)_auto] items-center gap-2 rounded-md p-1 ${liveId === s.id ? 'ring-1 ring-[#e5484d]' : ''}`}>
            <select className="input h-8" value={s.kind} onChange={e => upd(i, { kind: e.target.value as StoryKind })}>
              {(Object.keys(STORY_LABELS) as StoryKind[]).map(k => <option key={k} value={k}>{STORY_LABELS[k]}</option>)}
            </select>
            <input className="input h-8" value={s.title} placeholder="Title" onChange={e => upd(i, { title: e.target.value })} />
            <input className="input h-8" value={s.text} placeholder="Text" onChange={e => upd(i, { text: e.target.value })} />
            <div className="flex gap-1">
              <button type="button" className="btn-xs !border-[#e5484d]/60 !text-[#ff8a8d]" disabled={dirty} title={dirty ? 'Save first' : 'Show on stream'} onClick={() => onShow(s.id)}>SHOW</button>
              <button type="button" className="btn-xs" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-sm" onClick={() => setItems([...items, { id: `s-${Date.now().toString(36)}`, kind: 'custom', title: '', text: '' }])}>+ Add story</button>
        <button type="button" className="btn-sm !border-white !bg-white !text-[#111]" disabled={!dirty} onClick={() => send({ t: 'stories-set', stories: items })}>Save stories</button>
      </div>
    </section>
  );
}

function ImportPlayers({ current, send }: { current: Player[]; send: Send }) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => (text.trim() ? parsePlayersTable(text) : []), [text]);
  const merge = () => {
    const byName = new Map(current.map(p => [p.name.toLowerCase(), p]));
    for (const p of parsed) byName.set(p.name.toLowerCase(), { ...(byName.get(p.name.toLowerCase()) ?? {}), ...p, photo: byName.get(p.name.toLowerCase())?.photo ?? '' });
    send({ t: 'players-set', players: [...byName.values()] });
    setText('');
  };
  return (
    <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
      <p className="mb-2 text-[12px] leading-relaxed text-white/50">
        In Google Sheets, select the whole table (including the header row: Name, Input Device, Camera, Favourite Style, Age, Favourite Player, Fun Fact, Biggest Rival), copy, and paste it here. CSV works too.
      </p>
      <textarea className="input h-48 w-full py-2 font-mono text-[11.5px]" value={text} onChange={e => setText(e.target.value)} placeholder="Paste the table here…" />
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[12px] text-white/50">{text.trim() ? `${parsed.length} players found` : ''}</span>
        <div className="flex-1" />
        <button type="button" className="btn-sm" disabled={!parsed.length} onClick={merge}>Add & update by name</button>
        <ConfirmButton className="btn-sm" confirmLabel={`Replace all ${current.length} with ${parsed.length}?`} onConfirm={() => { if (parsed.length) { send({ t: 'players-set', players: parsed }); setText(''); } }}>Replace all</ConfirmButton>
      </div>
    </section>
  );
}
