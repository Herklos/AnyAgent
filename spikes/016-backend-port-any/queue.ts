// A minimal async queue: producers push, one consumer awaits. Closing wakes the consumer.
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiter: ((r: { done: boolean }) => void) | undefined;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.waiter?.({ done: false });
    this.waiter = undefined;
  }

  close(): void {
    this.closed = true;
    this.waiter?.({ done: true });
    this.waiter = undefined;
  }

  /** Resolves with the next item, or undefined once closed and drained. */
  async next(): Promise<T | undefined> {
    for (;;) {
      if (this.items.length > 0) return this.items.shift();
      if (this.closed) return undefined;
      await new Promise<{ done: boolean }>((resolve) => (this.waiter = resolve));
    }
  }
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
