// LibraryView.tsx — the persistent catalog browser (the Lightroom-style grid).
//
// The originals stay where the user keeps them; this window only reads the
// catalog and the preview thumbnails. Double-clicking a photograph opens it in
// the editor exactly like File › Open.

import { useEffect, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { tz } from '../i18n';
import { Import } from '../controls/icons';
import { baseName, platform } from '../platform';
import { useSession } from '../state/session';
import {
  clearError,
  clearSelection,
  importPaths,
  openSelection,
  refreshEditedBadges,
  removeFromCatalog,
  selectAll,
  selectOnly,
  selectRange,
  setFlag,
  setFilters,
  setLibraryOpen,
  setRating,
  setSort,
  toggleSelection,
  useLibrary,
  visibleEntries,
} from '../state/library';
import { folderGroups, keywordGroups, type Rating } from '@shared/catalog';
import './library.css';

const RATING_OPTIONS: Rating[] = [0, 1, 2, 3, 4, 5];

function Stars({ rating }: { rating: number }) {
  return <span className="library-stars" aria-label={`${rating} stars`}>{'★'.repeat(rating)}<span className="library-stars-empty">{'★'.repeat(5 - rating)}</span></span>;
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
  const gridRef = useRef<HTMLDivElement>(null);

  // Filtering/sorting live in the store; every render recomputes the visible page.
  const entries = visibleEntries();
  const selected = useMemo(() => new Set(selection), [selection]);
  const folders = useMemo(() => folderGroups(catalog.entries), [catalog.entries]);
  const keywords = useMemo(() => keywordGroups(catalog.entries), [catalog.entries]);

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
        const target = list[next];
        if (!target) return;
        selectOnly(target.path);
        gridRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(target.path)}"]`)?.scrollIntoView({ block: 'nearest' });
      };
      if (event.key === 'Escape') {
        clearSelection();
        if (editorHasPhoto) setLibraryOpen(false);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(-1);
      else if (event.key === 'Enter') void openSelection();
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

  const doImport = async (kind: 'folder' | 'files') => {
    const title = kind === 'folder' ? tz('Import Folder…', '导入文件夹…') : tz('Import Photos…', '导入照片…');
    const picked = kind === 'folder' ? await platform().pickFolder(title) : null;
    const paths = kind === 'folder' ? (picked ? [picked] : []) : await platform().pickFiles(title);
    await importPaths(paths);
  };

  const total = catalog.entries.length;
  return (
    <div className="library" data-testid="library">
      <div className="library-toolbar">
        <button className="library-btn" onClick={() => setLibraryOpen(false)} disabled={!editorHasPhoto} title={tz('Back to Develop', '返回修改')}>
          ↩ {tz('Develop', '修改')}
        </button>
        <button className="library-btn" onClick={() => void doImport('folder')} data-testid="library-import-folder">
          <Import /> {tz('Import Folder…', '导入文件夹…')}
        </button>
        <button className="library-btn" onClick={() => void doImport('files')} data-testid="library-import-files">
          {tz('Import Photos…', '导入照片…')}
        </button>
        <input
          className="library-search"
          placeholder={tz('Search name or folder', '搜索文件名或文件夹')}
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
          <select value={filters.flag} onChange={(e) => setFilters({ flag: e.target.value as typeof filters.flag })} data-testid="library-flag-filter">
            <option value="all">{tz('All', '全部')}</option>
            <option value="pick">{tz('Picked', '留用')}</option>
            <option value="reject">{tz('Rejected', '排除')}</option>
            <option value="none">{tz('Unflagged', '未标')}</option>
          </select>
        </label>
        <label className="library-filter">
          {tz('Sort', '排序')}
          <select value={`${sort.key}:${sort.descending ? 'desc' : 'asc'}`} onChange={(e) => {
            const [key, dir] = e.target.value.split(':');
            setSort({ key: key as typeof sort.key, descending: dir === 'desc' });
          }} data-testid="library-sort">
            <option value="date:desc">{tz('Date ↓', '日期 ↓')}</option>
            <option value="date:asc">{tz('Date ↑', '日期 ↑')}</option>
            <option value="imported:desc">{tz('Imported ↓', '导入 ↓')}</option>
            <option value="name:asc">{tz('Name ↑', '名称 ↑')}</option>
            <option value="name:desc">{tz('Name ↓', '名称 ↓')}</option>
            <option value="rating:desc">{tz('Stars ↓', '星级 ↓')}</option>
            <option value="folder:asc">{tz('Folder ↑', '文件夹 ↑')}</option>
          </select>
        </label>
        <span className="library-count" data-testid="library-count">
          {entries.length} / {total}
        </span>
      </div>
      <div className="library-body">
        <aside className="library-side">
          <button className={`library-side-row${filters.folder === null ? ' is-active' : ''}`} onClick={() => setFilters({ folder: null })} data-testid="library-all">
            {tz('All Photographs', '所有照片')} <span>{total}</span>
          </button>
          <div className="library-side-title">{tz('Folders', '文件夹')}</div>
          {folders.map((folder) => (
            <button
              key={folder.path}
              className={`library-side-row${filters.folder === folder.path ? ' is-active' : ''}`}
              title={folder.path}
              onClick={() => setFilters({ folder: folder.path })}
              data-testid="library-folder"
            >
              {folder.name} <span>{folder.count}</span>
            </button>
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
        <div className="library-grid" ref={gridRef} data-testid="library-grid">
          {entries.map((entry) => (
            <div
              key={entry.path}
              className={`library-cell${selected.has(entry.path) ? ' is-selected' : ''}`}
              data-path={entry.path}
              data-testid="library-cell"
              onClick={(e) => onCellClick(e, entry.path)}
              onDoubleClick={() => void openSelection([entry.path])}
              title={entry.path}
            >
              <div className="library-thumb">
                {thumbs[entry.path]
                  ? <img src={thumbs[entry.path]} alt={entry.name} draggable={false} />
                  : <div className="library-thumb-missing">{tz('No preview', '无预览')}</div>}
                {entry.flag === 'pick' && <span className="library-flag library-flag-pick">{tz('Pick', '留用')}</span>}
                {entry.flag === 'reject' && <span className="library-flag library-flag-reject">{tz('Reject', '排除')}</span>}
                {entry.edited && <span className="library-flag library-flag-edited">{tz('Edited', '已修改')}</span>}
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
      </div>
      <div className="library-footer">
        <span>{selection.length > 0 ? `${selection.length} ${tz('selected', '项已选')}` : tz('Nothing selected', '未选择')}</span>
        {busy && <span className="library-busy">{busy}{progress ? ` ${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` : ''}</span>}
        <span className="library-hint">{tz('Double-click to develop · 1–5 rate · P/X/U flag · Delete removes from catalog', '双击进入修改 · 1–5 打分 · P/X/U 旗标 · Delete 从图库移除')}</span>
        {error && <button className="library-error" onClick={clearError}>{error} ✕</button>}
      </div>
    </div>
  );
}
