// ModuleBar.tsx — the three top-level modules of the window.
//
// The Library, the Develop editor and the Export page used to be separate
// layers (two fixed overlays and the editor underneath), so moving between
// them meant hunting for icons in the canvas bar. This strip gives the window
// one order — Library | Develop | Export — that stays visible in all three.

import { tz } from '../i18n';
import { sessionStore, setPages, useSession } from '../state/session';
import { libraryStore, setLibraryOpen, useLibrary } from '../state/library';

type Module = 'library' | 'develop' | 'export';

const MODULES: { id: Module; en: string; zh: string; hint: string; hintZh: string }[] = [
  { id: 'library', en: 'Library', zh: '图库', hint: 'Browse and cull imported photographs (Ctrl+Shift+L)', hintZh: '浏览与筛选已导入的照片（Ctrl+Shift+L）' },
  { id: 'develop', en: 'Develop', zh: '修改', hint: 'Edit the selected photograph', hintZh: '调整选中的照片' },
  { id: 'export', en: 'Export', zh: '导出', hint: 'Render the selected photographs to files (Ctrl+E)', hintZh: '把选中的照片渲染为文件（Ctrl+E）' },
];

/** The currently visible module, derived from the existing page flags. */
export function currentModule(): Module {
  const state = sessionStore.getState();
  if (state.exportOpen) return 'export';
  if (libraryStore.getState().open) return 'library';
  return 'develop';
}

/** Switch modules without losing the selection. */
export function showModule(module: Module): void {
  if (module === 'library') {
    setPages({ exportOpen: false });
    setLibraryOpen(true);
  } else if (module === 'develop') {
    setLibraryOpen(false);
    setPages({ exportOpen: false });
  } else {
    setLibraryOpen(false);
    setPages({ exportOpen: true });
  }
}

export function ModuleBar() {
  const active = useSession((s) => (s.exportOpen ? 'export' : null));
  const libraryOpen = useLibrary((s) => s.open);
  const selection = useSession((s) => s.selection);
  const module: Module = active === 'export' ? 'export' : libraryOpen ? 'library' : 'develop';
  const canExport = !!selection;
  return (
    <nav className="module-bar" data-testid="module-bar" aria-label={tz('Modules', '模块')}>
      <span className="module-bar-title">{tz('SpektraLab', 'SpektraLab')}</span>
      <div className="module-bar-tabs">
        {MODULES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={'module-tab' + (module === m.id ? ' is-active' : '')}
            aria-current={module === m.id ? 'page' : undefined}
            title={tz(m.hint, m.hintZh)}
            disabled={m.id === 'export' && !canExport}
            onClick={() => showModule(m.id)}
            data-testid={'module-' + m.id}
          >
            {tz(m.en, m.zh)}
          </button>
        ))}
      </div>
    </nav>
  );
}
