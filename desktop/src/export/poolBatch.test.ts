import { describe, expect, it } from 'vitest';
import { runPooled } from './poolBatch';

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

describe('runPooled', () => {
  it('never runs more jobs at once than lanes', async () => {
    let live = 0;
    let peak = 0;
    const items = Array.from({ length: 9 }, (_, i) => i);
    await runPooled(items, 3, async (i) => {
      live++;
      peak = Math.max(peak, live);
      await tick(2 + (i % 3));
      live--;
      return i;
    });
    expect(peak).toBe(3);
  });

  it('keeps result order, not completion order', async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await runPooled(items, 2, async (i) => {
      await tick(6 - i);
      return i * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('gives the first jobs to every lane before queueing', async () => {
    const lanes: number[] = [];
    await runPooled([0, 1, 2, 3], 2, async (_i, index, lane) => {
      if (index < 2) lanes.push(lane);
      return index;
    });
    expect(lanes.sort()).toEqual([0, 1]);
  });

  it('stops pulling new work after a failure and rethrows it', async () => {
    const started: number[] = [];
    await expect(runPooled([0, 1, 2, 3, 4, 5], 2, async (i) => {
      started.push(i);
      if (i === 1) throw new Error('boom');
      await tick(1);
      return i;
    })).rejects.toThrow('boom');
    // Lane 0 may keep its own next pull racing the failure; the queue as a
    // whole must not drain.
    expect(started.length).toBeLessThan(6);
  });

  it('clamps absurd lane counts and handles an empty batch', async () => {
    expect(await runPooled([], 4, async () => 1)).toEqual([]);
    const seen = new Set<number>();
    await runPooled([0, 1], 99, async (_i, index, lane) => { seen.add(lane); return index; });
    expect(seen.size).toBe(2);
  });
});
