import { createServer } from "node:http";
import { Unauthorized, Unavailable } from "@anyagent/backend";
import { afterEach, describe, expect, it } from "vitest";
import { HeartClient } from "../src/client.js";

describe("T-WP1-05 error mapping", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve, reject) => {
            s.close((e) => (e ? reject(e) : resolve()));
          }),
      ),
    );
  });

  async function serve(
    handler: (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => void,
  ) {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    return `http://127.0.0.1:${addr.port}`;
  }

  it("401 and 403 become Unauthorized", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(401).end("{}");
    });
    const client = new HeartClient({ baseUrl: url, apiKey: "x" });
    await expect(client.request("GET", "/v2/auth/whoami")).rejects.toBeInstanceOf(Unauthorized);

    const url403 = await serve((_req, res) => {
      res.writeHead(403).end("{}");
    });
    const client403 = new HeartClient({ baseUrl: url403, apiKey: "x" });
    await expect(client403.request("GET", "/x")).rejects.toBeInstanceOf(Unauthorized);
  });

  it("429 and 5xx become Unavailable", async () => {
    const url429 = await serve((_req, res) => {
      res.writeHead(429).end("{}");
    });
    await expect(
      new HeartClient({ baseUrl: url429, apiKey: "x" }).request("GET", "/x"),
    ).rejects.toBeInstanceOf(Unavailable);

    const url500 = await serve((_req, res) => {
      res.writeHead(503).end("{}");
    });
    await expect(
      new HeartClient({ baseUrl: url500, apiKey: "x" }).request("GET", "/x"),
    ).rejects.toBeInstanceOf(Unavailable);
  });

  it("a refused connection becomes Unavailable", async () => {
    const client = new HeartClient({ baseUrl: "http://127.0.0.1:1", apiKey: "x", timeoutMs: 500 });
    await expect(client.request("GET", "/x")).rejects.toBeInstanceOf(Unavailable);
  });
});
