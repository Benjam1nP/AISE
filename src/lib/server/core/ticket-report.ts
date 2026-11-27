import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { z } from 'zod';
import { codeHash } from './code-state';
import { sha256, stableStringify } from './hash';
import { listRuns, readBackup, runFiles } from './runs';
import { DesignDoc } from './schemas/design';
import { RequirementsDoc } from './schemas/requirements';
import type { TicketReport } from './schemas/tickets';
import { changedIds, reqHashes } from './staleness';
import type { ProjectStore } from './store';
import { readTestChecks, testHash } from './test-state';
import { DESIGN_PATH } from './tools/design';
import { REQUIREMENTS_PATH } from './tools/requirements';
import { rejectReason } from './tools/scope';

/** The change data of a report; the maintenance agent adds the prose and the time. */
export type ReportData = Omit<TicketReport, 'at' | 'text'>;

const MAX_DIFF_LINES = 400;
const MAX_DIFF_CHARS = 40_000;
const MAX_DIFF_BYTES = 1024 * 1024;
const TOO_LARGE = '... (too large to diff)';

/** A file the report lists: not an artefact, a secret, node_modules or .git (the rule the file tools use). */
const listed = (rel: string) => rejectReason(rel) === null;

/**
 * The file's text now, '' when it is gone, TOO_LARGE above the size limit. Anything that is not a
 * plain file with one link at its own path (a folder, a link, a hard link, a path that runs
 * through a linked folder) counts as gone, so a link put in place of the file or of a folder
 * above it cannot leak what it points at into a report.
 */
async function current(store: ProjectStore, rel: string): Promise<string | typeof TOO_LARGE> {
	try {
		const abs = store.resolve(rel);
		const [real, root] = [await realpath(abs), await realpath(store.dir)];
		if (path.relative(root, real) !== path.normalize(rel)) return '';
		const s = await lstat(abs);
		if (!s.isFile() || s.nlink !== 1) return '';
		if (s.size > MAX_DIFF_BYTES) return TOO_LARGE;
	} catch (e) {
		if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes((e as NodeJS.ErrnoException).code ?? '')) return '';
		throw e;
	}
	return (await store.readText(rel)) ?? '';
}

/**
 * Unified diff, '' when nothing differs. Cut to MAX_DIFF_LINES lines with a note for the rest,
 * then to MAX_DIFF_CHARS characters; a side over MAX_DIFF_BYTES is not diffed at all.
 */
function diffOf(rel: string, before: string, after: string | typeof TOO_LARGE): string {
	if (after === TOO_LARGE || Buffer.byteLength(before) > MAX_DIFF_BYTES) return TOO_LARGE;
	if (before === after) return '';
	const lines = createTwoFilesPatch(rel, rel, before, after).replace(/\n$/, '').split('\n');
	let diff = lines.join('\n');
	if (lines.length > MAX_DIFF_LINES)
		diff = [
			...lines.slice(0, MAX_DIFF_LINES),
			`... (${lines.length - MAX_DIFF_LINES} more lines)`
		].join('\n');
	return diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n... (truncated)` : diff;
}

/** One hash per design element over the whole element (a node with its links), so any edit shows. */
function elementHashes(d: DesignDoc): Record<string, string> {
	const h = (v: unknown) => sha256(stableStringify(v));
	const out: Record<string, string> = {};
	for (const e of [...d.actors, ...d.useCases, ...d.classes, ...d.components, ...d.sequences])
		out[e.id] = h(e);
	for (const n of d.nodes)
		out[n.id] = h({ ...n, links: d.links.filter((l) => l.from === n.id || l.to === n.id) });
	return out;
}

/** IDs whose hash differs between the stored JSON `before` and the current one; an unreadable document has no IDs. */
function idsChanged<T>(
	before: string | null,
	now: string | null,
	schema: z.ZodType<T>,
	hashes: (doc: T) => Record<string, string>
): string[] {
	const hash = (text: string | null) => {
		if (text === null) return {};
		try {
			const r = schema.safeParse(JSON.parse(text));
			return r.success ? hashes(r.data) : {};
		} catch {
			return {};
		}
	};
	return changedIds(hash(before), hash(now));
}

/**
 * What a ticket changed, built from its runs: the runs as steps, the net diff per project file
 * (backups hold the before state only, so the earliest backup against the file now), the
 * requirement and design IDs that differ from before the first step, and the last test result.
 */
export async function reportData(store: ProjectStore, ticketId: string): Promise<ReportData> {
	const runs = (await listRuns(store))
		.filter(
			(r) =>
				r.ticketId === ticketId &&
				r.status !== 'discarded' &&
				!(r.phase === 'P7' && r.agent === 'maintenance')
		)
		.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

	// path to the content before the first step that touched it, '' when that step created it
	const before = new Map<string, string>();
	const steps: TicketReport['steps'] = [];
	for (const r of runs) {
		const touched = await runFiles(store, r.id);
		for (const f of touched)
			if (!before.has(f.path))
				before.set(f.path, f.created ? '' : ((await readBackup(store, r.id, f.path)) ?? ''));
		steps.push({
			runId: r.id,
			phase: r.phase,
			agent: r.agent,
			status: r.status,
			summary: r.summary,
			files: touched.map((f) => f.path).filter(listed)
		});
	}

	const files: TicketReport['files'] = [];
	for (const rel of [...before.keys()].filter(listed).sort())
		files.push({ path: rel, diff: diffOf(rel, before.get(rel)!, await current(store, rel)) });

	const was = async (rel: string) => (before.has(rel) ? before.get(rel)! : store.readText(rel));
	const reqNow = await store.readText(REQUIREMENTS_PATH);
	const designNow = await store.readText(DESIGN_PATH);
	const [reqBefore, designBefore] = [await was(REQUIREMENTS_PATH), await was(DESIGN_PATH)];
	const ids = new Set([
		...idsChanged(reqBefore, reqNow, RequirementsDoc, reqHashes),
		...idsChanged(designBefore, designNow, DesignDoc, elementHashes)
	]);

	const checks = await readTestChecks(store);
	const tests: ReportData['tests'] = checks?.result
		? {
				at: checks.at,
				passed: checks.result.passed,
				failed: checks.result.failed,
				outOfDate:
					checks.codeHash !== (await codeHash(store)) || checks.testHash !== (await testHash(store))
			}
		: null;

	return { steps, changedIds: [...ids].sort(), files, tests };
}
