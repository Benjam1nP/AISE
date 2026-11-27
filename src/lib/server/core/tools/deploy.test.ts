import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deployCheckHash, readDeployCheck } from '../deploy-state';
import { DOCKER_DOWN, docker, type DockerResult } from '../docker/run';
import { ProjectStore } from '../store';
import { executeTool, TOOLS, ToolError, type ToolContext } from './index';

vi.mock('../docker/run', async (orig) => ({
	...(await orig<typeof import('../docker/run')>()),
	docker: vi.fn()
}));

const COMPOSE = `services:
  web:
    build: .
    ports:
      - '127.0.0.1:3917:3000'
  api:
    build: .
    ports:
      - '127.0.0.1:3918:3000'
`;
const OK: DockerResult = { code: 0, stdout: '', stderr: '', timedOut: false };
const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

/** A Compose that accepts the text above and answers `config` like the real one. */
function fakeDocker(args: string[]): Promise<DockerResult> {
	if (args.includes('config')) {
		const [name, dir] = [arg(args, '-p'), arg(args, '--project-directory')];
		const port = (published: string) => ({
			mode: 'ingress',
			host_ip: '127.0.0.1',
			target: 3000,
			published,
			protocol: 'tcp'
		});
		const svc = (published: string) => ({
			build: { context: dir, dockerfile: 'Dockerfile' },
			command: null,
			entrypoint: null,
			networks: { default: null },
			ports: [port(published)]
		});
		const doc = {
			name,
			networks: { default: { name: `${name}_default`, ipam: {} } },
			services: { web: svc('3917'), api: svc('3918') }
		};
		return Promise.resolve({ ...OK, stdout: JSON.stringify(doc) });
	}
	if (args.includes('logs')) return Promise.resolve({ ...OK, stdout: 'web | listening' });
	return Promise.resolve(OK);
}

const roots: string[] = [];
const dockerMock = vi.mocked(docker);
const ups = () => dockerMock.mock.calls.filter(([a]) => a.includes('up')).length;
const downs = () => dockerMock.mock.calls.filter(([a]) => a.includes('down')).length;

async function setup(files: Record<string, string> = { 'compose.yaml': COMPOSE }) {
	const dir = await mkdtemp(path.join(tmpdir(), 'aise-deploy-tool-'));
	roots.push(dir);
	for (const [rel, content] of Object.entries(files)) await writeFile(path.join(dir, rel), content);
	const store = new ProjectStore(dir);
	const ctx: ToolContext = { store, runId: 'r1', projectName: 'p', agent: 'deploy' };
	const run = (input: unknown, c: ToolContext = ctx) =>
		executeTool(c, 'deploy_check', input, Object.keys(TOOLS));
	return { dir, store, ctx, run };
}

const health = (port: number) => `http://localhost:${port}/health`;
let fetched: string[];

