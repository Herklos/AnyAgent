/**
 * Re-exports the WP1 mock-heart HTTP facade for process-level e2e.
 * Import path is the package test helper (not published); CI in-process tests
 * use MemoryBackend directly instead.
 */
export { type MockHeart, startMockHeart } from "../../packages/backend-anytype/test/mock-heart.js";
