// history.ts — one line of the history list: what an undo step changed.
//
// The stack stores full snapshots (`UndoEntry` in state/session.ts); a person
// reading the list needs the change between two neighbours. Keep this pure so
// the wording is testable without a store.

import { tz } from '../i18n';
import type { UndoEntry } from '../state/session';

type Snapshot = Pick<UndoEntry, 'noFilm' | 'params' | 'adjustments' | 'geometry' | 'decode'>;

const PARAM_FIELDS: { key: keyof Snapshot['params']; en: string; zh: string; unit?: string }[] = [
  { key: 'exposureCompensationEV', en: 'Exposure compensation', zh: '曝光补偿', unit: ' EV' },
  { key: 'printBrightnessStops', en: 'Print brightness', zh: '印放亮度', unit: ' stops' },
  { key: 'preflashExposure', en: 'Preflash', zh: '预闪', unit: ' EV' },
  { key: 'filmFormatMM', en: 'Film format', zh: '胶片画幅', unit: ' mm' },
  { key: 'scanFilm', en: 'Scan film', zh: '扫描负片' },
  { key: 'digitalIntermediate', en: 'Digital intermediate', zh: '数字中间片' },
  { key: 'extendedDynamicRange', en: 'Extended dynamic range', zh: '扩展动态范围' },
  { key: 'printEffects', en: 'Print effects', zh: '印放效果' },
  { key: 'grainActive', en: 'Grain', zh: '颗粒' },
  { key: 'halationActive', en: 'Halation', zh: '光晕' },
  { key: 'glareActive', en: 'Glare', zh: '眩光' },
  { key: 'autoExposure', en: 'Auto exposure', zh: '自动曝光' },
  { key: 'scanIlluminant', en: 'Scan light', zh: '扫描光源' },
  { key: 'viewingIlluminant', en: 'Viewing light', zh: '观看光源' },
];

const ADJUSTMENT_FIELDS: { key: keyof Snapshot['adjustments']; en: string; zh: string; unit?: string }[] = [
  { key: 'enabled', en: 'Adjustments', zh: '调整' },
  { key: 'temperature', en: 'Temperature', zh: '色温' },
  { key: 'tint', en: 'Tint', zh: '色调' },
  { key: 'exposure', en: 'Exposure', zh: '曝光' },
  { key: 'contrast', en: 'Contrast', zh: '对比度' },
  { key: 'brightness', en: 'Brightness', zh: '亮度' },
  { key: 'saturation', en: 'Saturation', zh: '饱和度' },
  { key: 'highlights', en: 'Highlights', zh: '高光' },
  { key: 'shadows', en: 'Shadows', zh: '阴影' },
  { key: 'blackPoint', en: 'Black point', zh: '黑场' },
  { key: 'whitePoint', en: 'White point', zh: '白场' },
  { key: 'vignette', en: 'Vignette', zh: '暗角' },
];

function changed(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** A short, human line for the step that moved `before` to `after`. */
export function describeChange(before: Snapshot | null, after: Snapshot, stockName: (id: string) => string): string {
  if (!before) return tz('Initial state', '初始状态');
  const p0 = before.params, p1 = after.params;
  if (p0.filmStock !== p1.filmStock) return tz(`Film → ${stockName(p1.filmStock)}`, `胶片 → ${stockName(p1.filmStock)}`);
  if (p0.printStock !== p1.printStock) return tz(`Paper → ${stockName(p1.printStock)}`, `相纸 → ${stockName(p1.printStock)}`);
  if ((before.noFilm ?? false) !== (after.noFilm ?? false)) {
    return (after.noFilm ?? false) ? tz('Film simulation off', '关闭胶片模拟') : tz('Film simulation on', '开启胶片模拟');
  }
  const minutes = p1.development.trixD76Minutes ?? 0;
  if ((p0.development.trixD76Minutes ?? 0) !== minutes)
    return minutes ? tz(`D-76 · ${minutes} min`, `D-76 · ${minutes} 分钟`) : tz('Stock development', '原片种显影');
  if (p0.development.active !== p1.development.active) return tz('Development', '显影');
  if (p0.development.active) {
    if (p0.development.pushStops !== p1.development.pushStops) {
      const v = p1.development.pushStops;
      return tz(`Push / pull ${v > 0 ? '+' : ''}${v.toFixed(2)}`, `推拉显影 ${v > 0 ? '+' : ''}${v.toFixed(2)}`);
    }
    if (p0.development.temperatureC !== p1.development.temperatureC) {
      return tz(`Developer ${p1.development.temperatureC.toFixed(1)} °C`, `显影温度 ${p1.development.temperatureC.toFixed(1)} °C`);
    }
  }
  if (p0.contrastMask.active !== p1.contrastMask.active) return tz('Tone mask', '影调蒙版');
  if (p0.contrastMask.active) {
    const c0 = p0.contrastMask, c1 = p1.contrastMask;
    if (c0.highlights !== c1.highlights || c0.shadows !== c1.shadows || c0.core !== c1.core || c0.scale !== c1.scale) {
      return tz(`Tone mask ${c1.highlights.toFixed(2)} / ${c1.shadows.toFixed(2)}`, `影调蒙版 ${c1.highlights.toFixed(2)} / ${c1.shadows.toFixed(2)}`);
    }
  }
  for (const f of PARAM_FIELDS) {
    if (changed(p0[f.key], p1[f.key])) {
      const v = p1[f.key];
      const text = typeof v === 'number' ? `${v.toFixed(v % 1 === 0 ? 0 : 2)}${f.unit ?? ''}` : '';
      return text ? tz(`${f.en} ${text}`, `${f.zh} ${text}`) : tz(f.en, f.zh);
    }
  }
  for (const f of ADJUSTMENT_FIELDS) {
    const a = before.adjustments[f.key], b = after.adjustments[f.key];
    if (changed(a, b)) {
      if (typeof b === 'number') {
        return tz(`${f.en} ${b > 0 ? '+' : ''}${b.toFixed(2)}`, `${f.zh} ${b > 0 ? '+' : ''}${b.toFixed(2)}`);
      }
      return tz(f.en, f.zh);
    }
  }
  if (changed(before.adjustments.curves, after.adjustments.curves)) return tz('Curve', '曲线');
  if (changed(before.adjustments.colorBalance, after.adjustments.colorBalance)) return tz('Color balance', '色彩平衡');
  if (changed(before.geometry.crop, after.geometry.crop)) return tz('Crop', '裁剪');
  if (changed(before.geometry, after.geometry)) return tz('Geometry', '几何');
  if (before.decode.whiteBalance !== after.decode.whiteBalance) {
    return tz(`White balance → ${after.decode.whiteBalance}`, `白平衡 → ${after.decode.whiteBalance}`);
  }
  if (before.decode.temperature !== after.decode.temperature || before.decode.tint !== after.decode.tint) {
    return tz('White balance', '白平衡');
  }
  return tz('Edit', '编辑');
}
