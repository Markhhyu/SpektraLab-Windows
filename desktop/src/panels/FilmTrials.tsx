import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { decodeWire, isRawPath } from '@shared/whiteBalance';
import { pairSnapshotFor } from '@shared/pair';
import { fullDelta, pickedFilmParams } from '@shared/params';
import { paintOutput } from '../canvas/colorSpace';
import { captureExportFrames, renderProof, type ExportJob } from '../export/exporter';
import { DEFAULT_RECIPES } from '../export/recipes';
import { host, type RgbaImage } from '../host/client';
import { tz } from '../i18n';
import { selectFilmStock, sessionStore, useSession } from '../state/session';
import { settingsStore } from '../state/settings';

type Sample = RgbaImage | { error: string };

function TrialImage({ sample }: { sample?: Sample }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (ref.current && sample && !('error' in sample)) paintOutput(ref.current, sample);
  }, [sample]);
  if (!sample) return <span role="status">{tz('Preparing…', '正在生成…')}</span>;
  if ('error' in sample) return <span className="trial-error" title={sample.error}>{sample.error}</span>;
  return <canvas ref={ref} />;
}

const PAGE_SIZE = 4;
const SAMPLE_EDGE = 800;

function TrialSheet({ close }: { close: () => void }) {
  const [source] = useState(() => sessionStore.getState());
  const { sidecar, selection, catalog, gate, nativeSize, metadata, pair, pairInfo, hello } = source;
  const [trialSession, setTrialSession] = useState('');
  const [openError, setOpenError] = useState('');
  useEffect(() => {
    if (!selection) return;
    // Rendering a candidate installs its stock on the supplied session.
    // Candidates must never share this handle with the editor.
    const params = { ...fullDelta(sidecar.params, gate, catalog), preview_long_edge: SAMPLE_EDGE };
    const opening = pair ? host().openPair(selection, params, pairSnapshotFor(pair, sidecar.params))
      : host().open(selection, params, decodeWire(sidecar.decode, isRawPath(selection)));
    let closed = false;
    void opening.then(({ session }) => { if (!closed) setTrialSession(session); },
      (error: unknown) => { if (!closed) setOpenError(String(error)); });
    return () => {
      closed = true;
      void opening.then(({ session }) => host().close(session)).catch(() => {});
    };
  }, [selection, sidecar, gate, catalog, pair]);
  const initial = sidecar.params.filmStock;
  const [pinned, pin] = useState(initial);
  const [candidate, choose] = useState(initial);
  const [query, search] = useState('');
  const [page, turn] = useState(0);
  const [samples, setSamples] = useState<Record<string, Sample>>({});
  const cache = useRef<Record<string, Sample>>({});
  const stocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...catalog.films].sort((a, b) => Number(b.id === initial) - Number(a.id === initial))
      .filter((stock) => stock.name.toLowerCase().includes(q) || stock.id.includes(q));
  }, [query, catalog, initial]);
  const visible = useMemo(() => stocks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [stocks, page]);
  useEffect(() => {
    if (!selection || !hello || !trialSession) return;
    let obsolete = false;
    let job: ExportJob | null = null;
    const recalculate = settingsStore.getState().recalculateEffectsAfterCrop;
    async function fill(id: string): Promise<Sample> {
      const trial = structuredClone(sidecar);
      trial.noFilm = false;
      trial.params = pickedFilmParams(trial.params, id, catalog, true);
      const [item] = await captureExportFrames([selection!], {
        path: selection!, session: trialSession, sidecar: trial,
        native: nativeSize ?? undefined, metadata, pair, pairInfo,
      }, catalog, gate, recalculate, () => obsolete);
      if (!item || 'error' in item) throw Error(item?.error ?? tz('Cancelled', '已取消'));
      const frame = item.frame;
      const display = source.displaySpace ?? 'srgb';
      if (!frame.pair && !frame.scenePlacement && hello?.methods?.includes('render_view')) {
        const progressId = 'film-trial-' + crypto.randomUUID();
        job = { session: trialSession, progressId };
        try {
          return await host().renderView(trialSession, 'live', {
            adjustments: frame.adjustments, geometry: frame.geometry, source_geometry: frame.sourceGeometry,
            params: { ...fullDelta(frame.params, gate, catalog), preview_long_edge: SAMPLE_EDGE },
            display, long_edge: SAMPLE_EDGE, progress_id: progressId, generation: 1,
          });
        } finally { job = null; }
      }
      const recipe = { ...DEFAULT_RECIPES[0]!, colorSpace: display === 'display-p3' ? 'display-p3' as const : 'sRGB' as const, longEdge: SAMPLE_EDGE };
      const proof = await renderProof(recipe, item.frame, catalog, hello!.methods, display, SAMPLE_EDGE, 1, {
        frameOptions: hello!.frame_options, cancelled: () => obsolete, active: (value) => { job = value; },
      });
      if (!proof) throw Error(tz('Cancelled', '已取消'));
      return proof;
    }
    void (async () => {
      for (const id of new Set([pinned, candidate, ...visible.map((s) => s.id)])) {
        if (obsolete) break;
        if (cache.current[id]) continue;
        let sample: Sample;
        try { sample = await fill(id); }
        catch (error) { sample = { error: error instanceof Error ? error.message : String(error) }; }
        if (obsolete) break;
        cache.current[id] = sample;
        setSamples({ ...cache.current });
      }
    })();
    return () => {
      obsolete = true;
      if (job) void host().cancel(job.session, job.progressId).catch(() => {});
    };
  }, [trialSession, pinned, candidate, visible, selection, hello, sidecar, catalog, gate, nativeSize, metadata, pair, pairInfo, source.displaySpace]);

  function label(id: string) {
    const params = pickedFilmParams(sidecar.params, id, catalog, true);
    const paper = params.scanFilm ? tz('Direct scan', '直接扫描') : catalog.stock(params.printStock)?.name ?? params.printStock;
    return (catalog.stock(id)?.name ?? id) + ' · ' + paper;
  }
  const ready = samples[candidate] && !('error' in samples[candidate]);
  return <Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay trial-overlay" />
    <Dialog.Content className="dialog trial-sheet" aria-describedby={undefined} onKeyDown={(e) => e.stopPropagation()}>
      <Dialog.Title>{tz('Film contact sheet', '胶片试片台')}</Dialog.Title>
      {openError && <div role="alert">{openError}</div>}
      <div className="trial-compare">
        {[pinned, candidate].map((id, i) => <figure key={i}>
          <div className="trial-image"><TrialImage sample={openError ? { error: openError } : samples[id]} /></div>
          <figcaption>{i ? 'B' : 'A'} · {label(id)}</figcaption>
        </figure>)}
      </div>
      <div className="trial-tools">
        <input type="search" className="stock-search" aria-label={tz('Search films', '搜索胶片')} placeholder={tz('Search films…', '搜索胶片…')}
          value={query} onChange={(e) => { search(e.target.value); turn(0); }} />
        <button className="btn" disabled={page === 0} onClick={() => turn(page - 1)}>{tz('Previous', '上一页')}</button>
        <button className="btn" disabled={(page + 1) * PAGE_SIZE >= stocks.length} onClick={() => turn(page + 1)}>{tz('Next', '下一页')}</button>
      </div>
      <div className="trial-grid">
        {!visible.length && <span>{tz('No matching film', '没有匹配的胶片')}</span>}
        {visible.map((stock) => <button key={stock.id} aria-label={stock.name} aria-pressed={stock.id === candidate} onClick={() => choose(stock.id)}>
          <div className="trial-image"><TrialImage sample={openError ? { error: openError } : samples[stock.id]} /></div>
          <span>{catalog.coverURL(stock.id) && <img src={catalog.coverURL(stock.id)!} alt="" />}{stock.name}</span>
        </button>)}
      </div>
      <div className="dialog-actions">
        <button className="btn" disabled={!ready || candidate === pinned} onClick={() => pin(candidate)}>{tz('Pin B as A', '将 B 固定为 A')}</button>
        <Dialog.Close asChild><button className="btn">{tz('Cancel', '取消')}</button></Dialog.Close>
        <button className="btn primary" disabled={!ready} onClick={() => {
          if (sessionStore.getState().selection === selection) selectFilmStock(candidate, true);
          close();
        }}>{tz('Apply B', '采用 B')}</button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>;
}

export function FilmTrials() {
  const [open, setOpen] = useState(false);
  const ready = useSession((s) => !!s.selection && !!s.engineSession && !s.batchExporting && !s.developing && !s.redecoding && !!s.hello?.methods?.includes('render_proof'));
  return <Dialog.Root open={open && ready} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button className="btn trial-trigger" disabled={!ready}>{tz('Compare films on this photo…', '用这张照片试胶片…')}</button></Dialog.Trigger>
    {open && ready && <TrialSheet close={() => setOpen(false)} />}
  </Dialog.Root>;
}
