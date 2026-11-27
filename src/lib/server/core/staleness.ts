import { sha256, stableStringify } from './hash';
import type { RequirementsDoc } from './schemas/requirements';

/** One hash per requirement over the whole object, so any field change shows. */
export function reqHashes(r: RequirementsDoc): Record<string, string> {
	return Object.fromEntries(r.requirements.map((q) => [q.id, sha256(stableStringify(q))]));
}

/** IDs whose hash differs, plus IDs added or removed, sorted. */
export function changedIds(
	stored: Record<string, string>,
	current: Record<string, string>
): string[] {
	const ids = new Set([...Object.keys(stored), ...Object.keys(current)]);
	return [...ids].filter((id) => stored[id] !== current[id]).sort();
}

/** What an Update run patches: IDs in both with another hash, only in `current`, only in `stored`. */
export function designDiff(
	stored: Record<string, string>,
	current: Record<string, string>
): { changed: string[]; added: string[]; removed: string[] } {
	const ids = changedIds(stored, current);
	return {
		changed: ids.filter((id) => id in stored && id in current),
		added: ids.filter((id) => !(id in stored)),
		removed: ids.filter((id) => !(id in current))
	};
}
