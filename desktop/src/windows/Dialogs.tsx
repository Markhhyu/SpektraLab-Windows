// Dialogs.tsx — Settings (`Windows/SettingsWindow.swift`, the pages this port
// carries), About (licences: CC BY-SA requires the attribution be visible),
// and the engine-failure dialog.

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { PillMenu, ToggleRow } from '../controls/controls';
import { t, tz } from '../i18n';
import { hostMessage } from '../host/messages';
import { host } from '../host/client';
import { platform, type AppPaths } from '../platform';
import { historyJump, recomputeFilmFormat, requestPrint, setPages, useSession, sessionStore } from '../state/session';
import { INTERFACE_SCALES, PREVIEW_EDGES, settingsStore, useSettings, SETTINGS_DEFAULT } from '../state/settings';
import { featureGate } from '@shared/params';
import { AgentsSettings, MemorySettings, UpdateSettings } from './SettingsPages';
import { SHORTCUT_GROUPS } from './shortcuts';
import { describeChange } from './history';
import { diagnosticReport } from './diagnosticReport';
import { DiagnosticSettings } from './DiagnosticSettings';
import { NewPhotoDefaultsSettings } from './NewPhotoDefaultsSettings';

function Frame({ open, onClose, title, children, actions, testId }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; actions?: React.ReactNode; testId?: string }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" data-testid={testId} aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h2>{title}</h2>
          </Dialog.Title>
          {children}
          <div className="dialog-actions">
            {actions}
            <Dialog.Close asChild>
              <button className="btn primary">{tz('Done', '完成')}</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SettingsDialog() {
  const open = useSession((s) => s.settingsOpen);
  const page = useSettings((s) => s.settingsPage);
  const st = useSettings((s) => s);
  const hello = useSession((s) => s.hello);
  const hostState = useSession((s) => s.hostState);
  const gate = useSessionGate();
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [diag, setDiag] = useState<string>('');
  const [diagnosticPaths, setDiagnosticPaths] = useState(false);
  const [diagnosticNotice, setDiagnosticNotice] = useState('');
  useEffect(() => {
    if (open) {
      void platform().appPaths().then(setPaths);
      void host()
        .diagnostics()
        .then((d) => setDiag(JSON.stringify(d, null, 1)))
        .catch(() => {});
    }
  }, [open, page]);
  const set = settingsStore.getState().set;
  return (
    <Frame open={open} onClose={() => setPages({ settingsOpen: false })} title={tz('Settings', '设置')} testId="settings">
      <div className="tabs">
        {(['general', 'rendering', 'memory', 'diagnostics', 'agents'] as const).map((p) => (
          <button key={p} className={page === p ? 'on' : ''} onClick={() => set('settingsPage', p)}>
            {p === 'general' ? t('setTabGeneral') : p === 'rendering' ? t('setTabRendering') : p === 'memory' ? tz('Memory', '内存') : p === 'agents' ? tz('Agents', '智能体') : t('setTabDiagnostics')}
          </button>
        ))}
      </div>
      <div className="dialog-body rail right" style={{ background: 'transparent' }}>
        {page === 'general' && (
          <>
            <div className="settings-group">
              <h3>{t('setLanguage')}</h3>
              <PillMenu
                label={t('setLanguage')}
                value={st.language}
                options={[
                  { value: 'system', label: t('languageFollowSystem') },
                  { value: 'english', label: 'English' },
                  { value: 'simplifiedChinese', label: '简体中文 (zh-Hans)' },
                ]}
                onChange={(v) => set('language', v)}
                testId="language"
              />
              <div className="caption">{t('setLanguageCaption')}</div>
            </div>
            <div className="settings-group">
              <h3>{t('setInterface')}</h3>
              <PillMenu label={t('setScale')} value={st.interfaceScale} options={INTERFACE_SCALES.map((s) => ({ value: s, label: `${s} %` }))} onChange={(v) => set('interfaceScale', v)} />
              <div className="row">
                <button
                  className="btn"
                  onClick={() => {
                    for (const k of ['interfaceScale', 'parametersTab', 'leftCollapsed', 'rightCollapsed', 'filmstripCollapsed', 'leftWidth', 'rightWidth', 'collapsedSections'] as const) set(k, SETTINGS_DEFAULT[k] as never);
                  }}
                >
                  {t('setResetLayout')}
                </button>
              </div>
            </div>
            <NewPhotoDefaultsSettings />
            <UpdateSettings version={paths?.version} os={paths?.os} />
          </>
        )}
        {page === 'rendering' && (
          <>
            <div className="settings-group">
              <h3>{tz('Preview', '预览')}</h3>
              <PillMenu
                label={tz('Preview', '预览')}
                value={st.previewLongEdge}
                options={PREVIEW_EDGES.map((e) => ({ value: e, label: `${e} px` }))}
                onChange={(v) => {
                  set('previewLongEdge', v);
                  // The live tier's size is a session parameter: send it, render.
                  const sid = sessionStore.getState().engineSession;
                  if (sid) void host().setParams(sid, { preview_long_edge: v }).then(() => requestPrint());
                }}
              />
              <div className="caption">
                {tz(
                  "The resolution every interactive edit renders at. The frame's own resolution is rendered separately once an edit settles, so this trades responsiveness while dragging against nothing in the finished picture.",
                  '每次交互编辑的渲染分辨率。编辑停下后会另外按照片本身的分辨率渲染，所以这里只是拖动时的流畅度，与最终画面无关。',
                )}
              </div>
            </div>
            <div className="settings-group">
              <h3>{tz('Batch rendering', '批量渲染')}</h3>
              <PillMenu
                label={tz('Render hosts', '渲染进程')}
                value={st.renderPoolWorkers}
                options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
                onChange={(v) => set('renderPoolWorkers', v)}
                testId="render-pool-workers"
              />
              <div className="caption">
                {tz(
                  'Extra host processes a batch may render in parallel. They start when an export begins and stop when it ends; each one holds a full engine allocation (roughly 0.5–1 GB of graphics memory), so lower this on a small GPU. A single image, editing and the interactive preview always use the main host.',
                  '批量导出时可并行使用的额外宿主进程数。导出开始时启动、结束时关闭；每个进程都有完整的引擎分配（约 0.5–1 GB 显存），显卡内存较小时请调低。单张编辑与交互预览始终使用主宿主。',
                )}
              </div>
            </div>
            <div className="settings-group">
              <h3>{tz('Film effects', '胶片效果')}</h3>
              <ToggleRow
                label={tz('Crop re-maps the frame', '裁剪重新映射画幅')}
                on={st.recalculateEffectsAfterCrop}
                onChange={(v) => {
                  set('recalculateEffectsAfterCrop', v);
                  queueMicrotask(recomputeFilmFormat);
                }}
              />
              <div className="caption">{tz('Whether cropping changes the physical scale of grain, halation and glare. Off — the default, and the physically true answer — the crop shows less of the same negative.', '裁剪是否改变颗粒、光晕与耀光的物理尺度。关闭（默认，也是物理上正确的做法）时，裁剪只是看到同一张负片的更小部分。')}</div>
              <ToggleRow label={tz('Decouple effects', '分离效果强度')} on={st.decoupleEffects} onChange={(v) => set('decoupleEffects', v)} />
              <div className="caption">{tz('Show a strength for each film effect beside its switch. The strengths belong to the frame: turning this off hides the sliders and changes no picture.', '在每个胶片效果的开关旁显示强度滑块。强度属于照片本身：关闭此项只会隐藏滑块，不会改变任何画面。')}</div>
            </div>
            <div className="settings-group">
              <h3>{tz('Digital Intermediate', '数字中间片')}</h3>
              <ToggleRow
                label={tz('Blue compensation', '蓝色补偿')}
                on={st.diBlueCompensation}
                disabled={!gate.digitalIntermediate}
                reason={tz('The Digital Intermediate is not available with this engine yet.', '此引擎暂不支持数字中间片。')}
                onChange={(v) => {
                  set('diBlueCompensation', v);
                  const s = sessionStore.getState();
                  sessionStore.setState({ gate: featureGate(s.unsupported, v, s.hello?.view_options?.includes('no_film') ?? false) });
                }}
              />
            </div>
          </>
        )}
        {page === 'diagnostics' && (
          <>
            {open && <DiagnosticSettings paths={paths} hello={hello} includePaths={diagnosticPaths} />}
            <div className="settings-group">
              <h3>{tz('This session', '本次会话')}</h3>
              <div className="caption">
                {tz('App', '应用')}: {paths?.version ?? '—'} · {paths?.os ?? ''}
                <br />
                {tz('Engine', '引擎')}: {hello ? `${hello.host_version} — ${hello.build_info}` : hostState.phase}
                <br />
                GPU: {hello?.backend?.device_name ?? '—'} ({hello?.backend?.api ?? '—'}) · {tz('Render core', '渲染核心')}: {String(hello?.capabilities?.backend?.render_core ?? '—')}
                <br />
                {tz('Not available here', '此处不可用')}: {(hello?.capabilities?.backend?.unsupported_features as string[] | undefined)?.join(', ') || '—'}
              </div>
            </div>
            <div className="settings-group">
              <h3>{tz('Logs and settings', '日志与设置')}</h3>
              <div className="caption mono">
                {tz('Logs', '日志')}: {paths?.logs}
                <br />
                {tz('Sidecars', '设置文件')}: {paths?.sidecars}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={() => paths && void platform().reveal(paths.logs)}>
                  {tz('Show logs', '显示日志')}
                </button>
                <button className="btn" onClick={() => paths && void platform().reveal(paths.sidecars)}>
                  {tz('Show sidecars', '显示设置文件')}
                </button>
                <button className="btn" onClick={() => void host().restart()}>
                  {tz('Restart engine', '重启引擎')}
                </button>
              </div>
            </div>
            <div className="settings-group">
              <h3>{tz('Share diagnostics', '分享诊断')}</h3>
              <ToggleRow label={tz('Include local paths and engine logs', '包含本地路径和引擎日志')} on={diagnosticPaths} onChange={setDiagnosticPaths} />
              <p className="caption">{tz('Off by default. The basic report contains versions, GPU and capability information. Paths and logs may contain file names; nothing is uploaded automatically.', '默认关闭。基本报告包含版本、显卡及能力信息；路径和日志可能包含文件名，不会自动上传任何内容。')}</p>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={() => {
                  void host().diagnostics().then((d) => { setDiag(JSON.stringify(d, null, 1)); setDiagnosticNotice(''); }).catch((e) => setDiagnosticNotice(String(e)));
                }}>{tz('Refresh', '刷新')}</button>
                <button className="btn" onClick={() => {
                  void Promise.all([host().diagnostics(), host().memoryReport().catch(() => null)]).then(async ([d, memory]) => {
                    await navigator.clipboard.writeText(JSON.stringify(diagnosticReport(paths, hello, d, diagnosticPaths, memory), null, 2));
                    setDiagnosticNotice(tz('Diagnostics copied.', '诊断信息已复制。'));
                  }).catch((e) => setDiagnosticNotice(String(e)));
                }}>{tz('Copy diagnostics', '复制诊断信息')}</button>
              </div>
              {diagnosticNotice && <p className="caption" role="status">{diagnosticNotice}</p>}
            </div>
            <div className="settings-group">
              <h3>{tz('Engine host', '引擎进程')}</h3>
              <div className="mono" style={{ maxHeight: 180, overflow: 'auto' }}>
                {diag}
              </div>
            </div>
          </>
        )}
        {open && page === 'memory' && <MemorySettings />}
        {open && page === 'agents' && <AgentsSettings />}
      </div>
    </Frame>
  );
}

