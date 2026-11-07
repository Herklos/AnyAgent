export async function waitFor(
  pred: () => boolean | Promise<boolean>,
  timeoutMs: number,
  stepMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