beforeEach(() => {
	dockerMock.mockReset().mockImplementation(fakeDocker);
	fetched = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			fetched.push(url);
			return new Response('ok', { status: 200 });
		})
	);
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe('deploy_check urls', () => {
	it('probes every url and lists each one', async () => {
		const { run } = await setup();
		const r = await run({ urls: [health(3917), health(3918)] });
		expect(r.isError).toBe(false);
		expect(JSON.parse(r.content)).toEqual({
			ok: true,
			services: [
				{ url: health(3917), ok: true, status: 200, body: 'ok' },
				{ url: health(3918), ok: true, status: 200, body: 'ok' }
			],
			logTail: 'web | listening'
		});
	});

	it('takes the single url alias as a list of one', async () => {
		const { run } = await setup();
		const a = JSON.parse((await run({ url: health(3918) })).content);
		const aliasFetches = [...fetched];
		fetched.length = 0;
		const b = JSON.parse((await run({ urls: [health(3918)] })).content);
		expect(a).toEqual(b);
		expect(aliasFetches).toEqual(fetched);
		expect(a.services.map((s: { url: string }) => s.url)).toEqual([health(3918)]);
	});

	it('defaults to port 8080 health when neither is given', async () => {
		const { run } = await setup({
			'compose.yaml': COMPOSE.replace('3917:3000', '8080:3000')
		});
		dockerMock.mockImplementation((args) =>
			fakeDocker(args).then((r) =>
				args.includes('config') ? { ...r, stdout: r.stdout.replace('"3917"', '"8080"') } : r
			)
		);
		const r = JSON.parse((await run({})).content);
		expect(r.services.map((s: { url: string }) => s.url)).toEqual([health(8080)]);
	});

	it('is not ok when one url does not answer 2xx, and names it', async () => {
		const { run } = await setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => new Response('no', { status: url.includes('3918') ? 503 : 200 }))
		);
		const r = JSON.parse(
			(await run({ urls: [health(3917), health(3918)], timeoutMs: 1500 })).content
		);
		expect(r.ok).toBe(false);
		expect(r.services.map((s: { ok: boolean; status: number }) => [s.ok, s.status])).toEqual([
			[true, 200],
			[false, 503]
		]);
	});

	it('refuses url and urls together before any Docker call', async () => {
		const { run } = await setup();
		const r = await run({ url: health(3917), urls: [health(3917)] });
		expect(r.isError).toBe(true);
		expect(dockerMock).not.toHaveBeenCalled();
	});

	it('refuses an unpublished port in the second url before up', async () => {
		const { run } = await setup();
		const r = await run({ urls: [health(3917), health(5432)] });
		expect(r.isError).toBe(true);
		expect(r.content).toMatch(/port 5432.*does not publish/);
		expect(ups()).toBe(0);
		expect(fetched).toEqual([]);
	});

	it.each([
		'http://169.254.169.254:3917/health',
		'https://localhost:3917/health',
		'http://localhost@example.com:3917/health'
	])('refuses %s in a later entry before any Docker call or probe', async (bad) => {
		const { run } = await setup();
		const r = await run({ urls: [health(3917), bad] });
		expect(r.isError).toBe(true);
		expect(r.content).toMatch(/localhost|127\.0\.0\.1/);
		expect(dockerMock).not.toHaveBeenCalled();
		expect(fetched).toEqual([]);
	});

	it('does not follow redirects on any url', async () => {
		const { run } = await setup();
		await run({ urls: [health(3917), health(3918)] });
		const fetchMock = vi.mocked(fetch);
		expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([health(3917), health(3918)]);
		for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ redirect: 'manual' });
	});

	it('tries every url at least once even when an earlier one used up the time', async () => {
		const { run } = await setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				fetched.push(url);
				return new Response('x', { status: url.includes('3917') ? 503 : 200 });
			})
		);
		const r = JSON.parse((await run({ urls: [health(3917), health(3918)], timeoutMs: 1 })).content);
		expect(fetched).toContain(health(3918));
		expect(r.ok).toBe(false);
		expect(r.services[0]).toMatchObject({ ok: false, status: 503 });
		expect(r.services[1]).toMatchObject({ ok: true, status: 200 });
	});

	it('waits at most 1 s for an attempt after the deadline, 3 s before it', async () => {
		const { run } = await setup();
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('x', { status: 503 }))
		);
		await run({ url: health(3917), timeoutMs: 300 });
		expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([3000, 1000]);
		timeout.mockRestore();
	});

	it('refuses an empty list and more than 8 urls', async () => {
		const { run } = await setup();
		expect((await run({ urls: [] })).isError).toBe(true);
		const nine = Array.from({ length: 9 }, () => health(3917));
		expect((await run({ urls: nine })).isError).toBe(true);
	});
});