function useSessionGate() {
  return useSession((s) => s.gate);
}

export function AboutDialog() {
  const open = useSession((s) => s.aboutOpen);
  const [texts, setTexts] = useState<{ name: string; body: string }[]>([]);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  useEffect(() => {
    if (!open) return;
    void platform().appPaths().then(setPaths);
    void Promise.all(
      ['SpektraLab-GPL-3.0.txt', 'Profiles-and-LUTs-CC-BY-SA-4.0.txt', 'README.txt'].map(async (name) => {
        try {
          const r = await fetch('assets/licenses/' + name);
          return { name, body: r.ok ? await r.text() : '' };
        } catch {
          return { name, body: '' };
        }
      }),
    ).then(setTexts);
  }, [open]);
  return (
    <Frame open={open} onClose={() => setPages({ aboutOpen: false })} title="SpektraLab" testId="about">
      <div className="dialog-body">
        <p>
          {tz('Version', '版本')} {paths?.version ?? '1.8.0'} — {tz('film and print emulation built on the spektrafilm engine.', '基于 spektrafilm 引擎的胶片与相纸模拟。')}
        </p>
        <p className="caption">
          {tz(
            'SpektraLab is free software under the GNU GPL, version 3 or later. The film and paper profiles are licensed CC BY-SA 4.0; their attribution follows.',
            'SpektraLab 是依据 GNU GPL 第 3 版或更新版本发布的自由软件。胶片与相纸的特性数据依据 CC BY-SA 4.0 授权，署名如下。',
          )}
        </p>
        {texts.map((x) => (
          <details key={x.name}>
            <summary>{x.name}</summary>
            <div className="mono" style={{ maxHeight: 200, overflow: 'auto' }}>
              {x.body || tz('(not bundled in this build)', '（此版本未附带）')}
            </div>
          </details>
        ))}
      </div>
    </Frame>
  );
}

