// catalog.ts — the library's persistent index (the catalog).
//
// Every imported photograph is one entry. The originals are never copied or
// modified: an entry remembers the absolute path, its file identity and the
// user's library metadata (rating, flag, keywords). Edits themselves still
// live in the per-image sidecar; `edited` here is only a badge for the grid.

export const CATALOG_VERSION = 1 as const;
export const CATALOG_STORE_AREA = 'Catalog';
export const CATALOG_STORE_NAME = 'catalog.json';

export type Rating = 0 | 1 | 2 | 3 | 4 | 5;
export type Flag = 'none' | 'pick' | 'reject';
export type ColorLabel = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
export type LibraryView = 'library' | 'editor';

export interface CatalogEntry {
  /** Absolute path of the original. */
  path: string;
  name: string;
  /** Absolute folder that contains the original. */
  folder: string;
  size: number;
  mtimeMs: number;
  importedAt: number;
  rating: Rating;
  flag: Flag;
  keywords: string[];
  /** A sidecar exists for this photograph. */
  edited: boolean;
  /** A cached JPEG preview exists in the catalog thumbs store. */
  thumb: boolean;
  /** Colour label, as in the classic grid workflow. */
  label: ColorLabel;
  /** Free-text metadata edited in the library (never written into the RAW). */
  title: string;
  caption: string;
}

export interface CatalogCollection {
  id: string;
  name: string;
  /** Lower-case entry paths; the collection is a subset of the catalog. */
  paths: string[];
  createdAt: number;
}

export interface SmartCollection {
  id: string;
  name: string;
  /** Saved filter preset; collection/smart/label view keys are cleared. */
  filters: LibraryFilters;
  createdAt: number;
}

export interface CatalogFolder {
  path: string;
  addedAt: number;
}

export interface Catalog {
  version: typeof CATALOG_VERSION;
  folders: CatalogFolder[];
  entries: CatalogEntry[];
  collections: CatalogCollection[];
  smartCollections: SmartCollection[];
  lastView: LibraryView;
  lastSelection: string | null;
  updatedAt: number;
}

export function emptyCatalog(): Catalog {
  return {
    version: CATALOG_VERSION,
    folders: [],
    entries: [],
    collections: [],
    smartCollections: [],
    lastView: 'library',
    lastSelection: null,
    updatedAt: 0,
  };
}

const RATINGS: readonly number[] = [0, 1, 2, 3, 4, 5];

function clampRating(value: unknown): Rating {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  return (RATINGS.includes(n) ? n : 0) as Rating;
}

function flagOf(value: unknown): Flag {
  return value === 'pick' || value === 'reject' ? value : 'none';
}

const LABELS: readonly ColorLabel[] = ['none', 'red', 'yellow', 'green', 'blue', 'purple'];

function labelOf(value: unknown): ColorLabel {
  return LABELS.includes(value as ColorLabel) ? (value as ColorLabel) : 'none';
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Path helpers shared with the platform layer (Windows separators included). */
export function dirNameOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : path;
}

export function baseNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function entryOf(value: unknown, now: number): CatalogEntry | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const path = str(o.path).trim();
  if (!path) return null;
  return {
    path,
    name: str(o.name) || baseNameOf(path),
    folder: str(o.folder) || dirNameOf(path),
    size: Math.max(0, num(o.size)),
    mtimeMs: Math.max(0, num(o.mtimeMs)),
    importedAt: num(o.importedAt, now),
    rating: clampRating(o.rating),
    flag: flagOf(o.flag),
    keywords: Array.isArray(o.keywords) ? [...new Set(o.keywords.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean))] : [],
    edited: o.edited === true,
    thumb: o.thumb === true,
    label: labelOf(o.label),
    title: str(o.title),
    caption: str(o.caption),
  };
}

