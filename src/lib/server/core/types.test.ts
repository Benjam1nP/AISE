import { describe, expect, it } from 'vitest';
import { BUILTIN_TYPES, normaliseCodeType, normaliseType } from './types';

const known = new Set(['Task', 'Booking']);
const normal = (t: string) => {
	const r = normaliseType(t, known);
	if (!r.ok) throw new Error(r.error);
	return r.normal;
};
const error = (t: string) => {
	const r = normaliseType(t, known);
	if (r.ok) throw new Error(`expected failure, got ${r.normal}`);
	return r.error;
};

describe('normaliseType', () => {
	it('accepts builtins and known classes', () => {
		expect(normal('string')).toBe('string');
		expect(normal('Task')).toBe('Task');
		expect(BUILTIN_TYPES.has('Date')).toBe(true);
	});

	it('accepts the ws WebSocket type, which a gateway holds', () => {
		expect(normal('Map<string, WebSocket>')).toBe('Map<string, WebSocket>');
	});

	it('rewrites Array<T> to T[]', () => {
		expect(normal('Array<Task>')).toBe('Task[]');
		expect(normal('Array<string | number>')).toBe('(string | number)[]');
		expect(normal('Array<Array<Task>>')).toBe('Task[][]');
	});

	it('normalises whitespace', () => {
		expect(normal('Promise< Booking >')).toBe('Promise<Booking>');
		expect(normal('Record<string, Task[]>')).toBe('Record<string, Task[]>');
		expect(normal('{ a:string;  b : Task }')).toBe('{ a: string; b: Task; }');
	});

	it('gives quote styles and unions the same normal form', () => {
		expect(normal("'open' | 'done'")).toBe(normal('"open"|"done"'));
		expect(normal("'open' | 'done'")).toBe('"open" | "done"');
	});

	it('always prints a single line and stays idempotent', () => {
		for (const t of [
			'[string, number]',
			'Promise<[string, Task]>',
			'[[string, number], Task[]]',
			'[a: string, b?: number]',
			'[...string[], number]',
			'Task extends string ? "a" : "b"',
			'(a: Task, b: string) => void',
			'{ a: string; b: { c: [number, Task] } }',
			'{ [K in "a" | "b"]?: [Task] }'
		]) {
			const once = normal(t);
			expect(once).not.toMatch(/[\r\n]/);
			expect(normal(once)).toBe(once);
		}
		expect(normal('[string,number]')).toBe('[string, number]');
	});

	it('rejects types that would print on several lines', () => {
		expect(error('`a\nb`')).toBe('multi-line types are not supported');
	});

	it('is idempotent', () => {
		for (const t of [
			'Array<Task>',
			"'a'|'b'",
			'Map<string, Array<Booking>>',
			'(a: Task) => Promise<void>',
			'{ a: string; b?: Task[] }'
		]) {
			const once = normal(t);
			expect(normal(once)).toBe(once);
		}
	});

	it('allows type parameters declared inside the type', () => {
		expect(normal('<T>(x: T) => T')).toBe('<T>(x: T) => T');
		expect(normal('{ [K in "a" | "b"]: Task }')).toBeTruthy();
	});

	it('allows qualified names only when the left-most name is known', () => {
		expect(normal('Task.Status')).toBe('Task.Status');
		expect(error('Foo.Bar')).toBe('unknown type "Foo"');
	});

	it('rejects unknown types with a case hint', () => {
		expect(error('date')).toBe('unknown type "date", did you mean "Date"?');
		expect(error('task')).toBe('unknown type "task", did you mean "Task"?');
		expect(error('Widget')).toBe('unknown type "Widget"');
		expect(error('Array<Widget>')).toBe('unknown type "Widget"');
	});

	it('rejects any, typeof and import types', () => {
		expect(error('any')).toBe('"any" is not allowed, use "unknown"');
		expect(error('Array<any>')).toContain('use "unknown"');
		expect(error('typeof foo')).toContain('not supported');
		expect(error('import("x").Y')).toContain('not supported');
	});

	it('rejects syntax errors, empty input and extra statements', () => {
		expect(error('list of Task')).toMatch(/^invalid type/);
		expect(error('')).toMatch(/^invalid type/);
		expect(error('   ')).toMatch(/^invalid type/);
		expect(error('string; type X = any')).toMatch(/^invalid type/);
		expect(error('string }')).toMatch(/^invalid type/);
	});
});

describe('normaliseCodeType', () => {
	it('allows any identifier and normalises like the design side', () => {
		expect(normaliseCodeType('Array<DatabaseSync>', known)).toBe('DatabaseSync[]');
		expect(normaliseCodeType('Express.Request | undefined', known)).toBe(
			'Express.Request | undefined'
		);
	});

	it('falls back to the text without whitespace when the type does not normalise', () => {
		expect(normaliseCodeType('typeof  x', known)).toBe('typeofx');
		expect(normaliseCodeType('a  b', known)).toBe('ab');
	});
});
