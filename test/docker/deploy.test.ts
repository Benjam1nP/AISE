import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDeployCheck } from '../../src/lib/server/core/deploy-state';
import { docker } from '../../src/lib/server/core/docker/run';
import { ProjectStore } from '../../src/lib/server/core/store';
import { executeTool, TOOLS } from '../../src/lib/server/core/tools';

// A non default host port keeps the fixtures clear of dev servers on 3000.
const URL_OK = 'http://localhost:3917/health';
const URL_API = 'http://localhost:3918/health';
const roots: string[] = [];
let lastStore: ProjectStore;

/** Copies a fixture to a temp folder and runs deploy_check on it. */
async function deploy(fixture: string, input: unknown, projectName = fixture, compose?: string) {
	const root = await mkdtemp(path.join(tmpdir(), 'aise-deploy-'));
	roots.push(root);
	const dir = path.join(root, fixture);
	await cp(new URL(`./fixtures/${fixture}`, import.meta.url), dir, { recursive: true });
	if (compose !== undefined) await writeFile(path.join(dir, 'compose.yaml'), compose);
	lastStore = new ProjectStore(dir);
	const ctx = { store: lastStore, runId: 'r1', projectName, agent: 'deploy' as const };
	return executeTool(ctx, 'deploy_check', input, Object.keys(TOOLS));
}

/** Container ids (running or not) of a compose project; empty string when nothing is left. */
const containers = async (project: string) =>
	(
		await docker(['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${project}`], {
			timeoutMs: 30_000
		})
	).stdout.trim();

afterEach(async () => {
	await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe('deploy_check', () => {
	it('builds, starts, probes the url and removes everything afterwards', async () => {
		const r = await deploy('hello-deploy', { url: URL_OK });
		expect(r.isError).toBe(false);
		expect(JSON.parse(r.content)).toMatchObject({
			ok: true,
			services: [{ url: URL_OK, ok: true, status: 200, body: 'ok' }]
		});
		expect(await containers('aise-hello-deploy')).toBe('');
		expect(await readDeployCheck(lastStore)).toMatchObject({
			passed: true,
			services: [{ url: URL_OK, status: 200 }]
		});
	});

	it('probes every url of two services and lists both', async () => {
		const r = await deploy('two-services', { urls: [URL_OK, URL_API] });
		expect(r.isError).toBe(false);
		expect(JSON.parse(r.content)).toMatchObject({
			ok: true,
			services: [
				{ url: URL_OK, ok: true, status: 200 },
				{ url: URL_API, ok: true, status: 200 }
			]
		});
		expect(await readDeployCheck(lastStore)).toMatchObject({
			passed: true,
			services: [
				{ url: URL_OK, status: 200 },
				{ url: URL_API, status: 200 }
			]
		});
		expect(await containers('aise-two-services')).toBe('');
	});

	it('fails when one service crashes and names its url', async () => {
		const failing = (
			await readFile(new URL('./fixtures/two-services/compose.yaml', import.meta.url), 'utf8')
		).replace(
			'  api:\n    build: .\n',
			"  api:\n    build: .\n    environment:\n      FAIL: '1'\n"
		);
		const r = await deploy(
			'two-services',
			{ urls: [URL_OK, URL_API], timeoutMs: 30_000 },
			'two-services',
			failing
		);
		const out = JSON.parse(r.content);
		expect(out.ok).toBe(false);
		expect(out.services).toMatchObject([
			{ url: URL_OK, ok: true, status: 200 },
			{ url: URL_API, ok: false, status: null }
		]);
		expect(out.logTail).toContain('api failed on purpose');
		expect(await readDeployCheck(lastStore)).toMatchObject({
			passed: false,
			services: [
				{ url: URL_OK, status: 200 },
				{ url: URL_API, status: null }
			]
		});
		expect(await containers('aise-two-services')).toBe('');
	});

	it('reports a failed build with the log and leaves nothing behind', async () => {
		const r = await deploy('broken-deploy', { url: URL_OK, timeoutMs: 120_000 });
		const out = JSON.parse(r.content);
		expect(out.ok).toBe(false);
		expect(out.services).toEqual([{ url: URL_OK, ok: false, status: null }]);
		expect(out.logTail).toContain('exit 1');
		expect(await containers('aise-broken-deploy')).toBe('');
	});

	it('gives up at the timeout when the url never answers 2xx, and still cleans up', async () => {
		const r = await deploy('hello-deploy', {
			url: 'http://localhost:3917/nope',
			timeoutMs: 20_000
		});
		expect(JSON.parse(r.content)).toMatchObject({ ok: false, services: [{ status: 404 }] });
		expect(await containers('aise-hello-deploy')).toBe('');
	});

	it('does not follow redirects; a 3xx is not healthy', async () => {
		const r = await deploy('hello-deploy', {
			url: 'http://localhost:3917/redirect',
			timeoutMs: 20_000
		});
		expect(JSON.parse(r.content)).toMatchObject({ ok: false, services: [{ status: 302 }] });
		expect(await containers('aise-hello-deploy')).toBe('');
	});

	it('refuses a port compose.yaml does not publish before starting anything', async () => {
		const r = await deploy('hello-deploy', { url: 'http://127.0.0.1:5432/' });
		expect(r.isError).toBe(true);
		expect(r.content).toMatch(/port 5432.*does not publish.*3917/);
		expect(await containers('aise-hello-deploy')).toBe('');
	});

	it('derives a valid compose project name from the project name', async () => {
		const r = await deploy('hello-deploy', { url: URL_OK }, 'Hello Deploy_2');
		expect(JSON.parse(r.content).ok).toBe(true);
		expect(await containers('aise-hello-deploy-2')).toBe('');
	});

	it.each([
		'http://example.com',
		'https://localhost:3917/health',
		'http://localhost.example.com/health',
		'http://localhost@example.com/health',
		'not a url'
	])('rejects the url %s before starting anything', async (url) => {
		const r = await deploy('hello-deploy', { url });
		expect(r.isError).toBe(true);
		expect(r.content).toMatch(/localhost|127\.0\.0\.1/);
		expect(await containers('aise-hello-deploy')).toBe('');
	});

	it('refuses a line break only Compose sees (U+2028) and starts nothing', async () => {
		const hidden =
			"services:\n  web:\n    build: .\n    # note\u2028    privileged: true\n    ports:\n      - '127.0.0.1:3917:3000'\n";
		const r = await deploy('hello-deploy', { url: URL_OK }, 'hello-deploy', hidden);
		expect(r.isError).toBe(true);
		expect(r.content).toContain('compose.yaml is not allowed');
		expect(await containers('aise-hello-deploy')).toBe('');
	});

	it('asks for P6 when the project has no compose.yaml', async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'aise-deploy-'));
		roots.push(root);
		const ctx = {
			store: new ProjectStore(root),
			runId: 'r1',
			projectName: 'empty',
			agent: 'deploy' as const
		};
		const r = await executeTool(ctx, 'deploy_check', {}, Object.keys(TOOLS));
		expect(r).toEqual({ content: 'No compose.yaml in the project. Run P6 first.', isError: true });
	});
});