/** Tolerant decode: unknown or damaged fields fall back to a usable entry. */
export function decodeCatalog(value: unknown, now = Date.now()): Catalog {
  const fallback = emptyCatalog();
  if (!value || typeof value !== 'object') return fallback;
  const o = value as Record<string, unknown>;
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(o.entries) ? o.entries : []) {
    const entry = entryOf(raw, now);
    // Two catalog records for one path would make selection and ratings ambiguous.
    const id = entry?.path.toLowerCase();
    if (!entry || !id || seen.has(id)) continue;
    seen.add(id);
    entries.push(entry);
  }
  const folders: CatalogFolder[] = [];
  const foldersSeen = new Set<string>();
  for (const raw of Array.isArray(o.folders) ? o.folders : []) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    const path = str(f.path).trim();
    const id = path.toLowerCase();
    if (!path || foldersSeen.has(id)) continue;
    foldersSeen.add(id);
    folders.push({ path, addedAt: num(f.addedAt, now) });
  }
  const collections: CatalogCollection[] = [];
  const collectionSeen = new Set<string>();
  for (const raw of Array.isArray(o.collections) ? o.collections : []) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const id = str(c.id).trim();
    const name = str(c.name).trim();
    if (!id || !name || collectionSeen.has(id)) continue;
    collectionSeen.add(id);
    const paths = Array.isArray(c.paths)
      ? [...new Set(c.paths.filter((p): p is string => typeof p === 'string').map((p) => p.toLowerCase()))]
      : [];
    collections.push({ id, name, paths, createdAt: num(c.createdAt, now) });
  }
  const smartCollections: SmartCollection[] = [];
  const smartSeen = new Set<string>();
  for (const raw of Array.isArray(o.smartCollections) ? o.smartCollections : []) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const id = str(c.id).trim();
    const name = str(c.name).trim();
    if (!id || !name || smartSeen.has(id)) continue;
    smartSeen.add(id);
    smartCollections.push({ id, name, filters: normalizeFilters(c.filters), createdAt: num(c.createdAt, now) });
  }
  return {
    version: CATALOG_VERSION,
    folders,
    entries,
    collections,
    smartCollections,
    lastView: o.lastView === 'editor' ? 'editor' : 'library',
    lastSelection: typeof o.lastSelection === 'string' ? o.lastSelection : null,
    updatedAt: num(o.updatedAt, now),
  };
}

/** Wire form written by `store_write` (plain JSON). */
export function encodeCatalog(catalog: Catalog): unknown {
  return {
    version: CATALOG_VERSION,
    folders: catalog.folders,
    entries: catalog.entries,
    collections: catalog.collections,
    smartCollections: catalog.smartCollections,
    lastView: catalog.lastView,
    lastSelection: catalog.lastSelection,
    updatedAt: Date.now(),
  };
}

export interface ImportFile {
  path: string;
  name: string;
  size: number;
  mtime_ms: number;
}

/** Merge a folder's files into the catalog; returns the entries that were new. */
export function addImportedFiles(
  catalog: Catalog,
  folder: string,
  files: readonly ImportFile[],
  now = Date.now(),
): { catalog: Catalog; added: CatalogEntry[] } {
  const known = new Set(catalog.entries.map((e) => e.path.toLowerCase()));
  const added: CatalogEntry[] = [];
  const entries = [...catalog.entries];
  for (const file of files) {
    const id = file.path.toLowerCase();
    if (!file.path || known.has(id)) continue;
    known.add(id);
    const entry: CatalogEntry = {
      path: file.path,
      name: file.name || baseNameOf(file.path),
      folder: dirNameOf(file.path),
      size: Math.max(0, file.size),
      mtimeMs: Math.max(0, file.mtime_ms),
      importedAt: now,
      rating: 0,
      flag: 'none',
      keywords: [],
      edited: false,
      thumb: false,
      label: 'none',
      title: '',
      caption: '',
    };
    entries.push(entry);
    added.push(entry);
  }
  const folders = catalog.folders.some((f) => f.path.toLowerCase() === folder.toLowerCase())
    ? catalog.folders
    : [...catalog.folders, { path: folder, addedAt: now }];
  return { catalog: { ...catalog, entries, folders }, added };
}

export interface LibraryFilters {
  /** A folder path, or null for the whole catalog. */
  folder: string | null;
  /** Only this colour label; 'all' for any. */
  label: ColorLabel | 'all';
  /** Entries with at least this many stars; 0 means any. */
  ratingMin: Rating;
  /** Only this flag; 'all' for any. */
  flag: Flag | 'all';
  /** Only entries carrying this keyword, or null. */
  keyword: string | null;
  /** Only entries with an edit sidecar. */
  editedOnly: boolean;
  /** Case-insensitive substring of the file or folder name. */
  search: string;
  /** Restrict to a user collection (id), or null for the whole catalog. */
  collectionId: string | null;
  /** Restrict to a smart collection (id), or null. */
  smartId: string | null;
}

export const FILTERS_DEFAULT: LibraryFilters = {
  folder: null,
  label: 'all',
  ratingMin: 0,
  flag: 'all',
  keyword: null,
  editedOnly: false,
  search: '',
  collectionId: null,
  smartId: null,
};

