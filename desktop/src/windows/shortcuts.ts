// shortcuts.ts — the keyboard reference shown by ShortcutsDialog. The table in
// keys.ts is the source of truth for behaviour; this is the readable copy, so
// a test keeps the two from drifting apart.

export interface ShortcutItem {
  /** The Windows chord, as written in the dialog. */
  keys: string;
  en: string;
  zh: string;
}

export interface ShortcutGroup {
  en: string;
  zh: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    en: 'File', zh: '文件',
    items: [
      { keys: 'Ctrl+O', en: 'Open folder', zh: '打开文件夹' },
      { keys: 'Ctrl+Shift+O', en: 'Open photographs', zh: '打开照片' },
      { keys: 'Ctrl+Shift+L', en: 'Library', zh: '图库' },
      { keys: 'Ctrl+E', en: 'Export', zh: '导出' },
      { keys: 'Ctrl+,', en: 'Settings', zh: '设置' },
      { keys: 'Ctrl+Q', en: 'Quit', zh: '退出' },
    ],
  },
  {
    en: 'Edit', zh: '编辑',
    items: [
      { keys: 'Ctrl+Z', en: 'Undo', zh: '撤销' },
      { keys: 'Ctrl+Shift+Z', en: 'Redo', zh: '重做' },
      { keys: 'Ctrl+Shift+C', en: 'Copy settings', zh: '拷贝设置' },
      { keys: 'Ctrl+Shift+V', en: 'Paste settings', zh: '粘贴设置' },
      { keys: 'Ctrl+A', en: 'Select all photographs', zh: '选择全部照片' },
      { keys: 'Ctrl+Shift+B', en: 'Toggle the adjustment layer', zh: '切换调整层开关' },
    ],
  },
  {
    en: 'View', zh: '视图',
    items: [
      { keys: 'Ctrl+=', en: 'Zoom in', zh: '放大' },
      { keys: 'Ctrl+-', en: 'Zoom out', zh: '缩小' },
      { keys: ',', en: 'Fit to window', zh: '适合窗口' },
      { keys: '.', en: 'Zoom 100 %', zh: '缩放到 100%' },
      { keys: 'Y', en: 'Before / after', zh: '前后对比' },
      { keys: 'Space (hold)', en: 'Show the decoded original', zh: '按住看原图' },
      { keys: 'F11', en: 'Full screen', zh: '全屏' },
      { keys: 'Ctrl+B', en: 'Toggle both panels', zh: '收起两侧面板' },
      { keys: 'Ctrl+Shift+F', en: 'Toggle filmstrip', zh: '显示/隐藏胶片条' },
    ],
  },
  {
    en: 'Photographs', zh: '照片',
    items: [
      { keys: '← / →', en: 'Previous / next', zh: '上一张 / 下一张' },
      { keys: 'Delete', en: 'Remove from the roll', zh: '从工作台移除' },
      { keys: 'Ctrl+J', en: 'New photo pair', zh: '新建双图拼接' },
      { keys: 'Ctrl+Alt+[ / ]', en: 'Rotate left / right', zh: '向左 / 右旋转' },
    ],
  },
  {
    en: 'Tools', zh: '工具',
    items: [
      { keys: 'V', en: 'Select', zh: '选择' },
      { keys: 'H', en: 'Hand', zh: '抓手' },
      { keys: 'C', en: 'Crop', zh: '裁剪' },
      { keys: 'Esc', en: 'Leave the tool / close a page', zh: '退出工具 / 关闭页面' },
    ],
  },
  {
    en: 'Library', zh: '图库',
    items: [
      { keys: '0 – 5', en: 'Star rating', zh: '星级评分' },
      { keys: 'P / X / U', en: 'Pick / reject / unflag', zh: '保留 / 废弃 / 取消旗标' },
      { keys: '← / →', en: 'Move the selection', zh: '移动选中' },
      { keys: 'Ctrl+A', en: 'Select all shown', zh: '全选当前筛选' },
      { keys: 'Enter / double-click', en: 'Open in Develop', zh: '在修改中打开' },
      { keys: 'Delete', en: 'Remove from the catalog', zh: '从图库移除' },
      { keys: 'Esc', en: 'Clear the selection / back', zh: '清空选择 / 返回' },
    ],
  },
];
