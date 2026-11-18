// RightRail.tsx — "Parameters" (`Panels/RightPanel.swift`):
//   Pre-Dev:  Latitude · Input / Camera · Film Format · Scene Placement
//   Post-Dev: White Balance · Exposure · Curve · Color Balance (Layer 2)

import { useRef, useState } from 'react';
import { Checkbox, NumberField, PillMenu, ScrubSlider, Section, SegmentedSwitch, ToggleRow, signed } from '../controls/controls';
import { isChinese, t, tz } from '../i18n';
import { hostMessage } from '../host/messages';
import { cameraParams, cameraExposureBaseline, cameraExposureTotal, setCameraMetering, setCameraExposureTotal, resetCameraExposure, pairFocus, shownAdjustments, shownDecode as selectedDecode, updatePair, canPickNeutral, currentPlacementWindow, hostRedecodes, placeScene, placementReady, resetScenePlacement, setAdjustments, setDecode, setFilmFrame, setFilmSide, setParams, setSideLengthMM, startNeutralPick, useSession } from '../state/session';
import { settingsStore, useSettings } from '../state/settings';
import {
  type AEMethod,
  CONTRAST_MASK_DEFAULT,
  CONTRAST_MASK_SCALE,
  DEVELOPMENT_DEFAULT,
  DEVELOPMENT_PUSH_RANGE,
  DEVELOPMENT_TEMPERATURE_RANGE,
  EFFECTS_DEFAULT,
  EFFECT_RANGES,
  FILM_FRAMES,
  FILM_FRAME_CUSTOM,
  ILLUMINANTS,
  illuminantLabel,
  SIDE_UNIT_DECIMALS,
  SIDE_UNIT_PER_MM,
  type SideUnit,
  aeMethodOf,
} from '@shared/params';
import { type ColorZone, type CurveChannel, CURVE_CHANNELS, isNeutral } from '@shared/adjustments';
import { createLocalAdjustment, localAdjustmentLabel, LOCAL_GRADE_RANGE, type LocalAdjustment } from '@shared/localAdjust';
import {
  type AsShot,
  TEMPERATURE_RANGE,
  TINT_RANGE,
  WB_MODES,
  applyBoxes,
  boxesOf,
  isRawPath,
  modeOf,
  shownDecode,
  withPreset,
  withTemperature,
  withTint,
} from '@shared/whiteBalance';
import { CurveEditor } from './CurveEditor';
import { unsupportedReason } from './gate';
import { type LatitudeReply, type PlacementSide, placementMessage } from '@shared/latitude';
import { edgeEffective, edgeFormat } from '@shared/filmEdge';
import { setLibraryOpen } from '../state/library';
import { applyPreset, deletePreset, renamePreset, saveCurrentPreset, usePresets } from '../state/presets';

