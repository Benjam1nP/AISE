import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRun, restoreRun, touchedFiles } from '../runs';
import { ProjectStore } from '../store';
import { executeTool, TOOLS } from './index';
import type { ToolContext } from './registry';
import { canRead, canWrite, type AgentName } from './scope';

let root: string;
let ctx: ToolContext;
const all = Object.keys(TOOLS);
const as = (agent: AgentName) => ({ ...ctx, agent });
const call = (c: ToolContext, name: string, input: unknown) => executeTool(c, name, input, all);
const put = async (rel: string, content: string | Buffer) => {
	const abs = path.join(ctx.store.dir, rel);
	await mkdir(path.dirname(abs), { recursive: true });
	await writeFile(abs, content);
};

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-files-'));
	const store = new ProjectStore(path.join(root, 'proj'));
	const meta = await createRun(store, 'P4', 'code');
	ctx = { store, runId: meta.id, projectName: 'todo', agent: 'code' };
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('scopes', () => {
	it.each<[AgentName, string, boolean]>([
		['code', 'src/a.ts', true],
		['code', 'public/i.html', true],
		['code', 'package.json', true],
		['code', 'tsconfig.json', true],
		['code', 'test/a.test.ts', false],
		['code', 'src', false],
		['test', 'test/a.test.ts', true],
		['test', 'src/a.ts', false],
		['deploy', 'Dockerfile', true],
		['deploy', 'compose.yaml', true],
		['deploy', 'RUN.md', true],
		['deploy', 'src/a.ts', false],
		['design', 'src/a.ts', false],
		['design', 'docs/x.md', false],
		['requirements', 'package.json', false],
		['maintenance', 'src/a.ts', false],
		['mcp', 'src/a.ts', true],
		['mcp', 'test/a.test.ts', true],
		['mcp', 'Dockerfile', true],
		['mcp', 'docs/x.md', false]
	])('canWrite(%s, %s) is %s', (agent, rel, ok) => {
		expect(canWrite(agent, rel)).toBe(ok);
	});

	it.each<[AgentName, string, boolean]>([
		['test', 'src/a.ts', false],
		['test', 'src', false],
		['test', 'SRC/a.ts', false],
		['test', 'Src', false],
		['test', 'srcx/a.ts', true],
		['test', 'test/a.test.ts', true],
		['code', 'src/a.ts', true],
		['design', 'test/a.test.ts', true],
		['mcp', 'src/a.ts', true]
	])('canRead(%s, %s) is %s', (agent, rel, ok) => {
		expect(canRead(agent, rel)).toBe(ok);
	});

	it.each([
		'.aise/state.json',
		'.env',
		'src/.env.local',
		'node_modules/x/index.js',
		'../x',
		'/etc/passwd',
		'C:\\Windows\\win.ini',
		'.git/config',
		'src/.git/config',
		'.ENV',
		'src/.Env.local',
		'NODE_MODULES/x/index.js',
		'.GIT/config',
		'.AISE/state.json'
	])('no agent may read or write %s', (rel) => {
		expect(canRead('mcp', rel)).toBe(false);
		expect(canWrite('mcp', rel)).toBe(false);
	});

	it('no agent may use a path with a NUL byte or over 1024 characters', () => {
		for (const rel of ['src/a\0.ts', 'src/' + 'a'.repeat(1021)]) {
			expect(canRead('mcp', rel)).toBe(false);
			expect(canWrite('mcp', rel)).toBe(false);
		}
		expect(canWrite('mcp', 'src/' + 'a'.repeat(1020))).toBe(true);
	});

	it('the test agent is told its read scope and cannot list src/', async () => {
		await put('src/a.ts', 'export {}');
		await put('test/a.test.ts', 'test');
		await put('README.md', 'hi');
		const r = await call(as('test'), 'read_file', { path: 'src/a.ts' });
		expect(r.isError).toBe(true);
		expect(r.content).toContain('test agent');
		expect(r.content).toContain('except src/');
		const l = await call(as('test'), 'list_files', {});
		expect(JSON.parse(l.content)).toEqual(['README.md', 'test/a.test.ts']);
		expect((await call(as('test'), 'list_files', { dir: 'src' })).isError).toBe(true);
	});

	it('a write outside the scope names what the agent may write', async () => {
		const r = await call(as('deploy'), 'write_file', { path: 'src/a.ts', content: 'x' });
		expect(r.isError).toBe(true);
		expect(r.content).toContain('Dockerfile, compose.yaml, RUN.md');
		expect(await ctx.store.exists('src/a.ts')).toBe(false);
		const d = await call(as('design'), 'write_file', { path: 'src/a.ts', content: 'x' });
		expect(d.content).toContain('may not write any files');
	});
});

