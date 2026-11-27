/** The IDs of the `@trace` tags in a source file: the class ID first, then its requirement IDs. */
export function traceIds(source: string): string[] {
	const ids = new Set<string>();
	for (const line of source.split('\n')) {
		const at = line.indexOf('@trace');
		if (at < 0) continue;
		for (const id of line.slice(at).matchAll(/\b(?:DSN|REQ)-\d+\b/g)) ids.add(id[0]);
	}
	return [...ids];
}
