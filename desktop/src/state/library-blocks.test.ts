// library-blocks.test.ts — catalogue workflows: collections, smart
// collections, metadata edits and batch "sync settings".

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addImportedFiles, emptyCatalog, FILTERS_DEFAULT } from '@shared/catalog';

const sidecars = new Map<string, unknown>();
const writes: { area: string; name: string; value: unknown }[] = [];

const { openCollection } = vi.hoisted(() => ({ openCollection: vi.fn(async () => {}) }));

vi.mock('./session', () => ({ openCollection }));
vi.mock('../host/client', () => ({ host: () => ({}) }));
vi.mock('../platform', () => ({
  baseName: (path: string) => path.split(/[\\\\/]/).pop() ?? path,
  platform: () => ({
    kind: 'browser',
    storeRead: async (area: string, name: string) => writes.find((w) => w.area === area && w.name === name)?.value ?? null,
    storeWrite: async (area: string, name: string, value: unknown) => {
      writes.push({ area, name, value });
    },
    sidecarLoad: async (path: string) => sidecars.get(path) ?? null,
    sidecarSave: async (path: string, value: unknown) => {
      sidecars.set(path, value);
      return `${path}.json`;
    },
    catalogThumbSave: async (path: string) => path,
    catalogThumbRead: async () => null,
    catalogThumbRemove: async () => undefined,
  }),
}));

import {
  addSelectionToCollection,
  clearSelection,
  createCollectionFromSelection,
  createSmartCollectionFromFilters,
  libraryStore,
  setEntryMetadata,
  setFilters,
  setRating,
  showAllPhotographs,
  showSmartCollection,
  syncDevelopSettings,
  visibleEntries,
} from './library';

function seed() {
  const imported = addImportedFiles(
    emptyCatalog(),
    'D:\\\\Photos',
    [
      { path: 'D:\\\\Photos\\\\a.ARW', name: 'a.ARW', size: 10, mtime_ms: 1 },
      { path: 'D:\\\\Photos\\\\b.ARW', name: 'b.ARW', size: 11, mtime_ms: 2 },
      { path: 'D:\\\\Photos\\\\c.ARW', name: 'c.ARW', size: 12, mtime_ms: 3 },
    ],
    1000,
  );
  libraryStore.setState({
    catalog: imported.catalog,
    filters: { ...FILTERS_DEFAULT },
    selection: ['D:\\\\Photos\\\\a.ARW', 'D:\\\\Photos\\\\b.ARW'],
    anchor: 'D:\\\\Photos\\\\b.ARW',
    sort: { key: 'name', descending: false },
    ready: true,
    open: true,
  });
  return imported.catalog.entries;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('library collections', () => {
  beforeEach(() => {
    sidecars.clear();
    writes.length = 0;
    seed();
  });

  it('creates a collection from the selection and scopes the grid to it', async () => {
    await createCollectionFromSelection('Keepers');
    const state = libraryStore.getState();
    expect(state.catalog.collections).toHaveLength(1);
    expect(state.catalog.collections[0]?.name).toBe('Keepers');
    expect(state.filters.collectionId).toBe(state.catalog.collections[0]?.id);
    expect(visibleEntries().map((e) => e.name)).toEqual(['a.ARW', 'b.ARW']);
    // Adding the third photo widens the collection, not the grid.
    addSelectionToCollection(state.catalog.collections[0]!.id, ['D:\\\\Photos\\\\c.ARW']);
    await flush();
    expect(libraryStore.getState().catalog.collections[0]?.paths).toContain('d:\\\\photos\\\\c.arw');
    expect(visibleEntries()).toHaveLength(3);
  });

  it('saves the current filters as a smart collection and resolves it', async () => {
    await setRating(5, ['D:\\\\Photos\\\\b.ARW']);
    setFilters({ ratingMin: 5 });
    await createSmartCollectionFromFilters('Five stars');
    const state = libraryStore.getState();
    const smart = state.catalog.smartCollections[0]!;
    expect(state.filters.smartId).toBe(smart.id);
    showSmartCollection(smart.id);
    expect(visibleEntries().map((e) => e.name)).toEqual(['b.ARW']);
    setFilters({ ratingMin: 0 });
    showAllPhotographs();
    expect(visibleEntries()).toHaveLength(3);
  });

  it('syncs develop settings from the anchor to the other selected photos', async () => {
    sidecars.set('D:\\\\Photos\\\\b.ARW', { params: { film_stock: 'kodak_portra_400' } });
    await syncDevelopSettings(['D:\\\\Photos\\\\a.ARW', 'D:\\\\Photos\\\\b.ARW']);
    expect(sidecars.get('D:\\\\Photos\\\\a.ARW')).toEqual({ params: { film_stock: 'kodak_portra_400' } });
    expect(libraryStore.getState().catalog.entries.find((e) => e.name === 'a.ARW')?.edited).toBe(true);
    expect(libraryStore.getState().busy).toBeNull();
  });

  it('reports when the anchor has no saved edits', async () => {
    await syncDevelopSettings(['D:\\\\Photos\\\\a.ARW', 'D:\\\\Photos\\\\b.ARW']);
    expect(libraryStore.getState().error).toContain('no saved edits');
    expect(sidecars.size).toBe(0);
  });

  it('edits title, caption and keywords without touching the original path', async () => {
    await setEntryMetadata('D:\\\\Photos\\\\a.ARW', { title: 'Rooftop', caption: 'Dusk', keywords: ['city', ' city ', ''] });
    const entry = libraryStore.getState().catalog.entries.find((e) => e.name === 'a.ARW')!;
    expect(entry.title).toBe('Rooftop');
    expect(entry.caption).toBe('Dusk');
    expect(entry.keywords).toEqual(['city']);
    expect(entry.path).toBe('D:\\\\Photos\\\\a.ARW');
    clearSelection();
    expect(libraryStore.getState().selection).toEqual([]);
  });
});
