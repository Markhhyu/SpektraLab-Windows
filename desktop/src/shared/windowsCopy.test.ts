import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import zhHans from '../i18n/zh-Hans.json';

/** The Windows build must never teach macOS key symbols (UX review F1). */
describe('Windows copy', () => {
  it('never shows Command or Shift glyphs', () => {
    for (const [name, table] of Object.entries({ 'en.json': en, 'zh-Hans.json': zhHans })) {
      const text = JSON.stringify(table);
      expect(text.includes('⌘'), `${name} contains a Command glyph`).toBe(false);
      expect(text.includes('⇧'), `${name} contains a Shift glyph`).toBe(false);
    }
  });
});