export function RightRail() {
  const tab = useSettings((s) => s.parametersTab);
  const edited = useSession((s) => shownAdjustments(s).enabled && !isNeutral(shownAdjustments(s)));
  return (
    <aside className="rail right" data-testid="right-rail">
      <div className="rail-modules" data-testid="rail-modules">
        <button className="rail-module" onClick={() => setLibraryOpen(true)} data-testid="rail-library">{tz('Library', '图库')}</button>
        <button className="rail-module is-active" data-testid="rail-develop">{tz('Develop', '修改')}</button>
      </div>
      <div className="rail-header">{t('railParameters')}</div>
      <SegmentedSwitch
        value={tab}
        onChange={(v) => settingsStore.getState().set('parametersTab', v)}
        options={[
          { value: 'preDev', label: t('tabPreDev') },
          { value: 'postDev', label: t('tabPostDev'), marked: edited, markHelp: tz('The grade is not neutral.', '调色不是中性的。') },
        ]}
      />
      <div className="hairline" />
      <div className="rail-scroll">
        {tab === 'preDev' ? (
          <>
            <LatitudeSection />
            <CameraSection />
            <FilmFormatSection />
            <DevelopmentSection />
            <LightingSection />
            <ScenePlacementSection />
          </>
        ) : (
          <>
            <PresetsSection />
            <WhiteBalanceSection />
            <ExposureSection />
            <CurveSection />
            <ColorBalanceSection />
            <ToneMaskSection />
            <LocalAdjustmentsSection />
          </>
        )}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ Latitude

function LatitudeSection() {
  const noFilm = useSession((s) => s.sidecar.noFilm);
  const film = useSession((s) => s.sidecar.params.filmStock);
  const paper = useSession((s) => s.sidecar.params.printStock);
  const catalog = useSession((s) => s.catalog);
  const { reply, failure } = useSession((s) => s.latitude);
  const name = (id: string) => catalog.stock(id)?.name.replace(/^(Kodak|Fujifilm) (Professional )?/, '') ?? id;
  return (
    <Section id="latitude" title={t('sectionLatitude')} trailing={`${name(film)} · ${name(paper)}`} unsupported={noFilm ? tz('Film simulation is bypassed.', '当前不应用胶片模拟。') : failure}>
      <LatitudePlot reply={reply} />
      {reply?.suggested?.valid && (reply.suggested.highlight_pull_back > 0 || reply.suggested.shadow_pull_back > 0) && (
        <button
          className="btn latitude-suggest"
          data-testid="apply-suggested-placement"
          onClick={() => {
            if (reply.suggested.highlight_pull_back > 0) placeScene('highlight', reply.suggested.highlight_pull_back);
            if (reply.suggested.shadow_pull_back > 0) placeScene('shadow', reply.suggested.shadow_pull_back);
          }}
        >
          {tz('Apply suggested placement', '应用建议置位')}
          <span className="num"> (+{reply.suggested.highlight_pull_back.toFixed(1)} / +{reply.suggested.shadow_pull_back.toFixed(1)} EV)</span>
        </button>
      )}
    </Section>
  );
}

function LatitudePlot({ reply }: { reply: LatitudeReply | null }) {
  const W = 260;
  const H = 96;
  if (!reply) return <svg className="plot" viewBox={`0 0 ${W} ${H}`} height={H} data-testid="latitude-plot" />;
  const h = reply.scene.histogram;
  const placed = h.placed_fractions ?? h.fractions;
  const n = placed.length;
  const smooth = (series: number[], radius = 2) => series.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(n - 1, i + radius); j++) { sum += series[j] ?? 0; count++; }
    return sum / count;
  });
  const smoothPlaced = smooth(placed);
  const sortedPeak = [...smoothPlaced].sort((a, b) => a - b);
  const peak = Math.max(1e-9, sortedPeak[Math.floor(sortedPeak.length * 0.995)] ?? Math.max(...smoothPlaced));
  const x = (ev: number) => ((ev - h.lo_ev) / (h.hi_ev - h.lo_ev)) * W;
  const yOf = (v: number) => H - 12 - (Math.min(v, peak) / peak) * (H - 20);
  const lo = reply.medium.shadow_ev;
  const hi = reply.medium.highlight_ev;
  let below = 0;
  let above = 0;
  let total = 0;
  placed.forEach((v, i) => {
    const c = h.lo_ev + ((i + 0.5) * (h.hi_ev - h.lo_ev)) / n;
    total += v;
    if (c < lo) below += v;
    else if (c > hi) above += v;
  });
  const pct = (v: number) => ((v / (total || 1)) * 100).toFixed(1);
  // A smooth area for the placed distribution, plus a faint outline of the
  // measurement before scene placement when the two differ.
  const area = smoothPlaced.map((v, i) => {
    const cx = (i / Math.max(1, n - 1)) * W;
    return `${i === 0 ? 'M' : 'L'}${cx.toFixed(1)} ${yOf(v).toFixed(1)}`;
  }).join(' ') + ` L${W} ${H - 12} L0 ${H - 12} Z`;
  const outline = smooth(h.fractions).map((v, i) => {
    const cx = (i / Math.max(1, n - 1)) * W;
    return `${i === 0 ? 'M' : 'L'}${cx.toFixed(1)} ${yOf(v).toFixed(1)}`;
  }).join(' ');
  // Five EV ticks, kept on round values when the range allows it.
  const tickStep = Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(1, (h.hi_ev - h.lo_ev) / 4)))));
  const ticks: number[] = [];
  for (let ev = Math.ceil(h.lo_ev / tickStep) * tickStep; ev <= h.hi_ev + 1e-9; ev += tickStep) ticks.push(Number(ev.toFixed(2)));
  const tickLabel = (ev: number) => (ev > 0 ? '+' : '') + ev.toFixed(0);
  return (
    <>
      <div className="latitude-plot-wrap">
        <svg className="plot" viewBox={`0 0 ${W} ${H}`} height={H} data-testid="latitude-plot">
          <defs>
            <linearGradient id="latitude-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--latitude-inside-edge)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--latitude-inside-edge)" stopOpacity="0.08" />
            </linearGradient>
          </defs>
          <rect x={x(lo)} y={0} width={Math.max(0, x(hi) - x(lo))} height={H - 12} fill="var(--latitude-inside)" fillOpacity="0.16" />
          <rect x={0} y={0} width={Math.max(0, x(lo))} height={H - 12} fill="var(--latitude-beyond)" fillOpacity="0.30" />
          <rect x={x(hi)} y={0} width={Math.max(0, W - x(hi))} height={H - 12} fill="var(--latitude-beyond)" fillOpacity="0.30" />
          <path d={area} fill="url(#latitude-fill)" />
          {placed !== h.fractions && <path d={outline} fill="none" stroke="var(--dim)" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="2 2" />}
          {ticks.map((ev) => (
            <g key={ev}>
              <line x1={x(ev)} x2={x(ev)} y1={H - 12} y2={H - 8} stroke="var(--plot-grid)" />
              <text x={x(ev)} y={H - 1} textAnchor="middle" className="latitude-tick">{tickLabel(ev)}</text>
            </g>
          ))}
          <line x1={x(lo)} x2={x(lo)} y1={0} y2={H - 12} stroke="var(--latitude-inside-edge)" strokeWidth="1" strokeDasharray="3 2" />
          <line x1={x(hi)} x2={x(hi)} y1={0} y2={H - 12} stroke="var(--latitude-inside-edge)" strokeWidth="1" strokeDasharray="3 2" />
          <text x={Math.max(2, x(lo) - 4)} y={10} textAnchor="end" className="latitude-bound">{lo.toFixed(1)} EV</text>
          <text x={Math.min(W - 2, x(hi) + 4)} y={10} textAnchor="start" className="latitude-bound">+{hi.toFixed(1)} EV</text>
        </svg>
      </div>
      <div className="latitude-stats num">
        <span className="latitude-stat latitude-stat-value">{reply.medium.latitude_stops.toFixed(2)} {t('latitudeHeld')}</span>
        <span className="latitude-stat">{t('latitudeBelow')} {pct(below)} %</span>
        <span className="latitude-stat latitude-stat-in">{t('latitudeWithin')} {pct(total - below - above)} %</span>
        <span className="latitude-stat">{t('latitudeAbove')} {pct(above)} %</span>
      </div>
    </>
  );
}

// -------------------------------------------------------------------- Camera

