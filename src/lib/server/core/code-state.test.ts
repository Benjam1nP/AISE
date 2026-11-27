import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	CODE_ROOTS,
	codeHash,
	designHashes,
	hasCode,
	hashFiles,
	listCodeFiles,
	designHash,
	readChecks,
	runCodeChecks
} from './code-state';
import { sha256, stableStringify } from './hash';
import { DesignDoc } from './schemas/design';
import { ProjectStore } from './store';
import { NO_TSCONFIG } from './tools/check';
import { ToolError, type ToolContext } from './tools/registry';
import { canWrite, CODE_ROOTS as SCOPE_CODE_ROOTS } from './tools/scope';

let root: string;
let store: ProjectStore;

const put = async (rel: string, content: string | Buffer) => {
	const abs = path.join(store.dir, rel);
	await mkdir(path.dirname(abs), { recursive: true });
	await writeFile(abs, content);
};

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-code-state-'));
	store = new ProjectStore(path.join(root, 'proj'));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('codeHash', () => {
	it('ignores the temp files of an atomic write in progress', async () => {
		await put('src/a.ts', 'export const a = 1;');
		const before = await codeHash(store);
		await put('src/a.ts.0b6c9e0e-4a1f-4c2e-9d55-3f0f2f3c1a7e.tmp', 'half written');
		expect(await listCodeFiles(store)).toEqual(['src/a.ts']);
		expect(await codeHash(store)).toBe(before);
	});

	it('skips a listed file that vanished before it was read', async () => {
		await put('src/a.ts', 'export const a = 1;');
		expect(await hashFiles(store, ['src/a.ts', 'src/gone.ts'])).toBe(await codeHash(store));
	});

	it('is null for an empty project and for a scaffold without files under src/', async () => {
		expect(await codeHash(store)).toBeNull();
		await put('package.json', '{}');
		await put('tsconfig.json', '{}');
		expect(await codeHash(store)).toBeNull();
		expect(await hasCode(store)).toBe(false);
	});

	it('changes when a file under src/, public/, package.json or tsconfig.json changes', async () => {
		await put('src/a.ts', 'export const a = 1;');
		await put('public/index.html', 'x');
		await put('package.json', '{}');
		await put('tsconfig.json', '{}');
		expect(await hasCode(store)).toBe(true);
		const base = await codeHash(store);
		expect(base).toMatch(/^[0-9a-f]{64}$/);
		for (const f of ['src/a.ts', 'public/index.html', 'package.json', 'tsconfig.json']) {
			const before = await codeHash(store);
			await put(f, 'changed ' + f);
			expect(await codeHash(store), f).not.toBe(before);
		}
	});

	it('changes when a file is added or renamed', async () => {
		await put('src/a.ts', 'x');
		const one = await codeHash(store);
		await put('src/b.ts', 'x');
		expect(await codeHash(store)).not.toBe(one);
	});

	it('ignores .aise/, test/ and other files', async () => {
		await put('src/a.ts', 'x');
		const base = await codeHash(store);
		await put('.aise/design.json', '{}');
		await put('test/a.test.ts', 'x');
		await put('Dockerfile', 'x');
		expect(await codeHash(store)).toBe(base);
	});

	it('hashes bytes: a binary change in public/ changes the hash', async () => {
		await put('src/a.ts', 'x');
		await put('public/logo.png', Buffer.from([0x89, 0xff, 0xfe, 0x01]));
		const before = await codeHash(store);
		// both decode to the same UTF-8 text (U+FFFD), so only the bytes differ
		await put('public/logo.png', Buffer.from([0x89, 0xff, 0xfe, 0x02]));
		expect(await codeHash(store)).not.toBe(before);
	});

	it('uses the code roots of the code agent write scope', () => {
		expect(CODE_ROOTS).toBe(SCOPE_CODE_ROOTS);
		expect(CODE_ROOTS.filter((r) => !canWrite('code', r.endsWith('/') ? r + 'x' : r))).toEqual([]);
	});

	it('skips a symlinked src/ or package.json', async () => {
		await mkdir(path.join(root, 'outside'), { recursive: true });
		await writeFile(path.join(root, 'outside', 'a.ts'), 'x');
		await writeFile(path.join(root, 'outside', 'pkg.json'), '{}');
		await mkdir(store.dir, { recursive: true });
		await symlink(path.join(root, 'outside'), path.join(store.dir, 'src'));
		await symlink(path.join(root, 'outside', 'pkg.json'), path.join(store.dir, 'package.json'));
		expect(await listCodeFiles(store)).toEqual([]);
		expect(await hasCode(store)).toBe(false);
		expect(await codeHash(store)).toBeNull();
	});

	it('treats a root that is a file like a missing one', async () => {
		await put('src', 'not a folder');
		await put('public', 'not a folder');
		expect(await listCodeFiles(store)).toEqual([]);
		expect(await codeHash(store)).toBeNull();
	});

	it('listCodeFiles gives sorted project relative paths under the roots', async () => {
		for (const f of ['src/b.ts', 'src/a/z.ts', 'public/i.html', 'package.json', 'test/t.ts'])
			await put(f, 'x');
		expect(await listCodeFiles(store)).toEqual([
			'package.json',
			'public/i.html',
			'src/a/z.ts',
			'src/b.ts'
		]);
	});
});

