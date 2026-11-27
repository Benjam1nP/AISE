import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level, so equal values always give the same string. */
export function stableStringify(v: unknown): string {
	const sorted = (_key: string, val: unknown) =>
		val && typeof val === 'object' && !Array.isArray(val)
			? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: val;
	return JSON.stringify(v, sorted) ?? 'null';
}

export function sha256(s: string | Buffer): string {
	return createHash('sha256').update(s).digest('hex');
}
