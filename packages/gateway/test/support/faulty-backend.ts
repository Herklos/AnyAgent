import {
  type Backend,
  Unauthorized,
  Unavailable,
  type WatchEvent,
  type WatchSpec,
} from "@anyagent/backend";

/**
 * Wraps a Backend so watch / identity can throw Unavailable or Unauthorized on demand.
 */
export class FaultyBackend implements Backend {
  fault: "none" | "unavailable" | "unauthorized" = "none";
  readonly name: string;
  readonly capabilities: Backend["capabilities"];
  readonly identity: Backend["identity"];
  readonly org: Backend["org"];
  readonly objects: Backend["objects"];
  readonly chat: Backend["chat"];
  readonly events: Backend["events"];

  constructor(private readonly inner: Backend) {
    this.name = inner.name;
    this.capabilities = inner.capabilities;
    this.org = inner.org;
    this.objects = inner.objects;
    this.chat = inner.chat;
    this.identity = {
      self: async () => {
        this.throwIfFault();
        return inner.identity.self();
      },
      roleOf: (id) => inner.identity.roleOf(id),
    };
    this.events = {
      watch: (spec: WatchSpec, opts?: { after?: string; signal?: AbortSignal }) =>
        this.watch(spec, opts),
    };
  }

  private throwIfFault(): void {
    if (this.fault === "unavailable") throw new Unavailable("injected unavailable");
    if (this.fault === "unauthorized") throw new Unauthorized("injected unauthorized");
  }

  private async *watch(
    spec: WatchSpec,
    opts?: { after?: string; signal?: AbortSignal },
  ): AsyncGenerator<WatchEvent> {
    this.throwIfFault();
    for await (const ev of this.inner.events.watch(spec, opts)) {
      this.throwIfFault();
      yield ev;
    }
  }
}
