import { describe, expect, it, vi } from 'vitest';

import {
  INDEX_READ_BATCH_SIZE,
  IndexStartupCoordinator,
  IndexUpdateBuffer,
  runBatched,
  STARTUP_INDEX_DELAY_MS,
  type TimeoutScheduler,
} from '../src/index-lifecycle';

class FakeScheduler implements TimeoutScheduler {
  private nextHandle = 1;
  readonly tasks = new Map<number, { callback: () => void; delayMs: number }>();

  clear(handle: number): void {
    this.tasks.delete(handle);
  }

  set(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.tasks.set(handle, { callback, delayMs });
    return handle;
  }

  runNext(): void {
    const next = this.tasks.entries().next().value as [number, { callback: () => void }] | undefined;
    if (!next) return;
    const [handle, task] = next;
    this.tasks.delete(handle);
    task.callback();
  }
}

describe('IndexStartupCoordinator', () => {
  it('defers layout-ready indexing instead of starting work inline', () => {
    const scheduler = new FakeScheduler();
    const coordinator = new IndexStartupCoordinator(scheduler);
    const start = vi.fn();

    coordinator.afterLayoutReady(start);

    expect(start).not.toHaveBeenCalled();
    expect(coordinator.isPending).toBe(true);
    expect([...scheduler.tasks.values()]).toEqual([
      expect.objectContaining({ delayMs: STARTUP_INDEX_DELAY_MS }),
    ]);

    scheduler.runNext();
    expect(start).toHaveBeenCalledOnce();
    expect(coordinator.isPending).toBe(false);
  });

  it('runs immediately on explicit use and cancels the deferred copy', () => {
    const scheduler = new FakeScheduler();
    const coordinator = new IndexStartupCoordinator(scheduler);
    const deferredStart = vi.fn();
    const explicitStart = vi.fn();
    coordinator.afterLayoutReady(deferredStart);

    expect(coordinator.runNow(explicitStart)).toBe(true);
    scheduler.runNext();

    expect(explicitStart).toHaveBeenCalledOnce();
    expect(deferredStart).not.toHaveBeenCalled();
    expect(scheduler.tasks.size).toBe(0);
  });

  it('cancels deferred work on unload', () => {
    const scheduler = new FakeScheduler();
    const coordinator = new IndexStartupCoordinator(scheduler);
    const start = vi.fn();
    coordinator.afterLayoutReady(start);

    coordinator.cancel();
    scheduler.runNext();

    expect(start).not.toHaveBeenCalled();
    expect(scheduler.tasks.size).toBe(0);
  });
});

describe('IndexUpdateBuffer', () => {
  it('coalesces startup cache events without scheduling note reads', () => {
    const buffer = new IndexUpdateBuffer<{ path: string; revision: number }>((item) => item.path);

    expect(buffer.defer({ path: 'Alpha.md', revision: 1 })).toBe(true);
    expect(buffer.defer({ path: 'Alpha.md', revision: 2 })).toBe(true);
    expect(buffer.defer({ path: 'Beta.md', revision: 1 })).toBe(true);

    expect(buffer.size).toBe(2);
  });

  it('drops events covered by the full rebuild and flushes only later changes', () => {
    const buffer = new IndexUpdateBuffer<{ path: string; revision: number }>((item) => item.path);
    const scheduled: Array<{ path: string; revision: number }> = [];
    buffer.defer({ path: 'Covered.md', revision: 1 });
    buffer.defer({ path: 'ChangedLater.md', revision: 1 });

    buffer.markProcessed('Covered.md');
    buffer.markProcessed('ChangedLater.md');
    buffer.defer({ path: 'ChangedLater.md', revision: 2 });
    buffer.finishRebuild((item) => scheduled.push(item));

    expect(scheduled).toEqual([{ path: 'ChangedLater.md', revision: 2 }]);
    expect(buffer.isReady).toBe(true);
    expect(buffer.defer({ path: 'Immediate.md', revision: 1 })).toBe(false);
  });

  it('forgets deleted paths and resets for an explicit rebuild', () => {
    const buffer = new IndexUpdateBuffer<{ path: string }>((item) => item.path);
    const scheduled: Array<{ path: string }> = [];
    buffer.defer({ path: 'Deleted.md' });
    buffer.remove('Deleted.md');
    buffer.finishRebuild((item) => scheduled.push(item));

    expect(scheduled).toEqual([]);
    buffer.beginRebuild();
    expect(buffer.isReady).toBe(false);
    expect(buffer.defer({ path: 'During-rebuild.md' })).toBe(true);
    buffer.clear();
    expect(buffer.size).toBe(0);
  });
});

describe('runBatched', () => {
  it('limits concurrent reads and yields between small batches', async () => {
    const items = Array.from({ length: INDEX_READ_BATCH_SIZE * 2 + 1 }, (_, index) => index);
    let active = 0;
    let maximumActive = 0;
    const completed: number[] = [];
    const yieldControl = vi.fn(async () => Promise.resolve());

    const finished = await runBatched(items, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
    }, {
      isCurrent: () => true,
      onBatchComplete: (count) => completed.push(count),
      yieldControl,
    });

    expect(finished).toBe(true);
    expect(maximumActive).toBe(INDEX_READ_BATCH_SIZE);
    expect(completed).toEqual([INDEX_READ_BATCH_SIZE, INDEX_READ_BATCH_SIZE * 2, items.length]);
    expect(yieldControl).toHaveBeenCalledTimes(2);
  });

  it('stops before a later batch when the generation is superseded', async () => {
    const processed: number[] = [];
    let current = true;

    const finished = await runBatched(
      Array.from({ length: INDEX_READ_BATCH_SIZE * 2 }, (_, index) => index),
      async (item) => {
        processed.push(item);
      },
      {
        isCurrent: () => current,
        yieldControl: async () => {
          current = false;
        },
      },
    );

    expect(finished).toBe(false);
    expect(processed).toEqual([0, 1, 2, 3]);
  });
});
