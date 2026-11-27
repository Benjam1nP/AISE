import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { clientComponents } from './client';
import { sha256, stableStringify } from './hash';
import { DesignDoc } from './schemas/design';
import { NO_TSCONFIG, runTypecheck, type TypecheckResult } from './tools/check';
import { existingTargets, runStartCheck, StartResultSchema, type StartResult } from './tools/start';
import { DESIGN_PATH } from './tools/design';
import { checkDrift } from './tools/drift';
import type { ToolContext } from './tools/registry';
import { CODE_ROOTS, DOC_FILES } from './tools/scope';
import type { DriftItem } from './drift';
import type { ProjectStore } from './store';

/** What the P4 code hash covers: a trailing slash is a folder, anything else is one file. */
export { CODE_ROOTS };

const CHECKS_PATH = '.aise/checks/P4.json';

/** A path that is not there, or sits below a file, counts as missing. */
const isMissing = (e: unknown) =>
	['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '');
export const orMissing = <T>(e: unknown, empty: T): Promise<T> =>
	isMissing(e) ? Promise.resolve(empty) : Promise.reject(e);

/** The temp file `ProjectStore.writeFile` renames into place; it is not code yet. */
const WRITE_TMP = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

export async function walk(store: ProjectStore, rel: string, out: string[]): Promise<void> {
	const entries = await readdir(store.resolve(rel), { withFileTypes: true }).catch((e) =>
		orMissing(e, [])
	);
	for (const d of entries) {
		const child = `${rel}/${d.name}`;
		if (d.isDirectory()) await walk(store, child, out);
		else if (d.isFile() && !WRITE_TMP.test(d.name)) out.push(child);
	}
}

/**
 * Sorted project relative paths of the files under `CODE_ROOTS`. Symlinks are skipped, roots
 * included, so a link can never pull a file from outside the project into the hash.
 */
export async function listCodeFiles(store: ProjectStore): Promise<string[]> {
	const out: string[] = [];
	for (const root of CODE_ROOTS) {
		const rel = root.endsWith('/') ? root.slice(0, -1) : root;
		const s = await lstat(store.resolve(rel)).catch((e) => orMissing(e, null));
		if (s === null) continue;
		if (root.endsWith('/') ? s.isDirectory() : s.isFile()) {
			if (root.endsWith('/')) await walk(store, rel, out);
			else out.push(rel);
		}
	}
	return out.sort();
}

/** The `DOC_FILES` that exist as plain files, for the Code tab; never part of the code hash. */
export async function listDocFiles(store: ProjectStore): Promise<string[]> {
	const found = await Promise.all(
		DOC_FILES.map(async (f) => {
			const s = await lstat(store.resolve(f)).catch((e) => orMissing(e, null));
			return s?.isFile() ? f : null;
		})
	);
	return found.filter((f) => f !== null);
}

/** At least one file under `src/`; the scaffold (package.json, tsconfig.json) alone is not code. */
export async function hasCode(store: ProjectStore): Promise<boolean> {
	return (await listCodeFiles(store)).some((f) => f.startsWith('src/'));
}

/**
 * sha256 over the paths and contents of `files`, with no rule about which they are; a file deleted
 * between listing and reading (a write or delete in progress) is skipped. The P6 hashes use it.
 */
export async function hashPaths(store: ProjectStore, files: string[]): Promise<string> {
	const entries: [string, string][] = [];
	for (const f of files) {
		const content = await readFile(store.resolve(f)).catch((e) => orMissing(e, null));
		if (content !== null) entries.push([f, sha256(content)]);
	}
	return sha256(stableStringify(entries));
}

/** sha256 over `files` (from `listCodeFiles`); null without a file under `src/`. */
export async function hashFiles(store: ProjectStore, files: string[]): Promise<string | null> {
	if (!files.some((f) => f.startsWith('src/'))) return null;
	return hashPaths(store, files);
}

/** sha256 over the sorted paths and contents of the code files; null when `hasCode` is false. */
export async function codeHash(store: ProjectStore): Promise<string | null> {
	return hashFiles(store, await listCodeFiles(store));
}

/**
 * Per class, component and deployment node ID, the hash of the fields code depends on (spec
 * section 8), so a description edit never changes it. A class also hashes the name of its
 * component, because that name is part of its file path, and a node its links (ends and
 * protocol), so a link edit makes P4 stale. A client component also hashes its reqIds, which the
 * `@trace` comment of public/index.html carries.
 */
export function designHashes(design: DesignDoc): Record<string, string> {
	const out: Record<string, string> = {};
	const h = (v: unknown) => sha256(stableStringify(v));
	for (const c of design.classes) {
		const component = design.components.find((k) => k.classIds.includes(c.id))?.name ?? null;
		out[c.id] = h({
			name: c.name,
			kind: c.kind,
			attributes: c.attributes,
			methods: c.methods,
			values: c.values,
			relations: c.relations.map(({ kind, targetId, multiplicity }) => ({
				kind,
				targetId,
				multiplicity
			})),
			reqIds: c.reqIds,
			component
		});
	}
	const clients = new Set(clientComponents(design));
	for (const k of design.components) {
		const base = { name: k.name, classIds: k.classIds, nodeId: k.nodeId };
		// the page's @trace comment carries a client component's reqIds; service components hash as before
		out[k.id] = h(clients.has(k) ? { ...base, reqIds: k.reqIds } : base);
	}
	for (const n of design.nodes) {
		const links = design.links
			.filter((l) => l.from === n.id || l.to === n.id)
			.map(({ from, to, protocol }) => ({ from, to, protocol }));
		// no links key without links, so nodes hash as before links existed and approved P4s stay current
		out[n.id] = h(
			links.length > 0 ? { name: n.name, kind: n.kind, links } : { name: n.name, kind: n.kind }
		);
	}
	return out;
}

/** sha256 of the whole design; null without one. The P4 checks are only valid for the design they ran against. */
export function designHash(design: DesignDoc | null): string | null {
	if (!design) return null;
	// empty links hash as absent, so stored checks from before links existed stay current
	const { links, ...rest } = design;
	return sha256(stableStringify(links.length > 0 ? design : rest));
}

const TscError = z.object({
	file: z.string(),
	line: z.number(),
	col: z.number(),
	message: z.string()
});
const DriftItemSchema = z.object({
	kind: z.enum(['missing_in_code', 'missing_in_design', 'changed']),
	id: z.string().optional(),
	name: z.string(),
	file: z.string().optional(),
	line: z.number().optional(),
	details: z.array(z.string())
});

export type CodeChecks = {
	at: string;
	codeHash: string | null;
	/** Hash of the design at check time; absent in a file from before it was stored, which reads as out of date. */
	designHash?: string | null;
	typecheck: TypecheckResult | null;
	drift: DriftItem[];
	/**
	 * Every existing app entry started and answered GET /health. Null when it was not run: no passing
	 * typecheck or no entry file. Absent in a file from before it was stored, which reads as not run yet.
	 */
	start?: StartResult | null;
};

/** The stored shape of a typecheck result; the P5 checks file uses it too. */
export const TypecheckSchema = z.object({
	ok: z.boolean(),
	errors: z.array(TscError),
	timedOut: z.boolean()
}) satisfies z.ZodType<TypecheckResult>;

const CodeChecksSchema = z.object({
	at: z.string(),
	codeHash: z.string().nullable(),
	designHash: z.string().nullable().optional(),
	typecheck: TypecheckSchema.nullable(),
	drift: z.array(DriftItemSchema),
	start: StartResultSchema.nullable().optional()
}) satisfies z.ZodType<CodeChecks>;

/** The stored P4 checks; null before any ran or when the file is unreadable (a stale gate, not a crash). */
export async function readChecks(store: ProjectStore): Promise<CodeChecks | null> {
	try {
		return await store.readJson(CHECKS_PATH, CodeChecksSchema);
	} catch (e) {
		if (e instanceof SyntaxError || e instanceof z.ZodError) return null;
		throw e;
	}
}

export async function writeChecks(store: ProjectStore, c: CodeChecks): Promise<void> {
	await store.writeJson(CHECKS_PATH, CodeChecksSchema, c);
}

/** Whether `rel` is a regular file in the project. */
export async function isFile(store: ProjectStore, rel: string): Promise<boolean> {
	return (await stat(path.join(store.dir, rel)).catch(() => null))?.isFile() === true;
}

/**
 * The typecheck of a project for the stored checks: null when it has no package.json; a missing
 * tsconfig.json is a failed typecheck with the NO_TSCONFIG text as its one error, without calling
 * the runner. Errors from the runner itself (Docker down, timeout) propagate.
 */
export async function typecheckProject(
	ctx: ToolContext,
	typecheck: typeof runTypecheck = runTypecheck
): Promise<TypecheckResult | null> {
	if (!(await isFile(ctx.store, 'package.json'))) return null;
	if (await isFile(ctx.store, 'tsconfig.json')) return typecheck(ctx);
	return {
		ok: false,
		errors: [{ file: '', line: 0, col: 0, message: NO_TSCONFIG }],
		timedOut: false
	};
}

/**
 * The start check, only after a passing typecheck (a broken build tells nothing new when started)
 * and when at least one app entry exists; null otherwise.
 */
async function startProject(
	ctx: ToolContext,
	tc: TypecheckResult | null,
	start: typeof runStartCheck
): Promise<StartResult | null> {
	if (!tc?.ok) return null;
	const targets = await existingTargets(ctx);
	return targets.length === 0 ? null : start(ctx, targets);
}

/**
 * Typecheck, drift and the start check against the current code, stored in `.aise/checks/P4.json` with the code
 * hash and design hash taken before the checks start, so an edit made during them reads as out of
 * date. Typecheck
 * is null when the project has no package.json; a missing tsconfig.json is a failed typecheck with
 * the NO_TSCONFIG text as its one error, without calling the runner. Any error from the typecheck
 * itself (Docker down, timeout) propagates. The checks file is not backed up: it is derived from
 * the code, never restored by a discard.
 */
export async function runCodeChecks(
	ctx: ToolContext,
	opts: { typecheck?: typeof runTypecheck; start?: typeof runStartCheck } = {}
): Promise<CodeChecks> {
	const { store } = ctx;
	const hash = await codeHash(store);
	const designHashAtStart = designHash(await store.readJson(DESIGN_PATH, DesignDoc));
	const tc = await typecheckProject(ctx, opts.typecheck);
	const checks: CodeChecks = {
		at: new Date().toISOString(),
		codeHash: hash,
		designHash: designHashAtStart,
		typecheck: tc,
		drift: await checkDrift(store),
		start: await startProject(ctx, tc, opts.start ?? runStartCheck)
	};
	await writeChecks(store, checks);
	return checks;
}