function CameraSection() {
  const tool = useSession((s) => s.tool);
  const pickerReady = useSession(() => canPickNeutral());
  const state = useSession((s) => s);
  const p = cameraParams(state), focus = pairFocus(state), hole = focus ? state.pair?.[focus] : null;
  const vignette = useSession((s) => shownAdjustments(s).vignette.amount);
  const ae = aeMethodOf(p);
  const baseline = cameraExposureBaseline(state), total = cameraExposureTotal(state);
  // Keep the track fixed while ordinary values move. Expand only for an
  // existing exposure outside the normal range; the baseline itself moves.
  const span = Math.max(hole ? 5 : 8, Math.ceil(Math.abs(total ?? 0)));
  const lens = (focus ? state.pairInfo?.[focus]?.metadata : state.metadata)?.lens_correction;
  const lensReady = lens?.available === true && !!state.hello?.methods?.includes(state.pair ? 'update_pair' : 'redecode') && !state.batchExporting;
  const lensReason = lens?.reason ? hostMessage(lens.reason) : tz('No matching lens profile is available for this photograph.', '此照片没有匹配的镜头配置文件。');
  const lensParts = lens ? [lens.distortion && tz('distortion', '畸变'), lens.tca && tz('colour fringing', '横向色差'), lens.vignetting && tz('vignetting', '暗角')].filter(Boolean).join(' · ') : '';
  const wb = useWhiteBalance();
  const options: { value: AEMethod; label: string; disabled?: boolean }[] = [
    { value: 'custom', label: t('meteringCustom'), disabled: baseline === null },
    { value: 'balanced', label: t('meteringBalanced') },
    { value: 'center', label: t('meteringCenter') },
    { value: 'protect_highlights', label: t('meteringProtectHighlights') },
    { value: 'protect_shadows', label: t('meteringProtectShadows') },
  ];
  if (ae === 'legacy') options.push({ value: 'legacy', label: t('meteringCenterWeightedLegacy') });
  const asShot = !p.autoExposure && p.exposureCompensationEV === 0 && p.exposureBaselineEV === 0;
  return (
    <Section
      id="camera"
      title={t('sectionCamera')}
      onReset={resetCameraExposure}
      resetHelp={t('helpResetFilmExposure')}
      menu={[
        { label: t('helpResetFilmExposure'), onSelect: resetCameraExposure },
        // The presets keep their English names, as on the Mac.
        ...WB_MODES.filter((m) => m !== 'Custom').map((m) => ({
          label: `${t('helpWhiteBalancePreset')}: ${m}`,
          checked: wb.mode === m,
          disabled: !!wb.reason,
          onSelect: () => setDecode((d) => withPreset(d, wb.asShot, m)),
        })),
      ]}
    >
      <PillMenu label={t('cameraMetering')} value={ae} options={options} fill onChange={setCameraMetering} testId="metering" />
      {hole && focus && <PillMenu label={tz('Exposure scope', '曝光范围')} value={hole.exposureScope}
        options={[{ value: 'frame', label: tz('Frame', '这一格') }, { value: 'film', label: tz('+ Film', '+ 胶片') }]}
        onChange={(v) => updatePair((p) => ({ ...p, [focus]: { ...p[focus]!, exposureScope: v } }))} />}
      <ScrubSlider
        label={t('cameraFilmExposure')}
        sublabel={
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {t('cameraFilmExposureAsShot')}
            <Checkbox on={asShot} label={t('cameraFilmExposureAsShot')} onChange={resetCameraExposure} />
          </span>
        }
        value={total ?? p.exposureCompensationEV}
        range={[Math.max(-span, p.exposureCompensationEV - 64), Math.min(span, p.exposureCompensationEV + 64)]}
        disabled={total === null}
        reason={tz('Waiting for this photograph’s exposure reading.', '正在获取此照片的测光结果。')}
        snap={1 / 3}
        format={signed(1)}
        onChange={setCameraExposureTotal}
        testId="film-exposure"
      />
      {p.autoExposure && <div className="caption num" data-testid="automatic-exposure">
        {baseline === null ? tz('Metering…', '正在测光…') : tz(`Auto ${signed(2)(baseline)} EV · slider shows total`, `自动补偿 ${signed(2)(baseline)} EV · 滑条显示总曝光`)}
      </div>}
      <ScrubSlider
        label={t('cameraTemperature')}
        sublabel={<AsShotLine on={wb.boxes.temp} enabled={!!wb.asShot && !wb.reason} onChange={(v) => setDecode((d) => applyBoxes(d, wb.asShot, { temp: v }))} />}
        value={wb.shown.temperature}
        range={TEMPERATURE_RANGE}
        zero={wb.asShot?.temperature ?? 5500}
        snap={100}
        format={(v) => v.toFixed(0)}
        onChange={(v) => setDecode((d) => withTemperature(d, wb.asShot, v))}
        disabled={!!wb.reason}
        reason={wb.reason ?? undefined}
        gradient="linear-gradient(90deg,#005982,#8FA83C,#FFF100)"
        testId="wb-temperature"
      />
      <ScrubSlider
        label={t('cameraTint')}
        sublabel={<AsShotLine on={wb.boxes.tint} enabled={!!wb.asShot && !wb.reason} onChange={(v) => setDecode((d) => applyBoxes(d, wb.asShot, { tint: v }))} />}
        value={wb.shown.tint}
        range={TINT_RANGE}
        zero={wb.asShot?.tint ?? 0}
        snap={5}
        format={signed(1)}
        onChange={(v) => setDecode((d) => withTint(d, wb.asShot, v))}
        disabled={!!wb.reason}
        reason={wb.reason ?? undefined}
        gradient="linear-gradient(90deg,#00A93A,#8AA45E,#E4007F)"
        testId="wb-tint"
      />
      <button className="pill" disabled={!pickerReady} onClick={startNeutralPick} aria-pressed={tool === 'neutral'} data-testid="pick-neutral">
        {tool === 'neutral' ? tz('Cancel neutral picker', '取消中性灰取样') : tz('Pick neutral white balance', '吸取中性灰白平衡')}
      </button>
      <ScrubSlider label={t('cameraVignetting')} value={vignette} range={[-100, 100]} snap={5} format={signed(0)} onChange={(v) => setAdjustments((a) => ({ ...a, vignette: { ...a.vignette, amount: v } }))} />
      <ToggleRow label={t('cameraLensCorrection')} on={selectedDecode(state).lensCorrection} onChange={(v) => setDecode((d) => ({ ...d, lensCorrection: v }))} disabled={!lensReady} reason={!lensReady ? lensReason : undefined} testId="lens-correction" />
      <p className="caption" data-testid="lens-profile">{lensReady ? `${lens?.profile ?? ''}${lensParts ? ` · ${lensParts}` : ''}` : lensReason}</p>
    </Section>
  );
}

/** "As Shot ☐" — the second line under Temperature and Tint (`AsShotLine`). */
function AsShotLine({ on, enabled, onChange }: { on: boolean; enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {t('cameraFilmExposureAsShot')}
      <Checkbox on={on} label={t('cameraFilmExposureAsShot')} disabled={!enabled} onChange={onChange} />
    </span>
  );
}

/**
 * The decode white balance as the rows read it (`WhiteBalanceRows.swift`):
 * RAW only, and only on a host that can re-decode (R2's `redecode`).
 */
function useWhiteBalance() {
  const decode = useSession(selectedDecode);
  const shot = useSession((s) => { const side = pairFocus(s); return side ? s.pairInfo?.[side]?.metadata?.as_shot : s.metadata?.as_shot; });
  const selection = useSession((s) => s.selection);
  const kind = useSession((s) => { const side = pairFocus(s); return side ? s.pairInfo?.[side]?.kind : s.frameKind; });
  const methods = useSession((s) => s.hello?.methods);
  const asShot: AsShot | null = shot ? { temperature: shot.temperature_k, tint: shot.tint } : null;
  const isRaw = kind ? kind === 'raw' : !!selection && isRawPath(selection);
  let reason: string | null = null;
  if (selection && !isRaw) reason = t('reasonDecodeWBDisabled');
  else if (!hostRedecodes(methods))
    reason = tz('This engine host cannot change white balance at decode (it has no `redecode`).', '此引擎进程不能在解码时更改白平衡（没有 `redecode`）。');
  return { mode: modeOf(decode), shown: shownDecode(decode, asShot), boxes: boxesOf(decode, asShot), asShot, reason };
}

// --------------------------------------------------------------- Film Format

