/**
 * The external Frankfurter service at api.frankfurter.app (GET /latest?from=...), called only by FrankfurterClient.
 *
 * @trace DSN-035 REQ-005 REQ-010
 */
export interface FrankfurterApi {
  latest(base: string): Promise<Record<string, number>>;
}