/** Tolerant decode used for smart-collection presets and the persisted UI state. */
export function normalizeFilters(value: unknown): LibraryFilters {
  if (!value || typeof value !== 'object') return { ...FILTERS_DEFAULT };
  const o = value as Record<string, unknown>;
  return {
    folder: typeof o.folder === 'string' ? o.folder : null,
    label: LABELS.includes(o.label as ColorLabel) ? (o.label as ColorLabel) : 'all',
    ratingMin: clampRating(o.ratingMin),
    flag: o.flag === 'pick' || o.flag === 'reject' || o.flag === 'none' ? o.flag : 'all',
    keyword: typeof o.keyword === 'string' ? o.keyword : null,
    editedOnly: o.editedOnly === true,
    search: typeof o.search === 'string' ? o.search : '',
    collectionId: typeof o.collectionId === 'string' ? o.collectionId : null,
    smartId: typeof o.smartId === 'string' ? o.smartId : null,
  };
}

export function folderContains(folder: string, entryFolder: string): boolean {
  const f = folder.toLowerCase();
  const e = entryFolder.toLowerCase();
  return e === f || e.startsWith(f.endsWith('\\') || f.endsWith('/') ? f : `${f}\\`) || e.startsWith(f.endsWith('/') ? f : `${f}/`);
}

export function filterEntries(entries: readonly CatalogEntry[], filters: LibraryFilters): CatalogEntry[] {
  const needle = filters.search.trim().toLowerCase();
  return entries.filter((e) =>
    (!filters.folder || folderContains(filters.folder, e.folder))
    && (filters.label === 'all' || e.label === filters.label)
    && e.rating >= filters.ratingMin
    && (filters.flag === 'all' || e.flag === filters.flag)
    && (!filters.keyword || e.keywords.includes(filters.keyword))
    && (!filters.editedOnly || e.edited)
    && (!needle || e.name.toLowerCase().includes(needle) || e.folder.toLowerCase().includes(needle) || e.title.toLowerCase().includes(needle) || e.caption.toLowerCase().includes(needle)));
}

/**
 * The entries a view starts from: the catalog, a user collection, or the
 * saved filter preset of a smart collection. The grid then applies `filters`.
 */
export function sourceEntries(catalog: Catalog, filters: LibraryFilters): CatalogEntry[] {
  if (filters.smartId) {
    const smart = catalog.smartCollections.find((s) => s.id === filters.smartId);
    if (smart) {
      const preset = { ...normalizeFilters(smart.filters), collectionId: null, smartId: null };
      return filterEntries(catalog.entries, preset);
    }
  }
  if (filters.collectionId) {
    const collection = catalog.collections.find((c) => c.id === filters.collectionId);
    if (collection) {
      const wanted = new Set(collection.paths);
      return catalog.entries.filter((e) => wanted.has(e.path.toLowerCase()));
    }
  }
  return catalog.entries;
}

export type SortKey = 'imported' | 'name' | 'folder' | 'rating' | 'date';
export interface SortSetting { key: SortKey; descending: boolean }
export const SORT_DEFAULT: SortSetting = { key: 'date', descending: true };