function FilmFormatSection() {
  const p = useSession((s) => s.sidecar.params);
  const gate = useSession((s) => s.gate);
  const monochrome = useSession((s) => s.catalog.isMonochrome(s.sidecar.params.filmStock));
  // CineStill 800T: no layer to put back, and the engine reads its own tag whatever the switch says.
  const noLayer = useSession((s) => s.catalog.hasNoAntihalationLayer(s.sidecar.params.filmStock));
  const unit = useSettings((s) => s.sideUnit);
  const decouple = useSettings((s) => s.decoupleEffects);
  const isCustom = p.filmFrame === FILM_FRAME_CUSTOM.id;
  const heldFrame = edgeEffective(p.filmEdge, gate) ? edgeFormat(p.filmEdge.format) : undefined;
  const heldReason = heldFrame ? tz(
    `Set by Film Edge: ${heldFrame.label} (${heldFrame.long} × ${heldFrame.short} mm). Switch Film Edge off to choose a frame here.`,
    `由片边设定：${heldFrame.label}（${heldFrame.long} × ${heldFrame.short} mm）。关闭片边后可在此选择画幅。`,
  ) : undefined;
  const lengthDisabled = !!heldFrame || !isCustom;
  const e = p.effects;
  const setE = (patch: Partial<typeof e>) => setParams((q) => ({ ...q, effects: { ...q.effects, ...patch } }));
  const strength = (label: string, key: 'grain' | 'halation' | 'scatter' | 'couplers' | 'glare', enabled: boolean) => (
    <ScrubSlider label={label} value={e[key]} range={[...EFFECT_RANGES[key]] as [number, number]} zero={1} snap={0.25} format={(v) => v.toFixed(2)} disabled={!enabled} reason={t('reasonEffectOff')} onChange={(v) => setE({ [key]: v })} />
  );
  return (
    <Section
      id="filmFormat"
      title={t('filmFormat')}
      onReset={() => {
        // The gate overrides the physical frame without replacing its saved
        // controls. An effects reset must leave that held choice intact too.
        if (!heldFrame) {
          setFilmFrame('135');
          setFilmSide('short');
        }
        setParams((q) => ({ ...q, grainActive: true, halationActive: true, glareActive: true, effects: EFFECTS_DEFAULT }));
      }}
      resetHelp={t('helpResetFilmFormat')}
      menu={[
        { label: t('helpAllEffectsOn'), onSelect: () => setParams((q) => ({ ...q, grainActive: true, halationActive: true, glareActive: true })) },
        { label: t('helpAllEffectsOff'), onSelect: () => setParams((q) => ({ ...q, grainActive: false, halationActive: false, glareActive: false })) },
        { label: t('helpResetEffectStrengths'), onSelect: () => setParams((q) => ({ ...q, effects: EFFECTS_DEFAULT })) },
        { label: monochrome ? tz('Single-layer grain (black-and-white film)', '单层颗粒（黑白胶片）') : t('helpSubLayerGrain'),
          checked: monochrome || e.grainLayered, disabled: !p.grainActive || monochrome, onSelect: () => setE({ grainLayered: !e.grainLayered }) },
      ]}
    >
      <PillMenu
        label={t('filmFormatSize')}
        value={p.filmFrame}
        options={FILM_FRAMES.map((f) => ({ value: f.id, label: f.id, badge: f.isCine ? 'CINE' : undefined }))}
        onChange={(v) => setFilmFrame(v)}
        display={heldFrame?.label}
        disabled={!!heldFrame}
        reason={heldReason}
        testId="film-format-size"
      />
      <PillMenu
        label={t('filmFormatSide')}
        value={p.filmSide}
        options={[
          { value: 'short', label: t('filmFormatShort') },
          { value: 'long', label: t('filmFormatLong') },
        ]}
        onChange={(v) => setFilmSide(v)}
        disabled={!!heldFrame}
        reason={heldReason}
        testId="film-format-side"
      />
      <div className={'row' + (lengthDisabled ? ' disabled' : '')} title={heldReason ?? (isCustom ? undefined : t('reasonNonCustomSideLength'))}>
        <span className="row-label">{t('filmFormatSideLength')}</span>
        <NumberField
          value={p.sideLengthMM / SIDE_UNIT_PER_MM[unit]}
          decimals={SIDE_UNIT_DECIMALS[unit]}
          label={t('filmFormatSideLength')}
          onCommit={(v) => setSideLengthMM(v * SIDE_UNIT_PER_MM[unit])}
          disabled={lengthDisabled}
        />
        <PillMenu<SideUnit>
          value={unit}
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'cm', label: 'cm' },
            { value: 'inch', label: 'inch' },
          ]}
          onChange={(v) => settingsStore.getState().set('sideUnit', v)}
          disabled={!!heldFrame}
          reason={heldReason}
          testId="film-format-unit"
        />
      </div>
      <ToggleRow label={t('filmGrain')} on={p.grainActive} onChange={(v) => setParams((q) => ({ ...q, grainActive: v }))} testId="grain-toggle" />
      {decouple && strength(t('filmGrainStrength'), 'grain', p.grainActive)}
      <ToggleRow label={t('filmHalation')} on={p.halationActive} onChange={(v) => setParams((q) => ({ ...q, halationActive: v }))} />
      {noLayer ? (
        <ToggleRow label={t('filmAntihalationLayer')} on={false} disabled reason={t('reasonNoAntihalationLayer')} onChange={() => {}} testId="antihalation-toggle" />
      ) : (
        <ToggleRow label={t('filmAntihalationLayer')} on={!e.antihalationRemoved} disabled={!p.halationActive} reason={t('reasonEffectOff')} onChange={(v) => setE({ antihalationRemoved: !v })} testId="antihalation-toggle" />
      )}
      {/* 1.3.4: offered on a film with no anti-halation layer only (the one film whose halo the
          engine draws from it), in both layouts, under the layer it belongs to. */}
      {noLayer && (
        <ScrubSlider label={t('filmHighlightHeadroom')} value={e.highlightHeadroom} range={[...EFFECT_RANGES.highlightHeadroom] as [number, number]} zero={4} snap={0.5} format={(v) => v.toFixed(1)} disabled={!p.halationActive} reason={t('reasonEffectOff')} onChange={(v) => setE({ highlightHeadroom: v })} testId="headroom-slider" />
      )}
      {decouple && (
        <>
          {strength(t('filmHalationStrength'), 'halation', p.halationActive)}
          {strength(t('filmScatterStrength'), 'scatter', p.halationActive)}
          <ScrubSlider label={t('filmHighlightBoost')} value={e.highlightBoost} range={[0, 8]} snap={0.5} format={(v) => v.toFixed(1)} disabled={!p.halationActive} onChange={(v) => setE({ highlightBoost: v })} />
          <ToggleRow label={t('filmCouplers')} on={e.couplersActive} onChange={(v) => setE({ couplersActive: v })} />
          {strength(t('filmCouplersStrength'), 'couplers', e.couplersActive)}
        </>
      )}
      <ToggleRow label={t('filmGlare')} on={p.glareActive} disabled={!p.printEffects} reason={t('reasonPrintEffectsOff')} onChange={(v) => setParams((q) => ({ ...q, glareActive: v }))} />
      {decouple && strength(t('filmGlareStrength'), 'glare', p.glareActive && p.printEffects)}
    </Section>
  );
}

