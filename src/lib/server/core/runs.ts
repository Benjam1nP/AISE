import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ID_PATTERNS } from './ids';
import { PathError } from './path-error';
import { Ticket, TicketId } from './schemas/tickets';
import { PhaseId, PhaseState } from './state';
// Type only: store.ts imports backupFile from here at runtime.
import type { ProjectStore } from './store';

export const RunMeta = z.object({
	id: z.string(),
	phase: PhaseId,
	agent: z.string(),
	status: z.enum(['running', 'done', 'failed', 'discarded']),
	startedAt: z.string(),
	finishedAt: z.string().optional(),
	error: z.string().optional(),
	usage: z.object({
		input: z.number(),
		output: z.number(),
		cacheRead: z.number(),
		cacheWrite: z.number()
	}),
	costUsd: z.number(),
	summary: z.string().optional(),
	/** The phase state before the run; discard puts it back. */
	prevPhase: PhaseState.optional(),
	/** sha256 of the phase artefact before the run, null when there was none. */
	prevArtefactHash: z.string().nullable().optional(),
	/** sha256 of the phase artefact when the run ended; discard refuses once it changed again. */
	postArtefactHash: z.string().nullable().optional(),
	/** P2 runs: requirement hashes the design was made from; approving P2 records these. P5 generation and Update runs: those the tests were made from. */
	reqHashes: z.record(z.string(), z.string()).optional(),
	/** P4 generation and update runs: design hashes the code was made from; approving P4 records these. */
	designHashes: z.record(z.string(), z.string()).optional(),
	/** P5 generation and Update runs: use case and sequence hashes the tests were made from. */
	useCaseHashes: z.record(z.string(), z.string()).optional(),
	/** P6 generation and Update runs: deploy hashes the deployment was made from. */
	deployHashes: z.record(z.string(), z.string()).optional(),
	/** The ticket the run belongs to: P7 runs, and every run started while a ticket is in progress. */
	ticketId: TicketId.optional(),
	/** True for the run that closes a ticket; only such a run may call write_ticket_report. */
	report: z.literal(true).optional(),
	/**
	 * True for a run that started from a ticket's entry brief (approve plan, or start the entry
	 * run again). Set by the orchestrator only; a Retry in the phase chat never carries it.
	 */
	entry: z.literal(true).optional(),
	/** True for a P5 fix loop run, in which the test agent and the code agent hand findings to each other. */
	fixLoop: z.literal(true).optional(),
	/** P2 runs that apply an accepted review proposal: its PRP ID; discard reopens it. */
	fromProposal: z.string().regex(ID_PATTERNS.PRP).optional(),
	/** The ticket before the run; discard puts it back. */
	prevTicket: Ticket.pick({ status: true, plan: true, report: true })
		.partial({ plan: true, report: true })
		.optional()
});
export type RunMeta = z.infer<typeof RunMeta>;

const CreatedList = z.array(z.string());

const RUNS_DIR = '.aise/runs';
const RUN_ID = /^\d{8}-\d{6}-P[1-7](-\d+)?$/;
const CREATED = 'created.json';

function runDir(id: string): string {
	if (!RUN_ID.test(id)) throw new PathError(`Not a run id: ${id}`);
	return `${RUNS_DIR}/${id}`;
}
const runFile = (id: string) => `${runDir(id)}/run.json`;
const backupDir = (id: string) => `${runDir(id)}/backup`;

const isCode = (e: unknown, code: string) => (e as NodeJS.ErrnoException).code === code;

