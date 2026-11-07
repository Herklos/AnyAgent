import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TERMS_LINK = "https://github.com/Herklos/Michel/blob/main/docs/research/provider-terms.md";

export const TERMS_NOTICE = `anybot drives the harness you installed (Claude Code, Codex, Grok Build) with your own login or API key. Each provider's terms apply, and some providers restrict automated use of consumer subscriptions; an API key is the safest option. See ${TERMS_LINK}.`;

/** Remember notice shown once per org under the state directory. Never blocks. */
export function showTermsNoticeOnce(stateDir: string, orgId: string): boolean {
  const dir = join(stateDir, "notices");
  mkdirSync(dir, { recursive: true });
  const marker = join(dir, `terms-${orgId}`);
  if (existsSync(marker)) return false;
  writeFileSync(marker, new Date().toISOString());
  return true;
}

export function noticeAlreadyShown(stateDir: string, orgId: string): boolean {
  return existsSync(join(stateDir, "notices", `terms-${orgId}`));
}

/** Test helper: read marker contents if present. */
export function readNoticeMarker(stateDir: string, orgId: string): string | undefined {
  const marker = join(stateDir, "notices", `terms-${orgId}`);
  if (!existsSync(marker)) return undefined;
  return readFileSync(marker, "utf8");
}