// -------------------------------------------------------------- Development

/** P1-7: push/pull and developer temperature, for film already exposed and
 *  developed. The engine folds temperature into an equivalent push, so this is
 *  one continuous control with a separate temperature trim. */
function DevelopmentSection() {
  const p = useSession((s) => s.sidecar.params);
  const d = p.development;
  const setD = (patch: Partial<typeof d>) => setParams((q) => ({ ...q, development: { ...q.development, ...patch } }));
  return (
    <Section
      id="development"
      title={tz('Development', '显影')}
      onReset={() => setD(DEVELOPMENT_DEFAULT)}
      resetHelp={tz('Reset push/pull and temperature.', '重置推拉与显影温度。')}
    >
      <ToggleRow
        label={tz('Push / pull', '推拉显影')}
        on={d.active}
        onChange={(v) => setD({ active: v })}
        testId="development-toggle"
      />
      <ScrubSlider
        label={tz('Push stops', '推拉档位')}
        value={d.pushStops}
        range={[...DEVELOPMENT_PUSH_RANGE] as [number, number]}
        zero={0}
        snap={1 / 3}
        format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)}
        disabled={!d.active}
        reason={tz('Enable push/pull first.', '请先启用推拉显影。')}
        onChange={(v) => setD({ pushStops: v })}
        testId="development-push"
      />
      <ScrubSlider
        label={tz('Developer temperature', '显影温度')}
        value={d.temperatureC}
        range={[...DEVELOPMENT_TEMPERATURE_RANGE] as [number, number]}
        zero={20}
        snap={0.5}
        format={(v) => v.toFixed(1) + ' °C'}
        disabled={!d.active}
        reason={tz('Enable push/pull first.', '请先启用推拉显影。')}
        onChange={(v) => setD({ temperatureC: v })}
        testId="development-temperature"
      />
    </Section>
  );
}

// ---------------------------------------------------------------- Lighting

/** P1-8: the lights the print is read and viewed under. Both default to the
 *  print stock's own viewing illuminant, which is the pre-P1-8 colour path. */
function LightingSection() {
  const p = useSession((s) => s.sidecar.params);
  const set = (patch: Partial<typeof p>) => setParams((q) => ({ ...q, ...patch }));
  const stockDefault = tz('Stock default', '片基默认');
  const sameAsScan = tz('Same as scan', '同扫描光源');
  const scanOptions = ILLUMINANTS.map((v) => ({ value: v, label: v === '' ? stockDefault : illuminantLabel(v) }));
  const viewOptions = [
    { value: '', label: sameAsScan },
    ...ILLUMINANTS.filter((v) => v !== '').map((v) => ({ value: v, label: illuminantLabel(v) })),
  ];
  return (
    <Section
      id="lighting"
      title={tz('Lighting', '光源')}
      onReset={() => set({ scanIlluminant: '', viewingIlluminant: '' })}
      resetHelp={tz('Back to the print stock\'s own light.', '恢复为相纸默认光源。')}
    >
      <PillMenu
        label={tz('Scan light', '扫描光源')}
        value={p.scanIlluminant}
        options={scanOptions}
        onChange={(v) => set({ scanIlluminant: v })}
        display={p.scanIlluminant === '' ? stockDefault : illuminantLabel(p.scanIlluminant)}
        testId="scan-illuminant"
      />
      <PillMenu
        label={tz('View light', '观看光源')}
        value={p.viewingIlluminant}
        options={viewOptions}
        onChange={(v) => set({ viewingIlluminant: v })}
        display={p.viewingIlluminant === '' ? sameAsScan : illuminantLabel(p.viewingIlluminant)}
        testId="viewing-illuminant"
      />
    </Section>
  );
}

// ----------------------------------------------------------- Scene Placement

function ScenePlacementSection() {
  const s = useSession((s) => s);
  const sl = s.sidecar.params.sceneLatitude, l = s.latitude;
  const unsupported = unsupportedReason('scene_latitude_mapping', s.gate.sceneLatitude);
  const ready = placementReady();
  const reason = unsupported ?? (s.sidecar.noFilm ? tz('Scene placement is unavailable while film simulation is bypassed.', '不应用胶片模拟时不使用场景置位。') : s.sidecar.params.digitalIntermediate && !s.sidecar.params.scanFilm
    ? tz('Scene placement is unavailable in Digital Intermediate mode.', '数字中间片模式不使用场景置位。')
    : ready ? null : l.failure ?? tz('Waiting for the scene latitude measurement…', '正在等待场景宽容度测量…'));
  const row = (side: PlacementSide) => {
    const window = currentPlacementWindow(side);
    const why = placementMessage(l.refusal ?? (window?.span === null ? window.below : null), side, l.reply, isChinese());
    return <div key={side}>
      <ScrubSlider label={side === 'highlight' ? t('placementHighlight') : t('placementShadow')}
        value={side === 'highlight' ? sl.highlightPullBack : sl.shadowPullBack} range={[0, 8]} snap={0.25}
        format={(v) => v.toFixed(2)} onChange={(v) => placeScene(side, v)} disabled={!ready}
        reason={reason ?? undefined} usable={window?.span ? [window.span] : []} testId={`placement-${side}`} />
      {why && <div className="caption" data-testid={`placement-${side}-reason`}>{why}</div>}
    </div>;
  };
  return (
    <Section id="scenePlacement" title={t('sectionScenePlacement')} unsupported={unsupported} onReset={resetScenePlacement} resetHelp={t('helpResetPlacement')} resetEnabled={s.gate.sceneLatitude && (sl.active || sl.highlightPullBack > 0 || sl.shadowPullBack > 0)}>
      {reason && !unsupported && <p className="caption">{reason}</p>}
      {row('highlight')}{row('shadow')}
    </Section>
  );
}

// ---------------------------------------------------------------- Post-Dev

