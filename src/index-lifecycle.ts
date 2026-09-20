export const STARTUP_INDEX_DELAY_MS = 5_000;
export const INDEX_READ_BATCH_SIZE = 4;

export interface TimeoutScheduler {
  clear(handle: number): void;
  set(callback: () => void, delayMs: number): number;
}

export class IndexStartupCoordinator {
  private pendingTask?: () => void;
  private timer?: number;

  constructor(
    private readonly scheduler: TimeoutScheduler,
    private readonly delayMs = STARTUP_INDEX_DELAY_MS,
  ) {}

  afterLayoutReady(task: () => void): void {
    this.cancel();
    this.pendingTask = task;
    this.timer = this.scheduler.set(() => {
      this.timer = undefined;
      const pendingTask = this.pendingTask;
      this.pendingTask = undefined;
      pendingTask?.();
    }, this.delayMs);
  }

  runNow(task?: () => void): boolean {
    const pendingTask = task ?? this.pendingTask;
    this.cancel();
    if (!pendingTask) return false;
    pendingTask();
    return true;
  }

  cancel(): void {
    if (this.timer !== undefined) this.scheduler.clear(this.timer);
    this.timer = undefined;
    this.pendingTask = undefined;
  }

  get isPending(): boolean {
    return this.timer !== undefined;
  }
}

interface BatchedWorkOptions {
  batchSize?: number;
  isCurrent: () => boolean;
  onBatchComplete?: (completed: number) => void;
  yieldControl: () => Promise<void>;
}

export async function runBatched<T>(
  items: readonly T[],
  processItem: (item: T) => Promise<void>,
  options: BatchedWorkOptions,
): Promise<boolean> {
  const batchSize = options.batchSize ?? INDEX_READ_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error('Index batch size must be a positive integer.');
  }

  for (let offset = 0; offset < items.length; offset += batchSize) {
    if (!options.isCurrent()) return false;
    const batch = items.slice(offset, offset + batchSize);
    await Promise.all(batch.map(async (item) => processItem(item)));
    if (!options.isCurrent()) return false;
    const completed = Math.min(offset + batch.length, items.length);
    options.onBatchComplete?.(completed);
    if (completed < items.length) await options.yieldControl();
  }
  return options.isCurrent();
}
