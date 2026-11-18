// LibraryView.tsx — the persistent catalog browser (the library grid).
//
// The originals stay where the user keeps them; this window only reads the
// catalog and the preview thumbnails. Double-clicking a photograph opens it in
// the editor exactly like File › Open, with the visible page in the filmstrip.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { tz } from '../i18n';
import { Import } from '../controls/icons';
import { baseName, platform } from '../platform';
import { useSession } from '../state/session';
import { settingsStore, useSettings } from '../state/settings';
import {
  addSelectionToCollection,
  clearError,
  clearSelection,
  createCollectionFromSelection,
  createSmartCollectionFromFilters,
  deleteCollectionById,
  deleteSmartCollectionById,
  cancelImport,
  importPaths,
  openSelection,
  refreshEditedBadges,
  removeFromCatalog,
  removeSelectionFromCollection,
  renameEntryFile,
  renameCollectionById,
  renameSmartCollectionById,
  selectAll,
  selectOnly,
  selectRange,
  setColorLabel,
  setEntryMetadata,
  setFlag,
  setFilters,
  setLibraryOpen,
  setRating,
  setSort,
  showAllPhotographs,
  showCollection,
  showFolder,
  showSmartCollection,
  syncDevelopSettings,
  toggleSelection,
  useLibrary,
  visibleEntries,
} from '../state/library';
import {
  folderGroups,
  keywordGroups,
  type CatalogEntry,
  type ColorLabel,
  type Flag,
  type LibraryFilters,
  type Rating,
} from '@shared/catalog';
import './library.css';

const RATING_OPTIONS: Rating[] = [0, 1, 2, 3, 4, 5];
const LABELS: { value: ColorLabel; en: string; zh: string }[] = [
  { value: 'none', en: 'None', zh: '无' },
  { value: 'red', en: 'Red', zh: '红' },
  { value: 'yellow', en: 'Yellow', zh: '黄' },
  { value: 'green', en: 'Green', zh: '绿' },
  { value: 'blue', en: 'Blue', zh: '蓝' },
  { value: 'purple', en: 'Purple', zh: '紫' },
];

function Stars({ rating }: { rating: number }) {
  return <span className="library-stars" aria-label={`${rating} stars`}>{'★'.repeat(rating)}<span className="library-stars-empty">{'★'.repeat(5 - rating)}</span></span>;
}

