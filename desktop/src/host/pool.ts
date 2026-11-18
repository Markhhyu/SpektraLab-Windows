// pool.ts — background render hosts for batch work.
//
// The interactive host owns the editing session. A batch that only needs the
// engine (soft proof, export) can borrow extra host processes instead: every
// job it runs is self-contained, so nothing is shared but the GPU and the
// files. The pool starts when a batch starts and stops when it ends, so the
// extra device memory is not held while someone is editing.

import { invoke } from '@tauri-apps/api/core';
import { decodeFrame } from '@shared/framing';
import { HostCallError, inTauri, type Reply, type RequestOptions, type Transport } from './transport';

/** Mirrors `MAX_WORKERS` in `src-tauri/src/pool.rs`. */
export const POOL_MAX_WORKERS = 4;

export interface PoolWorker {
  index: number;
  busy: boolean;
  state: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
}

export interface PoolSummary {
  workers: number;
  max: number;
  states: PoolWorker[];
}

function unpack(method: string, buf: ArrayBuffer): Reply {
  const { header, payload } = decodeFrame(new Uint8Array(buf));
  const h = header as { ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } };
  if (!h.ok) throw new HostCallError(method, h.error?.code ?? 'internal', h.error?.message ?? 'unknown error');
  return { result: h.result ?? {}, payload };
}

/** Only the Tauri core can spawn hosts; the browser mock has no pool. */
export function poolAvailable(): boolean {
  return inTauri();
}

/** Make sure `count` workers exist and are ready. Returns the resulting pool. */
export async function poolEnsure(count: number): Promise<PoolSummary> {
  if (!poolAvailable()) return { workers: 0, max: 0, states: [] };
  return invoke<PoolSummary>('pool_ensure', { count });
}

export async function poolState(): Promise<PoolSummary | null> {
  if (!poolAvailable()) return null;
  return invoke<PoolSummary>('pool_state');
}

export async function poolRestart(worker: number): Promise<void> {
  if (!poolAvailable()) return;
  await invoke('pool_restart', { worker });
}

export async function poolShutdown(): Promise<void> {
  if (!poolAvailable()) return;
  await invoke('pool_shutdown');
}

/** The transport a batch lane uses. Mirrors `Transport` but without UI state
 * events: a pool worker has no editor to keep in sync. */
export function poolTransport(worker: number): Pick<Transport, 'kind' | 'request' | 'restart'> {
  return {
    kind: 'tauri',
    async request(method: string, params: Record<string, unknown>, opts: RequestOptions = {}): Promise<Reply> {
      if (opts.payload) {
        // Pool jobs read their own inputs; a pixel upload would need the
        // interactive session that a worker deliberately does not have.
        throw new HostCallError(method, 'unsupported', 'the render pool does not accept request payloads');
      }
      const buf = await invoke<ArrayBuffer>('pool_request', {
        worker, method, params, timeoutMs: opts.timeoutMs,
      });
      return unpack(method, buf);
    },
    async restart(): Promise<void> {
      await poolRestart(worker);
    },
  };
}

/** A worker's current phase, for diagnostics. Not part of the request path. */
export async function poolWorkerState(worker: number): Promise<Record<string, unknown> | null> {
  const s = await poolState();
  return s?.states[worker]?.state ?? null;
}

export const __poolTest = { unpack };