describe('always rejected paths', () => {
	const bad = [
		'/etc/passwd',
		'C:\\Windows\\win.ini',
		'../x',
		'src/../../x',
		'.aise/state.json',
		'.env',
		'.env.local',
		'node_modules/x/index.js',
		'.git/config',
		''
	];

	it.each(bad)('read_file and write_file reject %j for every agent', async (rel) => {
		await put('.aise/state.json', '{}');
		await put('.env', 'SECRET=1');
		for (const agent of ['code', 'test', 'deploy', 'mcp'] as const) {
			const r = await call(as(agent), 'read_file', { path: rel });
			expect(r.isError, `${agent} read ${rel}`).toBe(true);
			expect(r.content).not.toContain('SECRET');
			const w = await call(as(agent), 'write_file', { path: rel, content: 'x' });
			expect(w.isError, `${agent} write ${rel}`).toBe(true);
		}
		expect(await readFile(path.join(ctx.store.dir, '.env'), 'utf8')).toBe('SECRET=1');
	});

	it('list_files skips .aise, .env, node_modules and .git', async () => {
		for (const f of ['.aise/x.json', '.env', 'node_modules/a/i.js', '.git/HEAD', 'src/a.ts'])
			await put(f, 'x');
		const r = await call(as('mcp'), 'list_files', {});
		expect(JSON.parse(r.content)).toEqual(['src/a.ts']);
		expect((await call(as('mcp'), 'list_files', { dir: '.aise' })).isError).toBe(true);
		expect((await call(as('mcp'), 'list_files', { dir: '../' })).isError).toBe(true);
	});

	it('list_files of a subfolder gives project relative, sorted paths', async () => {
		for (const f of ['src/b.ts', 'src/a/z.ts', 'src/a.ts', 'test/t.ts']) await put(f, 'x');
		const r = await call(ctx, 'list_files', { dir: 'src' });
		expect(JSON.parse(r.content)).toEqual(['src/a.ts', 'src/a/z.ts', 'src/b.ts']);
	});

	it('list_files of a project with no files yet is empty', async () => {
		const empty = { ...ctx, store: new ProjectStore(path.join(root, 'none')) };
		expect(JSON.parse((await call(empty, 'list_files', {})).content)).toEqual([]);
	});
});

describe('symlinks', () => {
	beforeEach(async () => {
		await mkdir(path.join(root, 'outside'), { recursive: true });
		await writeFile(path.join(root, 'outside', 'secret.txt'), 'SECRET');
		await mkdir(path.join(ctx.store.dir, 'src'), { recursive: true });
		await symlink(path.join(root, 'outside'), path.join(ctx.store.dir, 'src', 'out'));
	});

	it('read and write through a link leaving the project are errors', async () => {
		const r = await call(ctx, 'read_file', { path: 'src/out/secret.txt' });
		expect(r.isError).toBe(true);
		expect(r.content).not.toContain('SECRET');
		const w = await call(ctx, 'write_file', { path: 'src/out/new.ts', content: 'x' });
		expect(w.isError).toBe(true);
		const deep = await call(ctx, 'write_file', { path: 'src/out/a/b.ts', content: 'x' });
		expect(deep.isError).toBe(true);
		expect(await ctx.store.exists('src/out/new.ts')).toBe(false);
		expect(await ctx.store.exists('src/out/a')).toBe(false);
	});

	it('a link inside the project cannot reach outside the agent scope', async () => {
		await put('src/a.ts', 'CODE');
		await put('.env', 'SECRET');
		await mkdir(path.join(ctx.store.dir, 'test'), { recursive: true });
		await symlink(path.join(ctx.store.dir, 'src', 'a.ts'), path.join(ctx.store.dir, 'test', 'a'));
		await symlink(path.join(ctx.store.dir, '.env'), path.join(ctx.store.dir, 'test', 'e'));
		const r = await call(as('test'), 'read_file', { path: 'test/a' });
		expect(r.isError).toBe(true);
		expect(r.content).not.toContain('CODE');
		const e = await call(as('mcp'), 'read_file', { path: 'test/e' });
		expect(e.isError).toBe(true);
		expect(e.content).not.toContain('SECRET');
	});
});