function labelColor(value: ColorLabel | 'all'): string {
  switch (value) {
    case 'red': return '#d9534f';
    case 'yellow': return '#e0b13a';
    case 'green': return '#5aa469';
    case 'blue': return '#5b8dd9';
    case 'purple': return '#9a72c8';
    default: return 'transparent';
  }
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '—';
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function formatDate(ms: number): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

/** The metadata side panel: file facts plus catalogue metadata for the selection. */
function MetadataPanel({ entries, selection }: { entries: CatalogEntry[]; selection: string[] }) {
  const selected = useMemo(() => {
    const wanted = new Set(selection);
    return entries.filter((e) => wanted.has(e.path));
  }, [entries, selection]);
  const single = selected.length === 1 ? selected[0]! : null;
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [keyword, setKeyword] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState('');

  useEffect(() => {
    setTitle(single?.title ?? '');
    setCaption(single?.caption ?? '');
    setKeyword('');
  }, [single?.path, single?.title, single?.caption]);

  const saveTitle = () => {
    if (single && title !== single.title) void setEntryMetadata(single.path, { title });
  };
  const saveCaption = () => {
    if (single && caption !== single.caption) void setEntryMetadata(single.path, { caption });
  };
  const addKeyword = () => {
    const word = keyword.trim();
    if (!single || !word || single.keywords.includes(word)) {
      setKeyword('');
      return;
    }
    void setEntryMetadata(single.path, { keywords: [...single.keywords, word] });
    setKeyword('');
  };

  if (selected.length === 0) {
    return (
      <aside className="library-meta" data-testid="library-meta">
        <div className="library-meta-empty">{tz('Select a photograph to see its metadata.', '选择一张照片查看元数据。')}</div>
      </aside>
    );
  }

  if (!single) {
    return (
      <aside className="library-meta" data-testid="library-meta">
        <div className="library-meta-title">{selected.length} {tz('photographs selected', '张照片已选')}</div>
        <div className="library-meta-row">
          <span>{tz('Rating', '星级')}</span>
          <select
            value=""
            onChange={(e) => { if (e.target.value !== '') void setRating(Number(e.target.value) as Rating); }}
            data-testid="library-meta-rating"
          >
            <option value="">—</option>
            {RATING_OPTIONS.map((r) => <option key={r} value={r}>{r}★</option>)}
          </select>
        </div>
        <div className="library-meta-row">
          <span>{tz('Flag', '旗标')}</span>
          <select
            value=""
            onChange={(e) => { if (e.target.value) void setFlag(e.target.value as Flag); }}
            data-testid="library-meta-flag"
          >
            <option value="">—</option>
            <option value="pick">{tz('Pick', '留用')}</option>
            <option value="reject">{tz('Reject', '排除')}</option>
            <option value="none">{tz('None', '无')}</option>
          </select>
        </div>
        <div className="library-meta-row">
          <span>{tz('Label', '颜色')}</span>
          <select
            value=""
            onChange={(e) => { if (e.target.value) void setColorLabel(e.target.value as ColorLabel); }}
            data-testid="library-meta-label"
          >
            <option value="">—</option>
            {LABELS.map((l) => <option key={l.value} value={l.value}>{tz(l.en, l.zh)}</option>)}
          </select>
        </div>
        <button className="library-btn library-meta-wide" onClick={() => void syncDevelopSettings()} data-testid="library-sync">
          {tz('Sync Settings', '同步修改设置')}
        </button>
        <div className="library-meta-hint">{tz('Settings copy from the last-selected photograph.', '以最后选中的照片为准复制修改设置。')}</div>
      </aside>
    );
  }

  return (
    <aside className="library-meta" data-testid="library-meta">
      <div className="library-meta-title" title={single.path}>{single.name || baseName(single.path)}</div>
      <div className="library-meta-sub">{single.folder}</div>
      <div className="library-meta-facts">
        <div><span>{tz('Size', '大小')}</span><b>{formatBytes(single.size)}</b></div>
        <div><span>{tz('Modified', '修改时间')}</span><b>{formatDate(single.mtimeMs)}</b></div>
        <div><span>{tz('Imported', '导入时间')}</span><b>{formatDate(single.importedAt)}</b></div>
      </div>
      <button className="library-btn library-meta-wide" data-testid="library-rename" onClick={() => { setRenameName(single.name); setRenaming(true); }}>
        {tz('Rename on disk…', '重命名文件…')}
      </button>
      <div className="library-meta-hint">{tz('Renames the original file in place; sidecar edits and the preview follow it.', '就地重命名原文件；修改记录与预览会随文件迁移。')}</div>
      <label className="library-meta-field">
        {tz('Title', '标题')}
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); }} data-testid="library-meta-title" />
      </label>
      <label className="library-meta-field">
        {tz('Caption', '说明')}
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={saveCaption} rows={3} data-testid="library-meta-caption" />
      </label>
      <div className="library-meta-field">
        {tz('Keywords', '关键字')}
        <div className="library-keywords">
          {single.keywords.length === 0 && <span className="library-meta-hint">{tz('None', '无')}</span>}
          {single.keywords.map((word) => (
            <button
              key={word}
              className="library-keyword"
              title={tz('Remove keyword', '移除关键字')}
              onClick={() => void setEntryMetadata(single.path, { keywords: single.keywords.filter((k) => k !== word) })}
            >
              {word} ✕
            </button>
          ))}
        </div>
        <div className="library-keyword-add">
          <input
            value={keyword}
            placeholder={tz('Add keyword…', '添加关键字…')}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addKeyword(); }}
            data-testid="library-meta-keyword"
          />
          <button className="library-btn" onClick={addKeyword}>＋</button>
        </div>
      </div>
      <div className="library-meta-row">
        <span>{tz('Rating', '星级')}</span>
        <select value={single.rating} onChange={(e) => void setRating(Number(e.target.value) as Rating, [single.path])} data-testid="library-meta-rating">
          {RATING_OPTIONS.map((r) => <option key={r} value={r}>{r === 0 ? tz('None', '无') : `${r}★`}</option>)}
        </select>
      </div>
      <div className="library-meta-row">
        <span>{tz('Flag', '旗标')}</span>
        <select value={single.flag} onChange={(e) => void setFlag(e.target.value as Flag, [single.path])} data-testid="library-meta-flag">
          <option value="none">{tz('None', '无')}</option>
          <option value="pick">{tz('Pick', '留用')}</option>
          <option value="reject">{tz('Reject', '排除')}</option>
        </select>
      </div>
      <div className="library-meta-row">
        <span>{tz('Label', '颜色')}</span>
        <select value={single.label} onChange={(e) => void setColorLabel(e.target.value as ColorLabel, [single.path])} data-testid="library-meta-label">
          {LABELS.map((l) => <option key={l.value} value={l.value}>{tz(l.en, l.zh)}</option>)}
        </select>
      </div>
      <button className="library-btn library-meta-wide" disabled={selection.length < 2} onClick={() => void syncDevelopSettings()} data-testid="library-sync">
        {tz('Sync Settings', '同步修改设置')}
      </button>
      {renaming && (
        <div className="library-modal-backdrop" data-testid="library-rename-dialog" onClick={() => setRenaming(false)}>
          <div className="library-modal" onClick={(e) => e.stopPropagation()}>
            <div className="library-modal-title">{tz('Rename photograph', '重命名照片')}</div>
            <div className="library-modal-body">
              <input
                className="library-rename-input"
                value={renameName}
                autoFocus
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { void renameEntryFile(single.path, renameName); setRenaming(false); } }}
                data-testid="library-rename-input"
              />
              <div className="library-meta-hint">{tz('The extension is kept when you leave it out.', '不写扩展名时沿用原扩展名。')}</div>
            </div>
            <div className="library-modal-actions">
              <button className="library-btn" onClick={() => setRenaming(false)}>{tz('Cancel', '取消')}</button>
              <button className="library-btn is-primary" data-testid="library-rename-confirm" onClick={() => { void renameEntryFile(single.path, renameName); setRenaming(false); }}>
                {tz('Rename', '重命名')}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

