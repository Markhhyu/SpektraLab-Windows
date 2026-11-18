// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockList, type StockRow } from './StockList';
import { tz } from '../i18n';

vi.mock('../i18n', () => ({ tz: (english: string) => english }));

const rows: StockRow[] = [
  { id: '__gNeg', name: 'Negative', header: true },
  { id: 'kodak_portra_400', name: 'Kodak Portra 400' },
  { id: 'kodak_portra_800', name: 'Kodak Portra 800' },
  { id: '__gPos', name: 'Positive', header: true },
  { id: 'kodak_e100', name: 'Kodak Ektachrome E100' },
];

let root: Root;
let div: HTMLDivElement;

function mount(selected: string, onSelect: (id: string) => void) {
  div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  act(() => { root.render(<StockList rows={rows} selected={selected} onSelect={onSelect} testId="film-list" />); });
  return div;
}

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React); });
afterEach(() => { act(() => root.unmount()); div.remove(); void tz; });

describe('stock list', () => {
  it('filters by name and drops empty group headers', () => {
    const div = mount('kodak_portra_400', () => {});
    const input = div.querySelector('input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'e100');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const text = div.querySelector('[data-testid=film-list]')!.textContent!;
    expect(text).toContain('Kodak Ektachrome E100');
    expect(text).not.toContain('Kodak Portra 400');
    expect(div.querySelector('[data-stock=kodak_portra_400]')).toBeNull();
  });

  it('keeps a recently used stock as a clickable chip', () => {
    const picked: string[] = [];
    const div = mount('kodak_portra_400', (id) => picked.push(id));
    const row = div.querySelector('[data-stock=kodak_portra_800]') as HTMLElement;
    act(() => { row.click(); });
    expect(picked).toEqual(['kodak_portra_800']);
    const recent = div.querySelector('[data-testid=film-list-recent]')!;
    expect(recent.textContent).toContain('Kodak Portra 800');
    act(() => { (recent.querySelector('[data-stock=kodak_portra_800]') as HTMLElement).click(); });
    expect(picked).toEqual(['kodak_portra_800', 'kodak_portra_800']);
  });
});
