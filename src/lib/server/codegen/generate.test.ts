import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyUsage } from '../agents/cost';
import type { runAgent } from '../agents/loop';
import type { RunResult } from '../agents/types';
import type { CodeChecks } from '../core/code-state';
import type { DriftItem } from '../core/drift';
import { createRun } from '../core/runs';
import type { DesignClass, DesignDoc } from '../core/schemas/design';
import type { RequirementsDoc } from '../core/schemas/requirements';
import { ProjectStore } from '../core/store';
import { executeTool, type ToolContext } from '../core/tools/index';
import { generateCode, WIRING_PATH, type GenerateEvent } from './generate';

let root: string;
let ctx: ToolContext;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-generate-'));
	const store = new ProjectStore(path.join(root, 'proj'));
	await mkdir(store.dir, { recursive: true });
	const meta = await createRun(store, 'P4', 'code');
	ctx = { store, runId: meta.id, projectName: 'todo', agent: 'code' };
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const cls = (n: number, name: string): DesignClass => ({
	id: `DSN-${String(n).padStart(3, '0')}`,
	name,
	kind: 'class',
	description: '',
	attributes: [],
	methods: [],
	values: [],
	relations: [],
	reqIds: []
});

const design = (names: string[]): DesignDoc => {
	const classes = names.map((n, i) => cls(i + 1, n));
	return {
		actors: [],
		useCases: [],
		classes,
		components: classes.length
			? [
					{
						id: 'DSN-100',
						name: 'Core',
						classIds: classes.map((c) => c.id),
						nodeId: 'DSN-200',
						reqIds: []
					}
				]
			: [],
		nodes: [],
		links: [],
		sequences: []
	};
};

const reqs: RequirementsDoc = {
	requirements: [],
	openQuestions: [],
	assumptions: [],
	outOfScope: []
};

const pathOf = (name: string) => `src/core/${name}.ts`;

type Call = {
	model: string;
	maxTurns: number | undefined;
	writeOnly: string | undefined;
	brief: string;
	tools: string[];
};

/** A fake agent loop: workers (maxTurns 6) write their file through write_file, the wiring agent (40) writes main.ts. */
function fakeRun(
	opts: {
		writes?: (c: Call, n: number) => boolean;
		/** the write_file call is refused: a tool event with isError and no file */
		refuseWrites?: boolean;
		cost?: number;
		result?: Partial<RunResult>;
		delay?: number;
	} = {}
) {
	const calls: Call[] = [];
	let running = 0;
	let peak = 0;
	const perPath = new Map<string, number>();
	const run: typeof runAgent = async (o) => {
		const first = o.history[0]!.content;
		const call: Call = {
			model: o.def.model,
			maxTurns: o.maxTurns,
			writeOnly: o.ctx.writeOnly,
			brief: typeof first === 'string' ? first : '',
			tools: [...o.def.tools]
		};
		calls.push(call);
		running++;
		peak = Math.max(peak, running);
		if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
		const key = call.writeOnly ?? 'wiring';
		const n = (perPath.get(key) ?? 0) + 1;
		perPath.set(key, n);
		if (call.writeOnly === undefined) {
			await executeTool(o.ctx, 'write_file', { path: 'src/app/main.ts', content: 'export {};\n' }, [
				'write_file'
			]);
			o.onEvent({ type: 'text', text: 'wired' });
		} else if (opts.refuseWrites) {
			o.onEvent({
				type: 'tool',
				name: 'write_file',
				input: { path: call.writeOnly },
				result: 'refused',
				isError: true
			});
		} else if (opts.writes?.(call, n) ?? true) {
			const r = await executeTool(
				o.ctx,
				'write_file',
				{ path: call.writeOnly, content: `// attempt ${n}\nexport class X {}\n` },
				['write_file']
			);
			expect(r.isError).toBe(false);
			o.onEvent({
				type: 'tool',
				name: 'write_file',
				input: { path: call.writeOnly },
				result: r.content,
				isError: r.isError
			});
		}
		running--;
		return {
			status: 'done',
			text: call.writeOnly === undefined ? 'wiring text' : 'ok',
			usage: { ...emptyUsage(), input: 10 },
			costUsd: opts.cost ?? 0.01,
			turns: 1,
			...opts.result
		};
	};
	return { run, calls, peak: () => peak };
}

