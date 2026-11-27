import { lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { orMissing } from '../code-state';
import { deployCheckHash, readDeployCheck, writeDeployCheck } from '../deploy-state';
import { docker, type DockerResult } from '../docker/run';
import { tail } from '../docker/parse';
import { checkComposeText, validateCompose } from './compose-check';
import { defineTool, ToolError, type ToolContext } from './registry';

const DEFAULT_URL = 'http://localhost:8080/health';
const BODY_LIMIT = 2000;
const DOWN_TIMEOUT_MS = 60_000;

/** Probes run from the host, so only the host's own loopback is allowed. */
function checkUrl(raw: string): string {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		throw new ToolError(`Invalid url "${raw}". Use http://localhost or http://127.0.0.1.`);
	}
	if (u.protocol !== 'http:' || (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1')) {
		throw new ToolError(
			`Only http://localhost and http://127.0.0.1 urls are allowed, got "${raw}".`
		);
	}
	return u.href;
}

/**
 * Host ports the validated Compose JSON publishes. validateCompose has already required every ports
 * entry to bind 127.0.0.1, so these are exactly the ports this deployment opens on the loopback.
 */
export function publishedPorts(doc: unknown): Set<string> {
	const out = new Set<string>();
	const services = (doc as { services?: Record<string, { ports?: unknown }> }).services ?? {};
	for (const svc of Object.values(services))
		for (const p of Array.isArray(svc?.ports) ? svc.ports : []) {
			const published = (p as { published?: unknown }).published;
			if (typeof published === 'string' || typeof published === 'number')
				out.add(String(published));
		}
	return out;
}

/** The probe may only reach this deployment, not other services on the host's loopback. */
function checkPort(target: string, ports: Set<string>): void {
	const u = new URL(target);
	const port = u.port || '80';
	if (!ports.has(port))
		throw new ToolError(
			ports.size === 0
				? `compose.yaml publishes no ports, so ${target} cannot reach it. Publish one like "127.0.0.1:8080:3000".`
				: `${target} uses port ${port}, which compose.yaml does not publish. Use one of: ${[...ports].sort().join(', ')}.`
		);
}

/** Compose project name `aise-<projectName>`, lowercase, only `[a-z0-9-]`. */
export const composeProjectName = (projectName: string) =>
	`aise-${projectName.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Probe = { ok: boolean; status: number | null; body?: string };
type ServiceProbe = Probe & { url: string };
export type DeployCheckResult = { ok: boolean; services: ServiceProbe[]; logTail: string };

/**
 * Polls once a second until a 2xx answer or the deadline, and tries at least once (an attempt
 * after the deadline waits 1 s at most, so the overrun stays small). Connection errors count as
 * "not yet". Redirects are not followed: the host would fetch wherever the app
 * points it (cloud metadata, the LAN) and hand the body to the agent. A 3xx counts as not healthy.
 */
async function poll(url: string, deadline: number): Promise<Probe> {
	let last: Probe = { ok: false, status: null };
	for (;;) {
		try {
			const wait = Date.now() >= deadline ? 1000 : 3000;
			const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(wait) });
			const body = (await res.text()).slice(0, BODY_LIMIT);
			last = { ok: res.ok, status: res.status, body };
			if (res.ok) return last;
		} catch {
			// not listening yet
		}
		if (Date.now() >= deadline) return last;
		await sleep(Math.min(1000, deadline - Date.now()));
	}
}

/** `up --build`, poll the urls one after the other against one deadline, collect logs; always `down -v` afterwards. */
async function upAndProbe(
	compose: (...args: string[]) => string[],
	targets: string[],
	timeoutMs: number
): Promise<DeployCheckResult> {
	const deadline = Date.now() + timeoutMs;
	const run = async (): Promise<DeployCheckResult> => {
		const up = await docker(compose('up', '-d', '--build'), { timeoutMs });
		if (up.code !== 0) {
			const reason = up.timedOut ? 'Timed out while building or starting.\n' : '';
			return {
				ok: false,
				services: targets.map((url) => ({ url, ok: false, status: null })),
				logTail: tail(`${reason}${up.stderr}\n${up.stdout}`.trim())
			};
		}
		const services: ServiceProbe[] = [];
		for (const url of targets) services.push({ url, ...(await poll(url, deadline)) });
		const logs = await docker(compose('logs', '--no-color'), { timeoutMs: 30_000 });
		return {
			ok: services.every((s) => s.ok),
			services,
			logTail: tail(`${logs.stdout}${logs.stderr}`.trim())
		};
	};
	let result: DeployCheckResult;
	let down: DockerResult;
	try {
		result = await run();
	} finally {
		down = await docker(compose('down', '-v', '--remove-orphans'), { timeoutMs: DOWN_TIMEOUT_MS });
	}
	if (down.code !== 0 || down.timedOut) {
		// Leftover containers can hold the ports of the next check, so the log says it happened.
		const why = down.timedOut ? 'timed out' : `failed (${down.stderr.trim().split('\n')[0]})`;
		result = { ...result, logTail: tail(`${result.logTail}\ndocker compose down ${why}`.trim()) };
	}
	return result;
}

export const deployCheck = defineTool({
	name: 'deploy_check',
	description:
		'Builds and starts the project with `docker compose up --build`, polls the health urls (urls: 1 to 8, or one url; localhost only, on ports compose.yaml publishes; redirects are not followed; default http://localhost:8080/health) one after the other until each answers 2xx within timeoutMs (at most 180000 in all), returns every url with its status and the container log tail, and always removes the containers and volumes again. Needs compose.yaml in the project. The result is stored for the P6 gate.',
	input: z.object({
		urls: z.array(z.string()).min(1).max(8).optional(),
		url: z.string().optional(),
		timeoutMs: z.number().int().positive().max(180_000).default(180_000)
	}),
	async run(ctx, { urls, url, timeoutMs }): Promise<DeployCheckResult> {
		if (urls !== undefined && url !== undefined)
			throw new ToolError('Give either url or urls, not both.');
		const targets = (urls ?? [url ?? DEFAULT_URL]).map(checkUrl);

		const started = Date.now();
		const filesHash = await deployCheckHash(ctx.store);
		const store = async (
			passed: boolean,
			services: DeployCheckResult['services'],
			logTail: string
		) =>
			writeDeployCheck(ctx.store, {
				at: new Date().toISOString(),
				filesHash,
				passed,
				services: services.map(({ url, status }) => ({ url, status })),
				logTail,
				durationMs: Date.now() - started
			});
		try {
			const result = await check(ctx, targets, timeoutMs);
			await store(result.ok, result.services, result.logTail);
			return result;
		} catch (e) {
			// A refusal or Docker down is still a result: the gate shows why, instead of a stale check.
			// It says nothing about the files though, so any check of these same files stays, a pass
			// or a failure with its container log.
			if (e instanceof ToolError && !(await checkedFor(ctx, filesHash)))
				await store(
					false,
					targets.map((url) => ({ url, ok: false, status: null })),
					e.message
				);
			throw e;
		}
	}
});

/** Whether a check of these files is stored already (passed or failed). */
async function checkedFor(ctx: ToolContext, filesHash: string | null): Promise<boolean> {
	const previous = await readDeployCheck(ctx.store);
	return previous !== null && previous.filesHash === filesHash;
}

async function check(
	ctx: ToolContext,
	targets: string[],
	timeoutMs: number
): Promise<DeployCheckResult> {
	if (ctx.deployChecks && ctx.deployChecks.left <= 0)
		throw new ToolError('This run has used its 3 deploy checks. Stop and report what still fails.');
	// Compose would follow a symlink out of the project, so only a plain file is read.
	const entry = await lstat(ctx.store.resolve('compose.yaml')).catch((e) => orMissing(e, null));
	if (entry !== null && !entry.isFile())
		throw new ToolError('compose.yaml must be a plain file, not a symlink or a folder.');
	const composeText = await ctx.store.readText('compose.yaml');
	if (composeText === null) {
		throw new ToolError('No compose.yaml in the project. Run P6 first.');
	}
	const refuse = (problems: string[]) => {
		if (problems.length > 0)
			throw new ToolError(
				`compose.yaml is not allowed, fix these and retry:\n${problems.map((p) => `- ${p}`).join('\n')}`
			);
	};
	refuse(checkComposeText(composeText));

	const name = composeProjectName(ctx.projectName);
	const dir = await realpath(ctx.store.dir);
	// Outside the project: the checked text, Compose's output of it, and an empty env file so
	// Compose does not read the project's .env.
	const tmp = await mkdtemp(path.join(tmpdir(), 'aise-compose-'));
	try {
		const at = (f: string) => path.join(tmp, f);
		await writeFile(at('compose.yaml'), composeText);
		await writeFile(at('empty.env'), '');
		const base = ['compose', '-p', name, '--project-directory', dir, '--env-file', at('empty.env')];
		const config = await docker([...base, '-f', at('compose.yaml'), 'config', '--format', 'json'], {
			timeoutMs: 30_000
		});
		let doc: unknown;
		try {
			doc = config.code === 0 ? JSON.parse(config.stdout) : undefined;
		} catch {
			doc = undefined;
		}
		if (doc === undefined)
			throw new ToolError(
				`Docker Compose could not read compose.yaml:\n${tail(`${config.stderr}${config.stdout}`.trim())}`
			);
		refuse(validateCompose(doc, { name, dir }));
		const ports = publishedPorts(doc);
		for (const target of targets) checkPort(target, ports);
		// Compose runs exactly the JSON that was validated.
		await writeFile(at('compose.json'), config.stdout);
		const compose = (...args: string[]) => [...base, '-f', at('compose.json'), ...args];
		// Only a check that reaches `up` counts against the run's budget.
		if (ctx.deployChecks) ctx.deployChecks.left -= 1;
		return await upAndProbe(compose, targets, timeoutMs);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}
