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
  type ColorLabel,
  type Flag,
  type LibraryFilters,
  type Rating,
  type SortSetting,
  CATALOG_STORE_AREA,
  CATALOG_STORE_NAME,
  FILTERS_DEFAULT,
  SORT_DEFAULT,
  addImportedFiles,
  createCollection,
  createSmartCollection,
  decodeCatalog,
  deleteCollection,
  deleteSmartCollection,
  emptyCatalog,
  encodeCatalog,
  filterEntries,
  folderContains,
  removeEntries,
  renameEntry,
  renameCollection,
  renameSmartCollection,
  setCollectionMembership,
  sortEntries,
  sourceEntries,
  updateEntries,
} from '@shared/catalog';
import { type FileEntry, baseName, joinPath, platform } from '../platform';
import { displayImage, host } from '../host/client';
import type { RgbaImage } from '../host/client';
import type { ImageInfo, ProbeResult } from '@shared/protocol';
import type { Transport } from '../host/transport';
import { POOL_MAX_WORKERS, poolAvailable, poolEnsure, poolShutdown, poolTransport } from '../host/pool';
import { openCollection } from './session';
import { thumbs } from './thumbs';
import { matchesImportFormat, type ImportFormat } from '@shared/fileTypes';
import { isRawPath } from '@shared/whiteBalance';
import { tz } from '../i18n';

/** Long edge of the preview thumbnails the grid shows. */
const THUMB_EDGE = 512;
/** How many thumbnails are pulled from the host at once. */
const THUMB_CONCURRENCY = 3;
/** Folder imports at least this big use the render pool for previews. */
const IMPORT_POOL_MIN = 8;

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
  importOpen: boolean;
  /** A one-shot error for the UI to surface. */
  error: string | null;
  /** Imported paths whose camera preview could not be read; retryable. */
  failures: string[];
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
  importOpen: false,
  error: null,
  failures: [],
});

export const libraryStore = createStore<LibraryState>(() => initial());

// Filmstrip thumbnails prefer the JPEG the catalog cached on import; the host
// is only asked for frames the library has never seen.
thumbs.setFallback((path) => libraryStore.getState().thumbs[path] ?? null);

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

/** Read the embedded preview for RAW or a resized image for raster files. */
async function readThumb(
  entry: CatalogEntry, transport: Pick<Transport, 'request'> | null = null,
): Promise<string | null> {
  const embeddedOnly = isRawPath(entry.path);
  let preview: RgbaImage;
  if (transport) {
    // A pool worker answers `thumbnail` without owning a session.
    const reply = await transport.request('thumbnail',
      { path: entry.path, long_edge: THUMB_EDGE, ...(embeddedOnly ? { embedded_only: true } : {}) }, { timeoutMs: 60_000 });
    preview = displayImage((reply.result as { image: ImageInfo }).image, reply.payload);
  } else {
    preview = await host().thumbnail(entry.path, THUMB_EDGE, embeddedOnly);
  }
  const jpeg = await toJpeg(preview);
  if (!jpeg) return null;
  await platform().catalogThumbSave(entry.path, jpeg).catch(() => '');
  return bytesToDataUrl(jpeg);
}

/** Read one file's EXIF capture time through the same transport as its preview.
 *  A file the host cannot probe keeps no `capturedAt`; sorting falls back to mtime. */