/** The engine failed to start or keeps dying: say so, in words, with the log tail. */
export function HostFailure() {
  const st = useSession((s) => s.hostState);
  const [detailOpen, setDetailOpen] = useState(false);
  const [tail, setTail] = useState<string>('');
  const failed = st.phase === 'failed';
  useEffect(() => {
    if (!failed) return;
    // The host's own stderr: where a driver says what it could not do.
    void host()
      .diagnostics()
      .then((d) => setTail(((d as { stderr_tail?: string[] }).stderr_tail ?? []).join('\n')))
      .catch(() => {});
  }, [failed]);
  if (st.phase === 'restarting')
    return (
      <div className="host-banner" role="status">
        {tz('The engine stopped and is being restarted…', '引擎已停止，正在重启…')}
      </div>
    );
  if (st.phase !== 'failed') return null;
  const detail = tail || st.detail || '';
  const vulkan = /vulkan|\bvk|no .*device|GPU/i.test(st.reason + ' ' + detail);
  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" data-testid="host-failure" aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h2>{tz('The render engine could not start', '渲染引擎无法启动')}</h2>
          </Dialog.Title>
          <div className="dialog-body">
            <p>{hostMessage(st.reason)}</p>
            {vulkan && (
              <p className="caption">
                {tz(
                  'SpektraLab renders on the GPU through Vulkan. Make sure a Vulkan driver is installed for your graphics card (on Linux: mesa-vulkan-drivers or your vendor’s driver; on Windows: the latest driver from your GPU vendor), then restart the engine.',
                  'SpektraLab 通过 Vulkan 在 GPU 上渲染。请确认已为显卡安装 Vulkan 驱动（Linux：mesa-vulkan-drivers 或厂商驱动；Windows：显卡厂商的最新驱动），然后重启引擎。',
                )}
              </p>
            )}
            {detail && (
              <details open={detailOpen} onToggle={(e) => setDetailOpen((e.target as HTMLDetailsElement).open)}>
                <summary>{tz('Engine log', '引擎日志')}</summary>
                <div className="mono" style={{ maxHeight: 220, overflow: 'auto' }}>
                  {detail}
                </div>
              </details>
            )}
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={() => void platform().appPaths().then((p) => platform().reveal(p.logs))}>
              {tz('Show logs', '显示日志')}
            </button>
            <button className="btn primary" onClick={() => void host().restart()}>
              {tz('Restart engine', '重启引擎')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ------------------------------------------------------- keyboard reference

/** The `?` page: every shortcut the table in keys.ts honours, grouped like the
 *  menus. Pure reference — changing behaviour means changing keys.ts too. */
export function ShortcutsDialog() {
  const open = useSession((s) => s.shortcutsOpen);
  return (
    <Frame open={open} onClose={() => setPages({ shortcutsOpen: false })} title={tz('Keyboard shortcuts', '键盘快捷键')} testId="shortcuts">
      <div className="shortcut-groups">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.en} className="shortcut-group">
            <h3>{tz(g.en, g.zh)}</h3>
            {g.items.map((it) => (
              <div key={it.keys} className="shortcut-row">
                <kbd>{it.keys}</kbd>
                <span>{tz(it.en, it.zh)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className="caption">{tz('Shortcuts for the photo editor. Library and Develop pages keep their own keys while focused.', '照片编辑器的快捷键；图库页与修改页在聚焦时使用各自的按键。')}</p>
    </Frame>
  );
}

// ------------------------------------------------------------- history page

/** The Ctrl+H page: every undo step of the open frame, newest first. Picking a
 *  row jumps the session to that snapshot (Redo replays from there). */
export function HistoryDialog() {
  const open = useSession((s) => s.historyOpen);
  const undo = useSession((s) => s.undo);
  const catalog = useSession((s) => s.catalog);
  const stockName = (id: string) => catalog.stock(id)?.name ?? id;
  const steps = undo.map((entry, index) => ({
    index,
    label: describeChange(index > 0 ? undo[index - 1]! : null, entry, stockName),
  }));
  steps.push({ index: undo.length, label: tz('Current state', '当前状态') });
  const rows = [...steps].reverse();
  return (
    <Frame open={open} onClose={() => setPages({ historyOpen: false })} title={tz('History', '历史记录')} testId="history">
      <div className="history-list">
        {rows.map((row) => (
          <button
            key={row.index}
            type="button"
            className={row.index === undo.length ? 'history-row is-current' : 'history-row'}
            disabled={row.index === undo.length || row.index >= undo.length}
            onClick={() => {
              if (row.index < undo.length) historyJump(row.index);
            }}
          >
            <span className="history-index">{row.index === undo.length ? '•' : row.index + 1}</span>
            <span className="history-label">{row.label}</span>
          </button>
        ))}
      </div>
      <p className="caption">
        {tz(
          'Every edit in this session is listed here; choosing an earlier step keeps its result editable, and Redo (Ctrl+Shift+Z) replays forward.',
          '这里列出本次会话的每一处编辑；选择较早的步骤仍可继续修改，重做（Ctrl+Shift+Z）会向后重放。',
        )}
      </p>
    </Frame>
  );
}
