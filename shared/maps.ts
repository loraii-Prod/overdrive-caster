/**
 * OverDrive 2026 Major map pool (TMWT Duos). All five by Marchielli, each themed on a country.
 * Each map has an in-game shot (public/brand/overdrive/maps/<id>.jpg) used on the map card and the veto;
 * a photo uploaded in the Major tab replaces it. MapArt.tsx (drawn in code) is the fallback.
 */
import { hiRes } from './assetRes';
export interface MajorMap {
  id: string;
  country: string;
  title: string;
  author: string;
  /** Flag colours, for the stripe on the card. */
  flag: string[];
  /** Card accent (matches the artwork). */
  accent: string;
  /** In-game shot of the map. */
  photo: string;
}

export const MAJOR_MAPS: MajorMap[] = [
  { id: 'india', photo: '/brand/overdrive/maps/india.jpg', country: 'India', title: 'OverDrive India 2026', author: 'Marchielli', flag: ['#FF9933', '#FFFFFF', '#138808'], accent: '#FF9933' },
  { id: 'czech', photo: '/brand/overdrive/maps/czech.jpg', country: 'Czech Republic', title: 'OverDrive Czech Republic 2026', author: 'Marchielli', flag: ['#FFFFFF', '#D7141A', '#11457E'], accent: '#3D7DD8' },
  { id: 'egypt', photo: '/brand/overdrive/maps/egypt.jpg', country: 'Egypt', title: 'OverDrive Egypt 2026', author: 'Marchielli', flag: ['#CE1126', '#FFFFFF', '#000000'], accent: '#E8B04B' },
  { id: 'uk', photo: '/brand/overdrive/maps/uk.jpg', country: 'United Kingdom', title: 'OverDrive United Kingdom 2026', author: 'Marchielli', flag: ['#012169', '#FFFFFF', '#C8102E'], accent: '#C8102E' },
  { id: 'nz', photo: '/brand/overdrive/maps/nz.jpg', country: 'New Zealand', title: 'OverDrive New Zealand 2026', author: 'Marchielli', flag: ['#00247D', '#FFFFFF', '#CC142B'], accent: '#3FB6A8' },
];

export const majorMap = (id: string | null | undefined) => MAJOR_MAPS.find(m => m.id === id);
export const isMapId = (v: unknown): v is string => typeof v === 'string' && MAJOR_MAPS.some(m => m.id === v);

/** How long the map card stays up (ms). */
export const MAP_CARD_MS = 7000;

/** The picture for a map: the uploaded photo, else the in-game shot. */
export const mapPhoto = (id: string, uploads: Record<string, string> = {}) => uploads[id] || hiRes(majorMap(id)?.photo) || '';
