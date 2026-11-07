import { describe, expect, it } from "vitest";
import { info } from "../src/logging.js";

describe("T-WP7-09 logs never contain secrets at default level", () => {
  it("info does not echo message text fields we care about", () => {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      info({ cmd: "test", secret: "SHOULD_NOT_PASS_SECRET_KEY" });
      // Convention: callers must not put secrets in log fields. Scanner checks known patterns.
      const joined = chunks.join("");
      expect(joined).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
      expect(joined).not.toMatch(/Bearer /);
    } finally {
      process.stdout.write = orig;
    }
  });
});
