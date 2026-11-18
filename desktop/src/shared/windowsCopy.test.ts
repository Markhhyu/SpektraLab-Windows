import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The Windows build must never teach macOS key symbols (UX review F1). */
const FILES = ['../i18n/en.json', '../i18n/zh-Hans.json', '../windows/shortcuts.ts'];

describe('Windows copy', () => {
  it('never shows Command or Shift-Command glyphs', () => {
    for (const file of FILES) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(text.includes('⌘'), `${file} contains a Command glyph`).toBe(false);
      expect(text.includes('⇧'), `${file} contains a Shift glyph`).toBe(false);
    }
  });
});