const design = (over: { description?: string; attrType?: string; compName?: string } = {}) =>
	DesignDoc.parse({
		actors: [],
		useCases: [],
		classes: [
			{
				id: 'DSN-001',
				name: 'Task',
				kind: 'class',
				description: over.description ?? 'a task',
				attributes: [{ name: 'title', type: over.attrType ?? 'string' }],
				methods: [],
				relations: [],
				reqIds: ['REQ-001']
			}
		],
		components: [
			{
				id: 'DSN-010',
				name: over.compName ?? 'Tasks',
				classIds: ['DSN-001'],
				nodeId: 'DSN-020',
				reqIds: ['REQ-001']
			}
		],
		nodes: [{ id: 'DSN-020', name: 'Server', kind: 'service', reqIds: ['REQ-001'] }],
		sequences: []
	});

describe('designHashes', () => {
	it('has one hash per class, component and node ID', () => {
		expect(Object.keys(designHashes(design())).sort()).toEqual(['DSN-001', 'DSN-010', 'DSN-020']);
	});

	it('hashes a node without links as before links existed, so approved P4s stay current', () => {
		expect(designHashes(design())['DSN-020']).toBe(
			sha256(stableStringify({ name: 'Server', kind: 'service' }))
		);
	});

	it('hashes a design without links as before links existed', () => {
		const { links, ...rest } = design();
		expect(links).toEqual([]);
		expect(designHash(design())).toBe(sha256(stableStringify(rest)));
	});

	it('does not change when only a description changes', () => {
		expect(designHashes(design({ description: 'other words' }))).toEqual(designHashes(design()));
	});

	it('changes for the class when an attribute type changes, not for the others', () => {
		const a = designHashes(design());
		const b = designHashes(design({ attrType: 'number' }));
		expect(b['DSN-001']).not.toBe(a['DSN-001']);
		expect(b['DSN-010']).toBe(a['DSN-010']);
		expect(b['DSN-020']).toBe(a['DSN-020']);
	});

	it('changes for both nodes of a link when the link or its protocol changes, not its label', () => {
		const d = design();
		d.nodes.push({ id: 'DSN-021', name: 'Browser', kind: 'client', reqIds: [] });
		const a = designHashes(d);
		d.links.push({ from: 'DSN-021', to: 'DSN-020', protocol: 'http' });
		const b = designHashes(d);
		expect(b['DSN-020']).not.toBe(a['DSN-020']);
		expect(b['DSN-021']).not.toBe(a['DSN-021']);
		expect(b['DSN-001']).toBe(a['DSN-001']);
		d.links[0].protocol = 'ws';
		const c = designHashes(d);
		expect(c['DSN-020']).not.toBe(b['DSN-020']);
		expect(c['DSN-021']).not.toBe(b['DSN-021']);
		d.links[0].label = 'live';
		expect(designHashes(d)).toEqual(c);
	});

	it('changes for a client component when its reqIds change, which the page comment carries, not for a service component', () => {
		const d = design();
		d.nodes.push({ id: 'DSN-021', name: 'Browser', kind: 'client', reqIds: [] });
		d.components.push({ id: 'DSN-011', name: 'Page', classIds: [], nodeId: 'DSN-021', reqIds: [] });
		const a = designHashes(d);
		d.components[0].reqIds = ['REQ-002'];
		d.components[1].reqIds = ['REQ-002'];
		const b = designHashes(d);
		expect(b['DSN-011']).not.toBe(a['DSN-011']);
		// a service component keeps the hash it had before, so stored approvals stay current
		expect(b['DSN-010']).toBe(a['DSN-010']);
		expect(b['DSN-010']).toBe(
			sha256(stableStringify({ name: 'Tasks', classIds: ['DSN-001'], nodeId: 'DSN-020' }))
		);
	});

	it('changes for the component and its classes when the component is renamed', () => {
		const a = designHashes(design());
		const b = designHashes(design({ compName: 'Work' }));
		expect(b['DSN-010']).not.toBe(a['DSN-010']);
		expect(b['DSN-001']).not.toBe(a['DSN-001']);
	});
});