describe('deploy_check budget', () => {
	it('allows as many checks as left and refuses the next before Docker', async () => {
		const { ctx, run } = await setup();
		const limited = { ...ctx, deployChecks: { left: 1 } };
		expect((await run({ url: health(3917) }, limited)).isError).toBe(false);
		expect(limited.deployChecks.left).toBe(0);
		expect(ups()).toBe(1);
		const calls = dockerMock.mock.calls.length;
		const second = await run({ url: health(3917) }, limited);
		expect(second).toEqual({
			content: 'This run has used its 3 deploy checks. Stop and report what still fails.',
			isError: true
		});
		expect(limited.deployChecks.left).toBe(0);
		expect(dockerMock.mock.calls.length).toBe(calls);
	});

	it('has no limit without a counter', async () => {
		const { run } = await setup();
		for (let i = 0; i < 4; i++) expect((await run({ url: health(3917) })).isError).toBe(false);
		expect(ups()).toBe(4);
	});

	it('does not charge an allowlist refusal and stores a failed check with the message', async () => {
		const { ctx, store, run } = await setup({
			'compose.yaml': `${COMPOSE}    env_file: .env\n`
		});
		const limited = { ...ctx, deployChecks: { left: 3 } };
		const r = await run({ urls: [health(3917), health(3918)] }, limited);
		expect(r.isError).toBe(true);
		expect(r.content).toContain('compose.yaml is not allowed');
		expect(limited.deployChecks.left).toBe(3);
		expect(ups()).toBe(0);
		const stored = await readDeployCheck(store);
		expect(stored).toMatchObject({
			passed: false,
			services: [
				{ url: health(3917), status: null },
				{ url: health(3918), status: null }
			]
		});
		expect(stored?.logTail).toBe(r.content);
	});

	it('does not charge Docker being down and stores a failed check with the message', async () => {
		const { ctx, store, run } = await setup();
		dockerMock.mockRejectedValue(new ToolError(DOCKER_DOWN));
		const limited = { ...ctx, deployChecks: { left: 3 } };
		const r = await run({ url: health(3917) }, limited);
		expect(r).toEqual({ content: DOCKER_DOWN, isError: true });
		expect(limited.deployChecks.left).toBe(3);
		expect(await readDeployCheck(store)).toMatchObject({
			passed: false,
			services: [{ url: health(3917), status: null }],
			logTail: DOCKER_DOWN
		});
	});

	it('stores the refusal for a project without compose.yaml', async () => {
		const { store, run } = await setup({});
		const r = await run({});
		expect(r.isError).toBe(true);
		expect(await readDeployCheck(store)).toMatchObject({
			filesHash: null,
			passed: false,
			logTail: 'No compose.yaml in the project. Run P6 first.'
		});
	});

	it('stores the used up budget as a failed check when no check exists for these files', async () => {
		const { ctx, store, run } = await setup();
		await run({ url: health(3917) }, { ...ctx, deployChecks: { left: 0 } });
		expect(await readDeployCheck(store)).toMatchObject({ passed: false });
		expect((await readDeployCheck(store))?.logTail).toContain('used its 3 deploy checks');
	});

	it('keeps a pass for the same files when a later call is refused', async () => {
		const { ctx, store, run } = await setup();
		const limited = { ...ctx, deployChecks: { left: 1 } };
		await run({ url: health(3917) }, limited);
		const passed = await readDeployCheck(store);
		expect(passed?.passed).toBe(true);
		expect((await run({ url: health(3917) }, limited)).isError).toBe(true);
		expect(await readDeployCheck(store)).toEqual(passed);
		// Docker down and an unpublished port say nothing about the files either.
		expect((await run({ url: health(5432) })).isError).toBe(true);
		dockerMock.mockRejectedValue(new ToolError(DOCKER_DOWN));
		expect((await run({ url: health(3917) })).isError).toBe(true);
		expect(await readDeployCheck(store)).toEqual(passed);
	});

	it('keeps a failed check that ran, with its log, when a later call for the same files is refused', async () => {
		const { ctx, store, run } = await setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('x', { status: 503 }))
		);
		await run({ url: health(3917), timeoutMs: 1 });
		const failed = await readDeployCheck(store);
		expect(failed).toMatchObject({ passed: false, services: [{ status: 503 }] });
		await run({ url: health(3917) }, { ...ctx, deployChecks: { left: 0 } });
		expect((await run({ url: health(5432) })).isError).toBe(true);
		dockerMock.mockRejectedValue(new ToolError(DOCKER_DOWN));
		expect((await run({ url: health(3917) })).isError).toBe(true);
		expect(await readDeployCheck(store)).toEqual(failed);
	});

	it('replaces a pass when the files changed since', async () => {
		const { dir, ctx, store, run } = await setup();
		await run({ url: health(3917) });
		await writeFile(path.join(dir, 'compose.yaml'), `${COMPOSE}# edited\n`);
		await run({ url: health(3917) }, { ...ctx, deployChecks: { left: 0 } });
		expect(await readDeployCheck(store)).toMatchObject({ passed: false });
	});

	it('replaces a pass with the real result of a check that ran and failed', async () => {
		const { store, run } = await setup();
		await run({ url: health(3917) });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('x', { status: 503 }))
		);
		await run({ url: health(3917), timeoutMs: 1 });
		expect(await readDeployCheck(store)).toMatchObject({
			passed: false,
			services: [{ url: health(3917), status: 503 }]
		});
	});

	it.each([
		['a symlink', async (dir: string) => symlink('/etc/hosts', path.join(dir, 'compose.yaml'))],
		['a folder', async (dir: string) => mkdir(path.join(dir, 'compose.yaml'))]
	])('refuses a compose.yaml that is %s before any Docker call', async (_n, make) => {
		const { dir, run } = await setup({});
		await make(dir);
		const r = await run({});
		expect(r.isError).toBe(true);
		expect(r.content).toContain('plain file');
		expect(dockerMock).not.toHaveBeenCalled();
	});
});

