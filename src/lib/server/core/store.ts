import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { PathError } from './path-error';
import { backupFile } from './runs';

export { PathError };

/** Lowercase name with an optional checkpoint suffix (`todo@P2`, spec section 12). */
export function isValidProjectName(n: string): boolean {
	return /^[a-z0-9][a-z0-9-]{0,40}(@P[1-7])?$/.test(n);
}

/** JSON as the store writes it: two space indent and a trailing newline, because it is committed. */
const toJson = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * All file access for one project folder. Every path is relative to `dir` and checked before any
 * file access. Symlinks inside the folder are not followed or checked.
 */
export class ProjectStore {
	readonly dir: string;

	constructor(dir: string) {
		this.dir = path.resolve(dir);
	}

	/** Absolute path of a file inside the project; throws PathError for anything else. */
	resolve(rel: string): string {
		if (path.isAbsolute(rel)) throw new PathError(`Absolute path not allowed: ${rel}`);
		const abs = path.resolve(this.dir, rel);
		const inside = path.relative(this.dir, abs);
		if (
			inside === '' ||
			inside === '..' ||
			inside.startsWith('..' + path.sep) ||
			path.isAbsolute(inside)
		) {
			throw new PathError(`Path leaves the project folder: ${rel}`);
		}
		return abs;
	}

	async readText(rel: string): Promise<string | null> {
		try {
			return await readFile(this.resolve(rel), 'utf8');
		} catch (e) {
			if (isMissing(e)) return null;
			throw e;
		}
	}

	/** null when the file is missing; throws on malformed JSON and the ZodError on schema failure. */
	async readJson<T>(rel: string, schema: z.ZodType<T>): Promise<T | null> {
		const text = await this.readText(rel);
		return text === null ? null : schema.parse(JSON.parse(text));
	}

	/** Atomic write (tmp file, then rename). With runId, backs the file up before the run first touches it. */
	async writeFile(rel: string, content: string, runId?: string): Promise<void> {
		const abs = this.resolve(rel);
		if (runId !== undefined) await backupFile(this, runId, rel);
		await mkdir(path.dirname(abs), { recursive: true });
		const tmp = `${abs}.${randomUUID()}.tmp`;
		try {
			await writeFile(tmp, content, 'utf8');
			await rename(tmp, abs);
		} catch (e) {
			await rm(tmp, { force: true });
			throw e;
		}
	}

	/** Deletes a file. With runId, backs it up first so discarding the run restores it. */
	async deleteFile(rel: string, runId?: string): Promise<void> {
		const abs = this.resolve(rel);
		if (runId !== undefined) await backupFile(this, runId, rel);
		await rm(abs);
	}

	/** Validates with the schema, then writes pretty printed JSON. */
	async writeJson<T>(rel: string, schema: z.ZodType<T>, value: T, runId?: string): Promise<void> {
		await this.writeFile(rel, toJson(schema.parse(value)), runId);
	}

	/** Appends to a log file (chat, run events); logs are not backed up. */
	async appendFile(rel: string, content: string): Promise<void> {
		const abs = this.resolve(rel);
		await mkdir(path.dirname(abs), { recursive: true });
		await appendFile(abs, content, 'utf8');
	}

	async exists(rel: string): Promise<boolean> {
		try {
			await access(this.resolve(rel));
			return true;
		} catch (e) {
			if (isMissing(e)) return false;
			throw e;
		}
	}
}
