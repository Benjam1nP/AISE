import { readFileSync } from 'node:fs';
import { readdir, readFile as readBytes, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { runnerDir } from '../docker/image';
import { PathError } from '../path-error';
import { defineTool, ToolError, type ToolContext } from './registry';
import {
	canRead,
	canWrite,
	describeScope,
	MAX_PATH_LENGTH,
	normalise,
	rejectReason
} from './scope';

const MAX_BYTES = 200 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.aise', '.git']);

const DEP_FIELDS = ['dependencies', 'devDependencies'];
const PKG_KEYS = [
	'name',
	'version',
	'private',
	'type',
	'description',
	'main',
	'engines',
	...['scripts', ...DEP_FIELDS]
];
/** npm runs these on install; the runner never installs, so they can only be an attack. */
const INSTALL_HOOK = /^(pre|post)?(install|prepare)$|^prepublish/;
/** A plain semver range: no `:` or `/`, so no npm:, git+, file:, link:, URLs or GitHub shorthands. */
const VERSION = /^[\w.\-+^~<>=|* ]{1,64}$/;

let runnerDeps: Set<string> | undefined;

/**
 * Package names preinstalled in the runner image; generated projects may depend on these only.
 * Read on first use, not at import, so the tool registry loads even where `runner/` is missing.
 */
export function getRunnerDeps(): Set<string> {
	if (runnerDeps) return runnerDeps;
	const file = path.join(runnerDir(), 'package.json');
	let pkg: { dependencies?: object; devDependencies?: object };
	try {
		pkg = JSON.parse(readFileSync(file, 'utf8'));
	} catch (e) {
		throw new Error(
			`Cannot read the runner's package list at ${file} (${(e as Error).message}). Set AISE_RUNNER_DIR to the runner/ folder.`,
			{ cause: e }
		);
	}
	runnerDeps = new Set([
		...Object.keys(pkg.dependencies ?? {}),
		...Object.keys(pkg.devDependencies ?? {})
	]);
	return runnerDeps;
}

const errCode = (e: unknown) => (e as NodeJS.ErrnoException).code;
const orNull = (e: unknown) => (errCode(e) === 'ENOENT' ? null : Promise.reject(e));

// File system errors an odd path can cause; the agent can fix them by choosing another path.
const FS_ERRORS: Record<string, string> = {
	ENOTDIR: 'part of the path is a file, not a folder',
	ELOOP: 'the path runs into a symlink loop',
	ENAMETOOLONG: 'a name in the path is too long'
};

/** Runs `f`, turning the file system errors above into a ToolError about `rel`. */
async function fsErrors<T>(rel: string, f: () => Promise<T>): Promise<T> {
	try {
		return await f();
	} catch (e) {
		const why = FS_ERRORS[errCode(e) ?? ''];
		if (why !== undefined) throw new ToolError(`${rel}: ${why}.`);
		throw e;
	}
}

/** Real path of `abs`, or of its nearest existing ancestor followed by the missing rest. */
async function realOrAncestor(abs: string): Promise<string> {
	try {
		return await realpath(abs);
	} catch (e) {
		if (errCode(e) !== 'ENOENT') throw e;
		const parent = path.dirname(abs);
		if (parent === abs) return abs;
		return path.join(await realOrAncestor(parent), path.basename(abs));
	}
}

/**
 * Absolute path of a project file the agent may read or write. Throws ToolError for absolute paths,
 * `..`, `.aise/`, `.env*`, `.git/`, `node_modules/`, NUL bytes, paths over 1024 characters, the
 * project folder itself, paths outside the agent's scope, and symlinks whose target leaves the
 * project or the scope. The path is normalised once (backslashes become slashes) and that one path
 * is checked and returned, so callers must use the returned path for the actual file access.
 */
export function safePath(ctx: ToolContext, rel: string, mode: 'read' | 'write'): Promise<string> {
	return fsErrors(rel, async () => {
		const reject = rejectReason(rel);
		if (reject !== null) throw new ToolError(`${rel}: ${reject}`);
		const p = normalise(rel);
		if (p === '') throw new ToolError(`"${rel}" is the project folder, not a file.`);
		const allowed = mode === 'read' ? canRead : canWrite;
		if (!allowed(ctx.agent, p))
			throw new ToolError(`Cannot ${mode} ${p}. ${describeScope(ctx.agent, mode)}`);

		let abs: string;
		try {
			abs = ctx.store.resolve(p);
		} catch (e) {
			if (e instanceof PathError) throw new ToolError(e.message);
			throw e;
		}
		// A new project may not have its folder yet; nothing inside it can be a link then.
		const root = await realpath(ctx.store.dir).catch(orNull);
		if (root === null) return abs;
		const real = path.relative(root, await realOrAncestor(abs));
		if (real === '' || real === '..' || real.startsWith('..' + path.sep) || path.isAbsolute(real))
			throw new ToolError(`${p} is a link that leaves the project folder.`);
		if (rejectReason(real) !== null || !allowed(ctx.agent, real))
			throw new ToolError(
				`${p} is a link to ${normalise(real)}. ${describeScope(ctx.agent, mode)}`
			);
		return abs;
	});
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Rejects package.json content that is not a JSON object, has keys outside a small allowlist,
 * install hook scripts, dependencies outside the runner image, or versions that are not plain
 * semver ranges.
 */
function checkPackageJson(content: string): void {
	let pkg: unknown;
	try {
		pkg = JSON.parse(content);
	} catch (e) {
		throw new ToolError(`package.json is not valid JSON: ${(e as Error).message}`);
	}
	if (!isObject(pkg)) throw new ToolError('package.json must be a JSON object.');
	const extra = Object.keys(pkg).filter((k) => !PKG_KEYS.includes(k));
	if (extra.length > 0)
		throw new ToolError(
			`package.json may only have the keys ${PKG_KEYS.join(', ')}. Not allowed: ${extra.join(', ')}.`
		);
	for (const field of ['scripts', ...DEP_FIELDS]) {
		const v = pkg[field];
		if (v !== undefined && !(isObject(v) && Object.values(v).every((s) => typeof s === 'string')))
			throw new ToolError(`package.json "${field}" must be an object of string values.`);
	}
	const hooks = Object.keys((pkg.scripts ?? {}) as object).filter((s) => INSTALL_HOOK.test(s));
	if (hooks.length > 0)
		throw new ToolError(
			`package.json scripts may not include install hooks: ${hooks.map((h) => `"${h}"`).join(', ')}.`
		);
	const deps = DEP_FIELDS.flatMap((f) => Object.entries((pkg[f] ?? {}) as Record<string, string>));
	const allowed = getRunnerDeps();
	const unknown = deps.filter(([name]) => !allowed.has(name)).map(([name]) => name);
	if (unknown.length > 0)
		throw new ToolError(
			`package.json may only use the preinstalled packages (${[...allowed].sort().join(', ')}). Not available: ${unknown.join(', ')}.`
		);
	const bad = deps.filter(([, v]) => !VERSION.test(v)).map(([name, v]) => `${name} "${v}"`);
	if (bad.length > 0)
		throw new ToolError(
			`package.json versions must be plain semver ranges such as ^5.0.0. Not allowed: ${bad.join(', ')}.`
		);
}

async function walk(ctx: ToolContext, absDir: string, out: string[]): Promise<void> {
	const entries = await readdir(absDir, { withFileTypes: true }).catch(orNull);
	for (const d of entries ?? []) {
		const abs = path.join(absDir, d.name);
		const rel = normalise(path.relative(ctx.store.dir, abs));
		// Symlinks are skipped: listing must not lead an agent outside the project.
		if (SKIP_DIRS.has(d.name.toLowerCase()) || !canRead(ctx.agent, rel)) continue;
		if (d.isDirectory()) await walk(ctx, abs, out);
		else if (d.isFile()) out.push(rel);
	}
}

const PathInput = z.string().max(MAX_PATH_LENGTH);

/** A worker's context allows changing exactly one file; anything else is an error naming it. */
function checkWriteOnly(ctx: ToolContext, p: string): void {
	if (ctx.writeOnly === undefined) return;
	const allowed = normalise(ctx.writeOnly);
	if (p !== allowed)
		throw new ToolError(`Cannot change ${p}. You may change only ${allowed} in this task.`);
}

export const listFiles = defineTool({
	name: 'list_files',
	description:
		'List the project files you may read, as paths relative to the project root, sorted. Optional dir limits the listing to one folder. Skips node_modules, .aise and .git.',
	input: z.strictObject({ dir: PathInput.optional() }),
	run: (ctx, { dir }) =>
		fsErrors(dir ?? '.', async () => {
			let start = ctx.store.dir;
			if (dir !== undefined && normalise(dir) !== '') {
				start = await safePath(ctx, dir, 'read');
				const s = await stat(start).catch(orNull);
				if (s !== null && !s.isDirectory()) throw new ToolError(`${dir} is a file, not a folder.`);
			}
			const out: string[] = [];
			await walk(ctx, start, out);
			return out.sort();
		})
});

const utf8 = new TextDecoder('utf-8', { fatal: true });

export const readFile = defineTool({
	name: 'read_file',
	description: `Read one UTF-8 text file of the project (at most ${MAX_BYTES / 1024} KB). path is relative to the project root.`,
	input: z.strictObject({ path: PathInput }),
	run: (ctx, { path: rel }) =>
		fsErrors(rel, async () => {
			const abs = await safePath(ctx, rel, 'read');
			const p = normalise(rel);
			const s = await stat(abs).catch(orNull);
			if (s === null) throw new ToolError(`${p}: file not found.`);
			if (!s.isFile()) throw new ToolError(`${p} is a folder; use list_files for folders.`);
			// A hard link can point at any file on the same disk, inside the project or not.
			if (s.nlink > 1) throw new ToolError(`${p} is a hard link; it cannot be read.`);
			if (s.size > MAX_BYTES)
				throw new ToolError(
					`${p} is ${Math.ceil(s.size / 1024)} KB, over the ${MAX_BYTES / 1024} KB limit for read_file.`
				);
			const buf = await readBytes(abs);
			let content: string | null = null;
			if (!buf.includes(0)) {
				try {
					content = utf8.decode(buf);
				} catch {
					// not UTF-8
				}
			}
			if (content === null)
				throw new ToolError(`${p} is binary or not UTF-8 text; it cannot be read.`);
			return { path: p, content };
		})
});

export const writeFile = defineTool({
	name: 'write_file',
	description: `Create or replace one project file with the given UTF-8 content (at most ${MAX_BYTES / 1024} KB); parent folders are created. path is relative to the project root and must be inside your write scope. package.json may only use the preinstalled packages.`,
	input: z.strictObject({ path: PathInput, content: z.string() }),
	run: (ctx, { path: rel, content }) =>
		fsErrors(rel, async () => {
			const bytes = Buffer.byteLength(content, 'utf8');
			if (bytes > MAX_BYTES)
				throw new ToolError(
					`content is ${Math.ceil(bytes / 1024)} KB, over the ${MAX_BYTES / 1024} KB limit for write_file.`
				);
			const abs = await safePath(ctx, rel, 'write');
			const p = normalise(rel);
			checkWriteOnly(ctx, p);
			if ((await stat(abs).catch(orNull))?.isDirectory())
				throw new ToolError(`${p} is a folder; give a file path.`);
			if (p === 'package.json') checkPackageJson(content);
			await ctx.store.writeFile(p, content, ctx.runId);
			return { ok: true, path: p, bytes };
		})
});

export const deleteFile = defineTool({
	name: 'delete_file',
	description:
		'Delete one project file. path is relative to the project root and must be inside your write scope. Folders cannot be deleted. The file is backed up under the run, so discarding the run restores it.',
	input: z.strictObject({ path: PathInput }),
	run: (ctx, { path: rel }) =>
		fsErrors(rel, async () => {
			const abs = await safePath(ctx, rel, 'write');
			const p = normalise(rel);
			checkWriteOnly(ctx, p);
			const s = await stat(abs).catch(orNull);
			if (s === null) throw new ToolError(`${p}: file not found.`);
			if (!s.isFile()) throw new ToolError(`${p} is a folder; only files can be deleted.`);
			await ctx.store.deleteFile(p, ctx.runId);
			return { ok: true, path: p };
		})
});