describe('deploy_check teardown', () => {
	it('runs one down -v after a pass, after a failed up and when logs throws', async () => {
		const { ctx, run } = await setup();
		await run({ url: health(3917) });
		expect(downs()).toBe(1);
		const down = dockerMock.mock.calls.find(([a]) => a.includes('down'))?.[0];
		expect(down).toEqual(expect.arrayContaining(['down', '-v', '--remove-orphans']));

		dockerMock.mockClear();
		dockerMock.mockImplementation((args) =>
			args.includes('up') ? Promise.resolve({ ...OK, code: 1 }) : fakeDocker(args)
		);
		await run({ url: health(3917) });
		expect(downs()).toBe(1);

		dockerMock.mockClear();
		dockerMock.mockImplementation((args) =>
			args.includes('logs') ? Promise.reject(new Error('socket closed')) : fakeDocker(args)
		);
		const limited = { ...ctx, deployChecks: { left: 3 } };
		await expect(run({ url: health(3917) }, limited)).rejects.toThrow('socket closed');
		expect(downs()).toBe(1);
		// the check reached up, so it counts even though it threw afterwards
		expect(limited.deployChecks.left).toBe(2);
	});

	it.each([
		['fails', { code: 1, stderr: 'network busy' }, 'network busy'],
		['times out', { code: null, timedOut: true }, 'timed out']
	])('says so in the log tail when down %s', async (_n, downResult, text) => {
		const { store, run } = await setup();
		dockerMock.mockImplementation((args) =>
			args.includes('down') ? Promise.resolve({ ...OK, ...downResult }) : fakeDocker(args)
		);
		const r = JSON.parse((await run({ url: health(3917) })).content);
		expect(r.logTail).toContain('docker compose down');
		expect(r.logTail).toContain(text);
		expect((await readDeployCheck(store))?.logTail).toContain('docker compose down');
	});
});

describe('deploy_check stored result', () => {
	it('stores a passed check with the files hash taken before the run', async () => {
		const { store, run } = await setup();
		const hash = await deployCheckHash(store);
		await run({ urls: [health(3917), health(3918)] });
		const stored = await readDeployCheck(store);
		expect(stored).toMatchObject({
			filesHash: hash,
			passed: true,
			services: [
				{ url: health(3917), status: 200 },
				{ url: health(3918), status: 200 }
			],
			logTail: 'web | listening'
		});
		expect(stored?.durationMs).toBeGreaterThanOrEqual(0);
		expect(Date.parse(stored?.at ?? '')).not.toBeNaN();
	});

	it('stores a failed start with no status per url', async () => {
		const { store, run } = await setup();
		dockerMock.mockImplementation((args) =>
			args.includes('up')
				? Promise.resolve({ ...OK, code: 1, stderr: 'build failed' })
				: fakeDocker(args)
		);
		const r = JSON.parse((await run({ urls: [health(3917), health(3918)] })).content);
		expect(r.ok).toBe(false);
		expect(r.services.map((s: { status: number | null }) => s.status)).toEqual([null, null]);
		expect(await readDeployCheck(store)).toMatchObject({
			passed: false,
			services: [
				{ url: health(3917), status: null },
				{ url: health(3918), status: null }
			]
		});
	});
});
