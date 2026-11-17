// library.ts — the persistent catalog behind the Library view.
//
// v1 keeps this deliberately small: the catalog is one JSON store entry
// (`Catalog/catalog.json`), previews are cached JPEGs the Rust side keeps in
// `Catalog/thumbs`, and every entry refers to the original file by absolute
// path. The originals are never copied, moved or modified.

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import {
  type Catalog,
  type CatalogEntry,
  type Flag,
  type LibraryFilters,
  type Rating,
  type SortSetting,
  CATALOG_STORE_AREA,
  CATALOG_STORE_NAME,
  FILTERS_DEFAULT,
  SORT_DEFAULT,
  addImportedFiles,
  decodeCatalog,
  emptyCatalog,
  encodeCatalog,
  filterEntries,
  folderContains,
  removeEntries,
  sortEntries,
  updateEntries,
} from '@shared/catalog';
import { type FileEntry, baseName, platform } from '../platform';
import { host } from '../host/client';
import { openPaths } from './session';

/** Long edge of the preview thumbnails the grid shows. */
const THUMB_EDGE = 512;
/** How many thumbnails are pulled from the host at once. */
const THUMB_CONCURRENCY = 3;

export interface LibraryState {
  catalog: Catalog;
  /** Entry path → data URL of the cached preview. */
  thumbs: Record<string, string>;
  filters: LibraryFilters;
  sort: SortSetting;
  /** Selected entry paths, in click order. */
  selection: string[];
  /** Last clicked path: target of Shift ranges and of the keyboard commands. */
  anchor: string | null;
  /** Non-null while an import runs; the value is a human-readable status. */
  busy: string | null;
  progress: { done: number; total: number } | null;
  ready: boolean;
  /** The Library overlay replaces the editor until the user opens a photo. */
  open: boolean;
  /** A one-shot error for the UI to surface. */
  error: string | null;
}

const initial = (): LibraryState => ({
  catalog: emptyCatalog(),
  thumbs: {},
  filters: FILTERS_DEFAULT,
  sort: SORT_DEFAULT,
  selection: [],
  anchor: null,
  busy: null,
  progress: null,
  ready: false,
  open: false,
  error: null,
});

export const libraryStore = createStore<LibraryState>(() => initial());

export function useLibrary<T>(selector: (s: LibraryState) => T): T {
  return useStore(libraryStore, selector);
}

function set(patch: Partial<LibraryState>) {
  libraryStore.setState(patch);
}

function store() {
  return libraryStore.getState();
}

/** Persist the catalog; failures are surfaced but never fatal. */
let saveQueue: Promise<void> = Promise.resolve();
function persist() {
  const catalog = store().catalog;
  saveQueue = saveQueue
    .then(() => platform().storeWrite(CATALOG_STORE_AREA, CATALOG_STORE_NAME, encodeCatalog(catalog)))
    .catch((e: unknown) => set({ error: `Could not save the catalog: ${String(e)}` }));
  return saveQueue;
}

function bytesToDataUrl(bytes: Uint8Array, mime = 'image/jpeg'): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}

function base64ToDataUrl(base64: string): string {
  return `data:image/jpeg;base64,${base64}`;
}

/** Encode the RGBA preview to a JPEG so the thumb store stays small. */
async function toJpeg(image: { width: number; height: number; data: Uint8Array }): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const pixels = new Uint8ClampedArray(image.data.length);
  pixels.set(image.data);
  ctx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/** Pull one camera-embedded preview through the host and cache it as a JPEG. */
async function readThumb(entry: CatalogEntry, thumbs: Record<string, string>): Promise<boolean> {
  const preview = await host().thumbnail(entry.path, THUMB_EDGE, true);
  const jpeg = await toJpeg(preview);
  if (!jpeg) return false;
  await platform().catalogThumbSave(entry.path, jpeg).catch(() => '');
  thumbs[entry.path] = bytesToDataUrl(jpeg);
  return true;
}

let hydrating = false;

/**
 * Fill in previews for catalog entries that were registered by the normal
 * open path (or whose preview failed earlier). Runs in the background while
 * the Library is on screen and stops as soon as it closes; the host is
 * single-threaded, so a couple at a time keeps the editor responsive.
 */
