export const ID_PATTERNS = {
	REQ: /^REQ-\d{3}$/,
	Q: /^Q-\d{3}$/,
	ACT: /^ACT-\d{3}$/,
	UC: /^UC-\d{3}$/,
	DSN: /^DSN-\d{3}$/,
	SEQ: /^SEQ-\d{3}$/,
	TCK: /^TCK-\d{3}$/,
	PRP: /^PRP-\d{3}$/
} as const satisfies Record<string, RegExp>;

export type IdPrefix = keyof typeof ID_PATTERNS;

/** Next free ID after the highest existing one; entries not matching the prefix's pattern are ignored. */
export function nextId(prefix: IdPrefix, existing: string[]): string {
	const pattern = ID_PATTERNS[prefix];
	const max = existing
		.filter((id) => pattern.test(id))
		.reduce((acc, id) => Math.max(acc, Number(id.slice(prefix.length + 1))), 0);
	if (max >= 999) throw new Error(`No ${prefix} IDs left after ${prefix}-999`);
	return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

/** Mermaid node IDs cannot contain dashes: "UC-001" becomes "UC_001". */
export function toMermaidId(id: string): string {
	return id.replaceAll('-', '_');
}
