// library-open.test.ts — opening from the grid keeps the visible catalog page
// as the editor's filmstrip, with the clicked photograph focused.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addImportedFiles, emptyCatalog, type CatalogEntry } from '@shared/catalog';

const { openCollection } = vi.hoisted(() => ({ openCollection: vi.fn(async (_folder: string, _files: unknown[], _focus?: string) => {}) }));

vi.mock('./session', () => ({ openCollection }));
vi.mock('../platform', () => ({
  platform: () => ({ pathExists: async () => true }),
  baseName: (path: string) => path.split(/[\\/]/).pop() ?? path,
}));

import { libraryStore, openSelection } from './library';

function seed(): CatalogEntry[] {
  const imported = addImportedFiles(
    emptyCatalog(),
    'D:\\Photos',
    [
      { path: 'D:\\Photos\\a.ARW', name: 'a.ARW', size: 10, mtime_ms: 1 },
      { path: 'D:\\Photos\\b.ARW', name: 'b.ARW', size: 11, mtime_ms: 2 },
      { path: 'D:\\Photos\\c.ARW', name: 'c.ARW', size: 12, mtime_ms: 3 },
    ],
    1000,
  );
  libraryStore.setState({
    catalog: imported.catalog,
    selection: ['D:\\Photos\\b.ARW'],
    anchor: 'D:\\Photos\\b.ARW',
    sort: { key: 'name', descending: false },
  });
  return imported.catalog.entries;
}

describe('library openSelection', () => {
  beforeEach(() => openCollection.mockClear());

  it('opens the whole visible page with the clicked photo focused', async () => {
    seed();
    await openSelection(['D:\\Photos\\b.ARW'], 'D:\\Photos\\b.ARW');
    expect(openCollection).toHaveBeenCalledTimes(1);
    const [folder, files, focus] = openCollection.mock.calls[0]! as [string, { path: string }[], string];
    expect(folder).toBe('D:\\Photos');
    expect(files.map((f) => f.path)).toEqual([
      'D:\\Photos\\a.ARW',
      'D:\\Photos\\b.ARW',
      'D:\\Photos\\c.ARW',
    ]);
    expect(focus).toBe('D:\\Photos\\b.ARW');
    expect(libraryStore.getState().open).toBe(false);
    expect(libraryStore.getState().selection).toEqual(['D:\\Photos\\b.ARW']);
  });

  it('keeps the picked subset distinct from the visible roll and focus', async () => {
    const [a, b, c] = seed();
    libraryStore.setState({ selection: [a!.path, c!.path], anchor: c!.path });
    await openSelection();
    expect(libraryStore.getState().selection).toEqual([a!.path, c!.path]);
    expect(openCollection).toHaveBeenCalledWith(a!.folder, expect.arrayContaining([expect.objectContaining({ path: b!.path })]), c!.path, [a!.path, c!.path]);
  });

  it('falls back to the last selected path when no focus is given', async () => {
    seed();
    await openSelection();
    const [, files, focus] = openCollection.mock.calls[0]! as [string, { path: string }[], string];
    expect(files).toHaveLength(3);
    expect(focus).toBe('D:\\Photos\\b.ARW');
  });
});