export function hydrateThumbs(): void {
  if (hydrating) return;
  const missing = store().catalog.entries.filter((e) => !e.thumb && !store().thumbs[e.path]);
  if (missing.length === 0) return;
  hydrating = true;
  void (async () => {
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        const entry = missing[index];
        if (!entry || !store().open) return;
        try {
          const thumbs = { ...store().thumbs };
          if (await readThumb(entry, thumbs)) {
            set({
              thumbs,
              catalog: {
                ...store().catalog,
                entries: store().catalog.entries.map((e) => (e.path === entry.path ? { ...e, thumb: true } : e)),
              },
            });
          }
        } catch {
          // Files the host cannot preview keep their placeholder.
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(2, missing.length) }, () => worker()));
      await persist();
    } finally {
      hydrating = false;
    }
  })();
}

/** Load the catalog and whatever thumbnails were cached last session. */
export async function bootLibrary(): Promise<void> {
  const decoded = decodeCatalog(await platform().storeRead(CATALOG_STORE_AREA, CATALOG_STORE_NAME).catch(() => null));
  const thumbs: Record<string, string> = {};
  await Promise.all(decoded.entries.filter((e) => e.thumb).map(async (entry) => {
    const base64 = await platform().catalogThumbRead(entry.path).catch(() => null);
    if (base64) thumbs[entry.path] = base64ToDataUrl(base64);
  }));
  set({ catalog: decoded, thumbs, ready: true, open: decoded.entries.length > 0 });
  if (decoded.entries.length > 0) hydrateThumbs();
}

/** Import the given files or folders (folders are expanded by the platform). */
export async function importPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  set({ busy: 'Importing…', progress: null, error: null });
  try {
    const files = await platform().expandPaths(paths);
    if (files.length === 0) {
      set({ busy: null, error: 'No photographs found in the selected path.' });
      return;
    }
    const first = files[0];
    if (!first) return;
    const folder = first.path.replace(/[\\/][^\\/]+$/, '');
    const before = store().catalog;
    const { catalog, added } = addImportedFiles(before, folder, files);
    const thumbs = { ...store().thumbs };
    set({ catalog, thumbs, busy: `Reading previews (0/${added.length})…`, progress: { done: 0, total: added.length } });
    let done = 0;
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= added.length) return;
        const entry = added[index];
        if (!entry) return;
        try {
          const ok = await readThumb(entry, thumbs);
          catalog.entries = catalog.entries.map((e) => (e.path === entry.path ? { ...e, thumb: ok } : e));
          set({ thumbs: { ...thumbs }, catalog: { ...catalog, entries: [...catalog.entries] } });
        } catch {
          // A file the host cannot preview stays in the catalog without a thumb.
        } finally {
          done += 1;
          set({ busy: `Reading previews (${done}/${added.length})…`, progress: { done, total: added.length } });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(THUMB_CONCURRENCY, added.length) }, () => worker()));
    const lastAdded = added.length > 0 ? added[added.length - 1] : null;
    set({ busy: null, progress: null, selection: lastAdded ? [lastAdded.path] : store().selection, anchor: lastAdded ? lastAdded.path : store().anchor });
    await persist();
    hydrateThumbs();
  } catch (e) {
    set({ busy: null, error: `Import failed: ${String(e)}` });
  }
}

/** Remove the selection from the catalog (originals are not touched). */
export async function removeFromCatalog(paths: string[] = store().selection): Promise<void> {
  if (paths.length === 0) return;
  for (const path of paths) {
    await platform().catalogThumbRemove(path).catch(() => undefined);
  }
  const thumbs = { ...store().thumbs };
  for (const path of paths) delete thumbs[path];
  set({ catalog: removeEntries(store().catalog, paths), thumbs, selection: [], anchor: null });
  await persist();
}

export async function setRating(rating: Rating, paths: string[] = store().selection): Promise<void> {
  if (paths.length === 0) return;
  set({ catalog: updateEntries(store().catalog, paths, { rating }) });
  await persist();
}

