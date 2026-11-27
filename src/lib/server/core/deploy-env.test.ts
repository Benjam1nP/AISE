import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { envReads, extraEnvVars, placeholderFor } from './deploy-env';
import type { DeployPlan } from './deploy-plan';
import { ProjectStore } from './store';

describe('envReads', () => {
	it('finds dot and literal bracket reads, sorted and once', () => {
		const text = `const a = process.env.ZED ?? 'x';
const b = process.env["SMTP_HOST"] + process.env.ZED + process.env['ADMIN_PASSWORD'];
const c = process.env[name]; // a computed read has no name to find`;
		expect(envReads(text)).toEqual(['ADMIN_PASSWORD', 'SMTP_HOST', 'ZED']);
	});
});

describe('placeholderFor', () => {
	it('is a literal that says to change it, with no dollar sign', () => {
		expect(placeholderFor('ADMIN_PASSWORD')).toBe('change-me-admin-password');
	});

	it('is a number for a port and a URL for a URL, text otherwise', () => {
		expect(placeholderFor('PORT')).toBe('3000');
		expect(placeholderFor('METRICS_PORT')).toBe('3000');
		expect(placeholderFor('WEBHOOK_URL')).toBe('http://change-me.invalid');
		expect(placeholderFor('SUPPORT')).toBe('change-me-support');
		expect(placeholderFor('PORT_OFFSET')).toBe('change-me-port-offset');
		expect(placeholderFor('URLS')).toBe('change-me-urls');
	});
});

const plan = (env: Record<string, string>[]): DeployPlan => ({
	services: env.map((e, i) => ({ name: `s${i}`, env: e }) as DeployPlan['services'][number]),
	volumes: [],
	missingScripts: []
});

describe('extraEnvVars', () => {
	let root: string;
	let store: ProjectStore;
	beforeEach(async () => {
		root = await mkdtemp('/tmp/p6-task4-env-');
		store = new ProjectStore(path.join(root, 'proj'));
		await mkdir(path.join(root, 'proj/src/app'), { recursive: true });
		await mkdir(path.join(root, 'proj/test'), { recursive: true });
		await mkdir(path.join(root, 'proj/public'), { recursive: true });
		await writeFile(
			path.join(root, 'proj/src/app/main.ts'),
			'const p = process.env.PORT; const d = process.env.DB_PATH; const n = process.env.NODE_ENV;'
		);
		await writeFile(
			path.join(root, 'proj/src/auth.ts'),
			'export const pw = process.env.ADMIN_PASSWORD; export const peer = process.env.API_SERVER_URL;'
		);
		await writeFile(path.join(root, 'proj/src/auth.test.ts'), 'process.env.ONLY_IN_TESTS;');
		await writeFile(path.join(root, 'proj/test/x.test.ts'), 'process.env.OUTSIDE_SRC;');
		await writeFile(path.join(root, 'proj/public/app.ts'), 'process.env.IN_PUBLIC;');
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('lists the variables src reads that no service of the plan sets', async () => {
		const p = plan([{ PORT: '8080', DB_PATH: '/data/app.db' }, { API_SERVER_URL: 'ws://a:1' }]);
		expect(await extraEnvVars(store, p)).toEqual(['ADMIN_PASSWORD']);
	});

	it('lists a variable the plan sets on no service, ignoring tests, other folders and NODE_ENV', async () => {
		expect(await extraEnvVars(store, plan([{ PORT: '8080' }]))).toEqual([
			'ADMIN_PASSWORD',
			'API_SERVER_URL',
			'DB_PATH'
		]);
	});

	it('reads only .ts files under src', async () => {
		await writeFile(path.join(root, 'proj/src/legacy.js'), 'process.env.JS_ONLY;');
		await writeFile(path.join(root, 'proj/src/readme.md'), 'process.env.MD_ONLY;');
		expect(
			await extraEnvVars(store, plan([{ PORT: '8080', DB_PATH: 'x', API_SERVER_URL: 'y' }]))
		).toEqual(['ADMIN_PASSWORD']);
	});

	it('skips NODE_ENV, TZ, HOME and PATH', async () => {
		await writeFile(
			path.join(root, 'proj/src/env.ts'),
			'process.env.TZ; process.env.HOME; process.env.PATH; process.env.NODE_ENV; process.env.HOMEPAGE;'
		);
		expect(
			await extraEnvVars(store, plan([{ PORT: '8080', DB_PATH: 'x', API_SERVER_URL: 'y' }]))
		).toEqual(['ADMIN_PASSWORD', 'HOMEPAGE']);
	});

	it('is empty for a project without src', async () => {
		const empty = new ProjectStore(path.join(root, 'none'));
		expect(await extraEnvVars(empty, plan([{ PORT: '8080' }]))).toEqual([]);
	});
});
