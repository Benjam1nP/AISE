import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deployCheckHash, writeDeployCheck } from '../core/deploy-state';
import { DesignDoc } from '../core/schemas/design';
import { initialState, type State } from '../core/state';
import { ProjectStore } from '../core/store';
import {
	GENERATE_DEPLOY_MESSAGE,
	deployBlocked,
	deployGate,
	comparableDeployHashes,
	deployHashesOf,
	markP6Stale,
	p6NotReady,
	readPackageJson,
	staleDeployIds
} from './p6';

const read = (rel: string): unknown =>
	JSON.parse(readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8'));
const design = () => DesignDoc.parse(read('showcases/auction/.aise/design.json'));
const pkg = () =>
	read('showcases/auction/package.json') as {
		scripts: Record<string, string>;
		dependencies: Record<string, string>;
	};

const COMPOSE = `services:
  api-server:
    build: .
    command: npm start
    ports: ['127.0.0.1:8080:8080']
  live-update-server:
    build: .
    command: npm run start:live-update-server
    environment:
      API_SERVER_URL: ws://api-server:8080
    ports: ['127.0.0.1:8081:8081']
`;

const roots: string[] = [];
async function project(files: Record<string, string>) {
	const dir = await mkdtemp(path.join(tmpdir(), 'p6-task6-'));
	roots.push(dir);
	const put = async (rel: string, content: string) => {
		await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
		await writeFile(path.join(dir, rel), content);
	};
	for (const [rel, content] of Object.entries(files)) await put(rel, content);
	return { store: new ProjectStore(dir), put };
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const deployFiles = {
	Dockerfile: 'FROM node:22\n',
	'compose.yaml': COMPOSE,
	'RUN.md': '# Run\n',
	'package.json': JSON.stringify(pkg()),
	'src/app/main.ts': 'export {};\n'
};

async function passedCheck(store: ProjectStore, services = [8080, 8081]) {
	await writeDeployCheck(store, {
		at: '2026-11-22T10:00:00.000Z',
		filesHash: await deployCheckHash(store),
		passed: true,
		services: services.map((p) => ({ url: `http://localhost:${p}/health`, status: 200 })),
		logTail: '',
		durationMs: 1
	});
}

describe('deployGate', () => {
	it('passes with the files, a consistent compose and a current passed check', async () => {
		const { store } = await project(deployFiles);
		await passedCheck(store);
		const g = await deployGate(store, design());
		expect(g).toEqual({
			passed: true,
			checks: [
				{ label: 'Deployment files exist', ok: true },
				{ label: 'Consistent with the design', ok: true },
				{ label: 'Deploy check passed', ok: true }
			]
		});
	});

	it('goes out of date after an edit of compose.yaml, Dockerfile, package.json or src, not RUN.md', async () => {
		const { store, put } = await project(deployFiles);
		await passedCheck(store);
		const detail = async () => (await deployGate(store, design())).checks[2];
		await put('RUN.md', '# Run, edited\n');
		expect((await detail()).ok).toBe(true);
		for (const [file, text] of [
			['compose.yaml', COMPOSE + '# edit\n'],
			['Dockerfile', 'FROM node:22-slim\n'],
			['package.json', deployFiles['package.json'] + '\n'],
			['src/app/main.ts', 'export const a = 1;\n']
		]) {
			const before = deployFiles[file as keyof typeof deployFiles];
			await put(file, text);
			expect(await detail(), file).toEqual({
				label: 'Deploy check passed',
				ok: false,
				detail: 'out of date'
			});
			await put(file, before);
			expect((await detail()).ok, file).toBe(true);
		}
	});

	it('names the failing service by its health url', async () => {
		const { store } = await project(deployFiles);
		await writeDeployCheck(store, {
			at: '2026-11-22T10:00:00.000Z',
			filesHash: await deployCheckHash(store),
			passed: false,
			services: [
				{ url: 'http://localhost:8080/health', status: 200 },
				{ url: 'http://localhost:8081/health', status: null }
			],
			logTail: 'x',
			durationMs: 1
		});
		const g = await deployGate(store, design());
		expect(g.checks[2]).toEqual({
			label: 'Deploy check passed',
			ok: false,
			detail: 'live-update-server no answer (x)'
		});
	});

	it('shows every consistency problem of the compose text', async () => {
		const bad = `services:
  api-server:
    build: .
    command: node server.js
  extra:
    build: .
    command: npm start
`;
		const { store } = await project({ ...deployFiles, 'compose.yaml': bad });
		await passedCheck(store);
		const g = await deployGate(store, design());
		expect(g.checks[1]).toEqual({
			label: 'Consistent with the design',
			ok: false,
			detail: [
				'service "api-server" runs "node server.js", expected "npm start"',
				'service "extra" is not a service node of the design',
				'service "live-update-server" is missing'
			].join('; ')
		});
		expect(g.passed).toBe(false);
	});

	it('shows missing files, and that the plan cannot be made without package.json or design', async () => {
		const { store } = await project({ 'compose.yaml': COMPOSE });
		const g = await deployGate(store, design());
		expect(g.checks.slice(0, 2)).toEqual([
			{ label: 'Deployment files exist', ok: false, detail: 'Dockerfile, RUN.md' },
			{ label: 'Consistent with the design', ok: false, detail: 'no design or package.json' }
		]);
		const full = await project(deployFiles);
		expect((await deployGate(full.store, null)).checks[1].detail).toBe('no design or package.json');
	});

	it('turns a pass out of date and the files check red when compose.yaml is deleted', async () => {
		const { store } = await project(deployFiles);
		await passedCheck(store);
		await store.deleteFile('compose.yaml');
		const g = await deployGate(store, design());
		expect(g.checks[0]).toEqual({
			label: 'Deployment files exist',
			ok: false,
			detail: 'compose.yaml'
		});
		expect(g.checks[2]).toEqual({ label: 'Deploy check passed', ok: false, detail: 'out of date' });
		expect(g.passed).toBe(false);
	});

	it('reports a missing compose.yaml as a consistency failure, not a crash', async () => {
		const { store } = await project({ ...deployFiles, 'compose.yaml': '' });
		const g = await deployGate(store, design());
		expect(g.checks[1].ok).toBe(false);
	});
});

describe('readPackageJson', () => {
	it('gives the parsed object, or null when missing, broken or not an object', async () => {
		expect(await readPackageJson((await project({ 'package.json': '{"a":1}' })).store)).toEqual({
			a: 1
		});
		expect(await readPackageJson((await project({})).store)).toBeNull();
		expect(await readPackageJson((await project({ 'package.json': '{' })).store)).toBeNull();
		expect(await readPackageJson((await project({ 'package.json': '[]' })).store)).toBeNull();
		// A folder named package.json cannot be read (EISDIR): null, not an exception.
		expect(await readPackageJson((await project({ 'package.json/x': '{}' })).store)).toBeNull();
	});
});

describe('deployBlocked', () => {
	it('needs the design and the package.json', async () => {
		const { store } = await project({});
		expect(await deployBlocked(store, null)).toMatch(/needs the design/);
		expect(await deployBlocked(store, design())).toMatch(/package\.json.*generate the code first/);
	});

	it('treats a broken or non object package.json as missing', async () => {
		for (const text of ['{', '[]', 'null']) {
			const { store } = await project({ 'package.json': text });
			expect(await deployBlocked(store, design()), text).toMatch(
				/package\.json.*generate the code first/
			);
		}
	});

	it('refuses while a deploy file exists and allows a project without them', async () => {
		const { store } = await project({ 'package.json': '{}' });
		expect(await deployBlocked(store, design())).toBeNull();
		const withCompose = await project({ 'package.json': '{}', 'compose.yaml': COMPOSE });
		expect(await deployBlocked(withCompose.store, design())).toMatch(
			/change them through the chat or Update/
		);
	});
});

const approved = (): State => {
	const s = initialState();
	for (const p of ['P1', 'P2', 'P4', 'P5'] as const) s.phases[p].status = 'approved';
	return s;
};

describe('p6NotReady', () => {
	it('is null with P1 to P5 approved', () => {
		expect(p6NotReady(approved(), 'generating')).toBeNull();
		expect(GENERATE_DEPLOY_MESSAGE).toBe(
			'Generate the deployment from the approved design and code.'
		);
	});

	it('names the first upstream phase to fix, then P5 stale or not approved', () => {
		const s = approved();
		s.phases.P5.status = 'awaiting_approval';
		expect(p6NotReady(s, 'generating')).toBe('Approve P5 before generating');
		s.phases.P5.status = 'stale';
		expect(p6NotReady(s, 'generating')).toBe(
			'P5 is stale; update it or confirm it is still valid before generating'
		);
		s.phases.P4.status = 'stale';
		expect(p6NotReady(s, 'generating')).toMatch(/^P4 is stale/);
		s.phases.P1.status = 'not_started';
		expect(p6NotReady(s, 'generating')).toBe('Approve P1 before generating');
	});
});

describe('P6 staleness', () => {
	const approvedP6 = (): State => {
		const s = approved();
		s.phases.P6 = { status: 'approved', deployHashes: deployHashesOf(design(), pkg(), 'c1') };
		return s;
	};

	it('is not stale for the stored hashes, nor without any', () => {
		expect(staleDeployIds(approvedP6(), design(), pkg(), 'c1')).toEqual([]);
		expect(staleDeployIds(approved(), design(), pkg(), 'c1')).toEqual([]);
	});

	it('marks P6 stale on a start script change and back to approved after reverting', () => {
		const s = approvedP6();
		const changed = pkg();
		changed.scripts['start:live-update-server'] = 'tsx src/other.ts';
		expect(staleDeployIds(s, design(), changed, 'c1')).toHaveLength(1);
		markP6Stale(s, design(), changed, 'c1');
		expect(s.phases.P6.status).toBe('stale');
		markP6Stale(s, design(), pkg(), 'c1');
		expect(s.phases.P6.status).toBe('approved');
	});

	it('marks stale on a dependency change and on a link change, not on a description', () => {
		const s = approvedP6();
		const dep = pkg();
		dep.dependencies.zzz = '1.0.0';
		expect(staleDeployIds(s, design(), dep, 'c1')).toEqual(['dependencies']);
		const d = design();
		d.links.pop();
		expect(staleDeployIds(s, d, pkg(), 'c1').length).toBeGreaterThan(0);
		const text = design();
		text.classes[0].description = 'another words';
		expect(staleDeployIds(s, text, pkg(), 'c1')).toEqual([]);
	});

	it('leaves the status alone while package.json is unreadable', () => {
		const stale = approvedP6();
		stale.phases.P6.status = 'stale';
		markP6Stale(stale, design(), null, 'c1');
		expect(stale.phases.P6.status).toBe('stale');
		const ok = approvedP6();
		markP6Stale(ok, design(), null, 'c1');
		expect(ok.phases.P6.status).toBe('approved');
		expect(staleDeployIds(ok, design(), null, 'c1')).toEqual([]);
	});

	it('reads the stored hashes whatever the status and leaves other statuses alone', () => {
		const s = approvedP6();
		s.phases.P6.status = 'awaiting_approval';
		const changed = pkg();
		changed.scripts.start = 'x';
		expect(staleDeployIds(s, design(), changed, 'c1').length).toBeGreaterThan(0);
		markP6Stale(s, design(), changed, 'c1');
		expect(s.phases.P6.status).toBe('awaiting_approval');
	});

	it('marks stale on a code change; hashes from before P6 tracked the code ignore it', () => {
		const s = approvedP6();
		expect(staleDeployIds(s, design(), pkg(), 'c2')).toEqual(['code']);
		markP6Stale(s, design(), pkg(), 'c2');
		expect(s.phases.P6.status).toBe('stale');
		markP6Stale(s, design(), pkg(), 'c1');
		expect(s.phases.P6.status).toBe('approved');
		const old = approvedP6();
		delete old.phases.P6.deployHashes!.code;
		expect(staleDeployIds(old, design(), pkg(), 'c2')).toEqual([]);
		expect(comparableDeployHashes({ a: 'x' }, { a: 'x', code: 'c' })).toEqual({ a: 'x' });
		expect(deployHashesOf(design(), pkg(), null)).not.toHaveProperty('code');
	});

	it('hashes nothing without a design', () => {
		expect(deployHashesOf(null, pkg(), 'c1')).toEqual({});
	});
});