describe('designHashes fields', () => {
	const base = () => ({
		actors: [],
		useCases: [],
		classes: [
			{
				id: 'DSN-001',
				name: 'Task',
				kind: 'class',
				description: 'd',
				attributes: [{ name: 'title', type: 'string' }],
				methods: [{ name: 'run', params: [], returnType: 'void' }],
				values: [] as string[],
				relations: [{ kind: 'association', targetId: 'DSN-002', multiplicity: '1', label: 'has' }],
				reqIds: ['REQ-001']
			},
			{
				id: 'DSN-002',
				name: 'Other',
				kind: 'class',
				description: '',
				attributes: [],
				methods: [],
				relations: [],
				reqIds: ['REQ-001']
			}
		],
		components: [
			{
				id: 'DSN-010',
				name: 'Tasks',
				classIds: ['DSN-001'],
				nodeId: 'DSN-020',
				reqIds: ['REQ-001']
			},
			{ id: 'DSN-011', name: 'Misc', classIds: ['DSN-002'], nodeId: 'DSN-020', reqIds: ['REQ-001'] }
		],
		nodes: [
			{ id: 'DSN-020', name: 'Server', kind: 'service', reqIds: ['REQ-001'] },
			{ id: 'DSN-021', name: 'Db', kind: 'database', reqIds: ['REQ-001'] }
		],
		sequences: []
	});
	type Raw = ReturnType<typeof base>;
	const hashes = (edit: (d: Raw) => void) => {
		const d = base();
		edit(d);
		return designHashes(DesignDoc.parse(d));
	};
	const ref = hashes(() => {});

	it.each<[string, string, (d: Raw) => void]>([
		['class kind', 'DSN-001', (d) => (d.classes[0]!.kind = 'interface')],
		['class name', 'DSN-001', (d) => (d.classes[0]!.name = 'Job')],
		['class attributes', 'DSN-001', (d) => (d.classes[0]!.attributes[0]!.name = 'name')],
		['class methods', 'DSN-001', (d) => (d.classes[0]!.methods[0]!.returnType = 'number')],
		['class values', 'DSN-001', (d) => (d.classes[0]!.values = ['A'])],
		['relation kind', 'DSN-001', (d) => (d.classes[0]!.relations[0]!.kind = 'composition')],
		['relation target', 'DSN-001', (d) => (d.classes[0]!.relations[0]!.targetId = 'DSN-001')],
		['relation multiplicity', 'DSN-001', (d) => (d.classes[0]!.relations[0]!.multiplicity = '*')],
		['class reqIds', 'DSN-001', (d) => (d.classes[0]!.reqIds = ['REQ-002'])],
		['class component', 'DSN-001', (d) => (d.components[0]!.name = 'Work')],
		['component name', 'DSN-010', (d) => (d.components[0]!.name = 'Work')],
		['component classIds', 'DSN-010', (d) => (d.components[0]!.classIds = ['DSN-001', 'DSN-002'])],
		['component nodeId', 'DSN-010', (d) => (d.components[0]!.nodeId = 'DSN-021')],
		['node name', 'DSN-020', (d) => (d.nodes[0]!.name = 'Api')],
		['node kind', 'DSN-021', (d) => (d.nodes[1]!.kind = 'external')]
	])('%s changes the hash of %s', (_what, id, edit) => {
		expect(hashes(edit)[id]).not.toBe(ref[id]);
	});

	it.each<[string, (d: Raw) => void]>([
		['class description', (d) => (d.classes[0]!.description = 'changed')],
		['relation label', (d) => (d.classes[0]!.relations[0]!.label = 'other')]
	])('%s changes no hash', (_what, edit) => {
		expect(hashes(edit)).toEqual(ref);
	});
});