export async function setFlag(flag: Flag, paths: string[] = store().selection): Promise<void> {
  if (paths.length === 0) return;
  set({ catalog: updateEntries(store().catalog, paths, { flag }) });
  await persist();
}

export async function toggleKeyword(keyword: string, paths: string[] = store().selection): Promise<void> {
  const word = keyword.trim();
  if (!word || paths.length === 0) return;
  const targets = new Set(paths);
  const catalog = store().catalog;
  const entries = catalog.entries.map((e) => {
    if (!targets.has(e.path)) return e;
    const has = e.keywords.includes(word);
    return { ...e, keywords: has ? e.keywords.filter((k) => k !== word) : [...e.keywords, word] };
  });
  set({ catalog: { ...catalog, entries } });
  await persist();
}

export async function markEdited(paths: string[] = store().selection): Promise<void> {
  if (paths.length === 0) return;
  set({ catalog: updateEntries(store().catalog, paths, { edited: true }) });
  await persist();
}

/** Refresh the `edited` badge from the sidecar store (cheap, one read per entry). */
export async function refreshEditedBadges(): Promise<void> {
  const catalog = store().catalog;
  const entries = await Promise.all(catalog.entries.map(async (e) => {
    if (e.edited) return e;
    const sidecar = await platform().sidecarLoad(e.path).catch(() => null);
    return sidecar ? { ...e, edited: true } : e;
  }));
  if (entries.some((e, i) => e.edited !== (catalog.entries[i]?.edited ?? e.edited))) {
    set({ catalog: { ...catalog, entries } });
  }
}

export function selectOnly(path: string) {
  set({ selection: [path], anchor: path });
}

export function selectRange(path: string) {
  const s = store();
  const visible = visibleEntries();
  const anchor = s.anchor ?? visible[0]?.path ?? path;
  const from = visible.findIndex((e) => e.path === anchor);
  const to = visible.findIndex((e) => e.path === path);
  if (from < 0 || to < 0) {
    selectOnly(path);
    return;
  }
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  set({ selection: visible.slice(lo, hi + 1).map((e) => e.path) });
}

export function toggleSelection(path: string) {
  const s = store();
  const has = s.selection.includes(path);
  set({ selection: has ? s.selection.filter((p) => p !== path) : [...s.selection, path], anchor: path });
}

export function selectAll() {
  set({ selection: visibleEntries().map((e) => e.path) });
}

export function clearSelection() {
  set({ selection: [], anchor: null });
}

export function setFilters(patch: Partial<LibraryFilters>) {
  set({ filters: { ...store().filters, ...patch } });
}

export function setSort(sort: SortSetting) {
  set({ sort });
}

/** Entries after filtering + sorting; the grid, ranges and Select All use it. */
export function visibleEntries(): CatalogEntry[] {
  const s = store();
  return sortEntries(filterEntries(s.catalog.entries, s.filters), s.sort);
}

export function setLibraryOpen(open: boolean) {
  set({ open });
  if (open) hydrateThumbs();
}

/**
 * Remember photos opened through the normal open path (folder picker, drop,
 * launch) so they show up in the library without importing them again. The
 * entry is registered immediately; previews are filled in when the library is
 * next opened.
 */
export async function registerOpened(files: FileEntry[], folder: string): Promise<void> {
  if (files.length === 0) return;
  const { catalog, added } = addImportedFiles(store().catalog, folder, files);
  if (added.length === 0) return;
  set({ catalog });
  await persist();
  if (store().open) hydrateThumbs();
}

/** Open the selection in the editor and leave the library. */
export async function openSelection(paths: string[] = store().selection): Promise<void> {
  if (paths.length === 0) return;
  set({ open: false });
  await openPaths(paths);
}

export function clearError() {
  set({ error: null });
}

/** True when `folder` is or contains `entryFolder` (used by the folder tree). */
export function inFolder(folder: string, entryFolder: string): boolean {
  return folderContains(folder, entryFolder);
}

export function entryName(entry: CatalogEntry): string {
  return entry.name || baseName(entry.path);
}
