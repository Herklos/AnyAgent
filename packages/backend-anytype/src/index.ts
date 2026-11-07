export {
  AnytypeAdapter,
  type AnytypeAdapterMeta,
  type AnytypeAdapterOptions,
  createAnytypeAdapter,
} from "./adapter.js";
export { HeartClient, type HeartClientOptions } from "./client.js";
export {
  type HeartMessage,
  type HeartObject,
  mapMessage,
  mapObject,
  mapRole,
} from "./mapping.js";
export { parseSse, type SseEvent, type SseFrame } from "./sse.js";

/** Package marker for WP0 workspace smoke. */
export const BACKEND_ANYTYPE_PACKAGE = "@anyagent/backend-anytype" as const;
