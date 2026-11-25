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
  // The diffusion filter (柔光镜, macOS 2.x) starts off with its family inert.
  expect(button('diffusion-active').getAttribute('aria-checked')).toBe('false');
  expect(button('diffusion-family').disabled).toBe(true);
  expect(button('diffusion-family').textContent).toContain('Black Pro-Mist');
  expect(section().textContent).toContain('Diffusion strength');
  // The lens character (macOS 2.x) starts off with its LoCA sign inert.
  expect(button('lens-character-active').getAttribute('aria-checked')).toBe('false');
  expect(button('lens-loca-sign').disabled).toBe(true);
  expect(section().textContent).toContain('Field curvature');
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

it('turns the diffusion filter on, picks a family and a stop, and files them under the shoot layer', async () => {
  await act(async () => setParams((p) => ({
    ...p,
    diffusionFilter: { active: true, family: 'cinebloom', strength: 1 },
  })));
  expect(button('diffusion-active').getAttribute('aria-checked')).toBe('true');
  expect(button('diffusion-family').disabled).toBe(false);
  expect(button('diffusion-family').textContent).toContain('CineBloom');
  const { wire } = await import('@shared/params');
  const rows = new Map(wire(sessionStore.getState().sidecar.params).map((f) => [f.name, f]));
  expect(rows.get('diffusion_filter_active')?.value).toBe(true);
  expect(rows.get('diffusion_filter_family')?.value).toBe('cinebloom');
  expect(rows.get('diffusion_filter_strength')?.value).toBe(1);
  expect(rows.get('diffusion_filter_family')?.layer).toBe('shoot');
});

it('turns the lens character on, sets its aberrations, and files them under the shoot layer', async () => {
  await act(async () => setParams((p) => ({
    ...p,
    lensCharacter: { ...p.lensCharacter, active: true, fieldCurvatureUm: 60, comaUm: 80,
      lateralCaR: 1.5, lateralCaB: -1, locaUm: 12, locaSign: 'green' },
  })));
  expect(button('lens-character-active').getAttribute('aria-checked')).toBe('true');
  expect(button('lens-loca-sign').disabled).toBe(false);
  expect(button('lens-loca-sign').textContent).toContain('Green soft');
  const { wire } = await import('@shared/params');
  const rows = new Map(wire(sessionStore.getState().sidecar.params).map((f) => [f.name, f]));
  expect(rows.get('lens_aberrations_active')?.value).toBe(true);
  expect(rows.get('lens_field_curvature_um')?.value).toBe(60);
  expect(rows.get('lens_coma_um')?.value).toBe(80);
  expect(rows.get('lens_lateral_ca_r')?.value).toBe(1.5);
  expect(rows.get('lens_lateral_ca_b')?.value).toBe(-1);
  expect(rows.get('lens_loca_um')?.value).toBe(12);
  expect(rows.get('lens_loca_sign')?.value).toBe('green');
  expect(rows.get('lens_coma_um')?.layer).toBe('shoot');
});

it('shows the Decode curve, sends its table, and resets to the identity', async () => {
  const decode = () => div.querySelector('[data-section=decodecurve]') as HTMLElement;
  expect(decode()).not.toBeNull();
  expect(button('decode-curve-rgb')).not.toBeNull();
  const { wire } = await import('@shared/params');
  const rows = () => new Map(wire(sessionStore.getState().sidecar.params).map((f) => [f.name, f]));
  expect(rows().get('scene_curve')?.value).toBe('');
  const table = Array.from({ length: 5 }, () => '0,1').join(',');
  await act(async () => setParams((p) => ({ ...p, decodeCurveText: table })));
  expect(rows().get('scene_curve')?.value).toBe(table);
  await act(async () => decode().querySelector('.section-header button[title]')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(sessionStore.getState().sidecar.params.decodeCurveText).toBe('');
});

it('shows the scan sharpening off by default, and files it under the print layer', async () => {
  await act(async () => settingsStore.getState().set('parametersTab', 'postDev'));
  const scan = () => div.querySelector('[data-section=scan]') as HTMLElement;
  expect(scan()).not.toBeNull();
  expect(scan().textContent).toContain('Scan sharpening');
  const row = (id: string) => div.querySelector(`[data-testid=${id}]`) as HTMLElement;
  expect(row('scan-unsharp-amount')).not.toBeNull();
  // The product sends no sharpening; the radius only matters once raised.
  expect(row('scan-unsharp-sigma').className).toContain('disabled');
  const { wire } = await import('@shared/params');
  const rows = new Map(wire(sessionStore.getState().sidecar.params).map((f) => [f.name, f]));
  expect(rows.get('scanner_unsharp_amount')?.value).toBe(0);
  expect(rows.get('scanner_unsharp_sigma')?.value).toBe(0.7);
  expect(rows.get('scanner_unsharp_amount')?.layer).toBe('print');
  await act(async () => setParams((p) => ({ ...p, scanUnsharpAmount: 0.6 })));
  expect(row('scan-unsharp-sigma').className).not.toContain('disabled');
  // Reset returns to the no-sharpening product default.
  await act(async () => scan().querySelector('.section-header button[title]')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(sessionStore.getState().sidecar.params.scanUnsharpAmount).toBe(0);
  expect(sessionStore.getState().sidecar.params.scanUnsharpSigma).toBe(0.7);
});

it('keeps the source highlights by default (H-3), and files the flag under shoot', async () => {
  // The product sends renormalize=false, so the visible toggle "keeps
  // highlights intact" starts checked -- the source is not dimmed by the halo.
  expect(button('halation-keep-highlights').getAttribute('aria-checked')).toBe('true');
  const { wire } = await import('@shared/params');
  expect(new Map(wire(sessionStore.getState().sidecar.params).map((f) => [f.name, f]))
    .get('halation_renormalize')?.value).toBe(false);
  await act(async () => button('halation-keep-highlights')
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(sessionStore.getState().sidecar.params.halationRenormalize).toBe(true);
  expect(button('halation-keep-highlights').getAttribute('aria-checked')).toBe('false');
});

it('shows measured D-76 times for 135 Tri-X and disables the generic push while selected', async () => {
  expect(button('trix-d76-minutes')).toBeNull();
  await act(async () => setParams((p) => ({
    ...p, filmStock: 'kodak_tri_x_400', filmFrame: '135',
    development: { ...p.development, active: true, trixD76Minutes: 8 },
  })));
  expect(button('trix-d76-minutes').textContent).toContain('8 min');
  expect(button('development-toggle').getAttribute('aria-disabled')).toBe('true');
  await act(async () => setParams((p) => ({ ...p, filmFrame: '120' })));
  expect(button('trix-d76-minutes')).toBeNull();
  expect(button('development-toggle').getAttribute('aria-checked')).toBe('true');
});
