// filmstripFilter.ts — rating / flag / colour-label filtering shared by the
// develop filmstrip (the library grid has the same idea through
// `filterEntries`). The filmstrip keeps the session's frame order untouched;
// this only decides which of those frames are drawn.

import type { ColorLabel, Flag, Rating } from './catalog';

export interface FilmstripFilter {
  ratingMin: Rating;
  flag: Flag | 'all';
  label: ColorLabel | 'all';
}

export const FILMSTRIP_FILTER_DEFAULT: FilmstripFilter = { ratingMin: 0, flag: 'all', label: 'all' };

export interface FrameMark {
  rating: Rating;
  flag: Flag;
  label: ColorLabel;
}

const NO_MARK: FrameMark = { rating: 0, flag: 'none', label: 'none' };

export function frameMatchesMark(mark: FrameMark | undefined, filter: FilmstripFilter): boolean {
  const m = mark ?? NO_MARK;
  if (m.rating < filter.ratingMin) return false;
  if (filter.flag !== 'all' && m.flag !== filter.flag) return false;
  if (filter.label !== 'all' && m.label !== filter.label) return false;
  return true;
}
