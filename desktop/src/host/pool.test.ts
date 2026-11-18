import { beforeEach, describe, expect, it, vi } from 'vitest';

const g = globalThis as unknown as { window?: Record<string, unknown> };

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { encodeFrame } from '@shared/framing';
import { poolAvailable, poolEnsure, poolTransport } from './pool';

/** A reply buffer in the host protocol's framing: 8-byte header + payload. */
function reply(header: Record<string, unknown>, payload = new Uint8Array()): ArrayBuffer {
  const frame = encodeFrame(header, payload);
  return frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer;
}

describe('pool transport', () => {
  beforeEach(() => {
    invoke.mockReset();
    g.window = { __TAURI_INTERNALS__: {} };
  });

  it('is unavailable outside the Tauri core', () => {
    g.window = {};
    expect(poolAvailable()).toBe(false);
  });

  it('sends a request through the worker index and decodes the reply', async () => {
    invoke.mockResolvedValueOnce(reply({ id: 1, ok: true, result: { path: 'C:/out/a.tif', width: 100, height: 50 } }));
    const res = await poolTransport(2).request('export_frame', { path: 'C:/out/a.tif' }, { timeoutMs: 5000 });
    expect(invoke).toHaveBeenCalledWith('pool_request', { worker: 2, method: 'export_frame', params: { path: 'C:/out/a.tif' }, timeoutMs: 5000 });
    expect(res.result).toMatchObject({ width: 100, height: 50 });
  });

  it('turns an ok:false header into a HostCallError', async () => {
    invoke.mockResolvedValueOnce(reply({ id: 1, ok: false, error: { code: 'bad_request', message: 'no pool worker 3' } }));
    await expect(poolTransport(3).request('export_frame', {})).rejects.toMatchObject({ code: 'bad_request', message: 'no pool worker 3' });
  });

  it('refuses payload uploads: a worker has no interactive session', async () => {
    await expect(poolTransport(0).request('write_image', {}, { payload: new Uint8Array([1]) }))
      .rejects.toMatchObject({ code: 'unsupported' });
  });

  it('never spawns hosts outside Tauri', async () => {
    g.window = {};
    await expect(poolEnsure(3)).resolves.toMatchObject({ workers: 0, states: [] });
    expect(invoke).not.toHaveBeenCalled();
  });
});
