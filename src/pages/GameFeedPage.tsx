import { GameFeed } from '../components/GameFeed';
import { query } from '../lib/hooks';

/** /gamefeed?slot=&key= — the casters' game feed on its own page (second monitor, fullscreen). */
export function GameFeedPage() {
  const q = query();
  const slot = q.get('slot'), key = q.get('key');
  const auth = slot && key ? `?slot=${encodeURIComponent(slot)}&key=${encodeURIComponent(key)}` : '';
  return (
    <div className="h-screen bg-[#0b0b0b] p-3 text-white">
      <GameFeed auth={auth} big />
    </div>
  );
}
