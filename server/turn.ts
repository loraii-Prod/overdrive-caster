import crypto from 'node:crypto';
import { config } from './config';

/**
 * ICE servers handed to authenticated WebRTC peers. With TURN_SECRET (coturn
 * `use-auth-secret`) every client gets a credential that expires after 12h,
 * so no long-lived TURN secret ever reaches a browser.
 */
export function iceServers(clientId: string): RTCIceServer[] {
  const list: RTCIceServer[] = [];
  if (config.stunUrls.length) list.push({ urls: config.stunUrls });
  if (config.turnUrls.length) {
    if (config.turnSecret) {
      const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${clientId}`;
      const credential = crypto.createHmac('sha1', config.turnSecret).update(username).digest('base64');
      list.push({ urls: config.turnUrls, username, credential });
    } else if (config.turnUsername) {
      list.push({ urls: config.turnUrls, username: config.turnUsername, credential: config.turnCredential });
    }
  }
  return list;
}
