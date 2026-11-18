// keys-marks.test.ts — the editor's rating/flag keys write the same catalog
// the Library does, for the picked set (or the open frame).

import { describe, expect, it, vi } from 'vitest';

const mark = vi.hoisted(() => ({
  setRating: vi.fn(async () => {}),
  setFlag: vi.fn(async () => {}),
  setColorLabel: vi.fn(async () => {}),
}));

vi.mock('../state/library', () => mark);

import { installKeys } from './keys';
import { sessionStore } from '../state/session';

const div = { tagName: 'DIV', isContentEditable: false } as unknown as EventTarget;

describe('editor mark keys', () => {
  it('applies stars and flags to the picked frames', async () => {
    const callbacks: ((e: KeyboardEvent) => void)[] = [];
    vi.stubGlobal('window', {
      addEventListener: (_: string, cb: (e: KeyboardEvent) => void) => callbacks.push(cb),
      removeEventListener: () => {},
    });
    const dispose = installKeys();
    const fire = (key: string) => {
      const e = {
        key, target: div, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        repeat: false, preventDefault: vi.fn(),
      };
      callbacks[0]!(e as unknown as KeyboardEvent);
      return e;
    };
    try {
      sessionStore.setState({
        selection: '/roll/2.ARW', picked: ['/roll/1.ARW', '/roll/2.ARW'],
        batchExporting: false, exportOpen: false, settingsOpen: false,
        aboutOpen: false, shortcutsOpen: false, historyOpen: false,
      });
      fire('3');
      expect(mark.setRating).toHaveBeenLastCalledWith(3, ['/roll/1.ARW', '/roll/2.ARW']);
      fire('0');
      expect(mark.setRating).toHaveBeenLastCalledWith(0, ['/roll/1.ARW', '/roll/2.ARW']);
      fire('p');
      expect(mark.setFlag).toHaveBeenLastCalledWith('pick', ['/roll/1.ARW', '/roll/2.ARW']);
      fire('x');
      expect(mark.setFlag).toHaveBeenLastCalledWith('reject', ['/roll/1.ARW', '/roll/2.ARW']);
      fire('u');
      expect(mark.setFlag).toHaveBeenLastCalledWith('none', ['/roll/1.ARW', '/roll/2.ARW']);
      // With nothing picked the open frame is the target.
      sessionStore.setState({ picked: [] });
      fire('5');
      expect(mark.setRating).toHaveBeenLastCalledWith(5, ['/roll/2.ARW']);
    } finally {
      dispose();
      vi.unstubAllGlobals();
      sessionStore.setState({ picked: [], selection: null });
    }
  });
});
