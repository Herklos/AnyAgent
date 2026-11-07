import { Conflict, NotFound, Unauthorized, Unavailable } from "@anyagent/backend";

export interface HeartClientOptions {
  baseUrl: string;
  apiKey: string;
  /**
   * UNVERIFIED: `Anytype-Version` is not listed in docs/research/anytype-api.md.
   * Kept as a default until spike 002 confirms whether heart requires it.
   */
  versionHeader?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HeartClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly versionHeader: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HeartClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.versionHeader = opts.versionHeader ?? "2025-11-08";
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "Anytype-Version": this.versionHeader,
      ...extra,
    };
  }

  async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<T> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    const onOuterAbort = () => ac.abort();
    opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const init: RequestInit = {
        method,
        headers: this.headers({
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...opts.headers,
        }),
        signal: ac.signal,
      };
      if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
      } catch (err) {
        throw new Unavailable(err instanceof Error ? `network: ${err.message}` : "network error");
      }
      if (res.status === 401 || res.status === 403) {
        throw new Unauthorized(`HTTP ${res.status}`, res.status);
      }
      if (res.status === 404) {
        throw new NotFound(path);
      }
      if (res.status === 409) {
        const text = await res.text().catch(() => "");
        let fields: string[] = [];
        try {
          const parsed = JSON.parse(text) as { fields?: string[]; objectId?: string };
          fields = parsed.fields ?? [];
          throw new Conflict(parsed.objectId ?? path, fields);
        } catch (e) {
          if (e instanceof Conflict) throw e;
          throw new Conflict(path, fields);
        }
      }
      if (res.status === 429 || res.status >= 500) {
        throw new Unavailable(`HTTP ${res.status}`, res.status);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Unavailable(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  async stream(
    path: string,
    opts: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<Response> {
    const method = opts.method ?? "GET";
    const init: RequestInit = {
      method,
      headers: this.headers({
        Accept: "text/event-stream",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      }),
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    if (opts.signal) init.signal = opts.signal;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new Unavailable(err instanceof Error ? `network: ${err.message}` : "network error");
    }
    if (res.status === 401 || res.status === 403)
      throw new Unauthorized(`HTTP ${res.status}`, res.status);
    if (res.status === 404) throw new NotFound(path);
    if (res.status === 429 || res.status >= 500)
      throw new Unavailable(`HTTP ${res.status}`, res.status);
    if (!res.ok || !res.body) {
      throw new Unavailable(`HTTP ${res.status}`);
    }
    return res;
  }
}
