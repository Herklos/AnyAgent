/**
 * Pure admission queue for AgentCore. No Temporal imports.
 */
import type { Admission, ChatInput, CoreStatus, Disposition, RotationHint } from "./types.js";

interface Queued {
  input: ChatInput;
  turnNumber: number;
}

export class AdmissionQueue {
  private readonly rotateAfterAccepted: number;
  private readonly seen = new Map<string, number>();
  private readonly queue: Queued[] = [];
  private nextTurn = 1;
  private accepted = 0;
  private turns = 0;
  private failed = 0;
  private closing = false;
  private running = false;
  private currentKey: string | undefined;
  private historyLength = 0;
  private continueAsNewFromTemporal = false;

  constructor(opts?: { rotateAfterAccepted?: number }) {
    this.rotateAfterAccepted = opts?.rotateAfterAccepted ?? 1500;
  }

  admit(input: ChatInput): Admission {
    if (this.closing) {
      const err = new Error("AgentClosed");
      err.name = "AgentClosed";
      throw err;
    }
    const existing = this.seen.get(input.key);
    if (existing !== undefined) {
      return { disposition: "duplicate", turnNumber: existing };
    }
    const turnNumber = this.nextTurn++;
    this.seen.set(input.key, turnNumber);
    this.accepted += 1;
    const disposition: Disposition = !this.running && this.queue.length === 0 ? "opened" : "queued";
    this.queue.push({ input, turnNumber });
    return { disposition, turnNumber };
  }

  next(): Queued | undefined {
    if (this.queue.length === 0) return undefined;
    return this.queue.shift();
  }

  begin(input: ChatInput): void {
    this.running = true;
    this.currentKey = input.key;
  }

  finish(ok: boolean): void {
    this.turns += 1;
    if (!ok) this.failed += 1;
    this.running = false;
    this.currentKey = undefined;
  }

  requestClose(): void {
    this.closing = true;
  }

  setHistoryLength(n: number): void {
    this.historyLength = n;
  }

  setContinueAsNewSuggested(v: boolean): void {
    this.continueAsNewFromTemporal = v;
  }

  get isClosing(): boolean {
    return this.closing;
  }

  get isIdle(): boolean {
    return !this.running && this.queue.length === 0;
  }

  get hasWork(): boolean {
    return this.running || this.queue.length > 0;
  }

  /** Items still queued after close (for tests). */
  peekQueuedInputs(): ChatInput[] {
    return this.queue.map((q) => q.input);
  }

  snapshot(): CoreStatus {
    const continueAsNewSuggested =
      this.continueAsNewFromTemporal || this.accepted >= this.rotateAfterAccepted;
    const status: CoreStatus = {
      state: this.closing ? "closing" : this.running ? "running" : "idle",
      queued: this.queue.length,
      turns: this.turns,
      accepted: this.accepted,
      failed: this.failed,
      historyLength: this.historyLength,
      continueAsNewSuggested,
    };
    if (this.currentKey !== undefined) status.currentKey = this.currentKey;
    return status;
  }

  rotation(): RotationHint {
    const snap = this.snapshot();
    return {
      continueAsNewSuggested: snap.continueAsNewSuggested,
      historyLength: snap.historyLength,
      idle: this.isIdle,
      accepted: this.accepted,
    };
  }
}
