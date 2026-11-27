import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	DEPLOY_FILES,
	deployArtefactHash,
	deployCheckHash,
	hasDeployFiles,
	listDeployFiles,
	readDeployCheck,
	writeDeployCheck,
	type DeployCheck
} from './deploy-state';
import { ProjectStore } from './store';

const roots: string[] = [];
async function project(files: Record<string, string> = {}) {
	const dir = await mkdtemp(path.join(tmpdir(), 'aise-deploy-state-'));
	roots.push(dir);
	const store = new ProjectStore(dir);
	const put = async (rel: string, content: string) => {
		await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
		await writeFile(path.join(dir, rel), content);
	};
	for (const [rel, content] of Object.entries(files)) await put(rel, content);
	return { dir, store, put };
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const base = {
	Dockerfile: 'FROM node:22\n',
	'compose.yaml': 'services:\n  app:\n    build: .\n',
	'RUN.md': '# Run\n',
	'package.json': '{}',
	'src/app/main.ts': 'export {};\n'
};

describe('deploy files', () => {
	it('lists the deploy files that exist as plain files', async () => {
		const { store, dir } = await project({ Dockerfile: 'x' });
		expect(await listDeployFiles(store)).toEqual(['Dockerfile']);
		expect(await hasDeployFiles(store)).toBe(true);
		await mkdir(path.join(dir, 'compose.yaml'));
		await symlink(path.join(dir, 'Dockerfile'), path.join(dir, 'RUN.md'));
		expect(await listDeployFiles(store)).toEqual(['Dockerfile']);
	});

	it('has none in an empty project', async () => {
		const { store } = await project();
		expect(await listDeployFiles(store)).toEqual([]);
		expect(await hasDeployFiles(store)).toBe(false);
	});
});

describe('deployArtefactHash', () => {
	it('is null without deploy files', async () => {
		const { store } = await project({ 'src/app/main.ts': 'x' });
		expect(await deployArtefactHash(store)).toBeNull();
	});

	it('ignores code outside the deploy files', async () => {
		const { store, put } = await project(base);
		const before = await deployArtefactHash(store);
		expect(before).toMatch(/^[0-9a-f]{64}$/);
		await put('src/app/main.ts', 'changed');
		await put('package.json', '{"changed":true}');
		expect(await deployArtefactHash(store)).toBe(before);
	});

	it.each(DEPLOY_FILES)('changes when %s changes', async (file) => {
		const { store, put } = await project(base);
		const before = await deployArtefactHash(store);
		await put(file, 'changed\n');
		expect(await deployArtefactHash(store)).not.toBe(before);
	});
});

describe('deployCheckHash', () => {
	it('is null without compose.yaml', async () => {
		const { store } = await project({ Dockerfile: 'x', 'src/app/main.ts': 'x' });
		expect(await deployCheckHash(store)).toBeNull();
	});

	it.each([
		['compose.yaml', 'services:\n  app:\n    build: .\n    restart: always\n'],
		['Dockerfile', 'FROM node:24\n'],
		['package.json', '{"scripts":{}}'],
		['package-lock.json', '{}'],
		['src/app/main.ts', 'export const a = 1;\n']
	])('changes when %s changes', async (file, content) => {
		const { store, put } = await project(base);
		const before = await deployCheckHash(store);
		await put(file, content);
		const after = await deployCheckHash(store);
		expect(after).toMatch(/^[0-9a-f]{64}$/);
		expect(after).not.toBe(before);
	});

	it('ignores RUN.md and .aise/', async () => {
		const { store, put } = await project(base);
		const before = await deployCheckHash(store);
		await put('RUN.md', '# Changed\n');
		await put('.aise/checks/deploy.json', '{}');
		await put('.aise/state.json', '{}');
		expect(await deployCheckHash(store)).toBe(before);
	});

	it('does not need a file under src/', async () => {
		const { store } = await project({ 'compose.yaml': base['compose.yaml'] });
		expect(await deployCheckHash(store)).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('stored deploy check', () => {
	const check: DeployCheck = {
		at: '2026-11-22T10:00:00.000Z',
		filesHash: 'abc',
		passed: false,
		services: [
			{ url: 'http://localhost:8080/health', status: 200 },
			{ url: 'http://localhost:8081/health', status: null }
		],
		logTail: 'boom',
		durationMs: 1234
	};

	it('round trips through .aise/checks/deploy.json', async () => {
		const { store } = await project();
		expect(await readDeployCheck(store)).toBeNull();
		await writeDeployCheck(store, check);
		expect(await readDeployCheck(store)).toEqual(check);
		await expect(store.readText('.aise/checks/deploy.json')).resolves.toContain('"boom"');
	});

	it('reads an unreadable file as no check', async () => {
		const { store, put } = await project();
		await put('.aise/checks/deploy.json', '{not json');
		expect(await readDeployCheck(store)).toBeNull();
		await put('.aise/checks/deploy.json', '{"at":1}');
		expect(await readDeployCheck(store)).toBeNull();
	});
});
