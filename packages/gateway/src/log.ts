export interface GatewayLogFields {
  org: string;
  space: string;
  agent?: string;
  key?: string;
  outcome: string;
  eventAgeMs?: number;
  [extra: string]: unknown;
}

/** One JSON log line; never includes message text. */
export function logGateway(fields: GatewayLogFields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...fields });
  console.info(line);
}