function WhiteBalanceSection() {
  const a = useSession(shownAdjustments);
  return (
    <Section id="wb2" title={t('sectionWhiteBalance')} trailing={t('statusRightRailWBScope')} onReset={() => setAdjustments((q) => ({ ...q, temperature: 0, tint: 0 }))} resetHelp={t('helpReset')}>
      <ScrubSlider label={tz('Temp.', '色温偏移')} value={a.temperature} range={[-100, 100]} snap={5} format={signed(0)} gradient="linear-gradient(90deg,#5d7de8,#bbb,#e8c04e)" onChange={(v) => setAdjustments((q) => ({ ...q, temperature: v }))} />
      <ScrubSlider label={tz('Tint', '色调偏移')} value={a.tint} range={[-100, 100]} snap={5} format={signed(0)} gradient="linear-gradient(90deg,#62c462,#bbb,#d05bd0)" onChange={(v) => setAdjustments((q) => ({ ...q, tint: v }))} />
    </Section>
  );
}

function ExposureSection() {
  const a = useSession(shownAdjustments);
  const row = (label: string, key: 'exposure' | 'contrast' | 'brightness' | 'saturation' | 'highlights' | 'shadows' | 'blackPoint' | 'whitePoint', range: [number, number], digits: number, snap: number) => (
    <ScrubSlider key={key} label={label} value={a[key]} range={range} snap={snap} format={signed(digits)} onChange={(v) => setAdjustments((q) => ({ ...q, [key]: v }))} testId={'adj-' + key} />
  );
  return (
    <Section
      id="exposure2"
      title={t('sectionExposure')}
      onReset={() => setAdjustments((q) => ({ ...q, exposure: 0, contrast: 0, brightness: 0, saturation: 0, highlights: 0, shadows: 0, blackPoint: 0, whitePoint: 0 }))}
      resetHelp={t('helpReset')}
    >
      {row(t('clipExposure'), 'exposure', [-3, 3], 2, 1 / 4)}
      {row(t('exposureContrast'), 'contrast', [-50, 50], 0, 5)}
      {row(t('exposureBrightness'), 'brightness', [-50, 50], 0, 5)}
      {row(t('exposureSaturation'), 'saturation', [-100, 100], 0, 5)}
      {row(t('exposureHighlights'), 'highlights', [-100, 100], 0, 5)}
      {row(t('exposureShadows'), 'shadows', [-100, 100], 0, 5)}
      {row(t('exposureBlackPoint'), 'blackPoint', [0, 50], 0, 1)}
      {row(t('exposureWhitePoint'), 'whitePoint', [0, 50], 0, 1)}
    </Section>
  );
}

const CHANNEL_LABEL: Record<CurveChannel, () => string> = {
  rgb: () => 'RGB',
  luma: () => t('curveLuma'),
  red: () => t('curveRed'),
  green: () => t('curveGreen'),
  blue: () => t('curveBlue'),
};

function CurveSection() {
  const [ch, setCh] = useState<CurveChannel>('rgb');
  return (
    <Section
      id="curve"
      title={t('sectionCurve')}
      onReset={() => setAdjustments((q) => ({ ...q, curves: { ...q.curves, [ch]: { points: [[0, 0], [1, 1]] } } }))}
      resetHelp={t('helpReset')}
      menu={[{ label: t('helpResetChannels'), onSelect: () => setAdjustments((q) => ({ ...q, curves: { rgb: { points: [[0, 0], [1, 1]] }, luma: { points: [[0, 0], [1, 1]] }, red: { points: [[0, 0], [1, 1]] }, green: { points: [[0, 0], [1, 1]] }, blue: { points: [[0, 0], [1, 1]] } } })) }]}
    >
      <div className="row" style={{ gap: 4 }}>
        {CURVE_CHANNELS.map((c) => (
          <button key={c} className={'btn' + (c === ch ? ' primary' : '')} style={{ height: 18, padding: '0 8px', fontSize: 'var(--fs-small)' }} onClick={() => setCh(c)}>
            {CHANNEL_LABEL[c]()}
          </button>
        ))}
      </div>
      <CurveEditor channel={ch} />
    </Section>
  );
}

const ZONES: { key: 'master' | 'shadows' | 'midtones' | 'highlights'; label: () => string }[] = [
  { key: 'master', label: () => tz('Master', '整体') },
  { key: 'shadows', label: () => t('exposureShadows') },
  { key: 'midtones', label: () => t('balanceMidtones') },
  { key: 'highlights', label: () => t('exposureHighlights') },
];

function ColorBalanceSection() {
  const cb = useSession((s) => shownAdjustments(s).colorBalance);
  const [zone, setZone] = useState<(typeof ZONES)[number]['key']>('master');
  const z = cb[zone];
  const setZ = (patch: Partial<ColorZone>) => setAdjustments((q) => ({ ...q, colorBalance: { ...q.colorBalance, [zone]: { ...q.colorBalance[zone], ...patch } } }));
  return (
    <Section
      id="colorbalance"
      title={t('sectionColorBalance')}
      onReset={() => setAdjustments((q) => ({ ...q, colorBalance: { master: zero, shadows: zero, midtones: zero, highlights: zero } }))}
      resetHelp={t('helpReset')}
    >
      <div className="row" style={{ gap: 4 }}>
        {ZONES.map((zz) => (
          <button key={zz.key} className={'btn' + (zz.key === zone ? ' primary' : '')} style={{ height: 18, padding: '0 8px', fontSize: 'var(--fs-small)' }} onClick={() => setZone(zz.key)}>
            {zz.label()}
          </button>
        ))}
      </div>
      <HueWheel zone={z} onChange={setZ} />
      <ScrubSlider label={tz('Hue', '色相')} value={z.hue} range={[0, 360]} snap={15} format={(v) => v.toFixed(0) + '°'} gradient="linear-gradient(90deg,#e8524e,#e8c04e,#62c462,#4ec0e8,#5d7de8,#d05bd0,#e8524e)" onChange={(v) => setZ({ hue: v })} />
      <ScrubSlider label={t('exposureSaturation')} value={z.saturation} range={[0, 1]} snap={0.05} onChange={(v) => setZ({ saturation: v })} />
      <ScrubSlider label={tz('Luminance', '亮度')} value={z.luminance} range={[-1, 1]} snap={0.05} format={signed(2)} onChange={(v) => setZ({ luminance: v })} />
    </Section>
  );
}
const zero: ColorZone = { hue: 0, saturation: 0, luminance: 0 };