export function sortEntries(entries: readonly CatalogEntry[], sort: SortSetting): CatalogEntry[] {
  const dir = sort.descending ? -1 : 1;
  const copy = [...entries];
  copy.sort((a, b) => {
    switch (sort.key) {
      case 'name': return dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'folder': return dir * (a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
      case 'rating': return dir * (a.rating - b.rating) || a.name.localeCompare(b.name);
      case 'imported': return dir * (a.importedAt - b.importedAt) || a.name.localeCompare(b.name);
      default: return dir * (a.mtimeMs - b.mtimeMs) || a.name.localeCompare(b.name);
    }
  });
  return copy;
}

export function folderGroups(entries: readonly CatalogEntry[]): { path: string; name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) map.set(e.folder, (map.get(e.folder) ?? 0) + 1);
  return [...map.entries()]
    .map(([path, count]) => ({ path, name: baseNameOf(path) || path, count }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function keywordGroups(entries: readonly CatalogEntry[]): { word: string; count: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) for (const k of e.keywords) map.set(k, (map.get(k) ?? 0) + 1);
  return [...map.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

/** Apply metadata to every selected entry; returns a new catalog. */
export function updateEntries(
  catalog: Catalog,
  paths: readonly string[],
  patch: { rating?: Rating; flag?: Flag; label?: ColorLabel; keywords?: string[]; thumb?: boolean; edited?: boolean; title?: string; caption?: string },
): Catalog {
  const targets = new Set(paths.map((p) => p.toLowerCase()));
  return {
    ...catalog,
    entries: catalog.entries.map((e) => (targets.has(e.path.toLowerCase()) ? { ...e, ...patch } : e)),
  };
}

/** Remove entries (never the originals), their collection memberships and empty folder rows. */
export function removeEntries(catalog: Catalog, paths: readonly string[]): Catalog {
  const targets = new Set(paths.map((p) => p.toLowerCase()));
  const entries = catalog.entries.filter((e) => !targets.has(e.path.toLowerCase()));
  const remaining = new Set(entries.map((e) => e.folder.toLowerCase()));
  const collections = catalog.collections.map((c) => ({ ...c, paths: c.paths.filter((p) => !targets.has(p)) }));
  return {
    ...catalog,
    entries,
    collections,
    folders: catalog.folders.filter((f) => remaining.has(f.path.toLowerCase())),
  };
}

const COLLECTION_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A short, human-readable id (col-…) for collections created in this session. */
function newCollectionId(prefix: string, taken: readonly string[]): string {
  const used = new Set(taken);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let id = `${prefix}-`;
    for (let i = 0; i < 8; i += 1) {
      id += COLLECTION_ID_CHARS[Math.floor(Math.random() * COLLECTION_ID_CHARS.length)];
    }
    if (!used.has(id)) return id;
  }
  return `${prefix}-${Date.now().toString(36)}`;
}

/** Create a collection holding the given entry paths (deduplicated). */
export function createCollection(
  catalog: Catalog,
  name: string,
  paths: readonly string[],
  now = Date.now(),
): { catalog: Catalog; collection: CatalogCollection | null } {
  const trimmed = name.trim();
  if (!trimmed) return { catalog, collection: null };
  const id = newCollectionId('col', catalog.collections.map((c) => c.id));
  const collection: CatalogCollection = {
    id,
    name: trimmed,
    paths: [...new Set(paths.map((p) => p.toLowerCase()))],
    createdAt: now,
  };
  return { catalog: { ...catalog, collections: [...catalog.collections, collection] }, collection };
}

export function renameCollection(catalog: Catalog, id: string, name: string): Catalog {
  const trimmed = name.trim();
  if (!trimmed) return catalog;
  return { ...catalog, collections: catalog.collections.map((c) => (c.id === id ? { ...c, name: trimmed } : c)) };
}

export function deleteCollection(catalog: Catalog, id: string): Catalog {
  return { ...catalog, collections: catalog.collections.filter((c) => c.id !== id) };
}

/** Add/remove entry paths from a user collection; `add=false` removes them. */
export function setCollectionMembership(
  catalog: Catalog,
  id: string,
  paths: readonly string[],
  add = true,
): Catalog {
  const wanted = new Set(paths.map((p) => p.toLowerCase()));
  return {
    ...catalog,
    collections: catalog.collections.map((c) => {
      if (c.id !== id) return c;
      const current = new Set(c.paths);
      if (add) {
        for (const p of wanted) current.add(p);
        return { ...c, paths: [...current] };
      }
      for (const p of wanted) current.delete(p);
      return { ...c, paths: [...current] };
    }),
  };
}

/** Save the current filter preset as a smart collection (collection/smart keys cleared). */
export function createSmartCollection(
  catalog: Catalog,
  name: string,
  filters: LibraryFilters,
  now = Date.now(),
): { catalog: Catalog; smart: SmartCollection | null } {
  const trimmed = name.trim();
  if (!trimmed) return { catalog, smart: null };
  const id = newCollectionId('smart', catalog.smartCollections.map((c) => c.id));
  const smart: SmartCollection = {
    id,
    name: trimmed,
    filters: { ...normalizeFilters(filters), collectionId: null, smartId: null },
    createdAt: now,
  };
  return { catalog: { ...catalog, smartCollections: [...catalog.smartCollections, smart] }, smart };
}

export function renameSmartCollection(catalog: Catalog, id: string, name: string): Catalog {
  const trimmed = name.trim();
  if (!trimmed) return catalog;
  return {
    ...catalog,
    smartCollections: catalog.smartCollections.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
  };
}

export function deleteSmartCollection(catalog: Catalog, id: string): Catalog {
  return { ...catalog, smartCollections: catalog.smartCollections.filter((c) => c.id !== id) };
}