/** Import modal: choose folder or files, then show preview-generation progress. */
function ImportDialog({ onClose }: { onClose: () => void }) {
  const busy = useLibrary((s) => s.busy);
  const progress = useLibrary((s) => s.progress);
  const failures = useLibrary((s) => s.failures);
  const [kind, setKind] = useState<'folder' | 'files'>('folder');

  const start = async () => {
    const title = kind === 'folder' ? tz('Import Folder…', '导入文件夹…') : tz('Import Photos…', '导入照片…');
    const picked = kind === 'folder' ? await platform().pickFolder(title) : null;
    const paths = kind === 'folder' ? (picked ? [picked] : []) : await platform().pickFiles(title);
    if (paths.length === 0) return;
    await importPaths(paths);
    onClose();
  };

  return (
    <div className="library-modal-backdrop" data-testid="library-import-dialog" onClick={onClose}>
      <div className="library-modal" onClick={(e) => e.stopPropagation()}>
        <div className="library-modal-title">{tz('Import photographs', '导入照片')}</div>
        <div className="library-modal-body">
          <label className="library-radio">
            <input type="radio" checked={kind === 'folder'} onChange={() => setKind('folder')} />
            {tz('Folder (includes sub-folders)', '文件夹（含子文件夹）')}
          </label>
          <label className="library-radio">
            <input type="radio" checked={kind === 'files'} onChange={() => setKind('files')} />
            {tz('Individual photographs', '单张照片')}
          </label>
          <div className="library-meta-hint">
            {tz('Photos are referenced in place; originals are never copied or modified.', '照片按原位置引用，不会复制或修改原图。')}
          </div>
          {busy && (
            <div className="library-progress" data-testid="library-import-progress">
              <span>{busy}{progress ? ` ${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` : ''}</span>
              <button className="library-btn" onClick={() => cancelImport()} data-testid="library-import-stop">
                {tz('Stop', '停止')}
              </button>
            </div>
          )}
          {!busy && failures.length > 0 && (
            <div className="library-import-failures" data-testid="library-import-failures">
              <span>
                {tz(
                  `${failures.length} file(s) had no readable preview.`,
                  `${failures.length} 个文件没有可读的预览。`,
                )}
              </span>
              <button className="library-btn" onClick={() => void importPaths(failures)} data-testid="library-import-retry">
                {tz('Retry', '重试')}
              </button>
            </div>
          )}
        </div>
        <div className="library-modal-actions">
          <button className="library-btn" onClick={onClose}>{tz('Cancel', '取消')}</button>
          <button className="library-btn is-primary" onClick={() => void start()} data-testid="library-import-start">
            {tz('Choose…', '选择…')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LibraryView() {
  const catalog = useLibrary((s) => s.catalog);
  const thumbs = useLibrary((s) => s.thumbs);
  const filters = useLibrary((s) => s.filters);
  const sort = useLibrary((s) => s.sort);
  const selection = useLibrary((s) => s.selection);
  const busy = useLibrary((s) => s.busy);
  const progress = useLibrary((s) => s.progress);
  const error = useLibrary((s) => s.error);
  const editorHasPhoto = useSession((s) => !!s.selection);
  const thumbSize = useSettings((s) => s.libraryThumbSize);
  const gridRef = useRef<HTMLDivElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState<string | null>(null);
  const [smartDraft, setSmartDraft] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<{ kind: 'collection' | 'smart'; id: string; name: string } | null>(null);

  // Filtering/sorting live in the store; every render recomputes the visible page.
  const entries = visibleEntries();
  const selected = useMemo(() => new Set(selection), [selection]);
  const folders = useMemo(() => folderGroups(catalog.entries), [catalog.entries]);
  const keywords = useMemo(() => keywordGroups(catalog.entries), [catalog.entries]);
  const collections = useMemo(
    () => catalog.collections.map((c) => ({ ...c, count: catalog.entries.filter((e) => c.paths.includes(e.path.toLowerCase())).length })),
    [catalog.collections, catalog.entries],
  );
  const smartCollections = catalog.smartCollections;
  const currentFolder = filters.folder;
  const currentCollection = filters.collectionId;
  const currentSmart = filters.smartId;
  const inCollection = currentCollection ? catalog.collections.find((c) => c.id === currentCollection) : null;

  useEffect(() => {
    void refreshEditedBadges();
  }, []);

  // Keyboard: arrows move the selection, 1–5 rate, P/X/U flag, Delete removes
  // from the catalog, Enter opens, Esc returns to the editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const list = visibleEntries();
      const anchor = selection[selection.length - 1] ?? null;
      const index = anchor ? list.findIndex((e) => e.path === anchor) : -1;
      const move = (delta: number) => {
        if (list.length === 0) return;
        const next = Math.max(0, Math.min(list.length - 1, index < 0 ? 0 : index + delta));
        const nextEntry = list[next];
        if (!nextEntry) return;
        selectOnly(nextEntry.path);
        gridRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(nextEntry.path)}"]`)?.scrollIntoView({ block: 'nearest' });
      };
      if (event.key === 'Escape') {
        clearSelection();
        if (editorHasPhoto) setLibraryOpen(false);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(-1);
      else if (event.key === 'Enter') void openSelection(undefined, selection[selection.length - 1]);
      else if (/^[0-5]$/.test(event.key)) void setRating(Number(event.key) as Rating);
      else if (event.key === 'p' || event.key === 'P') void setFlag('pick');
      else if (event.key === 'x' || event.key === 'X') void setFlag('reject');
      else if (event.key === 'u' || event.key === 'U') void setFlag('none');
      else if (event.key === 'Delete' || event.key === 'Backspace') void removeFromCatalog();
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(); }
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, editorHasPhoto]);

  const onCellClick = (event: ReactMouseEvent, path: string) => {
    if (event.shiftKey) selectRange(path);
    else if (event.ctrlKey || event.metaKey) toggleSelection(path);
    else selectOnly(path);
  };

  const submitCollection = () => {
    const name = (collectionDraft ?? '').trim();
    setCollectionDraft(null);
    if (name) void createCollectionFromSelection(name);
  };

  const submitSmart = () => {
    const name = (smartDraft ?? '').trim();
    setSmartDraft(null);
    if (name) void createSmartCollectionFromFilters(name);
  };

  const commitRename = () => {
    const draft = renameDraft;
    setRenameDraft(null);
    const name = (draft?.name ?? '').trim();
    if (!draft || !name) return;
    if (draft.kind === 'collection') void renameCollectionById(draft.id, name);
    else void renameSmartCollectionById(draft.id, name);
  };

  const total = catalog.entries.length;
  return (
    <div className="library" data-testid="library">
      <div className="library-toolbar">
        <div className="library-modules">
          <button className="library-module is-active" data-testid="library-module-library">{tz('Library', '图库')}</button>
          <button className="library-module" disabled={!editorHasPhoto} onClick={() => setLibraryOpen(false)} data-testid="library-module-develop">
            {tz('Develop', '修改')}
          </button>
        </div>
        <button className="library-btn" onClick={() => setImportOpen(true)} data-testid="library-import">
          <Import /> {tz('Import…', '导入…')}
        </button>
        <input
          className="library-search"
          placeholder={tz('Search name, folder, title or caption', '搜索文件名、文件夹、标题或说明')}
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          data-testid="library-search"
        />
        <label className="library-filter">
          {tz('Stars', '星级')}
          <select value={filters.ratingMin} onChange={(e) => setFilters({ ratingMin: Number(e.target.value) as Rating })} data-testid="library-rating-filter">
            {RATING_OPTIONS.map((r) => <option key={r} value={r}>{r === 0 ? tz('Any', '不限') : `${r}★+`}</option>)}
          </select>
        </label>
        <label className="library-filter">
          {tz('Flag', '旗标')}
          <select value={filters.flag} onChange={(e) => setFilters({ flag: e.target.value as LibraryFilters['flag'] })} data-testid="library-flag-filter">
            <option value="all">{tz('All', '全部')}</option>
            <option value="pick">{tz('Picked', '留用')}</option>
            <option value="reject">{tz('Rejected', '排除')}</option>
            <option value="none">{tz('Unflagged', '未标')}</option>
          </select>
        </label>
        <label className="library-filter">
          {tz('Label', '颜色')}
          <select value={filters.label} onChange={(e) => setFilters({ label: e.target.value as LibraryFilters['label'] })} data-testid="library-label-filter">
            <option value="all">{tz('All', '全部')}</option>
            {LABELS.filter((l) => l.value !== 'none').map((l) => <option key={l.value} value={l.value}>{tz(l.en, l.zh)}</option>)}
            <option value="none">{tz('None', '无')}</option>
          </select>
        </label>
        <label className="library-filter">
          {tz('Size', '大小')}
          <input type="range" min={96} max={240} step={8} value={thumbSize} title={`${thumbSize}px`}
            onChange={(e) => settingsStore.getState().set('libraryThumbSize', Number(e.target.value))}
            data-testid="library-thumb-size" />
        </label>
        <label className="library-filter">
          {tz('Sort', '排序')}
          <select value={`${sort.key}:${sort.descending ? 'desc' : 'asc'}`} onChange={(e) => {
            const [key, dir] = e.target.value.split(':');
            setSort({ key: key as typeof sort.key, descending: dir === 'desc' });
          }} data-testid="library-sort">
            <option value="captured:desc">{tz('Captured ↓', '拍摄时间 ↓')}</option>
            <option value="captured:asc">{tz('Captured ↑', '拍摄时间 ↑')}</option>
            <option value="date:desc">{tz('Date ↓', '日期 ↓')}</option>
            <option value="date:asc">{tz('Date ↑', '日期 ↑')}</option>
            <option value="imported:desc">{tz('Imported ↓', '导入 ↓')}</option>
            <option value="name:asc">{tz('Name ↑', '名称 ↑')}</option>
            <option value="name:desc">{tz('Name ↓', '名称 ↓')}</option>
            <option value="rating:desc">{tz('Stars ↓', '星级 ↓')}</option>
            <option value="folder:asc">{tz('Folder ↑', '文件夹 ↑')}</option>
          </select>
        </label>
        <span className="library-count" data-testid="library-count">{entries.length} / {total}</span>
      </div>
      <div className="library-body">
        <aside className="library-side">
          <button className={`library-side-row${!currentFolder && !currentCollection && !currentSmart ? ' is-active' : ''}`} onClick={showAllPhotographs} data-testid="library-all">
            {tz('All Photographs', '所有照片')} <span>{total}</span>
          </button>

          <div className="library-side-title">{tz('Folders', '文件夹')}</div>
          {folders.map((folder) => (
            <button
              key={folder.path}
              className={`library-side-row${currentFolder === folder.path ? ' is-active' : ''}`}
              title={folder.path}
              onClick={() => showFolder(folder.path)}
              data-testid="library-folder"
            >
              {folder.name} <span>{folder.count}</span>
            </button>
          ))}

          <div className="library-side-title">
            {tz('Collections', '集合')}
            <button className="library-side-add" title={tz('New collection from selection', '用所选照片新建集合')} onClick={() => setCollectionDraft('')} data-testid="library-new-collection">＋</button>
          </div>
          {collectionDraft !== null && (
            <div className="library-draft">
              <input
                autoFocus
                value={collectionDraft}
                placeholder={tz('Collection name', '集合名称')}
                onChange={(e) => setCollectionDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitCollection(); if (e.key === 'Escape') setCollectionDraft(null); }}
                data-testid="library-collection-name"
              />
              <button className="library-btn" onClick={submitCollection}>OK</button>
            </div>
          )}
          {collections.map((collection) => (
            <div key={collection.id} className={`library-side-item${currentCollection === collection.id ? ' is-active' : ''}`}>
              {renameDraft?.kind === 'collection' && renameDraft.id === collection.id ? (
                <input
                  autoFocus
                  className="library-side-input"
                  value={renameDraft.name}
                  onChange={(e) => setRenameDraft({ ...renameDraft, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenameDraft(null); }}
                  onBlur={() => setRenameDraft(null)}
                  data-testid="library-rename-input"
                />
              ) : (
                <button className="library-side-row" onClick={() => showCollection(collection.id)} data-testid="library-collection">
                  {collection.name} <span>{collection.count}</span>
                </button>
              )}
              <span className="library-side-tools">
                <button title={tz('Remove selection from collection', '从集合中移除所选')} onClick={() => void removeSelectionFromCollection(collection.id)}>−</button>
                <button title={tz('Rename', '重命名')} onClick={() => setRenameDraft({ kind: 'collection', id: collection.id, name: collection.name })} data-testid="library-rename-collection">✎</button>
                <button title={tz('Delete collection', '删除集合')} onClick={() => void deleteCollectionById(collection.id)}>✕</button>
              </span>
            </div>
          ))}

          <div className="library-side-title">
            {tz('Smart Collections', '智能集合')}
            <button className="library-side-add" title={tz('Save current filters as a smart collection', '把当前筛选保存为智能集合')} onClick={() => setSmartDraft('')} data-testid="library-new-smart">＋</button>
          </div>
          {smartDraft !== null && (
            <div className="library-draft">
              <input
                autoFocus
                value={smartDraft}
                placeholder={tz('Smart collection name', '智能集合名称')}
                onChange={(e) => setSmartDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSmart(); if (e.key === 'Escape') setSmartDraft(null); }}
                data-testid="library-smart-name"
              />
              <button className="library-btn" onClick={submitSmart}>OK</button>
            </div>
          )}
          {smartCollections.map((smart) => (
            <div key={smart.id} className={`library-side-item${currentSmart === smart.id ? ' is-active' : ''}`}>
              {renameDraft?.kind === 'smart' && renameDraft.id === smart.id ? (
                <input
                  autoFocus
                  className="library-side-input"
                  value={renameDraft.name}
                  onChange={(e) => setRenameDraft({ ...renameDraft, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenameDraft(null); }}
                  onBlur={() => setRenameDraft(null)}
                  data-testid="library-rename-input"
                />
              ) : (
                <button className="library-side-row" onClick={() => showSmartCollection(smart.id)} data-testid="library-smart">
                  {smart.name}
                </button>
              )}
              <span className="library-side-tools">
                <button title={tz('Rename', '重命名')} onClick={() => setRenameDraft({ kind: 'smart', id: smart.id, name: smart.name })} data-testid="library-rename-smart">✎</button>
                <button title={tz('Delete smart collection', '删除智能集合')} onClick={() => void deleteSmartCollectionById(smart.id)}>✕</button>
              </span>
            </div>
          ))}

          {keywords.length > 0 && <div className="library-side-title">{tz('Keywords', '关键字')}</div>}
          {keywords.map((keyword) => (
            <button
              key={keyword.word}
              className={`library-side-row${filters.keyword === keyword.word ? ' is-active' : ''}`}
              onClick={() => setFilters({ keyword: filters.keyword === keyword.word ? null : keyword.word })}
            >
              {keyword.word} <span>{keyword.count}</span>
            </button>
          ))}

          <div className="library-side-title">{tz('Quick filters', '快捷筛选')}</div>
          <button className={`library-side-row${filters.editedOnly ? ' is-active' : ''}`} onClick={() => setFilters({ editedOnly: !filters.editedOnly })}>
            {tz('Edited only', '仅已修改')}
          </button>
        </aside>

        <div className="library-grid" ref={gridRef} data-testid="library-grid" style={{ ["--library-thumb" as string]: `${thumbSize}px` }}>
          {inCollection && selection.length > 0 && (
            <div className="library-collection-bar">
              {tz('Collection', '集合')}: {inCollection.name}
              <button className="library-btn" onClick={() => void addSelectionToCollection(inCollection.id)} data-testid="library-add-to-collection">
                ＋ {tz('Add selection', '加入所选')}
              </button>
              <button className="library-btn" disabled={selection.length < 2} onClick={() => void syncDevelopSettings()} data-testid="library-sync-inline">
                {tz('Sync Settings', '同步修改设置')}
              </button>
            </div>
          )}
          {entries.map((entry) => (
            <div
              key={entry.path}
              className={`library-cell${selected.has(entry.path) ? ' is-selected' : ''}`}
              data-path={entry.path}
              data-testid="library-cell"
              onClick={(e) => onCellClick(e, entry.path)}
              onDoubleClick={() => void openSelection([entry.path], entry.path)}
              title={entry.title || entry.path}
            >
              <div className="library-thumb">
                {thumbs[entry.path]
                  ? <img src={thumbs[entry.path]} alt={entry.name} draggable={false} />
                  : <div className="library-thumb-missing">{tz('No preview', '无预览')}</div>}
                {entry.flag === 'pick' && <span className="library-flag library-flag-pick">{tz('Pick', '留用')}</span>}
                {entry.flag === 'reject' && <span className="library-flag library-flag-reject">{tz('Reject', '排除')}</span>}
                {entry.edited && <span className="library-flag library-flag-edited">{tz('Edited', '已修改')}</span>}
                <span className="library-dot" data-label={entry.label} style={{ background: labelColor(entry.label), display: entry.label === 'none' ? 'none' : undefined }} />
                <Stars rating={entry.rating} />
              </div>
              <div className="library-cell-name">{entry.name || baseName(entry.path)}</div>
            </div>
          ))}
          {entries.length === 0 && (
            <div className="library-empty">
              {total === 0
                ? tz('No photographs yet. Import a folder to build your library.', '还没有照片。导入一个文件夹来建立图库。')
                : tz('No photographs match the filters.', '没有照片匹配当前筛选。')}
            </div>
          )}
        </div>

        <MetadataPanel entries={catalog.entries} selection={selection} />
      </div>
      <div className="library-footer">
        <span>{selection.length > 0 ? `${selection.length} ${tz('selected', '项已选')}` : tz('Nothing selected', '未选择')}</span>
        {busy && <span className="library-busy">{busy}{progress ? ` ${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` : ''}</span>}
        <span className="library-hint">{tz('Double-click to develop · 1–5 rate · P/X/U flag · Delete removes from catalog', '双击进入修改 · 1–5 打分 · P/X/U 旗标 · Delete 从图库移除')}</span>
        {error && <button className="library-error" onClick={clearError}>{error} ✕</button>}
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}
