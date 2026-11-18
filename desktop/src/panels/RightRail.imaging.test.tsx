// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newSidecar } from '@shared/sidecar';
import { ALL_FEATURES } from '@shared/params';
vi.mock('../host/client', () => ({ HostCallError: class extends Error {}, host: () => ({}) }));
vi.mock('../platform', () => ({ platform: () => ({ log: vi.fn(), sidecarSave: async () => '' }),
  baseName: (p: string) => p, dirName: (p: string) => p }));
import { sessionStore, setParams } from '../state/session';
import { settingsStore } from '../state/settings';
import { setLanguage } from '../i18n';
import { RightRail } from './RightRail';

let root: Root, div: HTMLDivElement;
const button = (id: string) => div.querySelector(`[data-testid=${id}]`) as HTMLButtonElement;
const section = () => div.querySelector('[data-section=imaging]') as HTMLElement;
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  setLanguage('english');
  settingsStore.setState({ collapsedSections: {}, parametersTab: 'preDev', sideUnit: 'mm' });
  sessionStore.setState({ sidecar: structuredClone(newSidecar()), selection: null, engineSession: null,
    latitude: { reply: null, failure: null, refusal: null, session: null, frame: null, stamp: null },
    gate: ALL_FEATURES, nativeSize: { width: 6, height: 4 },
    batchExporting: false, pair: null, pairInfo: null, undo: [], redo: [] });
  div = document.createElement('div'); document.body.append(div); root = createRoot(div);
  await act(async () => root.render(<RightRail />));
});
afterEach(async () => {
  await act(async () => root.unmount()); div.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('exposes the shoot and print path detail the engine already had', async () => {
  expect(section()).not.toBeNull();
  expect(button('camera-filter').textContent).toContain('None');
  expect(button('overscan-carrier').textContent).toContain('No carrier');
  // The two toggles start off, exactly as the engine defaults.
  expect(button('scanner-white').getAttribute('aria-checked')).toBe('false');
  expect(button('scanner-black').getAttribute('aria-checked')).toBe('false');
  expect(section().textContent).toContain('Density curve gamma');
  // Inert without the film edge, so it must not look adjustable.
  expect(button('overscan-carrier').disabled).toBe(true);
});

it('lets the carrier be chosen once the film edge is on', async () => {
  await act(async () => setParams((p) => ({ ...p, filmEdge: { ...p.filmEdge, active: true, format: '135' } })));
  expect(button('overscan-carrier').disabled).toBe(false);
});

it('shows a saved filter and carrier, and resets them with the section', async () => {
  await act(async () => setParams((p) => ({ ...p, cameraFilter: 'w25', overscanCarrier: 'open',
    scannerWhiteCorrection: true, densityCurveGamma: 1.5 })));
  expect(button('camera-filter').textContent).toContain('No. 25');
  expect(button('overscan-carrier').textContent).toContain('Open carrier');
  expect(button('scanner-white').getAttribute('aria-checked')).toBe('true');
  await act(async () => section().querySelector('.section-header button[title]')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const p = sessionStore.getState().sidecar.params;
  expect([p.cameraFilter, p.overscanCarrier, p.scannerWhiteCorrection, p.densityCurveGamma])
    .toEqual(['', 'none', false, 1]);
});
