import { describe, expect, it } from 'vitest';
import {
  addImportedFiles,
  decodeCatalog,
  emptyCatalog,
  encodeCatalog,
  filterEntries,
  folderGroups,
  folderContains,
  keywordGroups,
  removeEntries,
  sortEntries,
  updateEntries,
  FILTERS_DEFAULT,
  type CatalogEntry,
  type ImportFile,
} from './catalog';

function file(path: string, mtime = 1_700_000_000_000): ImportFile {
  return { path, name: path.split(/[\\/]/).pop()!, size: 12, mtime_ms: mtime };
}

describe('catalog', () => {
  it('imports files once and remembers the folder', () => {
    const a = addImportedFiles(emptyCatalog(), 'C:\\Photos\\Roll 1', [file('C:\\Photos\\Roll 1\\a.ARW'), file('C:\\Photos\\Roll 1\\b.ARW')], 100);
    expect(a.added.map((e) => e.name)).toEqual(['a.ARW', 'b.ARW']);
    expect(a.catalog.folders.map((f) => f.path)).toEqual(['C:\\Photos\\Roll 1']);
    expect(a.catalog.entries.every((e) => e.folder === 'C:\\Photos\\Roll 1')).toBe(true);
    const b = addImportedFiles(a.catalog, 'C:\\Photos\\Roll 1', [file('C:\\PHOTOS\\ROLL 1\\A.ARW'), file('C:\\Photos\\Roll 1\\c.ARW')], 200);
    expect(b.added.map((e) => e.name)).toEqual(['c.ARW']);
    expect(b.catalog.entries).toHaveLength(3);
  });

  it('decodes a damaged catalog defensively', () => {
    const decoded = decodeCatalog({
      folders: [{ path: 'C:\\Photos' }, { path: 42 }],
      entries: [
        { path: 'C:\\Photos\\a.ARW', rating: 99, flag: 'weird', keywords: ['sky', 'sky', '  moon '] },
        { path: 'C:\\Photos\\a.ARW', rating: 3 },
        { path: '' },
        'nonsense',
      ],
      lastView: 'editor',
      lastSelection: 'C:\\Photos\\a.ARW',
    });
    expect(decoded.entries).toHaveLength(1);
    expect(decoded.entries[0]).toMatchObject({ rating: 0, flag: 'none', keywords: ['sky', 'moon'] });
    expect(decoded.folders.map((f) => f.path)).toEqual(['C:\\Photos']);
    expect(decoded.lastView).toBe('editor');
    expect(decoded.lastSelection).toBe('C:\\Photos\\a.ARW');
  });

  it('round-trips through the store encoding', () => {
    const catalog = addImportedFiles(emptyCatalog(), 'D:\\Negs', [file('D:\\Negs\\one.TIF')], 10).catalog;
    const decoded = decodeCatalog(JSON.parse(JSON.stringify(encodeCatalog(catalog))));
    expect(decoded.entries.map((e) => e.path)).toEqual(['D:\\Negs\\one.TIF']);
    expect(decoded.folders.map((f) => f.path)).toEqual(['D:\\Negs']);
  });

  const entries: CatalogEntry[] = [
    { path: 'C:\\A\\one.ARW', name: 'one.ARW', folder: 'C:\\A', size: 1, mtimeMs: 3, importedAt: 1, rating: 5, flag: 'pick', keywords: ['sky'], edited: true, thumb: true },
    { path: 'C:\\A\\two.ARW', name: 'two.ARW', folder: 'C:\\A', size: 1, mtimeMs: 1, importedAt: 2, rating: 0, flag: 'none', keywords: [], edited: false, thumb: true },
    { path: 'C:\\B\\three.ARW', name: 'three.ARW', folder: 'C:\\B', size: 1, mtimeMs: 2, importedAt: 3, rating: 2, flag: 'reject', keywords: ['sky', 'moon'], edited: false, thumb: false },
  ];

  it('filters by folder subtree, stars, flag, keyword, edited and search', () => {
    const base = emptyCatalog();
    const withEntries = { ...base, entries };
    const all = (patch: Partial<typeof FILTERS_DEFAULT>) => filterEntries(withEntries.entries, { ...FILTERS_DEFAULT, ...patch });
    expect(all({ folder: 'C:\\A' }).map((e) => e.name)).toEqual(['one.ARW', 'two.ARW']);
    expect(all({ folder: 'C:\\A' }).map((e) => e.name)).toContain('two.ARW');
    expect(all({ ratingMin: 2 })).toHaveLength(2);
    expect(all({ flag: 'reject' }).map((e) => e.name)).toEqual(['three.ARW']);
    expect(all({ keyword: 'sky' })).toHaveLength(2);
    expect(all({ editedOnly: true })).toHaveLength(1);
    expect(all({ search: 'THREE' }).map((e) => e.name)).toEqual(['three.ARW']);
    expect(all({ search: 'c:\\b' }).map((e) => e.name)).toEqual(['three.ARW']);
  });

  it('matches folder subtrees without matching a shared name prefix', () => {
    expect(folderContains('C:\\Photos', 'C:\\Photos\\Roll 1')).toBe(true);
    expect(folderContains('C:\\Photos', 'C:\\Photos')).toBe(true);
    expect(folderContains('C:\\Photo', 'C:\\Photos\\x')).toBe(false);
    expect(folderContains('/home/u/pics', '/home/u/pics/roll')).toBe(true);
  });

  it('sorts by name, rating, folder and date', () => {
    const byName = sortEntries(entries, { key: 'name', descending: false }).map((e) => e.name);
    expect(byName).toEqual(['one.ARW', 'three.ARW', 'two.ARW']);
    expect(sortEntries(entries, { key: 'rating', descending: true })[0]?.name).toBe('one.ARW');
    expect(sortEntries(entries, { key: 'date', descending: false }).map((e) => e.name)).toEqual(['two.ARW', 'three.ARW', 'one.ARW']);
  });

  it('groups folders and keywords for the sidebar', () => {
    expect(folderGroups(entries).map((f) => [f.name, f.count])).toEqual([['A', 2], ['B', 1]]);
    expect(keywordGroups(entries)).toEqual([{ word: 'sky', count: 2 }, { word: 'moon', count: 1 }]);
  });

  it('updates metadata and drops empty folders on removal', () => {
    const catalog = { ...emptyCatalog(), entries, folders: [{ path: 'C:\\A', addedAt: 1 }, { path: 'C:\\B', addedAt: 2 }] };
    const rated = updateEntries(catalog, ['C:\\A\\two.ARW'], { rating: 4, flag: 'pick' });
    expect(rated.entries.find((e) => e.name === 'two.ARW')).toMatchObject({ rating: 4, flag: 'pick' });
    const pruned = removeEntries(catalog, ['C:\\A\\one.ARW', 'C:\\A\\two.ARW']);
    expect(pruned.entries.map((e) => e.name)).toEqual(['three.ARW']);
    expect(pruned.folders.map((f) => f.path)).toEqual(['C:\\B']);
  });
});
