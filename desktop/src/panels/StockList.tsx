// StockList.tsx — the film and paper lists: group headers, a rounded white
// selection, the orange CINE pill, a cover where the catalogue has one.
//
// The list also carries a search box and the stocks used most recently in
// this session, so a long catalogue stays navigable without scrolling.

import { useMemo, useState } from 'react';
import { tz } from '../i18n';

export interface StockRow {
  id: string;
  name: string;
  header?: boolean;
  cine?: boolean;
  cover?: string | null;
  disabled?: boolean;
  reason?: string | null;
}

// Session memory: per list, the stocks selected most recently (newest first).
const recents = new Map<string, string[]>();
const RECENT_LIMIT = 4;

function recentFor(key: string): string[] {
  let list = recents.get(key);
  if (!list) {
    list = [];
    recents.set(key, list);
  }
  return list;
}

function noteRecent(key: string, id: string): void {
  const list = recentFor(key);
  const next = [id, ...list.filter((v) => v !== id)].slice(0, RECENT_LIMIT);
  list.splice(0, list.length, ...next);
}

export function StockList({ rows, selected, onSelect, testId, searchPlaceholder }: {
  rows: StockRow[];
  selected: string;
  onSelect: (id: string) => void;
  testId?: string;
  searchPlaceholder?: string;
}) {
  const key = testId ?? 'stocks';
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(() => recentFor(key));

  const byId = useMemo(() => {
    const map = new Map<string, StockRow>();
    for (const r of rows) if (!r.header) map.set(r.id, r);
    return map;
  }, [rows]);

  // Group headers survive only while a matching row follows them.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const out: StockRow[] = [];
    let header: StockRow | null = null;
    for (const r of rows) {
      if (r.header) {
        header = r;
        continue;
      }
      if (r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) {
        if (header) {
          out.push(header);
          header = null;
        }
        out.push(r);
      }
    }
    return out;
  }, [rows, query]);

  const recentRows = recent.map((id) => byId.get(id)).filter((r): r is StockRow => !!r);

  const select = (id: string) => {
    noteRecent(key, id);
    setRecent(recentFor(key).slice());
    onSelect(id);
  };

  return (
    <div className="stock-picker">
      <input
        className="stock-search"
        type="search"
        value={query}
        placeholder={searchPlaceholder ?? tz('Search…', '搜索…')}
        aria-label={searchPlaceholder ?? tz('Search…', '搜索…')}
        onChange={(e) => setQuery(e.target.value)}
        data-testid={testId ? `${testId}-search` : undefined}
      />
      {recentRows.length > 0 && (
        <div className="stock-recent" data-testid={testId ? `${testId}-recent` : undefined}>
          <span className="stock-recent-label">{tz('Recent', '最近')}</span>
          {recentRows.map((r) => (
            <button
              key={r.id}
              type="button"
              className={'stock-chip' + (r.id === selected ? ' selected' : '')}
              aria-disabled={r.disabled}
              disabled={r.disabled}
              title={r.disabled ? (r.reason ?? r.name) : r.name}
              onClick={() => select(r.id)}
              data-stock={r.id}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
      <div role="listbox" className="stock-list" data-testid={testId}>
        {visible.map((r) =>
          r.header ? (
            <div key={r.id} className="stock-group">
              {r.name}
            </div>
          ) : (
            <div
              key={r.id}
              role="option"
              aria-selected={r.id === selected}
              aria-disabled={r.disabled}
              className={'stock-row' + (r.id === selected ? ' selected' : '') + (r.disabled ? ' disabled' : '')}
              title={r.disabled ? (r.reason ?? undefined) : r.name}
              onClick={() => !r.disabled && select(r.id)}
              data-stock={r.id}
            >
              <span className="name">{r.name}</span>
              {r.cover && <img className="cover" src={r.cover} alt="" />}
              {r.cine && <span className="cine-pill">CINE</span>}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