async function readCapturedAt(transport: Pick<Transport, 'request'> | null, path: string): Promise<string | null> {
  try {
    const reply = transport
      ? await transport.request('probe', { path }, { timeoutMs: 30_000 })
      : await host().transport.request('probe', { path }, { timeoutMs: 30_000 });
    const metadata = (reply.result as unknown as ProbeResult).metadata;
    const raw = metadata?.datetime_original;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

function recordPreview(path: string, url: string | null, capturedAt?: string | null) {
  const { catalog, thumbs } = store();
  if (!catalog.entries.some((entry) => entry.path === path)) return;
  set({
    ...(url && { thumbs: { ...thumbs, [path]: url } }),
    catalog: { ...catalog, entries: catalog.entries.map((entry) => entry.path === path
      ? { ...entry, ...(url && { thumb: true }), ...(capturedAt && { capturedAt }) } : entry) },
  });
}

let hydrating = false;
let importing = false;
/** Set by cancelImport(); the worker loops check it between previews. */
let importCancelled = false;

/**
 * Fill in previews for catalog entries that were registered by the normal
 * open path (or whose preview failed earlier). Runs in the background while
 * the Library is on screen and stops as soon as it closes; the host is
 * single-threaded, so a couple at a time keeps the editor responsive.
 */
export function hydrateThumbs(skip?: ReadonlySet<string>): void {
  if (hydrating || importing || !store().open) return;
  const missing = store().catalog.entries.filter((e) => !store().thumbs[e.path] && !skip?.has(e.path));
  if (missing.length === 0) return;
  hydrating = true;
  void (async () => {
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        const entry = missing[index];
        if (!entry || !store().open || importing) return;
        if (store().thumbs[entry.path]) continue;
        try {
          const url = await readThumb(entry);
          if (url) recordPreview(entry.path, url);
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

/** Ask a running import to stop after the preview it is reading. Files stay
 * in the catalog; hydrateThumbs() fills the rest when the library opens. */
export function cancelImport(): void {
  importCancelled = true;
}

/** Import the given files or folders (folders are expanded by the platform). */
export async function importPaths(paths: string[], format: ImportFormat = 'all'): Promise<void> {
  if (paths.length === 0 || importing) return;
  importing = true;
  const attempted = new Set<string>();
  importCancelled = false;
  set({ busy: tz('Importing…', '正在导入…'), progress: null, error: null, failures: [] });
  let poolWorkers = 0;
  try {
    const files = (await platform().expandPaths(paths)).filter((file) => matchesImportFormat(file.path, format));
    if (files.length === 0) {
      set({ error: format === 'all' ? tz('No supported photos found.', '所选位置没有支持的照片。')
        : tz(`No ${format.toUpperCase()} photos found.`, `所选位置没有 ${format.toUpperCase()} 照片。`) });
      return;
    }
    const first = files[0];
    if (!first) return;
    const folder = first.path.replace(/[\\/][^\\/]+$/, '');
    const before = store().catalog;
    const { catalog, added } = addImportedFiles(before, folder, files);
    const requested = new Set(files.map((file) => file.path.toLowerCase()));
    const pending = catalog.entries.filter((entry) => requested.has(entry.path.toLowerCase()) && !store().thumbs[entry.path]);
    const total = pending.length;
    const progressText = (done: number) => tz(`Reading previews (${done}/${total})…`, `正在读取预览（${done}/${total}）…`);
    set({ catalog, busy: progressText(0), progress: { done: 0, total } });
    const wantPool = total >= IMPORT_POOL_MIN && poolAvailable();
    if (wantPool) {
      try {
        poolWorkers = (await poolEnsure(Math.min(POOL_MAX_WORKERS, Math.max(2, Math.ceil(total / 40))))).workers;
        platform().log('info', `thumbnail pool: ${poolWorkers} worker(s) for ${total} preview(s)`);
      } catch (e) {
        platform().log('warn', `thumbnail pool unavailable: ${String(e)}`);
        poolWorkers = 0;
      }
    }
    const workers = poolWorkers > 1 ? poolWorkers : Math.min(THUMB_CONCURRENCY, total);
    let done = 0;
    let next = 0;
    const failures: string[] = [];
    const worker = async (lane: number) => {
      const transport = poolWorkers > 1 ? poolTransport(lane % poolWorkers) : null;
      for (;;) {
        if (importCancelled) return;
        const index = next++;
        if (index >= total) return;
        const entry = pending[index];
        if (!entry) return;
        attempted.add(entry.path);
        try {
          const url = await readThumb(entry, transport);
          const capturedAt = await readCapturedAt(transport, entry.path);
          recordPreview(entry.path, url, capturedAt);
          if (!url) failures.push(entry.path);
        } catch {
          // A file the host cannot preview stays in the catalog without a thumb.
          failures.push(entry.path);
        } finally {
          done += 1;
          set({ busy: progressText(done), progress: { done, total } });
        }
      }
    };
    await Promise.all(Array.from({ length: workers }, (_v, lane) => worker(lane)));
    const lastAdded = added.length > 0 ? added[added.length - 1] : null;
    set({
      failures: [...new Set(failures)],
      selection: lastAdded ? [lastAdded.path] : store().selection,
      anchor: lastAdded ? lastAdded.path : store().anchor,
      ...(importCancelled ? { error: 'Import stopped; the remaining previews load when the folder is opened.' } : {}),
    });
    await persist();
  } catch (e) {
    set({ error: `Import failed: ${String(e)}` });
  } finally {
    if (poolWorkers > 1) {
      await poolShutdown().catch((e) => platform().log('error', `thumbnail pool shutdown: ${String(e)}`));
    }
    importing = false;
    set({ busy: null, progress: null });
    if (!importCancelled && attempted.size) hydrateThumbs(attempted);
    importCancelled = false;
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


/** Rename one photograph on disk; the catalog, sidecar and preview follow it. */
export async function renameEntryFile(path: string, newName: string): Promise<void> {
  const name = newName.trim();
  if (!name) return;
  if (/[\\/:*?"<>|]/.test(name)) {
    set({ error: 'File names cannot contain \\ / : * ? " < > |.' });
    return;
  }
  const entry = store().catalog.entries.find((e) => e.path === path);
  if (!entry) {
    set({ error: 'This photograph is not in the catalog.' });
    return;
  }
  // Renaming the open frame would leave the editor writing to the old path.
  const session = await import('./session');
  if (session.sessionStore.getState().selection === path) {
    set({ error: 'Close the photograph in Develop before renaming it.' });
    return;
  }
  const extension = entry.name.match(/\.[^.]+$/)?.[0] ?? '';
  let target = joinPath(entry.folder, name);
  if (extension && !target.toLowerCase().endsWith(extension.toLowerCase())) target += extension;
  if (target.toLowerCase() === path.toLowerCase()) return;
  set({ error: null });
  try {
    await platform().renameImage(path, target);
  } catch (e) {
    set({ error: `Could not rename: ${String(e)}` });
    return;
  }
  // The preview store is keyed by path, so move it with the file.
  const dataUrl = store().thumbs[path];
  if (dataUrl) {
    try {
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      await platform().catalogThumbSave(target, bytes);
      await platform().catalogThumbRemove(path).catch(() => undefined);
    } catch {
      // A missing preview is recoverable: hydration regenerates it.
    }
  }
  const thumbs = { ...store().thumbs };
  delete thumbs[path];
  if (dataUrl) thumbs[target] = dataUrl;
  const selection = store().selection.map((p) => (p === path ? target : p));
  const anchor = store().anchor === path ? target : store().anchor;
  set({ catalog: renameEntry(store().catalog, path, target), thumbs, selection, anchor });
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
  const pending = store().catalog.entries.filter((entry) => !entry.edited);
  const paths = await Promise.all(pending.map(async ({ path }) =>
    await platform().sidecarLoad(path).catch(() => null) ? path : null));
  const edited = paths.filter((path): path is string => path !== null);
  if (edited.length) set({ catalog: updateEntries(store().catalog, edited, { edited: true }) });
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
  return sortEntries(filterEntries(sourceEntries(s.catalog, s.filters), s.filters), s.sort);
}

/** Show the whole catalog (clears folder, collection and smart-collection scopes). */
export function showAllPhotographs() {
  set({ filters: { ...store().filters, folder: null, collectionId: null, smartId: null } });
}

export function showFolder(folder: string | null) {
  set({ filters: { ...store().filters, folder, collectionId: null, smartId: null } });
}

export function showCollection(id: string) {
  set({ filters: { ...store().filters, collectionId: id, smartId: null, folder: null } });
}

export function showSmartCollection(id: string) {
  set({ filters: { ...store().filters, smartId: id, collectionId: null, folder: null } });
}

export async function setColorLabel(label: ColorLabel, paths: string[] = store().selection): Promise<void> {
  if (paths.length === 0) return;
  set({ catalog: updateEntries(store().catalog, paths, { label }) });
  await persist();
}

/** Edit title/caption/keywords for one entry (metadata panel). */
export async function setEntryMetadata(
  path: string,
  patch: { title?: string; caption?: string; keywords?: string[] },
): Promise<void> {
  const entry = store().catalog.entries.find((e) => e.path === path);
  if (!entry) return;
  const keywords = patch.keywords
    ? [...new Set(patch.keywords.map((k) => k.trim()).filter(Boolean))]
    : entry.keywords;
  set({ catalog: updateEntries(store().catalog, [path], { ...patch, keywords }) });
  await persist();
}

export async function createCollectionFromSelection(name: string, paths: string[] = store().selection): Promise<void> {
  if (paths.length === 0) return;
  const { catalog, collection } = createCollection(store().catalog, name, paths);
  if (!collection) return;
  set({ catalog, filters: { ...store().filters, collectionId: collection.id, smartId: null, folder: null } });
  await persist();
}

export async function deleteCollectionById(id: string): Promise<void> {
  const filters = store().filters.collectionId === id ? { ...store().filters, collectionId: null } : store().filters;
  set({ catalog: deleteCollection(store().catalog, id), filters });
  await persist();
}

export async function renameCollectionById(id: string, name: string): Promise<void> {
  set({ catalog: renameCollection(store().catalog, id, name) });
  await persist();
}

export async function addSelectionToCollection(id: string, paths: string[] = store().selection): Promise<void> {
  if (paths.length === 0) return;
  set({ catalog: setCollectionMembership(store().catalog, id, paths, true) });
  await persist();
}

export async function removeSelectionFromCollection(id: string, paths: string[] = store().selection): Promise<void> {
  if (paths.length === 0) return;
  set({ catalog: setCollectionMembership(store().catalog, id, paths, false) });
  await persist();
}

export async function createSmartCollectionFromFilters(name: string): Promise<void> {
  const { catalog, smart } = createSmartCollection(store().catalog, name, store().filters);
  if (!smart) return;
  set({ catalog, filters: { ...store().filters, smartId: smart.id, collectionId: null, folder: null } });
  await persist();
}

export async function deleteSmartCollectionById(id: string): Promise<void> {
  const filters = store().filters.smartId === id ? { ...store().filters, smartId: null } : store().filters;
  set({ catalog: deleteSmartCollection(store().catalog, id), filters });
  await persist();
}

export async function renameSmartCollectionById(id: string, name: string): Promise<void> {
  set({ catalog: renameSmartCollection(store().catalog, id, name) });
  await persist();
}

/**
 * Copy the develop settings (the per-image sidecar) of the last-selected
 * photograph onto every other selected photograph — the batch workflow.
 */
export async function syncDevelopSettings(paths: string[] = store().selection): Promise<void> {
  if (paths.length < 2) return;
  const source = paths[paths.length - 1];
  if (!source) return;
  const sidecar = await platform().sidecarLoad(source).catch(() => null);
  if (!sidecar) {
    set({ error: 'The anchor photograph has no saved edits to sync.' });
    return;
  }
  set({ busy: `Syncing settings (0/${paths.length - 1})…` });
  let done = 0;
  for (const path of paths.slice(0, -1)) {
    if (path === source) continue;
    try {
      await platform().sidecarSave(path, sidecar);
      done += 1;
      set({ busy: `Syncing settings (${done}/${paths.length - 1})…` });
    } catch {
      // A sidecar that cannot be written leaves the photograph unchanged.
    }
  }
  set({ busy: null, catalog: updateEntries(store().catalog, paths.slice(0, -1), { edited: true }) });
  await persist();
}

export function setImportOpen(importOpen: boolean) {
  set({ importOpen, ...(importOpen && { open: true, error: null }) });
}

export function setLibraryOpen(open: boolean) {
  set({ open, ...(!open && { importOpen: false }) });
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

/**
 * Open the selection in the editor and leave the library. The editor's
 * filmstrip is filled with the whole visible (filtered/sorted) catalog page,
 * with `focusPath` (the clicked photo) open, so browsing continues there.
 */
export async function openSelection(paths: string[] = store().selection, focusPath?: string): Promise<void> {
  if (paths.length === 0) return;
  const wanted = new Set(paths);
  const visible = visibleEntries();
  const collection = visible.length > 0 ? visible : store().catalog.entries.filter((e) => wanted.has(e.path));
  if (collection.length === 0) return;
  const focus = focusPath ?? store().anchor ?? paths[paths.length - 1]!;
  const folder = (collection.find((e) => e.path === focus) ?? collection[0]!).folder;
  const files: FileEntry[] = collection.map((e) => ({ path: e.path, name: e.name, size: e.size, mtime_ms: e.mtimeMs }));
  const browsable = new Set(collection.map((e) => e.path));
  const picked = paths.filter((path) => browsable.has(path));
  const active = picked.includes(focus) ? focus : picked[picked.length - 1];
  if (!active) return;
  set({ open: false, selection: picked, anchor: active });
  await openCollection(folder, files, active, picked);
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
