import { dbFile } from '../agents/code';
import { planPaths } from '../codegen/plan';
import { designHashes, hasCode, hashFiles, listCodeFiles, readChecks } from '../core/code-state';
import { appEntries, MAIN_ENTRY, startScripts } from '../core/nodes';
import { readmeMarkdown } from '../core/render/markdown';
import { DesignDoc } from '../core/schemas/design';
import { readDesignReview } from '../core/tools/coverage';
import { DESIGN_PATH } from '../core/tools/design';
import type { RequirementsDoc } from '../core/schemas/requirements';
import type { State } from '../core/state';
import type { ProjectStore } from '../core/store';
import { validateDesign } from '../core/validate';
import { checkGate, type GateResult } from './gates';
import { changedIds } from './staleness';

/** The user message of a generation run in the P4 chat. */
export const GENERATE_MESSAGE = 'Generate the code from the approved design.';

/** Why P4 cannot act yet: P2 must be approved and not stale (spec section 4); null when it can. */
export function p2NotReady(state: State, action: string): string | null {
	const { status } = state.phases.P2;
	if (status === 'stale')
		return `P2 is stale; update it or confirm it is still valid before ${action}`;
	if (status !== 'approved') return `Approve P2 before ${action}`;
	return null;
}

/** A design approved over a failing gate cannot be generated from; null when it can. */
export function designProblems(
	design: DesignDoc | null,
	reqs: RequirementsDoc | null
): string | null {
	if (!design) return 'There is no design to generate code from';
	const { issues } = validateDesign(design, reqs);
	if (issues.length === 0) return null;
	return `The design has issues; fix them in P2 first: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`;
}

/**
 * The wiring step's entry files that do not exist: `src/app/main.ts` and one per extra service
 * node. No other check notices a missing entry.
 */
export const missingEntries = (files: string[], design: DesignDoc | null) =>
	(design ? appEntries(design) : [MAIN_ENTRY]).filter((e) => !files.includes(e));

/** The P4 gate from the stored checks and the current code hash; never runs Docker. */
export async function codeGate(
	store: ProjectStore,
	reqs: RequirementsDoc | null,
	design: DesignDoc | null
): Promise<GateResult> {
	const [checks, files] = await Promise.all([readChecks(store), listCodeFiles(store)]);
	return checkGate(
		'P4',
		reqs,
		design,
		checks,
		await hashFiles(store, files),
		missingEntries(files, design)
	);
}

/** The P2 gate: the design checks plus the stored acceptance criteria coverage. */
export async function designGate(
	store: ProjectStore,
	reqs: RequirementsDoc | null,
	design: DesignDoc | null
): Promise<GateResult> {
	return checkGate('P2', reqs, design, null, null, [], await readDesignReview(store));
}

/** The design's element hashes; a missing design has none, so every stored ID reads as removed. */
export const designHashesOf = (design: DesignDoc | null) => (design ? designHashes(design) : {});

/**
 * Design IDs that changed since the code was last made or confirmed against the design. Read from
 * the P4 phase state whatever its status, so the stale banner stays after a chat run reopens P4.
 */
export function staleDesignIds(state: State, design: DesignDoc | null): string[] {
	const stored = state.phases.P4.designHashes;
	return stored ? changedIds(stored, designHashesOf(design)) : [];
}

/** An approved P4 turns stale while its stored design hashes differ from the design, and back. */
export function markP4Stale(state: State, design: DesignDoc | null): void {
	const p4 = state.phases.P4;
	if (p4.status !== 'approved' && p4.status !== 'stale') return;
	p4.status = staleDesignIds(state, design).length > 0 ? 'stale' : 'approved';
}

export const README = 'README.md';
const PACKAGE = 'package.json';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** package.json and its scripts, or null when it is missing or not a JSON object. */
async function readPackage(
	store: ProjectStore
): Promise<{ pkg: Record<string, unknown>; scripts: Record<string, unknown> } | null> {
	const text = await store.readText(PACKAGE);
	if (text === null) return null;
	let pkg: unknown;
	try {
		pkg = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isRecord(pkg)) return null;
	return { pkg, scripts: isRecord(pkg.scripts) ? pkg.scripts : {} };
}

/**
 * Sets `start` and the `start:<node>` scripts of package.json from the design's service nodes and
 * keeps every other script, and the script of a removed node until its entry file is deleted, after a run that left code, backed up under the run like the README.
 * Returns whether it wrote the file, which changes the code hash.
 */
export async function syncStartScripts(store: ProjectStore, runId: string): Promise<boolean> {
	if (!(await hasCode(store))) return false;
	const [design, found] = await Promise.all([
		store.readJson(DESIGN_PATH, DesignDoc),
		readPackage(store)
	]);
	if (!design || !found) return false;
	const others = Object.entries(found.scripts).filter(
		([k]) => k !== 'start' && !k.startsWith('start:')
	);
	// A removed node's script stays while its entry file exists, so staleEntries keeps naming it.
	const stale = new Set(await staleEntries(store, design));
	const kept: [string, unknown][] = [];
	for (const [k, v] of Object.entries(found.scripts)) {
		const entry = typeof v === 'string' ? /^tsx (src\/app\/[\w.-]+\.ts)$/.exec(v)?.[1] : undefined;
		if (k.startsWith('start:') && entry && stale.has(entry) && (await store.exists(entry)))
			kept.push([k, v]);
	}
	const scripts = {
		...startScripts(design),
		...Object.fromEntries(kept),
		...Object.fromEntries(others)
	};
	if (JSON.stringify(scripts) === JSON.stringify(found.scripts)) return false;
	await store.writeFile(
		PACKAGE,
		`${JSON.stringify({ ...found.pkg, scripts }, null, '\t')}\n`,
		runId
	);
	return true;
}

/**
 * Entry files of service nodes the design no longer has: the `start:<node>` scripts name them
 * until the next sync, so an Update brief can ask for their deletion.
 */
export async function staleEntries(
	store: ProjectStore,
	design: DesignDoc | null
): Promise<string[]> {
	const found = await readPackage(store);
	if (!found) return [];
	const current = new Set(design ? appEntries(design) : [MAIN_ENTRY]);
	const named = Object.entries(found.scripts).flatMap(([k, v]) => {
		const m =
			k.startsWith('start:') && typeof v === 'string'
				? /^tsx (src\/app\/[\w.-]+\.ts)$/.exec(v)
				: null;
		return m && !current.has(m[1]) ? [m[1]] : [];
	});
	return named;
}

/**
 * Renders `README.md` from the design after a run that left code, backed up under the run so a
 * discard restores it. An unchanged README is not written: a backup would mark the run as one
 * that changed files. Throws for an unreadable or unplannable design.
 */
export async function writeReadme(store: ProjectStore, runId: string, projectName: string) {
	if (!(await hasCode(store))) return;
	const design = await store.readJson(DESIGN_PATH, DesignDoc);
	if (!design) return;
	const db = dbFile(design, projectName);
	// Only classes that have a file: the design may have gained a class since the code was written.
	const files = new Set(await listCodeFiles(store));
	const paths = Object.fromEntries(
		Object.entries(planPaths(design)).filter(([, p]) => files.has(p))
	);
	const text = readmeMarkdown(design, projectName, paths, db, await store.exists('RUN.md'));
	if ((await store.readText(README)) !== text) await store.writeFile(README, text, runId);
}
