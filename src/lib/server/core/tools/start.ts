import { z } from 'zod';
import { runInRunner } from '../docker/run';
import { tail } from '../docker/parse';
import { MAIN_ENTRY, serviceNodes } from '../nodes';
import { DesignDoc } from '../schemas/design';
import { DESIGN_PATH } from './design';
import { defineTool, ToolError, type ToolContext } from './registry';

/** One entry the start check runs: its file, the port variable it listens on and that port. */
export type StartTarget = { entry: string; portVar: string; port: number };

export type StartEntry = StartTarget & {
	ok: boolean;
	/** Why it failed: it exited, /health answered another status, or it did not answer in time. */
	error?: string;
	/** The end of the entry's own stdout and stderr; empty when it started. */
	log: string;
};

export type StartResult = { ok: boolean; entries: StartEntry[]; timedOut: boolean };

export const StartResultSchema = z.object({
	ok: z.boolean(),
	entries: z.array(
		z.object({
			entry: z.string(),
			portVar: z.string(),
			port: z.number(),
			ok: z.boolean(),
			error: z.string().optional(),
			log: z.string()
		})
	),
	timedOut: z.boolean()
}) satisfies z.ZodType<StartResult>;

/** The entries of every service node, primary first; `src/app/main.ts` on 8080 without service nodes. */
export function startTargets(design: DesignDoc | null): StartTarget[] {
	const roles = design ? serviceNodes(design) : [];
	if (roles.length === 0) return [{ entry: MAIN_ENTRY, portVar: 'PORT', port: 8080 }];
	return roles.map((r) => ({ entry: r.entry, portVar: r.portVar, port: r.port }));
}

/** How long every entry gets to answer GET /health with 200, from the container start. */
const START_MS = 30_000;
/** Extra time for the container itself; the host timer is the backstop. */
const CONTAINER_SLACK_MS = 30_000;
const LOG_LINES = 30;
const MARKER = 'AISE_START ';
/** The project mount; stripped from logs so stack traces show project relative paths. */
const APP_DIR = '/opt/aise/app/';

/**
 * Runs in the runner container with `node -e`: starts every entry with tsx at once (they may call
 * each other), polls GET /health on 127.0.0.1 until each answers 200, exits or the deadline
 * passes, then prints one MARKER line with the results and kills the processes. Every entry gets
 * every port variable and its own database file in /tmp, the only writable folder.
 */
const SCRIPT = `
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const targets = JSON.parse(process.argv[1]);
const end = Date.now() + Number(process.argv[2]);
const ports = Object.fromEntries(targets.map((t) => [t.portVar, String(t.port)]));
const procs = targets.map((t, i) => {
	const p = { ...t, log: '', exit: null, status: null, healthy: false };
	const dir = '/tmp/aise-start/' + i;
	mkdirSync(dir, { recursive: true });
	const env = { ...process.env, ...ports, DB_PATH: dir + '/app.db' };
	const child = spawn('/opt/aise/node_modules/.bin/tsx', [t.entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	const add = (d) => { p.log = (p.log + d).slice(-20000); };
	child.stdout.on('data', add);
	child.stderr.on('data', add);
	child.on('error', (e) => { add(String(e)); p.exit = 'error'; });
	child.on('exit', (code, signal) => { p.exit = signal ?? code; });
	p.child = child;
	return p;
});
const poll = async (p) => {
	try {
		const r = await fetch('http://127.0.0.1:' + p.port + '/health', { signal: AbortSignal.timeout(1000) });
		p.status = r.status;
		p.healthy = r.status === 200;
		await r.body?.cancel();
	} catch {}
};
(async () => {
	for (;;) {
		await Promise.all(procs.filter((p) => !p.healthy && p.exit === null).map(poll));
		if (procs.every((p) => p.healthy || p.exit !== null) || Date.now() > end) break;
		await new Promise((r) => setTimeout(r, 250));
	}
	const out = procs.map(({ child, ...p }) => p);
	process.stdout.write('\\n${MARKER}' + JSON.stringify(out) + '\\n');
	for (const p of procs) p.child.kill('SIGKILL');
	process.exit(0);
})();
`;

type Raw = StartTarget & {
	log: string;
	exit: number | string | null;
	status: number | null;
	healthy: boolean;
};

function errorOf(p: Raw, seconds: number): string | undefined {
	if (p.healthy) return undefined;
	if (p.exit !== null)
		return typeof p.exit === 'number'
			? `exited with code ${p.exit} before GET /health answered`
			: `stopped (${p.exit}) before GET /health answered`;
	if (p.status !== null) return `GET /health returned ${p.status}`;
	return `GET /health did not answer within ${seconds} s`;
}

/** The results from the script output; null when the MARKER line is missing or cut off (a crash, a timeout). */
export function parseStart(stdout: string, startMs = START_MS): StartEntry[] | null {
	const line = stdout.split('\n').find((l) => l.startsWith(MARKER));
	if (!line) return null;
	let raw: Raw[];
	try {
		raw = JSON.parse(line.slice(MARKER.length)) as Raw[];
	} catch {
		return null;
	}
	return raw.map((p) => {
		const error = errorOf(p, Math.round(startMs / 1000));
		const entry: StartEntry = {
			entry: p.entry,
			portVar: p.portVar,
			port: p.port,
			ok: error === undefined,
			log: error === undefined ? '' : tail(p.log.replaceAll(APP_DIR, ''), LOG_LINES, 4000)
		};
		return error === undefined ? entry : { ...entry, error };
	});
}

export type StartOpts = { startMs?: number; run?: typeof runInRunner };

/**
 * Starts the given entries in the runner image (project read only, no network but loopback) and
 * checks that each answers GET /health with 200. Docker errors propagate.
 */
export async function runStartCheck(
	ctx: ToolContext,
	targets: StartTarget[],
	{ startMs = START_MS, run = runInRunner }: StartOpts = {}
): Promise<StartResult> {
	const r = await run(
		ctx.store.dir,
		['node', '-e', SCRIPT, JSON.stringify(targets), String(startMs)],
		{
			timeoutMs: startMs + CONTAINER_SLACK_MS
		}
	);
	const entries = r.timedOut ? null : parseStart(r.stdout, startMs);
	if (entries === null) {
		const log = tail(r.stdout + r.stderr, LOG_LINES, 4000);
		const error = r.timedOut ? 'the start check timed out' : 'the start check did not finish';
		return {
			ok: false,
			timedOut: r.timedOut,
			entries: targets.map((t) => ({ ...t, ok: false, error, log }))
		};
	}
	return { ok: entries.every((e) => e.ok), entries, timedOut: false };
}

/** The design's start targets whose entry file exists; the others are the gate's missing entries. */
export async function existingTargets(ctx: ToolContext): Promise<StartTarget[]> {
	const design = await ctx.store.readJson(DESIGN_PATH, DesignDoc).catch(() => null);
	const out: StartTarget[] = [];
	for (const t of startTargets(design)) if (await ctx.store.exists(t.entry)) out.push(t);
	return out;
}

export const startApp = defineTool({
	name: 'start_app',
	description:
		'Start every app entry in src/app/ in a Docker container (no network, project read only, database in /tmp) and check that each answers GET /health with 200 within 30 s. Returns ok and per entry the error and the end of its log.',
	input: z.strictObject({}),
	async run(ctx) {
		const targets = await existingTargets(ctx);
		if (targets.length === 0)
			throw new ToolError(`No app entry exists yet. Write ${MAIN_ENTRY} first.`);
		return runStartCheck(ctx, targets);
	}
});