const clean = (over: Partial<CodeChecks> = {}): CodeChecks => ({
	at: '',
	codeHash: null,
	typecheck: { ok: true, errors: [], timedOut: false },
	drift: [],
	...over
});
const tscError = (
	file: string,
	message = "TS2322: Type 'string' is not assignable to type 'number'."
) =>
	clean({
		typecheck: { ok: false, errors: [{ file, line: 3, col: 5, message }], timedOut: false }
	});

const wiringStatuses = (events: GenerateEvent[]) =>
	events.flatMap((e) => (e.type === 'file' && e.path === WIRING_PATH ? [e.status] : []));

const generate = (
	names: string[],
	over: Partial<Parameters<typeof generateCode>[0]> & { events?: GenerateEvent[] } = {}
) => {
	const events = over.events ?? [];
	return generateCode({
		ctx,
		design: design(names),
		reqs,
		onEvent: (e) => events.push(e),
		...over
	});
};

describe('generateCode', () => {
	it('reports each worker tool call as a worker event with its file and attempt', async () => {
		const events: GenerateEvent[] = [];
		await generate(['Task'], { run: fakeRun().run, checks: async () => clean(), events });
		const workerEvents = events.filter((e) => e.type === 'worker');
		expect(workerEvents).toHaveLength(1);
		expect(workerEvents[0]).toMatchObject({
			type: 'worker',
			path: pathOf('Task'),
			attempt: 1,
			event: { type: 'tool', name: 'write_file', isError: false }
		});
	});

	it('gives the wiring call the @trace comment of the page when the design has a client component', async () => {
		const fake = fakeRun();
		const d = design(['Task']);
		d.nodes.push({ id: 'DSN-201', name: 'Browser', kind: 'client', reqIds: [] });
		d.components.push({
			id: 'DSN-101',
			name: 'Page',
			classIds: [],
			nodeId: 'DSN-201',
			reqIds: ['REQ-001']
		});
		await generate(['Task'], { design: d, run: fake.run, checks: async () => clean() });
		const wiring = fake.calls.filter((c) => c.writeOnly === undefined);
		expect(wiring[0]!.brief).toContain('<!-- @trace DSN-101 REQ-001 -->');
	});

	it('gives the wiring call the service nodes of a design with several', async () => {
		const fake = fakeRun();
		const d = design(['Task']);
		d.nodes.push(
			{ id: 'DSN-200', name: 'Api', kind: 'service', reqIds: [] },
			{ id: 'DSN-201', name: 'Live', kind: 'service', reqIds: [] }
		);
		await generate(['Task'], { design: d, run: fake.run, checks: async () => clean() });
		const wiring = fake.calls.filter((c) => c.writeOnly === undefined);
		expect(wiring[0]!.brief).toContain('Live (DSN-201): entry src/app/live.ts');
		const pkg = JSON.parse(await readFile(ctx.store.resolve('package.json'), 'utf8'));
		expect(pkg.scripts['start:live']).toBe('tsx src/app/live.ts');
	});

	it('writes three ok classes with three workers and one wiring call', async () => {
		const fake = fakeRun();
		let checks = 0;
		const events: GenerateEvent[] = [];
		const r = await generate(['Task', 'TaskList', 'User'], {
			run: fake.run,
			checks: async () => (checks++, clean()),
			events
		});
		expect(r.status).toBe('done');
		expect(r.files).toEqual({
			[pathOf('Task')]: 'ok',
			[pathOf('TaskList')]: 'ok',
			[pathOf('User')]: 'ok'
		});
		const workers = fake.calls.filter((c) => c.writeOnly !== undefined);
		expect(workers).toHaveLength(3);
		expect(workers.every((c) => c.model === 'claude-haiku-5-5' && c.maxTurns === 6)).toBe(true);
		const wiring = fake.calls.filter((c) => c.writeOnly === undefined);
		expect(wiring).toHaveLength(1);
		expect(wiring[0]).toMatchObject({ model: 'claude-sonnet-5-5', maxTurns: 40 });
		expect(wiring[0]!.brief).toMatch(/^Mode wiring/);
		expect(checks).toBe(2);
		expect(r.checked).toBe(true);
		expect(
			events.flatMap((e) => (e.type === 'file' && e.path === pathOf('Task') ? [e.status] : []))
		).toEqual(['planned', 'writing', 'checking', 'ok']);
		expect(events).toContainEqual({ type: 'wiring', event: { type: 'text', text: 'wired' } });
		expect(wiringStatuses(events)).toEqual(['planned', 'writing', 'ok']);
		expect(r.files).not.toHaveProperty(WIRING_PATH);
		expect(r.text).toBe('wiring text');
		expect(r.costUsd).toBeCloseTo(0.04);
		expect(r.usage.input).toBe(40);
		expect(r.turns).toBe(4);
		expect(await readFile(ctx.store.resolve('package.json'), 'utf8')).toContain(
			'tsx src/app/main.ts'
		);
	});

	it('runs at most 4 workers at once', async () => {
		const fake = fakeRun({ delay: 5 });
		const names = Array.from({ length: 8 }, (_, i) => `Class${i}`);
		const r = await generate(names, { run: fake.run, checks: async () => clean() });
		expect(r.status).toBe('done');
		expect(fake.calls.filter((c) => c.writeOnly !== undefined)).toHaveLength(8);
		expect(fake.peak()).toBe(4);
	});

	it('routes tsc errors by file: only the failing class is retried, with the error text and its current file', async () => {
		const fake = fakeRun();
		const events: GenerateEvent[] = [];
		let round = 0;
		const r = await generate(['Task', 'User'], {
			run: fake.run,
			checks: async () => {
				round++;
				return round <= 2 ? tscError(pathOf('Task'), 'TS2322: wrong type') : clean();
			},
			events
		});
		expect(r.status).toBe('done');
		const taskCalls = fake.calls.filter((c) => c.writeOnly === pathOf('Task'));
		expect(taskCalls.map((c) => c.model)).toEqual([
			'claude-haiku-5-5',
			'claude-haiku-5-5',
			'claude-sonnet-5-5'
		]);
		expect(taskCalls.every((c) => c.maxTurns === 6)).toBe(true);
		// the first attempt cannot read files other workers are still writing
		expect(taskCalls.map((c) => c.tools)).toEqual([
			['write_file'],
			['read_file', 'write_file'],
			['read_file', 'write_file']
		]);
		expect(taskCalls[0]!.brief).not.toContain('This is a retry');
		expect(taskCalls[1]!.brief).toContain('This is a retry');
		expect(taskCalls[1]!.brief).toContain('TS2322: wrong type');
		expect(taskCalls[1]!.brief).toContain('// attempt 1');
		expect(taskCalls[2]!.brief).toContain('// attempt 2');
		expect(fake.calls.filter((c) => c.writeOnly === pathOf('User'))).toHaveLength(1);
		expect(r.files).toEqual({ [pathOf('Task')]: 'ok', [pathOf('User')]: 'ok' });
		expect(
			events.flatMap((e) => (e.type === 'file' && e.path === pathOf('Task') ? [e.status] : []))
		).toEqual([
			'planned',
			'writing',
			'checking',
			'retrying',
			'checking',
			'escalated',
			'checking',
			'ok'
		]);
	});

	it('reports a wiring step that fails as failed, and a clean one as ok', async () => {
		const fake = fakeRun();
		const events: GenerateEvent[] = [];
		const run: typeof runAgent = (o) =>
			o.ctx.writeOnly === undefined
				? Promise.resolve({
						status: 'failed',
						reason: 'turn_limit',
						text: '',
						usage: emptyUsage(),
						costUsd: 0,
						turns: 40
					})
				: fake.run(o);
		await generate(['Task'], { run, checks: async () => clean(), events });
		expect(wiringStatuses(events)).toEqual(['planned', 'writing', 'failed']);
	});

	it('marks a file failed after attempt 3 and passes it to the wiring brief; the run is done', async () => {
		const fake = fakeRun();
		const drift: DriftItem = {
			kind: 'changed',
			id: 'DSN-001',
			name: 'Task',
			details: ['x differs']
		};
		const r = await generate(['Task', 'User'], {
			run: fake.run,
			checks: async () => clean({ drift: [drift] })
		});
		expect(r.status).toBe('done');
		expect(r.files).toEqual({ [pathOf('Task')]: 'failed', [pathOf('User')]: 'ok' });
		expect(fake.calls.filter((c) => c.writeOnly === pathOf('Task'))).toHaveLength(3);
		const wiring = fake.calls.find((c) => c.writeOnly === undefined)!;
		expect(wiring.brief).toContain(`${pathOf('Task')}: design drift (changed) Task: x differs`);
	});

	it('does not route a tsc error in src/app/main.ts or another outside file to any class file, and still wires', async () => {
		const fake = fakeRun();
		let n = 0;
		const r = await generate(['Task', 'User'], {
			run: fake.run,
			checks: async () => tscError(n++ === 0 ? 'src/app/main.ts' : 'src/other/Stray.ts')
		});
		expect(r.status).toBe('done');
		expect(r.files).toEqual({ [pathOf('Task')]: 'ok', [pathOf('User')]: 'ok' });
		expect(fake.calls.filter((c) => c.writeOnly !== undefined)).toHaveLength(2);
		expect(fake.calls.filter((c) => c.writeOnly === undefined)).toHaveLength(1);
	});

	it('routes a tsc error reported as ./src/core/Task.ts to that class file', async () => {
		const fake = fakeRun();
		let n = 0;
		const r = await generate(['Task', 'User'], {
			run: fake.run,
			checks: async () => (n++ === 0 ? tscError(`./${pathOf('Task')}`) : clean())
		});
		expect(r.status).toBe('done');
		expect(fake.calls.filter((c) => c.writeOnly === pathOf('Task'))).toHaveLength(2);
		expect(fake.calls.filter((c) => c.writeOnly === pathOf('User'))).toHaveLength(1);
	});

	it('ends failed when the typecheck timed out, not as a pass', async () => {
		const fake = fakeRun();
		let n = 0;
		const events: GenerateEvent[] = [];
		const r = await generate(['Task'], {
			run: fake.run,
			checks: async () => (n++, clean({ typecheck: { ok: false, errors: [], timedOut: true } })),
			events
		});
		expect(r.status).toBe('failed');
		expect(r.error).toBe('Typecheck timed out');
		expect(r.files[pathOf('Task')]).toBe('failed');
		expect(r.checked).toBe(true);
		expect(n).toBe(1);
		expect(fake.calls).toHaveLength(1);
	});

	it('stops above the cost limit after a round: no more workers, no wiring, failed with the limit named', async () => {
		const fake = fakeRun({ cost: 2 });
		const events: GenerateEvent[] = [];
		const r = await generate(['Task', 'User'], {
			run: fake.run,
			costLimitUsd: 3,
			checks: async () => tscError(pathOf('Task')),
			events
		});
		expect(r.status).toBe('failed');
		expect(r.error).toContain('$3.00');
		expect(fake.calls).toHaveLength(2);
		expect(fake.calls.every((c) => c.writeOnly !== undefined)).toBe(true);
		expect(r.files[pathOf('Task')]).toBe('failed');
		expect(r.files[pathOf('User')]).toBe('ok');
		expect(r.costUsd).toBe(4);
		// the wiring never ran: its row must not stay at planned
		expect(wiringStatuses(events)).toEqual(['planned', 'failed']);
		expect(r.checked).toBe(true);
	});

	it('starts no new worker once the cost limit is passed during a round', async () => {
		const fake = fakeRun({ cost: 2, delay: 5 });
		const names = Array.from({ length: 6 }, (_, i) => `Class${i}`);
		let n = 0;
		const r = await generate(names, {
			run: fake.run,
			costLimitUsd: 3,
			// like the real drift check, a class without a file is missing in code
			checks: async () => {
				n++;
				const drift: DriftItem[] = [];
				for (const [i, name] of names.entries()) {
					const exists = await readFile(ctx.store.resolve(pathOf(name))).then(
						() => true,
						() => false
					);
					if (!exists)
						drift.push({
							kind: 'missing_in_code',
							id: `DSN-${String(i + 1).padStart(3, '0')}`,
							name,
							details: []
						});
				}
				return clean({ drift });
			}
		});
		expect(r.status).toBe('failed');
		expect(r.error).toContain('$3.00');
		expect(fake.calls.filter((c) => c.writeOnly !== undefined).length).toBeLessThan(6);
		expect(fake.calls.filter((c) => c.writeOnly === undefined)).toHaveLength(0);
		expect(n).toBe(1);
		expect(Object.values(r.files).filter((s) => s === 'failed').length).toBeGreaterThan(0);
		expect(Object.values(r.files).every((s) => s === 'ok' || s === 'failed')).toBe(true);
	});

	it('ends failed with the message when the typecheck throws, and keeps the files written', async () => {
		const fake = fakeRun();
		const r = await generate(['Task'], {
			run: fake.run,
			checks: async () => {
				throw new Error('Docker is not running');
			}
		});
		expect(r.status).toBe('failed');
		expect(r.error).toBe('Docker is not running');
		expect(r.checked).toBe(false);
		expect(r.files[pathOf('Task')]).toBe('failed');
		expect(fake.calls).toHaveLength(1);
		expect(await readFile(ctx.store.resolve(pathOf('Task')), 'utf8')).toContain('attempt 1');
	});

	it('ends failed when the API fails in a worker, without further attempts', async () => {
		const fake = fakeRun({ result: { status: 'failed', reason: 'error', error: 'rate limited' } });
		let checks = 0;
		const r = await generate(['Task'], { run: fake.run, checks: async () => (checks++, clean()) });
		expect(r.status).toBe('failed');
		expect(r.error).toBe('rate limited');
		expect(fake.calls).toHaveLength(1);
		expect(r.checked).toBe(true);
		expect(checks).toBe(1);
	});

	it('counts a worker that hits its turn limit as a normal attempt', async () => {
		const fake = fakeRun({
			result: { status: 'failed', reason: 'turn_limit', error: 'turn limit (6) reached' }
		});
		const r = await generate(['Task'], { run: fake.run, checks: async () => clean() });
		expect(r.status).toBe('done');
		expect(r.files[pathOf('Task')]).toBe('ok');
	});

	it('counts a worker that writes nothing as a failed attempt, even when the checks are clean', async () => {
		const fake = fakeRun({ writes: (c, n) => c.writeOnly !== pathOf('Task') || n > 1 });
		const r = await generate(['Task', 'User'], { run: fake.run, checks: async () => clean() });
		expect(r.status).toBe('done');
		const taskCalls = fake.calls.filter((c) => c.writeOnly === pathOf('Task'));
		expect(taskCalls).toHaveLength(2);
		expect(taskCalls[1]!.brief).toContain('You did not write the file');
		expect(r.files).toEqual({ [pathOf('Task')]: 'ok', [pathOf('User')]: 'ok' });
	});

	it('does not count a refused write_file as a write', async () => {
		const fake = fakeRun({ refuseWrites: true });
		const r = await generate(['Task'], { run: fake.run, checks: async () => clean() });
		expect(r.status).toBe('done');
		const taskCalls = fake.calls.filter((c) => c.writeOnly === pathOf('Task'));
		expect(taskCalls).toHaveLength(3);
		expect(taskCalls[1]!.brief).toContain('You did not write the file');
	});

	it('recomputes the file statuses from the final checks and emits the changes', async () => {
		const fake = fakeRun();
		const events: GenerateEvent[] = [];
		let n = 0;
		const r = await generate(['Task'], {
			run: fake.run,
			// three failing rounds, then the wiring fixed the file before the final checks
			checks: async () => (n++ < 3 ? tscError(pathOf('Task')) : clean()),
			events
		});
		expect(r.status).toBe('done');
		expect(r.files[pathOf('Task')]).toBe('ok');
		const statuses = events.flatMap((e) =>
			e.type === 'file' && e.path === pathOf('Task') ? [e.status] : []
		);
		expect(statuses.slice(-2)).toEqual(['failed', 'ok']);
	});

	it('plans nothing for a design with no classes, still runs the wiring and ends done', async () => {
		const fake = fakeRun();
		const r = await generate([], { run: fake.run, checks: async () => clean() });
		expect(r.status).toBe('done');
		expect(r.files).toEqual({});
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]!.writeOnly).toBeUndefined();
	});
});
