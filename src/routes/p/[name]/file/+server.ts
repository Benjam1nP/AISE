import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { getOrchestrator } from '#lib/server/index.ts';
import { ProjectStore } from '#lib/server/core/store.ts';
import { safePath } from '#lib/server/core/tools/files.ts';
import { ToolError, type ToolContext } from '#lib/server/core/tools/registry.ts';
import { DEPLOY_FILES } from '#lib/server/core/deploy-state.ts';
import { CODE_ROOTS, DOC_FILES, normalise, rejectReason } from '#lib/server/core/tools/scope.ts';
import type { RequestHandler } from './$types';

const MAX_BYTES = 1024 * 1024;

/** The test folder: the test agent writes it, and the Tests tab shows it. */
const TEST_ROOT = 'test/';
/** What the Code and Tests tabs may show: the code roots, the generated docs, the P6 deploy files and the test folder. */
const SHOWN = [...CODE_ROOTS, ...DOC_FILES, ...DEPLOY_FILES, TEST_ROOT];

/** Whether a normalised path is a shown root or sits inside a shown folder. */
const underShownRoots = (p: string) =>
	SHOWN.some((e) => (e.endsWith('/') ? p === e.slice(0, -1) || p.startsWith(e) : p === e));

/** A missing file, or a path whose parent is a file: both mean there is no such file. */
const isMissing = (e: unknown) =>
	['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '');

/** Text of one code or test file, for the Code and Tests tabs. Paths are checked the same way as the agents' tools. */
export const GET: RequestHandler = async ({ params, url }) => {
	const { name } = params;
	const rel = url.searchParams.get('path');
	if (!rel) error(400, 'Give the file as ?path=<path relative to the project>.');
	const reject = rejectReason(rel);
	if (reject !== null) error(400, reject);
	const p = normalise(rel);
	if (!underShownRoots(p))
		error(400, `${p} is not a code or test file. Only ${SHOWN.join(', ')} can be shown.`);
	const orch = getOrchestrator();
	if (!(await orch.listProjects()).includes(name)) {
		error(404, `No project named "${name}"`);
	}

	const ctx: ToolContext = {
		store: new ProjectStore(orch.projectDir(name)),
		runId: '',
		projectName: name,
		agent: 'code'
	};
	let abs: string;
	try {
		abs = await safePath(ctx, p, 'read');
	} catch (e) {
		if (e instanceof ToolError) error(400, e.message);
		throw e;
	}

	const s = await stat(abs).catch((e: unknown) => {
		if (isMissing(e)) return null;
		throw e;
	});
	if (s === null) error(404, `${p}: file not found.`);
	if (!s.isFile()) error(404, `${p} is a folder, not a file.`);
	// A link inside a shown folder can point at any file in the project; the file it points at must be shown too.
	// Both paths are resolved, so a project under a symlinked folder (macOS /var, /tmp) compares equal.
	const target = normalise(path.relative(await realpath(ctx.store.dir), await realpath(abs)));
	if (!underShownRoots(target) || rejectReason(target) !== null)
		error(400, `${p} is a link to ${target}, which is not a code or test file.`);
	// A hard link can point at any file on the same disk, inside the project or not.
	if (s.nlink > 1) error(400, `${p} is a hard link; it cannot be shown.`);
	if (s.size > MAX_BYTES) error(413, `${p} is over the 1 MB limit.`);

	return new Response(await readFile(abs, 'utf8'), {
		headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' }
	});
};
