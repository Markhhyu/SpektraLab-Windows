// ModuleBar.tsx — the three top-level modules of the window.
//
// The Library, the Develop editor and the Export page used to be separate
// layers (two fixed overlays and the editor underneath), so moving between
// them meant hunting for icons in the canvas bar. This strip gives the window
// one order — Library | Develop | Export — that stays visible in all three.

import { tz } from '../i18n';
import { sessionStore, setPages, useSession } from '../state/session';
import { libraryStore, openSelection, setLibraryOpen, useLibrary } from '../state/library';

type Module = 'library' | 'develop' | 'export';

const MODULES: { id: Module; en: string; zh: string; hint: string; hintZh: string }[] = [
  { id: 'library', en: 'Library', zh: '图库', hint: 'Browse and cull imported photographs (Ctrl+Shift+L)', hintZh: '浏览与筛选已导入的照片（Ctrl+Shift+L）' },
  { id: 'develop', en: 'Edit', zh: '编辑', hint: 'Edit the selected photograph', hintZh: '调整选中的照片' },
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
  if (sessionStore.getState().batchExporting) return;
  if (module === 'develop' && currentModule() === 'develop') return;
  const library = libraryStore.getState();
  if (library.open && library.selection?.length && module !== 'library') {
    const focus = library.selection.includes(library.anchor ?? '') ? library.anchor! : library.selection[library.selection.length - 1]!;
    void openSelection(undefined, focus).then(() => {
      if (module === 'export' && sessionStore.getState().selection === focus) setPages({ exportOpen: true });
    });
    return;
  }
  if (module === 'library') {
    setPages({ exportOpen: false });
    const editor = sessionStore.getState();
    if (!library.open && editor.selection && library.catalog?.entries.some((entry) => entry.path === editor.selection)) {
      const registered = new Set(library.catalog.entries.map((entry) => entry.path));
      libraryStore.setState({ selection: editor.picked.filter((path) => registered.has(path)), anchor: editor.selection });
    }
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
  const pickedInLibrary = useLibrary((s) => s.selection?.length ?? 0);
  const busy = useSession((s) => s.batchExporting);
  const canExport = libraryOpen ? pickedInLibrary > 0 || !!selection : !!selection;
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
            disabled={busy || (m.id === 'export' && !canExport)}
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