/** Claims the run directory with a non-recursive mkdir, so concurrent calls never share an id. */
export async function createRun(
	store: ProjectStore,
	phase: PhaseId,
	agent: string
): Promise<RunMeta> {
	const now = new Date();
	const base = `${now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${PhaseId.parse(phase)}`;
	await mkdir(store.resolve(RUNS_DIR), { recursive: true });
	for (let n = 1; ; n++) {
		const id = n === 1 ? base : `${base}-${n}`;
		try {
			await mkdir(store.resolve(runDir(id)));
		} catch (e) {
			if (isCode(e, 'EEXIST')) continue;
			throw e;
		}
		const meta: RunMeta = {
			id,
			phase,
			agent,
			status: 'running',
			startedAt: now.toISOString(),
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			costUsd: 0
		};
		await store.writeJson(runFile(id), RunMeta, meta);
		return meta;
	}
}

export async function updateRun(
	store: ProjectStore,
	id: string,
	patch: Partial<Omit<RunMeta, 'id'>>
): Promise<RunMeta> {
	const meta = await store.readJson(runFile(id), RunMeta);
	if (!meta) throw new Error(`Unknown run: ${id}`);
	const next = { ...meta, ...patch, id };
	await store.writeJson(runFile(id), RunMeta, next);
	return next;
}

/** The run, or null when it does not exist or the ID is malformed. */
export async function readRun(store: ProjectStore, id: string): Promise<RunMeta | null> {
	if (!RUN_ID.test(id)) return null;
	return store.readJson(runFile(id), RunMeta);
}

export async function listRuns(store: ProjectStore): Promise<RunMeta[]> {
	let entries: string[];
	try {
		entries = await readdir(store.resolve(RUNS_DIR));
	} catch (e) {
		if (isCode(e, 'ENOENT')) return [];
		throw e;
	}
	const runs: RunMeta[] = [];
	for (const id of entries.filter((e) => RUN_ID.test(e)).sort()) {
		const meta = await store.readJson(runFile(id), RunMeta);
		if (meta) runs.push(meta);
	}
	return runs;
}

export async function appendRunEvent(store: ProjectStore, id: string, e: object): Promise<void> {
	await store.appendFile(`${runDir(id)}/events.jsonl`, JSON.stringify(e) + '\n');
}

// One promise chain per project and run, so concurrent writes cannot lose a created.json entry.
const backupChains = new Map<string, Promise<void>>();

/**
 * Saves a file before the run first changes it: a copy under backup/<rel>, or <rel> in
 * backup/created.json when the file did not exist. Decided from disk, so it survives a restart.
 * Calls for the same run are serialised; a failed call does not block the next one.
 */
export function backupFile(store: ProjectStore, id: string, rel: string): Promise<void> {
	const key = `${store.dir}\0${id}`;
	const next = (backupChains.get(key) ?? Promise.resolve())
		.catch(() => {})
		.then(() => backupOnce(store, id, rel));
	backupChains.set(key, next);
	const drop = () => {
		if (backupChains.get(key) === next) backupChains.delete(key);
	};
	next.then(drop, drop);
	return next;
}

async function backupOnce(store: ProjectStore, id: string, rel: string): Promise<void> {
	const norm = path.relative(store.dir, store.resolve(rel));
	if (norm === CREATED)
		throw new PathError(`${CREATED} at the project root is reserved for run backups`);
	if (!(await store.exists(runFile(id)))) throw new Error(`Unknown run: ${id}`);
	const backup = `${backupDir(id)}/${norm}`;
	const createdRel = `${backupDir(id)}/${CREATED}`;
	if (await store.exists(backup)) return;
	const created = (await store.readJson(createdRel, CreatedList)) ?? [];
	if (created.includes(norm)) return;
	if (await store.exists(norm)) {
		const dest = store.resolve(backup);
		await mkdir(path.dirname(dest), { recursive: true });
		await copyFile(store.resolve(norm), dest);
	} else {
		await store.writeJson(createdRel, CreatedList, [...created, norm]);
	}
}

/**
 * Whether the run backed up or created any file, that is whether discarding it changes files.
 * With `except`, a project relative path that does not count (derived files such as README.md).
 */
