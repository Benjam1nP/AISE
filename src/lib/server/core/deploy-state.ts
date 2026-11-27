import { lstat } from 'node:fs/promises';
import { z } from 'zod';
import { hashPaths, listCodeFiles, orMissing } from './code-state';
import type { ProjectStore } from './store';

/** What the deploy agent writes; the P6 artefact hash covers all three. */
export const DEPLOY_FILES = ['Dockerfile', 'compose.yaml', 'RUN.md'];
export const DEPLOY_CHECK_PATH = '.aise/checks/deploy.json';

/** The `names` that exist as plain files; a folder or a symlink does not count. */
async function plainFiles(store: ProjectStore, names: string[]): Promise<string[]> {
	const found = await Promise.all(
		names.map(async (f) => {
			const s = await lstat(store.resolve(f)).catch((e) => orMissing(e, null));
			return s?.isFile() ? f : null;
		})
	);
	return found.filter((f) => f !== null);
}

/** The `DEPLOY_FILES` that exist as plain files. */
export const listDeployFiles = (store: ProjectStore) => plainFiles(store, DEPLOY_FILES);

export async function hasDeployFiles(store: ProjectStore): Promise<boolean> {
	return (await listDeployFiles(store)).length > 0;
}

/** sha256 over the deploy files that exist; null when none does. */
export async function deployArtefactHash(store: ProjectStore): Promise<string | null> {
	const files = await listDeployFiles(store);
	return files.length === 0 ? null : hashPaths(store, files);
}

/**
 * What a deploy check ran against: `Dockerfile`, `compose.yaml`, `package-lock.json` and the code
 * files (`CODE_ROOTS`). `RUN.md` is docs and not in it. Null without `compose.yaml`, since nothing
 * can be checked then.
 */
export async function deployCheckHash(store: ProjectStore): Promise<string | null> {
	const own = await plainFiles(store, ['Dockerfile', 'compose.yaml', 'package-lock.json']);
	if (!own.includes('compose.yaml')) return null;
	return hashPaths(store, [...own, ...(await listCodeFiles(store))].sort());
}

export type DeployCheck = {
	at: string;
	/** `deployCheckHash` taken before the check started, so an edit made during it reads as out of date. */
	filesHash: string | null;
	passed: boolean;
	services: { url: string; status: number | null }[];
	logTail: string;
	durationMs: number;
};

const DeployCheckSchema = z.object({
	at: z.string(),
	filesHash: z.string().nullable(),
	passed: z.boolean(),
	services: z.array(z.object({ url: z.string(), status: z.number().nullable() })),
	logTail: z.string(),
	durationMs: z.number()
}) satisfies z.ZodType<DeployCheck>;

/** The stored deploy check; null before any ran or when the file is unreadable (out of date, not a crash). */
export async function readDeployCheck(store: ProjectStore): Promise<DeployCheck | null> {
	try {
		return await store.readJson(DEPLOY_CHECK_PATH, DeployCheckSchema);
	} catch (e) {
		if (e instanceof SyntaxError || e instanceof z.ZodError) return null;
		throw e;
	}
}

export async function writeDeployCheck(store: ProjectStore, c: DeployCheck): Promise<void> {
	await store.writeJson(DEPLOY_CHECK_PATH, DeployCheckSchema, c);
}
