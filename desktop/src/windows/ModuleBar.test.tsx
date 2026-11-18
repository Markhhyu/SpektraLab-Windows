// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  setPages: vi.fn(),
  libraryOpen: false,
  setLibraryOpen: vi.fn(),
}));

vi.mock('../state/session', () => ({
  sessionStore: { getState: () => fake.session },
  setPages: fake.setPages,
  useSession: <T,>(selector: (state: Record<string, unknown>) => T) => selector(fake.session),
}));
vi.mock('../state/library', () => ({
  setLibraryOpen: fake.setLibraryOpen,
  libraryStore: { getState: () => ({ open: fake.libraryOpen }) },
  useLibrary: <T,>(selector: (state: { open: boolean }) => T) => selector({ open: fake.libraryOpen }),
}));
vi.mock('../i18n', () => ({ tz: (english: string) => english }));

import { ModuleBar, currentModule, showModule } from './ModuleBar';

let root: Root;
let container: HTMLDivElement;

function render() {
  act(() => root.render(<ModuleBar />));
}
function tab(id: string): HTMLButtonElement {
  return container.querySelector(`[data-testid="module-${id}"]`) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.session = { exportOpen: false, selection: '/photos/a.ARW' };
  fake.libraryOpen = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('React', React);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('module bar', () => {
  it('marks Develop active by default and switches to the Library', () => {
    render();
    expect(tab('develop').className).toContain('is-active');
    expect(tab('library').getAttribute('aria-current')).toBeNull();
    act(() => tab('library').click());
    expect(fake.setPages).toHaveBeenCalledWith({ exportOpen: false });
    expect(fake.setLibraryOpen).toHaveBeenCalledWith(true);
  });

  it('switches back to Develop and closes the library', () => {
    fake.libraryOpen = true;
    render();
    expect(tab('library').className).toContain('is-active');
    act(() => tab('develop').click());
    expect(fake.setLibraryOpen).toHaveBeenCalledWith(false);
    expect(fake.setPages).toHaveBeenCalledWith({ exportOpen: false });
  });

  it('opens Export from the bar when a photograph is selected', () => {
    render();
    act(() => tab('export').click());
    expect(fake.setLibraryOpen).toHaveBeenCalledWith(false);
    expect(fake.setPages).toHaveBeenCalledWith({ exportOpen: true });
  });

  it('disables Export with no selection and derives the active module', () => {
    fake.session = { exportOpen: false, selection: null };
    render();
    expect(tab('export').disabled).toBe(true);
    fake.session = { exportOpen: true, selection: '/photos/a.ARW' };
    expect(currentModule()).toBe('export');
    fake.session = { exportOpen: false, selection: '/photos/a.ARW' };
    fake.libraryOpen = true;
    expect(currentModule()).toBe('library');
    fake.libraryOpen = false;
    expect(currentModule()).toBe('develop');
    showModule('export');
    expect(fake.setPages).toHaveBeenLastCalledWith({ exportOpen: true });
  });
});