describe('runCodeChecks', () => {
	const ctx = (): ToolContext => ({ store, runId: 'x', projectName: 'p', agent: 'code' });

	it('runs typecheck and drift, writes .aise/checks/P4.json with the current code hash', async () => {
		await store.writeJson('.aise/design.json', DesignDoc, design());
		await put('package.json', '{}');
		await put('tsconfig.json', '{}');
		await put('src/a.ts', 'export const a = 1;');
		const typecheck = async () => ({ ok: true, errors: [], timedOut: false });
		const checks = await runCodeChecks(ctx(), { typecheck });
		expect(checks.codeHash).toBe(await codeHash(store));
		expect(checks.designHash).toBe(designHash(design()));
		expect(checks.typecheck).toEqual({ ok: true, errors: [], timedOut: false });
		expect(checks.drift.map((d) => d.id)).toContain('DSN-001');
		expect(await readChecks(store)).toEqual(checks);
		expect(await store.exists('.aise/checks/P4.json')).toBe(true);
	});

	it('has typecheck null without package.json and does not call the runner', async () => {
		await store.writeJson('.aise/design.json', DesignDoc, design());
		await put('src/a.ts', 'export const a = 1;');
		let called = false;
		const typecheck = async () => {
			called = true;
			return { ok: true, errors: [], timedOut: false };
		};
		const checks = await runCodeChecks(ctx(), { typecheck });
		expect(checks.typecheck).toBeNull();
		expect(called).toBe(false);
	});

	it('a missing tsconfig.json is a failed typecheck with the NO_TSCONFIG text, runner not called', async () => {
		await store.writeJson('.aise/design.json', DesignDoc, design());
		await put('package.json', '{}');
		await put('src/a.ts', 'export const a = 1;');
		let called = false;
		const typecheck = async () => {
			called = true;
			return { ok: true, errors: [], timedOut: false };
		};
		const checks = await runCodeChecks(ctx(), { typecheck });
		expect(called).toBe(false);
		expect(checks.typecheck).toEqual({
			ok: false,
			errors: [{ file: '', line: 0, col: 0, message: NO_TSCONFIG }],
			timedOut: false
		});
	});

	it('every error from typecheck propagates and no checks file is written', async () => {
		await store.writeJson('.aise/design.json', DesignDoc, design());
		await put('package.json', '{}');
		await put('tsconfig.json', '{}');
		await put('src/a.ts', 'export const a = 1;');
		const typecheck = async () => {
			throw new ToolError('Docker is not running.');
		};
		await expect(runCodeChecks(ctx(), { typecheck })).rejects.toThrow('Docker is not running.');
		expect(await store.exists('.aise/checks/P4.json')).toBe(false);
	});

	it('takes the code hash before the checks, so an edit during them reads as out of date', async () => {
		await store.writeJson('.aise/design.json', DesignDoc, design());
		await put('package.json', '{}');
		await put('tsconfig.json', '{}');
		await put('src/a.ts', 'export const a = 1;');
		const before = await codeHash(store);
		const typecheck = async () => {
			await put('src/a.ts', 'export const a = 2;');
			return { ok: true, errors: [], timedOut: false };
		};
		const checks = await runCodeChecks(ctx(), { typecheck });
		expect(checks.codeHash).toBe(before);
		expect(checks.codeHash).not.toBe(await codeHash(store));
	});

	it('starts the existing app entries only after a passing typecheck', async () => {
		await store.writeJson('.aise/design.json', DesignDoc, design());
		await put('package.json', '{}');
		await put('tsconfig.json', '{}');
		await put('src/a.ts', 'export const a = 1;');
		const seen: string[][] = [];
		const start = async (_ctx: ToolContext, targets: { entry: string }[]) => {
			seen.push(targets.map((t) => t.entry));
			return { ok: true, entries: [], timedOut: false };
		};
		const pass = async () => ({ ok: true, errors: [], timedOut: false });
		const fail = async () => ({ ok: false, errors: [], timedOut: false });

		expect((await runCodeChecks(ctx(), { typecheck: pass, start })).start).toBeNull();
		await put('src/app/main.ts', 'export {};');
		expect((await runCodeChecks(ctx(), { typecheck: fail, start })).start).toBeNull();
		expect(seen).toEqual([]);
		const checks = await runCodeChecks(ctx(), { typecheck: pass, start });
		expect(checks.start).toEqual({ ok: true, entries: [], timedOut: false });
		expect(seen).toEqual([['src/app/main.ts']]);
		expect(await readChecks(store)).toEqual(checks);
	});

	it('starts the app when the only typecheck errors are under test/ (they belong to P5)', async () => {
		await store.writeJson('.aise/design.json', DesignDoc, design());
		await put('package.json', '{}');
		await put('tsconfig.json', '{}');
		await put('src/app/main.ts', 'export {};');
		const err = (file: string) => ({ file, line: 1, col: 1, message: 'TS2554' });
		const start = async () => ({ ok: true, entries: [], timedOut: false });
		const tc = (files: string[]) => async () => ({
			ok: false,
			errors: files.map(err),
			timedOut: false
		});
		const run = (files: string[]) => runCodeChecks(ctx(), { typecheck: tc(files), start });
		expect((await run(['test/a.test.ts', './test/b.test.ts'])).start).not.toBeNull();
		expect((await run(['test/a.test.ts', 'src/a.ts'])).start).toBeNull();
		expect((await run(['test/a.test.ts', ''])).start).toBeNull();
	});

	it('readChecks is null for a malformed checks file', async () => {
		for (const text of ['{not json', '{"at": 1}', '[]']) {
			await put('.aise/checks/P4.json', text);
			expect(await readChecks(store), text).toBeNull();
		}
	});

	it('designHash changes with any design edit and is null without a design', () => {
		expect(designHash(design())).toBe(designHash(design()));
		expect(designHash(design({ description: 'other words' }))).not.toBe(designHash(design()));
		expect(designHash(null)).toBeNull();
	});

	it('readChecks reads a file from before designHash with no design hash', async () => {
		await put(
			'.aise/checks/P4.json',
			JSON.stringify({
				at: '2026-11-20T10:00:00Z',
				codeHash: 'h',
				typecheck: null,
				drift: []
			})
		);
		const checks = await readChecks(store);
		expect(checks).not.toBeNull();
		expect(checks?.designHash).toBeUndefined();
	});

	it('readChecks is null before any check ran', async () => {
		expect(await readChecks(store)).toBeNull();
	});
});