/** A small hue/saturation disc: drag to set both (the Mac's ColorWheel, simplified). */
function HueWheel({ zone, onChange }: { zone: ColorZone; onChange: (z: Partial<ColorZone>) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const R = 46;
  const set = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const sat = Math.min(1, Math.hypot(dx, dy) / R);
    const hue = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
    onChange({ hue, saturation: sat });
  };
  const a = (zone.hue * Math.PI) / 180;
  return (
    <div className="row" style={{ justifyContent: 'center' }}>
      <svg
        ref={ref}
        width={R * 2 + 6}
        height={R * 2 + 6}
        viewBox={`${-R - 3} ${-R - 3} ${R * 2 + 6} ${R * 2 + 6}`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          set(e);
        }}
        onPointerMove={(e) => e.buttons && set(e)}
        style={{ cursor: 'crosshair' }}
      >
        <defs>
          <radialGradient id="wheel-fade">
            <stop offset="0" stopColor="#2d2d2c" stopOpacity="1" />
            <stop offset="1" stopColor="#2d2d2c" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle r={R} fill="none" stroke="url(#hue)" />
        {Array.from({ length: 36 }, (_, i) => {
          const a0 = (i * 10 * Math.PI) / 180;
          const a1 = ((i + 1) * 10 * Math.PI) / 180;
          return <path key={i} d={`M0 0 L${R * Math.cos(a0)} ${-R * Math.sin(a0)} A${R} ${R} 0 0 0 ${R * Math.cos(a1)} ${-R * Math.sin(a1)} Z`} fill={`hsl(${i * 10 + 5} 55% 50%)`} />;
        })}
        <circle r={R} fill="url(#wheel-fade)" />
        <circle cx={zone.saturation * R * Math.cos(a)} cy={-zone.saturation * R * Math.sin(a)} r={4} fill="none" stroke="var(--knob)" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

// -------------------------------------------------------------- Tone Mask

/** P0-1: the Tone Mask is a print-side local contrast node. It is enabled by
 *  the host's `contrast_mask` capability; the engine ignores it unless print
 *  effects are on, so the toggle explains that rather than silently refusing. */
function ToneMaskSection() {
  const p = useSession((s) => s.sidecar.params);
  const gate = useSession((s) => s.gate);
  const reason = unsupportedReason('contrast_mask', gate.contrastMask);
  const m = p.contrastMask;
  const setM = (patch: Partial<typeof m>) => setParams((q) => ({ ...q, contrastMask: { ...q.contrastMask, ...patch } }));
  const printOff = !p.printEffects;
  const disabled = !!reason || printOff;
  const why = printOff ? t('reasonPrintEffectsOff') : (reason ?? undefined);
  const radiusPercent = m.scale * 100;
  return (
    <Section
      id="toneMask"
      title={t('sectionToneMask')}
      onReset={() => setM(CONTRAST_MASK_DEFAULT)}
      resetHelp={t('helpResetToneMask')}
      unsupported={reason}
    >
      <ToggleRow
        label={t('maskEnable')}
        on={m.active}
        disabled={disabled}
        reason={why}
        onChange={(v) => setM({ active: v })}
        testId="mask-toggle"
      />
      <p className="caption">{t('maskCurveCaption')}</p>
      <ScrubSlider
        label={t('maskHighlights')}
        value={m.highlights}
        range={[0, 3]}
        zero={0}
        snap={0.1}
        format={(v) => v.toFixed(2)}
        disabled={!m.active || disabled}
        reason={why}
        onChange={(v) => setM({ highlights: v })}
        testId="mask-highlights"
      />
      <ScrubSlider
        label={t('maskShadows')}
        value={m.shadows}
        range={[0, 3]}
        zero={0}
        snap={0.1}
        format={(v) => v.toFixed(2)}
        disabled={!m.active || disabled}
        reason={why}
        onChange={(v) => setM({ shadows: v })}
        testId="mask-shadows"
      />
      <ScrubSlider
        label={t('maskCore')}
        value={m.core}
        range={[0, 3]}
        zero={1}
        snap={0.1}
        format={(v) => v.toFixed(2)}
        disabled={!m.active || disabled}
        reason={why}
        onChange={(v) => setM({ core: v })}
        testId="mask-core"
      />
      <ScrubSlider
        label={t('maskRadius')}
        value={radiusPercent}
        range={[CONTRAST_MASK_SCALE[0] * 100, CONTRAST_MASK_SCALE[1] * 100]}
        zero={3}
        snap={0.1}
        format={(v) => v.toFixed(1) + ' %'}
        disabled={!m.active || disabled}
        reason={why}
        onChange={(v) => setM({ scale: v / 100 })}
        testId="mask-radius"
      />
    </Section>
  );
}


// ------------------------------------------------------------------- Presets

function PresetsSection() {
  const presets = usePresets((s) => s.presets);
  const ready = usePresets((s) => s.ready);
  const error = usePresets((s) => s.error);
  const hasPhoto = useSession((s) => !!s.sidecar);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const save = () => {
    const trimmed = name.trim() || `Preset ${presets.length + 1}`;
    if (!hasPhoto) return;
    void saveCurrentPreset(trimmed).then((id) => { if (id) setName(''); });
  };

  return (
    <Section id="presets" title={tz('Presets', '预设')}>
      <div className="preset-save">
        <input
          className="preset-name-input"
          data-testid="preset-name"
          value={name}
          placeholder={tz('Preset name', '预设名称')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <button className="btn" data-testid="preset-save" disabled={!hasPhoto} onClick={save}>{tz('Save current', '保存当前')}</button>
      </div>
      {error && <p className="caption caption-error">{error}</p>}
      {presets.length === 0 ? (
        <p className="caption">{tz('No presets yet. Save the current settings to reuse them on another photograph.', '还没有预设。把当前设置保存下来，就能套用到其他照片。')}</p>
      ) : (
        <ul className="preset-list" data-testid="preset-list">
          {presets.map((preset) => (
            <li className="preset-row" key={preset.id}>
              {renaming?.id === preset.id ? (
                <input
                  className="preset-name-input"
                  autoFocus
                  data-testid="preset-rename"
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: preset.id, name: e.target.value })}
                  onBlur={() => { void renamePreset(preset.id, renaming.name); setRenaming(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { void renamePreset(preset.id, renaming.name); setRenaming(null); }
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <button
                  className="preset-name"
                  data-testid="preset-apply"
                  title={tz('Apply preset', '应用预设')}
                  disabled={!hasPhoto}
                  onClick={() => applyPreset(preset.id)}
                >{preset.name}</button>
              )}
              <button className="preset-icon" title={tz('Rename', '重命名')} onClick={() => setRenaming({ id: preset.id, name: preset.name })}>✎</button>
              <button className="preset-icon" title={tz('Delete', '删除')} onClick={() => void deletePreset(preset.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      {ready && <p className="caption">{tz('Applying a preset is an undoable edit stored in this photograph\'s sidecar.', '应用预设是一次可撤销的编辑，会写进这张照片的 sidecar。')}</p>}
    </Section>
  );
}

// ------------------------------------------------------- Local adjustments

function LocalAdjustmentsSection() {
  const adjustments = useSession((s) => shownAdjustments(s));
  const layers = adjustments.local ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = layers.find((l) => l.id === selectedId) ?? layers[0];

  const update = (patch: Partial<LocalAdjustment>) => {
    if (!selected) return;
    setAdjustments((a) => ({
      ...a,
      local: (a.local ?? []).map((l) => (l.id === selected.id ? { ...l, ...patch } : l)),
    }));
  };
  const add = (kind: 'linear' | 'radial') => {
    const layer = createLocalAdjustment(kind);
    setAdjustments((a) => ({ ...a, local: [...(a.local ?? []), layer] }));
    setSelectedId(layer.id);
  };
  const remove = (id: string) => {
    setAdjustments((a) => ({ ...a, local: (a.local ?? []).filter((l) => l.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <Section
      id="local"
      title={tz('Local Adjustments', '局部调整')}
      onReset={() => setAdjustments((a) => ({ ...a, local: [] }))}
      resetHelp={tz('Remove all local adjustments', '移除全部局部调整')}
      resetEnabled={layers.length > 0}
    >
      <div className="local-add-row">
        <button className="btn" data-testid="local-add-linear" onClick={() => add('linear')}>{tz('+ Linear gradient', '＋线性渐变')}</button>
        <button className="btn" data-testid="local-add-radial" onClick={() => add('radial')}>{tz('+ Radial', '＋径向')}</button>
      </div>
      {layers.length === 0 ? (
        <p className="caption">
          {tz(
            'Local adjustments are masked grades the host applies after the print is rendered. They never change the negative or the paper curve.',
            '局部调整是带蒙版的调色，由宿主在印片渲染完成后施加；不会改变负片和相纸曲线。',
          )}
        </p>
      ) : (
        <>
          <div className="local-list" data-testid="local-list">
            {layers.map((layer, index) => (
              <button
                key={layer.id}
                className={'local-chip' + (layer.id === selected?.id ? ' is-active' : '')}
                data-testid={'local-layer-' + index}
                onClick={() => setSelectedId(layer.id)}
              >
                <span className="local-chip-label">{localAdjustmentLabel(layer, index)}</span>
                <span
                  className="local-chip-remove"
                  title={tz('Remove', '移除')}
                  onClick={(e) => { e.stopPropagation(); remove(layer.id); }}
                >✕</span>
              </button>
            ))}
          </div>
          {selected && (
            <>
              <p className="caption">
                {selected.kind === 'linear'
                  ? tz('Linear gradient: the grade ramps in from one point to another.', '线性渐变：调色沿两点之间的方向渐入。')
                  : tz('Radial: the grade is strongest at the centre and fades out.', '径向：中心最强，向外淡出。')}
              </p>
              <ScrubSlider
                label={tz('Exposure', '曝光')}
                value={selected.exposure}
                range={LOCAL_GRADE_RANGE.exposure}
                snap={0.05}
                format={signed(2)}
                onChange={(v) => update({ exposure: v })}
                testId="local-exposure"
              />
              <ScrubSlider label={tz('Contrast', '对比度')} value={selected.contrast} range={[-100, 100]} snap={5} format={signed(0)} onChange={(v) => update({ contrast: v })} testId="local-contrast" />
              <ScrubSlider label={tz('Highlights', '高光')} value={selected.highlights} range={[-100, 100]} snap={5} format={signed(0)} onChange={(v) => update({ highlights: v })} testId="local-highlights" />
              <ScrubSlider label={tz('Shadows', '阴影')} value={selected.shadows} range={[-100, 100]} snap={5} format={signed(0)} onChange={(v) => update({ shadows: v })} testId="local-shadows" />
              <ScrubSlider label={tz('Saturation', '饱和度')} value={selected.saturation} range={[-100, 100]} snap={5} format={signed(0)} onChange={(v) => update({ saturation: v })} testId="local-saturation" />
              <ScrubSlider label={tz('Temperature', '色温')} value={selected.temperature} range={[-100, 100]} snap={5} format={signed(0)} gradient="linear-gradient(90deg,#5d7de8,#bbb,#e8c04e)" onChange={(v) => update({ temperature: v })} testId="local-temperature" />
              <ScrubSlider label={tz('Tint', '色调')} value={selected.tint} range={[-100, 100]} snap={5} format={signed(0)} gradient="linear-gradient(90deg,#62c462,#bbb,#d05bd0)" onChange={(v) => update({ tint: v })} testId="local-tint" />
              <ScrubSlider
                label={tz('Feather', '羽化')}
                value={selected.feather * 100}
                range={[0, 100]}
                snap={5}
                format={(v) => `${Math.round(v)}%`}
                onChange={(v) => update({ feather: v / 100 })}
                testId="local-feather"
              />
              <ToggleRow label={tz('Invert mask', '反转蒙版')} on={selected.invert} onChange={(v) => update({ invert: v })} testId="local-invert" />
              {selected.kind === 'linear' ? (
                <>
                  <ScrubSlider label={tz('Start X', '起点 X')} value={selected.x0} range={[-0.2, 1.2]} snap={0.01} format={pct} onChange={(v) => update({ x0: v })} testId="local-x0" />
                  <ScrubSlider label={tz('Start Y', '起点 Y')} value={selected.y0} range={[-0.2, 1.2]} snap={0.01} format={pct} onChange={(v) => update({ y0: v })} testId="local-y0" />
                  <ScrubSlider label={tz('End X', '终点 X')} value={selected.x1} range={[-0.2, 1.2]} snap={0.01} format={pct} onChange={(v) => update({ x1: v })} testId="local-x1" />
                  <ScrubSlider label={tz('End Y', '终点 Y')} value={selected.y1} range={[-0.2, 1.2]} snap={0.01} format={pct} onChange={(v) => update({ y1: v })} testId="local-y1" />
                </>
              ) : (
                <>
                  <ScrubSlider label={tz('Centre X', '中心 X')} value={selected.cx} range={[-0.2, 1.2]} snap={0.01} format={pct} onChange={(v) => update({ cx: v })} testId="local-cx" />
                  <ScrubSlider label={tz('Centre Y', '中心 Y')} value={selected.cy} range={[-0.2, 1.2]} snap={0.01} format={pct} onChange={(v) => update({ cy: v })} testId="local-cy" />
                  <ScrubSlider label={tz('Radius', '半径')} value={selected.radius * 100} range={[2, 200]} snap={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => update({ radius: v / 100 })} testId="local-radius" />
                </>
              )}
              <p className="caption">
                {tz(
                  'Masks are placed in the finished frame (after crop and rotation). Moving the crop moves the mask with it.',
                  '蒙版定位在成片画面（裁剪与旋转之后）；改变裁剪会一起移动蒙版。',
                )}
              </p>
            </>
          )}
        </>
      )}
    </Section>
  );
}
