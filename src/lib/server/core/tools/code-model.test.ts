import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCodeModel, MAX_DECLS, MAX_SIGNATURE, type CodeModel, type Decl } from './code-model';

const shop = fileURLToPath(new URL('../../../../../test/fixtures/projects/shop', import.meta.url));
const tmp: string[] = [];
const mktmp = async () => {
	const d = await mkdtemp(path.join(tmpdir(), 'aise-cm-'));
	tmp.push(d);
	return d;
};
afterEach(async () => {
	await Promise.all(tmp.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('buildCodeModel', () => {
	const model = buildCodeModel(shop);
	const find = (name: string) => model.decls.find((d) => d.name === name);

	it('lists exported declarations once and no private helpers', () => {
		expect(model.decls.map((d) => `${d.file}:${d.name}`)).toEqual([
			'src/cart.ts:Cart',
			'src/cart.ts:total',
			'src/item.ts:Currency',
			'src/item.ts:Item'
		]);
		expect(find('Cart')).toMatchObject({ kind: 'class', line: 7 });
		expect(find('Currency')?.kind).toBe('enum');
		expect(find('Item')?.kind).toBe('interface');
		expect(find('total')).toMatchObject({ kind: 'function', signature: 'total(c: Cart): number' });
	});

	it('lists public members with signatures and omits private ones', () => {
		const cart = find('Cart')!;
		expect(cart.members).toEqual([
			{
				name: 'constructor',
				kind: 'constructor',
				signature: 'constructor(currency?: Currency)',
				static: false,
				visibility: 'public',
				params: [{ name: 'currency', type: 'Currency', optional: true }]
			},
			{
				name: 'currency',
				kind: 'property',
				signature: 'currency: Currency',
				static: false,
				visibility: 'public',
				type: 'Currency',
				optional: false
			},
			{
				name: 'add',
				kind: 'method',
				signature: 'add(item: Item): void',
				static: false,
				visibility: 'public',
				params: [{ name: 'item', type: 'Item', optional: false }],
				returnType: 'void'
			},
			{
				name: 'empty',
				kind: 'method',
				signature: 'empty(): Cart',
				static: true,
				visibility: 'public',
				params: [],
				returnType: 'Cart'
			},
			{
				name: 'size',
				kind: 'property',
				signature: 'size: number',
				static: false,
				visibility: 'public',
				type: 'number',
				optional: false
			}
		]);
		expect(JSON.stringify(model)).not.toContain('items');
	});

	it('keeps JSDoc tags as written', () => {
		expect(find('Cart')?.tags).toEqual(['@trace UC-2']);
		expect(find('total')?.tags).toEqual([]);
	});

	it('contains no function bodies', () => {
		const strings = (v: unknown): string[] =>
			typeof v === 'string'
				? [v]
				: v && typeof v === 'object'
					? Object.values(v).flatMap(strings)
					: [];
		const all = strings(model);
		expect(all.some((x) => x.includes('Cart'))).toBe(true);
		for (const x of all) expect(x).not.toMatch(/return|push\(|reduce|\{\s*\w+\.|;\s*\}/);
	});

	it('returns no declarations when there is no src folder', async () => {
		expect(buildCodeModel(await mktmp())).toEqual({ decls: [], routes: [] });
	});

	it('skips test files and does not follow symlinks out of the project', async () => {
		const outside = await mktmp();
		await writeFile(path.join(outside, 'secret.ts'), 'export function leaked(): void {}\n');
		const dir = await mktmp();
		await mkdir(path.join(dir, 'src'));
		await writeFile(path.join(dir, 'src/a.ts'), 'export const a = (x: number): number => x;\n');
		await writeFile(path.join(dir, 'src/a.test.ts'), 'export function fromTest(): void {}\n');
		await symlink(outside, path.join(dir, 'src/linked'));
		await symlink(path.join(outside, 'secret.ts'), path.join(dir, 'src/secret.ts'));
		const r = buildCodeModel(dir);
		expect(r.decls.map((d) => d.name)).toEqual(['a']);
		expect(r.decls[0]).toMatchObject({ kind: 'function', signature: 'a(x: number): number' });
	});
});

describe('buildCodeModel edge cases', () => {
	/** Builds a temp project from `{ 'src/a.ts': source }` and returns its model. */
	const model = async (files: Record<string, string>) => {
		const dir = await mktmp();
		for (const [rel, src] of Object.entries(files)) {
			await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
			await writeFile(path.join(dir, rel), src);
		}
		return buildCodeModel(dir);
	};
	const get = (m: CodeModel, name: string) => m.decls.find((d) => d.name === name)!;
	const names = (d: Decl) => d.members.map((x) => x.name);

	it('returns nothing when src is a symlink out of the project', async () => {
		const outside = await mktmp();
		await mkdir(path.join(outside, 'real'));
		await writeFile(path.join(outside, 'real/a.ts'), 'export function leaked(): void {}\n');
		const dir = await mktmp();
		await symlink(path.join(outside, 'real'), path.join(dir, 'src'));
		expect(buildCodeModel(dir)).toEqual({ decls: [], routes: [] });
	});

	it('does not read files outside the project to infer types, but resolves imports inside it', async () => {
		const outer = await mktmp();
		await writeFile(
			path.join(outer, 'secret.ts'),
			"export const secret = { key: 'sk-123' as const };\n"
		);
		const dir = path.join(outer, 'proj');
		await mkdir(path.join(dir, 'src'), { recursive: true });
		await writeFile(
			path.join(dir, 'src/item.ts'),
			'export type Item = { id: number };\nexport const make = (): Item => ({ id: 1 });\n'
		);
		await writeFile(
			path.join(dir, 'src/a.ts'),
			"import { secret } from '../../secret';\nimport { make } from './item';\nexport const leak = secret;\nexport const first = make();\n"
		);
		const m = buildCodeModel(dir);
		expect(JSON.stringify(m)).not.toContain('sk-123');
		expect(get(m, 'first').signature).toBe('first: Item');
	});

	it('lists exported consts with their type', async () => {
		const m = await model({
			'src/a.ts':
				"export const LIMIT: number = 3;\nexport const NAME = 'x';\nexport const inc = (n: number): number => n + 1;\n"
		});
		expect(get(m, 'LIMIT')).toMatchObject({ kind: 'const', signature: 'LIMIT: number' });
		expect(get(m, 'NAME')).toMatchObject({ kind: 'const', signature: 'NAME: "x"' });
		expect(get(m, 'inc')).toMatchObject({ kind: 'function', signature: 'inc(n: number): number' });
	});

	it('omits #private members and keeps protected ones', async () => {
		const m = await model({
			'src/a.ts':
				'export class A {\n#secret = 1;\n#hidden(): void {}\nprotected guarded(): void {}\nprivate gone = 2;\npublic open = 3;\n}\n'
		});
		const a = get(m, 'A');
		expect(names(a)).toEqual(['guarded', 'open']);
		expect(a.members[0].visibility).toBe('protected');
	});

	it('falls back to inferred types when nothing is annotated', async () => {
		const m = await model({
			'src/a.ts':
				'export class A {\n count = 0;\n add(n = 1, label = "x") { return this.count + n; }\n}\nexport function f(a = true) { return a; }\n'
		});
		const a = get(m, 'A');
		expect(a.members.map((x) => x.signature)).toEqual([
			'count: number',
			'add(n?: number, label?: string): number'
		]);
		expect(get(m, 'f').signature).toBe('f(a?: boolean): boolean');
	});

	it('lists overload signatures and not the implementation', async () => {
		const m = await model({
			'src/a.ts': `export function pick(a: string): string;
export function pick(a: number): number;
export function pick(a: string | number): string | number { return a; }
export class B {
	run(a: string): string;
	run(a: number): number;
	run(a: string | number): string | number { return a; }
}
`
		});
		expect(get(m, 'pick').signature).toBe('pick(a: string): string\npick(a: number): number');
		expect(get(m, 'B').members.map((x) => x.signature)).toEqual([
			'run(a: string): string',
			'run(a: number): number'
		]);
	});

	it('gives the declaration line and structured member details', async () => {
		const m = await model({
			'src/a.ts': `/** @trace DSN-001 */
export class Task {
	due?: Date;
	private secret = 1;
	get label(): string { return 'x'; }
	async load(id: string, force = false) { return [id]; }
	rename(title: string): void {}
}
export interface Shape {
	area(scale?: number): number;
	name: string;
}
`
		});
		const task = get(m, 'Task');
		expect(task.line).toBe(2);
		expect(get(m, 'Shape').line).toBe(9);
		const member = (n: string) => task.members.find((x) => x.name === n)!;
		expect(member('due')).toMatchObject({ type: 'Date', optional: true });
		expect(member('label')).toMatchObject({ type: 'string', optional: false });
		expect(member('load')).toMatchObject({
			params: [
				{ name: 'id', type: 'string', optional: false },
				{ name: 'force', type: 'boolean', optional: true }
			],
			returnType: 'Promise<string[]>'
		});
		expect(member('rename')).toMatchObject({
			params: [{ name: 'title', type: 'string', optional: false }],
			returnType: 'void'
		});
		expect(get(m, 'Shape').members[0]).toMatchObject({
			params: [{ name: 'scale', type: 'number', optional: true }],
			returnType: 'number'
		});
		expect(names(task)).not.toContain('secret');
	});

	it('keeps private members only when asked', async () => {
		const dir = await mktmp();
		await mkdir(path.join(dir, 'src'));
		await writeFile(path.join(dir, 'src/a.ts'), 'export class A {\n private x = 1;\n #y = 2;\n}\n');
		const withPrivate = buildCodeModel(dir, { includePrivate: true }).decls[0];
		expect(names(withPrivate)).toEqual(['x']);
		expect(withPrivate.members[0].visibility).toBe('private');
		expect(buildCodeModel(dir).decls[0].members).toEqual([]);
	});

	it('uses the declared name for default exports', async () => {
		const m = await model({
			'src/a.ts': 'export default class Greeter { hi(): void {} }\n',
			'src/b.ts': 'export default function make(): void {}\n'
		});
		expect(m.decls.map((d) => d.name)).toEqual(['Greeter', 'make']);
	});

	it('lists abstract classes with abstract members', async () => {
		const m = await model({
			'src/a.ts':
				'export abstract class Shape {\n abstract area(): number;\n describe(): string { return "s"; }\n}\n'
		});
		const s = get(m, 'Shape');
		expect(s.kind).toBe('class');
		expect(s.members.map((x) => x.signature)).toEqual(['area(): number', 'describe(): string']);
	});

	it('reports extends and implements', async () => {
		const m = await model({
			'src/a.ts': `export interface Named { name: string }
export interface Aged { [key: string]: number }
export interface Person extends Named, Aged { (x: number): string }
export class Base {}
export class Kid extends Base implements Named, Aged { name = 'k'; }
`
		});
		expect(get(m, 'Kid')).toMatchObject({ extends: 'Base', implements: ['Named', 'Aged'] });
		expect(get(m, 'Person').extends).toBe('Named, Aged');
		expect(get(m, 'Person').members.map((x) => x.signature)).toEqual(['(x: number): string']);
		expect(get(m, 'Aged').members.map((x) => x.signature)).toEqual(['[key: string]: number']);
		expect(get(m, 'Base').extends).toBeUndefined();
		expect(get(m, 'Base').implements).toBeUndefined();
	});

	it('caps the number of declarations and says so', async () => {
		const src = Array.from({ length: MAX_DECLS + 1 }, (_, i) => `export function f${i}(): void {}`);
		const m = await model({ 'src/a.ts': src.join('\n') });
		expect(m.decls).toHaveLength(MAX_DECLS);
		expect(m.truncated).toBe(true);
		expect(
			(await model({ 'src/a.ts': 'export function one(): void {}' })).truncated
		).toBeUndefined();
	});

	it('skips files with syntax errors and lists them in parseErrors', async () => {
		const m = await model({
			'src/ok.ts': 'export function ok(): void {}\n',
			'src/bad.ts': 'export function broken( {{ class\n'
		});
		expect(m.decls.map((d) => d.name)).toEqual(['ok']);
		expect(m.parseErrors).toHaveLength(1);
		expect(m.parseErrors![0].file).toBe('src/bad.ts');
		expect(m.parseErrors![0].message.length).toBeGreaterThan(0);
	});

	it('skips spec files and __tests__ and includes .mts', async () => {
		const m = await model({
			'src/a.spec.ts': 'export function spec(): void {}\n',
			'src/__tests__/b.ts': 'export function inTests(): void {}\n',
			'src/c.mts': 'export function esm(): void {}\n',
			'src/d.d.ts': 'export declare function dts(): void;\n'
		});
		expect(m.decls.map((d) => d.name)).toEqual(['esm']);
	});

	it('skips node_modules inside src', async () => {
		const m = await model({
			'src/node_modules/z/i.ts': 'export class Z {}\n',
			'src/a.ts': 'export class A {}\n'
		});
		expect(m.decls.map((d) => d.name)).toEqual(['A']);
	});

	it('caps long signatures', async () => {
		const n = Array.from({ length: 500 }, (_, i) => i);
		const m = await model({
			'src/a.ts': [
				`export const big = { ${n.map((i) => `k${i}: { a: ${i}, b: 'x' }`).join(', ')} };`,
				`export type T = { ${n.map((i) => `k${i}: number`).join('; ')} };`,
				`export class C { m(a: { ${n.map((i) => `k${i}: number`).join('; ')} }): void {} }`
			].join('\n')
		});
		const sigs = m.decls.flatMap((d) => [d.signature, ...d.members.map((x) => x.signature)]);
		const long = sigs.filter((s): s is string => !!s && s.endsWith('…'));
		expect(long).toHaveLength(3);
		for (const s of long) expect(s.length).toBe(MAX_SIGNATURE + 1);
	});
});

describe('buildCodeModel routes', () => {
	const model = async (files: Record<string, string>) => {
		const dir = await mktmp();
		for (const [rel, src] of Object.entries(files)) {
			await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
			await writeFile(path.join(dir, rel), src);
		}
		return buildCodeModel(dir);
	};

	it('lists literal route calls under src/app with method, path, file and line', async () => {
		const m = await model({
			'src/app/app.ts':
				"export function createApp(app: any) {\n\tapp.get('/tasks', (_q: any, r: any) => r.json([]));\n\treturn app;\n}\n",
			'src/app/tasks.ts':
				"export const router: any = {};\nrouter.delete('/tasks/:id', () => {});\nrouter.post(`/tasks`, () => {});\n"
		});
		expect(m.routes).toEqual([
			{ method: 'get', path: '/tasks', file: 'src/app/app.ts', line: 2 },
			{ method: 'delete', path: '/tasks/:id', file: 'src/app/tasks.ts', line: 2 },
			{ method: 'post', path: '/tasks', file: 'src/app/tasks.ts', line: 3 }
		]);
	});

	it('takes the path of a route() chain and the line of the method name', async () => {
		const m = await model({
			'src/app/app.ts':
				"declare const app: any;\nexport const x = 1;\napp\n\t.route('/tasks')\n\t.get(() => {})\n\t.post(() => {});\n"
		});
		expect(m.routes).toEqual([
			{ method: 'get', path: '/tasks', file: 'src/app/app.ts', line: 5 },
			{ method: 'post', path: '/tasks', file: 'src/app/app.ts', line: 6 }
		]);
	});

	it('ignores non literal paths, other methods, non route strings and files outside src/app', async () => {
		const m = await model({
			'src/app/a.ts':
				"declare const app: any; declare const p: string;\nexport const x = 1;\napp.get(p, () => {});\napp.get(`/t/${p}`, () => {});\napp.use('/x', () => {});\napp.get('plain-key');\n",
			'src/other.ts':
				"declare const app: any;\nexport const y = 1;\napp.get('/outside', () => {});\n"
		});
		expect(m.routes).toEqual([]);
	});
});
