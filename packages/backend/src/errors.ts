/**
 * Copied from spikes/016-backend-port-any/port.ts (ConflictError, NotFoundError)
 * at commit of that spike, then extended for WP1 typed errors.
 * Licence: Apache-2.0 (same as anyagent). Changes: Unauthorized, Unavailable,
 * Unsupported; Conflict/NotFound renamed to match WP1 names with aliases.
 */

export class Unauthorized extends Error {
  readonly status?: number;
  constructor(message = "unauthorized", status?: number) {
    super(message);
    this.name = "Unauthorized";
    if (status !== undefined) this.status = status;
  }
}

export class Unavailable extends Error {
  readonly status?: number;
  constructor(message = "unavailable", status?: number) {
    super(message);
    this.name = "Unavailable";
    if (status !== undefined) this.status = status;
  }
}

export class NotFound extends Error {
  constructor(what: string) {
    super(`not found: ${what}`);
    this.name = "NotFound";
  }
}

export class Conflict extends Error {
  readonly objectId: string;
  readonly fields: string[];
  constructor(objectId: string, fields: string[]) {
    super(`stale write on ${objectId}: ${fields.join(", ")}`);
    this.name = "Conflict";
    this.objectId = objectId;
    this.fields = fields;
  }
}

export class Unsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Unsupported";
  }
}

/** Spike 016 aliases kept so promoted checks read cleanly. */
export { Conflict as ConflictError, NotFound as NotFoundError };
