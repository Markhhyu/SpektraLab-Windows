// @vitest-environment jsdom
// library-import.test.ts — folder imports pick the render pool for previews
// and report files whose preview could not be read.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const poolThumb = vi.fn(async () => ({
    result: { image: { width: 2, height: 1, format: 'rgba8' as const, row_bytes: 8 } },
    payload: new Uint8Array(8),
  }));
  return {
    poolThumb,
    hostThumb: vi.fn(async () => ({ width: 2, height: 1, data: new Uint8Array(8), colorSpace: 'sRGB' })),
    poolEnsure: vi.fn(async () => ({ workers: 3, max: 4, states: [] })),
    poolShutdown: vi.fn(async () => {}),
    poolTransport: vi.fn((_lane: number) => ({ kind: 'tauri' as const, request: poolThumb, restart: vi.fn(async () => {}) })),
  };
});

vi.mock('../host/client', () => ({
  host: () => ({ thumbnail: m.hostThumb }),
  displayImage: (info: { width: number; height: number }, payload: Uint8Array) => ({
    width: info.width, height: info.height, data: payload, colorSpace: 'sRGB',
  }),
}));
vi.mock('../host/pool', () => ({
  POOL_MAX_WORKERS: 4,
  poolAvailable: () => true,
  poolEnsure: m.poolEnsure,
  poolShutdown: m.poolShutdown,
  poolTransport: m.poolTransport,
}));
vi.mock('./session', () => ({ openCollection: vi.fn(async () => {}) }));

let expanded: { path: string; name: string; size: number; mtime_ms: number }[] = [];

vi.mock('../platform', () => ({
  baseName: (path: string) => path.split(/[\\/]/).pop() ?? path,
  platform: () => ({
    kind: 'browser',
    expandPaths: async () => expanded,
    storeRead: async () => null,
    storeWrite: async () => {},
    log: () => {},
    catalogThumbSave: async (path: string) => path,
    catalogThumbRead: async () => null,
    catalogThumbRemove: async () => undefined,
  }),
}));

import { importPaths, libraryStore } from './library';

function filesFor(n: number, folder = 'D:\\Photos') {
  return Array.from({ length: n }, (_, i) => ({
    path: `${folder}\\p${i}.ARW`, name: `p${i}.ARW`, size: 100 + i, mtime_ms: i,
  }));
}

describe('importPaths previews', () => {
  beforeEach(() => {
    m.hostThumb.mockClear();
    m.poolThumb.mockClear();
    m.poolEnsure.mockClear();
    m.poolShutdown.mockClear();
    m.poolTransport.mockClear();
  });

  it('keeps small imports on the interactive host', async () => {
    expanded = filesFor(3);
    await importPaths(['D:\\Photos']);
    expect(m.poolEnsure).not.toHaveBeenCalled();
    expect(m.hostThumb).toHaveBeenCalledTimes(3);
    // jsdom has no 2D canvas: every preview falls back to "unreadable" and is
    // reported rather than silently dropped.
    expect(libraryStore.getState().failures).toHaveLength(3);
    expect(libraryStore.getState().busy).toBeNull();
  });

  it('uses the ordinary thumbnail path for JPEG, and the embedded preview for RAW', async () => {
    expanded = filesFor(2, 'D:/Mixed').map((file, i) => ({ ...file, path: i ? 'D:/Mixed/b.JPG' : 'D:/Mixed/a.ARW' }));
    await importPaths(['D:/Mixed']);
    expect(m.hostThumb).toHaveBeenCalledWith('D:/Mixed/b.JPG', 512, false);
    expect(m.hostThumb).toHaveBeenCalledWith('D:/Mixed/a.ARW', 512, true);
  });

  it('filters before catalog insertion and preview generation, including mixed-case JPEG extensions', async () => {
    const folder = 'D:/Filter';
    expanded = ['a.ArW', 'a.JpG', 'b.JPEG', 'scan.tif'].map((name) => ({ path: folder + '/' + name, name, size: 10, mtime_ms: 1 }));
    await importPaths([folder], 'jpeg');
    expect(libraryStore.getState().catalog.entries.filter((e) => e.folder === folder).map((e) => e.name)).toEqual(['a.JpG', 'b.JPEG']);
    expect(m.hostThumb).toHaveBeenCalledTimes(2);
    m.hostThumb.mockClear();
    await importPaths([folder], 'raw');
    expect(m.hostThumb).toHaveBeenCalledTimes(1);
    expect(m.hostThumb).toHaveBeenCalledWith('D:/Filter/a.ArW', 512, true);
    m.hostThumb.mockClear();
    expanded = [];
    await importPaths([folder], 'raw');
    expect(m.hostThumb).not.toHaveBeenCalled();
    expect(libraryStore.getState().error).toBeTruthy();
  });

  it('runs folder-sized imports through the pool and always stops it', async () => {
    expanded = [...filesFor(8, 'D:\\Batch'), { path: 'D:\\Batch\\scan.JPG', name: 'scan.JPG', size: 200, mtime_ms: 2 }];
    await importPaths(['D:\\Batch']);
    expect(m.poolEnsure).toHaveBeenCalledTimes(1);
    expect((m.poolEnsure.mock.calls[0] as unknown as [number] | undefined)?.[0]).toBeGreaterThanOrEqual(2);
    expect(m.poolTransport.mock.calls.length).toBeGreaterThan(0);
    expect(m.poolThumb).toHaveBeenCalledWith('thumbnail', { path: 'D:\\Batch\\scan.JPG', long_edge: 512 }, expect.anything());
    expect(m.poolThumb).toHaveBeenCalledWith('thumbnail', { path: 'D:\\Batch\\p0.ARW', long_edge: 512, embedded_only: true }, expect.anything());
    expect(m.hostThumb).not.toHaveBeenCalled();
    expect(m.poolShutdown).toHaveBeenCalledTimes(1);
  });
});