export async function touchedFiles(
	store: ProjectStore,
	id: string,
	except?: string
): Promise<boolean> {
	let entries: string[];
	try {
		entries = await readdir(store.resolve(backupDir(id)), { recursive: true });
	} catch (e) {
		if (isCode(e, 'ENOENT')) return false;
		throw e;
	}
	if (except === undefined) return entries.length > 0;
	const dir = store.resolve(backupDir(id));
	for (const entry of entries) {
		if (entry === CREATED) {
			const created = (await store.readJson(`${backupDir(id)}/${CREATED}`, CreatedList)) ?? [];
			if (created.some((rel) => rel !== except)) return true;
		} else if (entry !== except && (await stat(path.join(dir, entry))).isFile()) return true;
	}
	return false;
}

/** Puts back every backed up file, deletes the files the run created, and marks the run discarded. */
export async function restoreRun(store: ProjectStore, id: string): Promise<void> {
	const dir = store.resolve(backupDir(id));
	let entries: string[] = [];
	try {
		entries = await readdir(dir, { recursive: true });
	} catch (e) {
		if (!isCode(e, 'ENOENT')) throw e;
	}
	for (const entry of entries) {
		if (entry === CREATED) continue;
		const src = path.join(dir, entry);
		if (!(await stat(src)).isFile()) continue;
		const dest = store.resolve(entry);
		await mkdir(path.dirname(dest), { recursive: true });
		await copyFile(src, dest);
	}
	const created = (await store.readJson(`${backupDir(id)}/${CREATED}`, CreatedList)) ?? [];
	for (const rel of created) await rm(store.resolve(rel), { force: true });
	await updateRun(store, id, { status: 'discarded' });
}

/** Project files the run changed: backed up (`created: false`) or made by it (`created: true`). Sorted by path. */
export async function runFiles(
	store: ProjectStore,
	id: string
): Promise<{ path: string; created: boolean }[]> {
	let entries: string[];
	try {
		entries = await readdir(store.resolve(backupDir(id)), { recursive: true });
	} catch (e) {
		if (isCode(e, 'ENOENT')) return [];
		throw e;
	}
	const dir = store.resolve(backupDir(id));
	const files: { path: string; created: boolean }[] = [];
	for (const entry of entries) {
		if (entry !== CREATED && (await stat(path.join(dir, entry))).isFile())
			files.push({ path: entry, created: false });
	}
	const created = (await store.readJson(`${backupDir(id)}/${CREATED}`, CreatedList)) ?? [];
	for (const rel of created) files.push({ path: rel, created: true });
	return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The content saved before the run first changed `rel`; null when the run created it or never touched it. */
export async function readBackup(
	store: ProjectStore,
	id: string,
	rel: string
): Promise<string | null> {
	const norm = path.relative(store.dir, store.resolve(rel));
	// The root created.json is the run's list of created files, never a backup.
	if (norm === CREATED) return null;
	return store.readText(`${backupDir(id)}/${norm}`);
}

const ChecksBefore = z.record(z.string(), z.string().nullable());
const checksBeforeFile = (id: string) => `${runDir(id)}/checks-before.json`;

/**
 * Saves derived files (the stored checks) as they are before a run, null when absent, so a
 * discard can put them back. Kept apart from `backup/`, so `touchedFiles` still means the run
 * changed project files.
 */
export async function saveChecksBefore(store: ProjectStore, id: string, rels: string[]) {
	const saved: Record<string, string | null> = {};
	for (const rel of rels) saved[rel] = await store.readText(rel);
	await store.writeJson(checksBeforeFile(id), ChecksBefore, saved);
}

/** Puts back what saveChecksBefore saved: writes each file, deletes those that were absent. */
export async function restoreChecksBefore(store: ProjectStore, id: string): Promise<void> {
	const saved = await store.readJson(checksBeforeFile(id), ChecksBefore);
	for (const [rel, content] of Object.entries(saved ?? {})) {
		if (content === null) await rm(store.resolve(rel), { force: true });
		else await store.writeFile(rel, content);
	}
}
