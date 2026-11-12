import { MediaView } from '../components/media/MediaView';
import { query, useMedia, useSocket } from '../lib/hooks';

/** /output/media — independent OBS browser source (tick "Control audio via OBS" for its sound). */
export function MediaOutput() {
  const sock = useSocket({ role: 'output', route: 'media', key: query().get('key') ?? undefined });
  const m = useMedia(sock);
  return <div className="fixed inset-0 overflow-hidden bg-transparent"><MediaView media={m?.media ?? null} skew={m?.skew ?? 0} onEnded={seq => sock.send({ t: 'media-ended', seq })} /></div>;
}