describe('read_file', () => {
	it('returns the path and content', async () => {
		await put('src/a.ts', 'export const a = 1;\n');
		const r = await call(ctx, 'read_file', { path: './src/a.ts' });
		expect(JSON.parse(r.content)).toEqual({ path: 'src/a.ts', content: 'export const a = 1;\n' });
	});

	it('refuses files over 200 KB', async () => {
		await put('big.txt', 'a'.repeat(300 * 1024));
		const r = await call(ctx, 'read_file', { path: 'big.txt' });
		expect(r.isError).toBe(true);
		expect(r.content).toContain('200 KB');
	});

	it('refuses binary content', async () => {
		await put('img.bin', Buffer.from([0x68, 0x00, 0x69]));
		await put('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]));
		for (const p of ['img.bin', 'latin1.txt']) {
			const r = await call(ctx, 'read_file', { path: p });
			expect(r.isError, p).toBe(true);
			expect(r.content, p).toMatch(/not UTF-8 text/);
		}
	});

	it('reports a missing file or a folder as an error result', async () => {
		await put('src/a.ts', 'x');
		expect((await call(ctx, 'read_file', { path: 'src/nope.ts' })).content).toContain('not found');
		expect((await call(ctx, 'read_file', { path: 'src' })).isError).toBe(true);
	});
});

describe('write_file', () => {
	it('creates folders, backs up under the run, and reports bytes', async () => {
		expect(await touchedFiles(ctx.store, ctx.runId)).toBe(false);
		const r = await call(ctx, 'write_file', { path: 'src/deep/a.ts', content: 'hello' });
		expect(JSON.parse(r.content)).toEqual({ ok: true, path: 'src/deep/a.ts', bytes: 5 });
		expect(await readFile(path.join(ctx.store.dir, 'src/deep/a.ts'), 'utf8')).toBe('hello');
		expect(await touchedFiles(ctx.store, ctx.runId)).toBe(true);
	});

	it('counts bytes, not characters', async () => {
		const r = await call(ctx, 'write_file', { path: 'src/a.ts', content: 'é' });
		expect(JSON.parse(r.content).bytes).toBe(2);
	});

	it('rejects package.json with dependencies outside the runner image', async () => {
		const pkg = (deps: object, dev: object = {}) =>
			JSON.stringify({ name: 'x', dependencies: deps, devDependencies: dev });
		const bad = await call(ctx, 'write_file', {
			path: 'package.json',
			content: pkg({ express: '^5', 'left-pad': '1' }, { 'is-odd': '1', vitest: '^4' })
		});
		expect(bad.isError).toBe(true);
		expect(bad.content).toMatch(/Not available: left-pad, is-odd\.$/);
		expect(await ctx.store.exists('package.json')).toBe(false);
		const ok = await call(ctx, 'write_file', {
			path: 'package.json',
			content: pkg({ express: '^5' })
		});
		expect(ok.isError).toBe(false);
	});

	it('rejects package.json that is not a JSON object', async () => {
		for (const content of ['{not json', '[]', '{"dependencies": ["left-pad"]}']) {
			const r = await call(ctx, 'write_file', { path: 'package.json', content });
			expect(r.isError, content).toBe(true);
		}
	});
});

describe('writeOnly', () => {
	const only = () => ({ ...ctx, writeOnly: 'src/tasks/Task.ts' });

	it('write_file to its own path works', async () => {
		const r = await call(only(), 'write_file', { path: 'src/tasks/Task.ts', content: 'x' });
		expect(r.isError, r.content).toBe(false);
		expect(await readFile(path.join(ctx.store.dir, 'src/tasks/Task.ts'), 'utf8')).toBe('x');
	});

	it('accepts the allowed path in another spelling and refuses a case variant', async () => {
		const ok = await call(only(), 'write_file', { path: './src/tasks/Task.ts', content: 'x' });
		expect(ok.isError, ok.content).toBe(false);
		const bad = await call(only(), 'write_file', { path: 'src/tasks/task.ts', content: 'y' });
		expect(bad.isError).toBe(true);
		expect(bad.content).toContain('src/tasks/Task.ts');
	});

	it('uses neutral wording that fits deletes too', async () => {
		const r = await call(only(), 'delete_file', { path: 'src/tasks/Other.ts' });
		expect(r.content).toContain('You may change only src/tasks/Task.ts in this task.');
	});

	it('write_file to any other path is a tool error naming the allowed path, file unchanged', async () => {
		await put('src/tasks/Other.ts', 'ORIGINAL');
		for (const p of [
			'src/tasks/Other.ts',
			'src/tasks/New.ts',
			'package.json',
			'src/tasks/Task.ts.bak'
		]) {
			const r = await call(only(), 'write_file', { path: p, content: 'CHANGED' });
			expect(r.isError, p).toBe(true);
			expect(r.content, p).toContain('src/tasks/Task.ts');
		}
		expect(await readFile(path.join(ctx.store.dir, 'src/tasks/Other.ts'), 'utf8')).toBe('ORIGINAL');
		expect(await ctx.store.exists('src/tasks/New.ts')).toBe(false);
		expect(await ctx.store.exists('package.json')).toBe(false);
	});

	it('delete_file of another path is a tool error and the file stays', async () => {
		await put('src/tasks/Other.ts', 'ORIGINAL');
		const r = await call(only(), 'delete_file', { path: 'src/tasks/Other.ts' });
		expect(r.isError).toBe(true);
		expect(r.content).toContain('src/tasks/Task.ts');
		expect(await ctx.store.exists('src/tasks/Other.ts')).toBe(true);
	});
});

describe('delete_file', () => {
	it('deletes the file and restoreRun brings it back', async () => {
		await put('src/a.ts', 'KEEP ME');
		const r = await call(ctx, 'delete_file', { path: 'src/a.ts' });
		expect(JSON.parse(r.content)).toEqual({ ok: true, path: 'src/a.ts' });
		expect(await ctx.store.exists('src/a.ts')).toBe(false);
		expect(await touchedFiles(ctx.store, ctx.runId)).toBe(true);
		await restoreRun(ctx.store, ctx.runId);
		expect(await readFile(path.join(ctx.store.dir, 'src/a.ts'), 'utf8')).toBe('KEEP ME');
	});

	it('refuses a missing file and a folder', async () => {
		await put('src/dir/a.ts', 'x');
		const missing = await call(ctx, 'delete_file', { path: 'src/nope.ts' });
		expect(missing.isError).toBe(true);
		expect(missing.content).toContain('not found');
		const folder = await call(ctx, 'delete_file', { path: 'src/dir' });
		expect(folder.isError).toBe(true);
		expect(folder.content).toContain('folder');
		expect(await ctx.store.exists('src/dir/a.ts')).toBe(true);
	});

	it('follows the write scope of the agent', async () => {
		await put('test/a.test.ts', 'x');
		await put('.env', 'SECRET');
		const r = await call(ctx, 'delete_file', { path: 'test/a.test.ts' });
		expect(r.isError).toBe(true);
		expect((await call(as('mcp'), 'delete_file', { path: '.env' })).isError).toBe(true);
		expect(await ctx.store.exists('test/a.test.ts')).toBe(true);
		expect(await ctx.store.exists('.env')).toBe(true);
	});
});

describe('escapes and file system errors', () => {
	it('a backslash path cannot skip the symlink check', async () => {
		await mkdir(path.join(root, 'outside'));
		await mkdir(path.join(ctx.store.dir, 'src'), { recursive: true });
		await symlink(path.join(root, 'outside'), path.join(ctx.store.dir, 'src', 'out'));
		await writeFile(path.join(root, 'outside', 'secret.ts'), 'SECRET');
		const w = await call(ctx, 'write_file', { path: 'src\\out\\pwn.ts', content: 'x' });
		expect(w.isError).toBe(true);
		const r = await call(ctx, 'read_file', { path: 'src\\out\\secret.ts' });
		expect(r.isError).toBe(true);
		expect(r.content).not.toContain('SECRET');
		const l = await call(ctx, 'list_files', { dir: 'src\\out' });
		expect(l.isError).toBe(true);
		await expect(readFile(path.join(root, 'outside', 'pwn.ts'))).rejects.toThrow();
	});

	it('maps ENOTDIR, ELOOP and ENAMETOOLONG to error results', async () => {
		await put('src/a.ts', 'x');
		await symlink('b', path.join(ctx.store.dir, 'src', 'loop-a'));
		await symlink('loop-a', path.join(ctx.store.dir, 'src', 'b'));
		const long = 'src/' + 'a'.repeat(300) + '.ts';
		for (const p of ['src/a.ts/x', 'src/loop-a', 'src/loop-a/x', long]) {
			const r = await call(ctx, 'read_file', { path: p });
			expect(r.isError, `read ${p}`).toBe(true);
			const w = await call(ctx, 'write_file', { path: p, content: 'x' });
			expect(w.isError, `write ${p}`).toBe(true);
		}
		expect((await call(ctx, 'list_files', { dir: 'src/loop-a' })).isError).toBe(true);
	});

	it('writing onto an existing folder is an error result', async () => {
		await put('src/dir/a.ts', 'x');
		const r = await call(ctx, 'write_file', { path: 'src/dir', content: 'x' });
		expect(r.isError).toBe(true);
		expect(r.content).toContain('folder');
	});

	it('the project root is reported as a folder', async () => {
		await put('a.txt', 'x');
		for (const p of ['.', './']) {
			const r = await call(ctx, 'read_file', { path: p });
			expect(r.isError).toBe(true);
			expect(r.content).toContain('folder');
			expect(r.content).not.toContain('leaves');
		}
	});

	it('read_file refuses hard links', async () => {
		await mkdir(path.join(root, 'outside'));
		await writeFile(path.join(root, 'outside', 'secret.txt'), 'SECRET');
		await mkdir(path.join(ctx.store.dir, 'src'), { recursive: true });
		await link(path.join(root, 'outside', 'secret.txt'), path.join(ctx.store.dir, 'src', 'h.txt'));
		const r = await call(ctx, 'read_file', { path: 'src/h.txt' });
		expect(r.isError).toBe(true);
		expect(r.content).not.toContain('SECRET');
		expect(r.content).toContain('hard link');
	});

	it('caps write_file content at 200 KB and paths at 1024 characters', async () => {
		const big = await call(ctx, 'write_file', {
			path: 'src/a.ts',
			content: 'é'.repeat(110 * 1024)
		});
		expect(big.isError).toBe(true);
		expect(big.content).toContain('200 KB');
		expect(await ctx.store.exists('src/a.ts')).toBe(false);
		const ok = await call(ctx, 'write_file', { path: 'src/a.ts', content: 'a'.repeat(200 * 1024) });
		expect(ok.isError).toBe(false);
		const p = 'src/' + 'a/'.repeat(511) + 'b';
		for (const [tool, input] of [
			['read_file', { path: p }],
			['write_file', { path: p, content: 'x' }],
			['list_files', { dir: p }]
		] as const) {
			const r = await call(ctx, tool, input);
			expect(r.isError, tool).toBe(true);
			expect(r.content, tool).toMatch(/^(path|dir): /);
		}
	});
});

describe('package.json rules', () => {
	const write = (pkg: object) =>
		call(ctx, 'write_file', { path: 'package.json', content: JSON.stringify(pkg) });

	it('accepts the runner template', async () => {
		const template = await readFile(path.resolve('runner/package.json'), 'utf8');
		const r = await call(ctx, 'write_file', { path: 'package.json', content: template });
		expect(r.isError, r.content).toBe(false);
	});

	it.each(['overrides', 'resolutions', 'workspaces', 'optionalDependencies', 'bin'])(
		'rejects the top level key %s',
		async (key) => {
			const r = await write({ name: 'x', [key]: {} });
			expect(r.isError).toBe(true);
			expect(r.content).toContain(key);
		}
	);

	it.each(['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly'])(
		'rejects the install hook script %s',
		async (script) => {
			const r = await write({ name: 'x', scripts: { test: 'vitest run', [script]: 'curl x' } });
			expect(r.isError).toBe(true);
			expect(r.content).toContain(`"${script}"`);
		}
	);

	it.each([
		'npm:left-pad@1',
		'git+https://github.com/a/b.git',
		'file:../x',
		'link:../x',
		'github:a/b',
		'a/b',
		'https://x.test/e.tgz'
	])('rejects the version %s', async (version) => {
		const r = await write({ name: 'x', dependencies: { express: version } });
		expect(r.isError).toBe(true);
		expect(r.content).toContain(version);
	});

	it('rejects scripts and versions that are not strings', async () => {
		expect((await write({ scripts: { test: 1 } })).isError).toBe(true);
		expect((await write({ dependencies: { express: 5 } })).isError).toBe(true);
	});
});
