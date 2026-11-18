import { describe, expect, it } from 'vitest';
import { FILMSTRIP_FILTER_DEFAULT, frameMatchesMark } from '@shared/filmstripFilter';

const pick3 = { rating: 3 as const, flag: 'pick' as const, label: 'red' as const };

describe('filmstrip filter', () => {
  it('passes everything by default, including frames without a catalog mark', () => {
    expect(frameMatchesMark(undefined, FILMSTRIP_FILTER_DEFAULT)).toBe(true);
    expect(frameMatchesMark(pick3, FILMSTRIP_FILTER_DEFAULT)).toBe(true);
  });

  it('filters by minimum rating', () => {
    expect(frameMatchesMark(pick3, { ...FILMSTRIP_FILTER_DEFAULT, ratingMin: 5 })).toBe(false);
    expect(frameMatchesMark(pick3, { ...FILMSTRIP_FILTER_DEFAULT, ratingMin: 3 })).toBe(true);
  });

  it('filters by flag and label', () => {
    expect(frameMatchesMark(pick3, { ...FILMSTRIP_FILTER_DEFAULT, flag: 'reject' })).toBe(false);
    expect(frameMatchesMark(pick3, { ...FILMSTRIP_FILTER_DEFAULT, flag: 'pick' })).toBe(true);
    expect(frameMatchesMark(pick3, { ...FILMSTRIP_FILTER_DEFAULT, label: 'blue' })).toBe(false);
    expect(frameMatchesMark(pick3, { ...FILMSTRIP_FILTER_DEFAULT, label: 'red' })).toBe(true);
  });

  it('treats a frame outside the catalog as unrated / unflagged / unlabelled', () => {
    expect(frameMatchesMark(undefined, { ...FILMSTRIP_FILTER_DEFAULT, ratingMin: 1 })).toBe(false);
    expect(frameMatchesMark(undefined, { ...FILMSTRIP_FILTER_DEFAULT, flag: 'none' })).toBe(true);
  });
});
