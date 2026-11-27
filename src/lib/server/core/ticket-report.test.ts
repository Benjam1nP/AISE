import { readFileSync } from 'node:fs';
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeHash } from './code-state';
import { createRun, updateRun } from './runs';
import type { PhaseId } from './state';
import { ProjectStore } from './store';
import { reportData } from './ticket-report';
import { testHash, writeTestChecks, type TestChecks } from './test-state';

const fixture = (name: string): string =>
	readFileSync(new URL(`../../../../test/fixtures/${name}`, import.meta.url), 'utf8');

let root: string;
let store: ProjectStore;
let clock: number;

/** A run of the ticket that starts after every earlier one; `agent` and `phase` default to a code run. */
async function run(
	files: Record<string, string | null>,
	over: {
		ticketId?: string;
		phase?: PhaseId;
		agent?: string;
		status?: 'done' | 'discarded' | 'failed' | 'running';
	} = {}
) {
	const meta = await createRun(store, over.phase ?? 'P4', over.agent ?? 'code');
	clock += 1000;
	await updateRun(store, meta.id, {
		ticketId: over.ticketId ?? 'TCK-001',
		startedAt: new Date(clock).toISOString(),
		status: over.status ?? 'done',
		summary: `summary of ${meta.id}`
	});
	for (const [rel, content] of Object.entries(files))
		if (content === null) await store.deleteFile(rel, meta.id);
		else await store.writeFile(rel, content, meta.id);
	return meta.id;
}

const edit = (file: string, f: (doc: Record<string, unknown>) => void) => {
	const doc = JSON.parse(fixture(file));
	f(doc);
	return JSON.stringify(doc, null, 2);
};
const changedLines = (diff: string, sign: '+' | '-') =>
	diff.split('\n').filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3)));

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-ticket-report-'));
	store = new ProjectStore(path.join(root, 'proj'));
	clock = Date.parse('2026-11-22T10:00:00.000Z');
	await store.writeFile('.aise/requirements.json', fixture('todo-requirements.json'));
	await store.writeFile('.aise/design.json', fixture('todo-design.json'));
	await store.writeFile('src/a.ts', 'v0\n');
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('reportData steps', () => {
	it('lists the runs of the ticket by start with the files each touched, without .aise files', async () => {
		// created in the opposite order of their start, so only the start can put them right
		const late = await run({ 'src/b.ts': 'b\n', '.aise/design.json': '{}' }, { phase: 'P4' });
		const early = await createRun(store, 'P2', 'design');
		await updateRun(store, early.id, {
			ticketId: 'TCK-001',
			status: 'done',
			startedAt: '2026-11-22T09:00:00.000Z'
		});
		await store.writeFile('src/a.ts', 'v1\n', early.id);
		const { steps, files } = await reportData(store, 'TCK-001');
		expect(steps.map((s) => s.runId)).toEqual([early.id, late]);
		expect(steps[0]).toMatchObject({
			phase: 'P2',
			agent: 'design',
			status: 'done',
			files: ['src/a.ts']
		});
		expect(steps[1].files).toEqual(['src/b.ts']);
		expect(steps[1].summary).toBe(`summary of ${late}`);
		expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
	});

	it('leaves out discarded runs, maintenance runs of phase P7 and runs of other tickets', async () => {
		const kept = await run({ 'src/a.ts': 'v1\n' });
		await run({ 'src/discarded.ts': 'x\n' }, { status: 'discarded' });
		await run({ 'src/triage.ts': 'x\n' }, { phase: 'P7', agent: 'maintenance' });
		await run({ 'src/other.ts': 'x\n' }, { ticketId: 'TCK-002' });
		const r = await reportData(store, 'TCK-001');
		expect(r.steps.map((s) => s.runId)).toEqual([kept]);
		expect(r.files.map((f) => f.path)).toEqual(['src/a.ts']);
	});

	it('keeps a P7 run of another agent and a maintenance run of another phase', async () => {
		const a = await run({ 'src/x.ts': 'x\n' }, { phase: 'P7', agent: 'code' });
		const b = await run({ 'src/y.ts': 'y\n' }, { phase: 'P4', agent: 'maintenance' });
		expect((await reportData(store, 'TCK-001')).steps.map((s) => s.runId)).toEqual([a, b]);
	});

	it('is empty for a ticket without runs', async () => {
		expect(await reportData(store, 'TCK-009')).toMatchObject({
			steps: [],
			files: [],
			changedIds: []
		});
	});
});

describe('reportData step status', () => {
	it('keeps failed and running runs as steps with their status and files', async () => {
		const failed = await run({ 'src/a.ts': 'v1\n' }, { status: 'failed' });
		const running = await run({ 'src/b.ts': 'b\n' }, { status: 'running' });
		const { steps, files } = await reportData(store, 'TCK-001');
		expect(steps.map((s) => [s.runId, s.status, s.files])).toEqual([
			[failed, 'failed', ['src/a.ts']],
			[running, 'running', ['src/b.ts']]
		]);
		expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
	});
});

describe('reportData file diffs', () => {
	it('diffs a file that two runs changed once, from the first backup to the current content', async () => {
		await run({ 'src/a.ts': 'v1\n' });
		await run({ 'src/a.ts': 'v2\n' });
		const { files } = await reportData(store, 'TCK-001');
		expect(files).toHaveLength(1);
		expect(files[0].path).toBe('src/a.ts');
		expect(changedLines(files[0].diff, '-')).toEqual(['-v0']);
		expect(changedLines(files[0].diff, '+')).toEqual(['+v2']);
	});

	it('diffs a created file from empty', async () => {
		await run({ 'src/new.ts': 'hello\n' });
		const { files } = await reportData(store, 'TCK-001');
		expect(changedLines(files[0].diff, '+')).toEqual(['+hello']);
		expect(changedLines(files[0].diff, '-')).toEqual([]);
	});

	it('diffs a deleted file to empty', async () => {
		await run({ 'src/a.ts': null });
		const { files } = await reportData(store, 'TCK-001');
		expect(changedLines(files[0].diff, '-')).toEqual(['-v0']);
		expect(changedLines(files[0].diff, '+')).toEqual([]);
	});

	it('diffs a file created by the first run and changed by the second from empty', async () => {
		await run({ 'src/new.ts': 'one\n' });
		await run({ 'src/new.ts': 'two\n' });
		const { files } = await reportData(store, 'TCK-001');
		expect(changedLines(files[0].diff, '-')).toEqual([]);
		expect(changedLines(files[0].diff, '+')).toEqual(['+two']);
	});

	it('lists a file that run 1 created and run 2 deleted with an empty diff', async () => {
		await run({ 'src/tmp.ts': 'tmp\n' });
		await run({ 'src/tmp.ts': null });
		expect((await reportData(store, 'TCK-001')).files).toEqual([{ path: 'src/tmp.ts', diff: '' }]);
	});

	it('compares with the earliest backup: a file the second run restored has no diff', async () => {
		await run({ 'src/a.ts': 'v1\n' });
		await run({ 'src/a.ts': 'v0\n' });
		expect((await reportData(store, 'TCK-001')).files).toEqual([{ path: 'src/a.ts', diff: '' }]);
	});

	it('sorts the files by path', async () => {
		await run({ 'src/z.ts': 'z\n', 'src/b.ts': 'b\n' });
		await run({ 'src/m.ts': 'm\n' });
		expect((await reportData(store, 'TCK-001')).files.map((f) => f.path)).toEqual([
			'src/b.ts',
			'src/m.ts',
			'src/z.ts'
		]);
	});

	it('caps a diff at 400 lines and says how many were left out', async () => {
		const long = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n') + '\n';
		await run({ 'src/long.ts': long });
		const { diff } = (await reportData(store, 'TCK-001')).files[0];
		const lines = diff.split('\n');
		expect(lines).toHaveLength(401);
		expect(lines[399]).toBe('+line 394');
		expect(lines[400]).toBe('... (605 more lines)');
	});

	it('keeps a diff of exactly 400 lines whole', async () => {
		// 5 header lines (Index, ===, ---, +++, @@) plus 395 added lines
		const text = Array.from({ length: 395 }, (_, i) => `line ${i}`).join('\n') + '\n';
		await run({ 'src/fit.ts': text });
		const { diff } = (await reportData(store, 'TCK-001')).files[0];
		expect(diff).not.toContain('more lines');
		expect(changedLines(diff, '+')).toHaveLength(395);
	});
});

describe('reportData size caps', () => {
	it('cuts a diff at 40000 characters and says so', async () => {
		// 100 lines of 600 characters: under the line cap, over the character cap
		const text = Array.from({ length: 100 }, (_, i) => `${i} ${'x'.repeat(600)}`).join('\n') + '\n';
		await run({ 'src/wide.ts': text });
		const { diff } = (await reportData(store, 'TCK-001')).files[0];
		expect(diff.endsWith('\n... (truncated)')).toBe(true);
		expect(diff.length).toBe(40000 + '\n... (truncated)'.length);
	});

	it('does not cut a diff of exactly 40000 characters', async () => {
		// the patch for one added line is 5 header lines, the line itself and one newline; measure then pad
		const probe = await (async () => {
			await run({ 'src/pad.ts': 'x\n' });
			return (await reportData(store, 'TCK-001')).files[0].diff.length;
		})();
		await rm(store.resolve('src/pad.ts'));
		await rm(store.resolve('.aise/runs'), { recursive: true });
		await run({ 'src/pad.ts': 'x'.repeat(1 + 40000 - probe) + '\n' });
		const { diff } = (await reportData(store, 'TCK-001')).files[0];
		expect(diff.length).toBe(40000);
		expect(diff).not.toContain('truncated');
	});

	it('does not diff a file over 1 MB and says so', async () => {
		await run({ 'src/big.ts': 'a'.repeat(1024 * 1024 + 1) + '\n' });
		await run({ 'src/small.ts': 'small\n' });
		const { files } = await reportData(store, 'TCK-001');
		expect(files).toEqual([
			{ path: 'src/big.ts', diff: '... (too large to diff)' },
			expect.objectContaining({ path: 'src/small.ts' })
		]);
	});

	it('does not diff a file over 1 MB before the change either', async () => {
		await store.writeFile('src/big.ts', 'a'.repeat(1024 * 1024 + 1) + '\n');
		await run({ 'src/big.ts': 'small\n' });
		expect((await reportData(store, 'TCK-001')).files).toEqual([
			{ path: 'src/big.ts', diff: '... (too large to diff)' }
		]);
	});

	it('diffs a file of exactly 1 MB before the change', async () => {
		await store.writeFile('src/ok.ts', 'a'.repeat(1024 * 1024 - 1) + '\n');
		await run({ 'src/ok.ts': 'small\n' });
		expect((await reportData(store, 'TCK-001')).files[0].diff).toContain('src/ok.ts');
		expect((await reportData(store, 'TCK-001')).files[0].diff).not.toContain('too large');
	});

	it('diffs a file of exactly 1 MB', async () => {
		await run({ 'src/ok.ts': 'a'.repeat(1024 * 1024 - 1) + '\n' });
		expect((await reportData(store, 'TCK-001')).files[0].diff).not.toContain('too large');
	});
});

describe('reportData files that must not be listed', () => {
	it.each(['.env', '.env.local', '.git/config', 'node_modules/x/index.js'])(
		'leaves out %s',
		async (rel) => {
			await run({ 'src/a.ts': 'v1\n', [rel]: 'SECRET=1\n' });
			const r = await reportData(store, 'TCK-001');
			expect(r.files.map((f) => f.path)).toEqual(['src/a.ts']);
			expect(r.steps[0].files).toEqual(['src/a.ts']);
			expect(JSON.stringify(r)).not.toContain('SECRET');
		}
	);
});

describe('reportData files that are no longer plain files', () => {
	it('does not read through a folder that became a link', async () => {
		await run({ 'src/a.ts': 'v1\n' });
		await mkdir(path.join(root, 'outside'));
		await writeFile(path.join(root, 'outside', 'a.ts'), 'TOP SECRET\n');
		await rm(store.resolve('src'), { recursive: true });
		await symlink(path.join(root, 'outside'), store.resolve('src'));
		const { files } = await reportData(store, 'TCK-001');
		expect(JSON.stringify(files)).not.toContain('TOP SECRET');
		expect(changedLines(files[0].diff, '-')).toEqual(['-v0']);
	});

	it('does not read through a folder that became a link to another project folder', async () => {
		await run({ 'src/a.ts': 'v1\n' });
		await store.writeFile('lib/a.ts', 'OTHER FILE\n');
		await rm(store.resolve('src'), { recursive: true });
		await symlink(store.resolve('lib'), store.resolve('src'));
		const { files } = await reportData(store, 'TCK-001');
		expect(JSON.stringify(files)).not.toContain('OTHER FILE');
	});

	it('reads a folder that replaced the file as deleted', async () => {
		await run({ 'src/a.ts': 'v1\n' });
		await rm(store.resolve('src/a.ts'));
		await mkdir(store.resolve('src/a.ts'));
		const { files } = await reportData(store, 'TCK-001');
		expect(changedLines(files[0].diff, '-')).toEqual(['-v0']);
		expect(changedLines(files[0].diff, '+')).toEqual([]);
	});

	it('does not read a hard link that replaced the file', async () => {
		await run({ 'src/a.ts': 'v1\n' });
		await writeFile(path.join(root, 'secret.txt'), 'TOP SECRET\n');
		await rm(store.resolve('src/a.ts'));
		await link(path.join(root, 'secret.txt'), store.resolve('src/a.ts'));
		const { files } = await reportData(store, 'TCK-001');
		expect(JSON.stringify(files)).not.toContain('TOP SECRET');
	});

	it('does not read through a link that replaced the file', async () => {
		await run({ 'src/a.ts': 'v1\n' });
		await writeFile(path.join(root, 'secret.txt'), 'TOP SECRET\n');
		await rm(store.resolve('src/a.ts'));
		await symlink(path.join(root, 'secret.txt'), store.resolve('src/a.ts'));
		const { files } = await reportData(store, 'TCK-001');
		expect(JSON.stringify(files)).not.toContain('TOP SECRET');
		expect(changedLines(files[0].diff, '-')).toEqual(['-v0']);
	});
});

describe('reportData changed IDs', () => {
	it('names the requirements whose text a step changed', async () => {
		await run({
			'.aise/requirements.json': edit('todo-requirements.json', (d) => {
				const reqs = d.requirements as { id: string; text: string }[];
				reqs.find((r) => r.id === 'REQ-002')!.text = 'The system shall show tasks, oldest first.';
			})
		});
		expect((await reportData(store, 'TCK-001')).changedIds).toEqual(['REQ-002']);
	});

	it('compares with the earliest backup, so a change a later step touched again still counts', async () => {
		const bump = (text: string) =>
			edit('todo-requirements.json', (d) => {
				(d.requirements as { id: string; text: string }[]).find((r) => r.id === 'REQ-002')!.text =
					text;
			});
		await run({ '.aise/requirements.json': bump('first') });
		await run({ '.aise/requirements.json': bump('second') });
		expect((await reportData(store, 'TCK-001')).changedIds).toEqual(['REQ-002']);
	});

	it('names changed, added and removed design elements, use cases and sequences, sorted and once', async () => {
		await run({
			'.aise/design.json': edit('todo-design.json', (d) => {
				const classes = d.classes as { id: string; name: string }[];
				classes.find((c) => c.id === 'DSN-001')!.name = 'Renamed';
				const nodes = d.nodes as { id: string; name: string; kind: string; reqIds: string[] }[];
				nodes.push({ id: 'DSN-009', name: 'Worker', kind: 'service', reqIds: [] });
				(d.useCases as { id: string; name: string }[]).find((u) => u.id === 'UC-002')!.name = 'X';
				d.sequences = (d.sequences as { id: string }[]).filter((s) => s.id !== 'SEQ-001');
			})
		});
		await run({ '.aise/design.json': (await store.readText('.aise/design.json'))! });
		expect((await reportData(store, 'TCK-001')).changedIds).toEqual([
			'DSN-001',
			'DSN-009',
			'SEQ-001',
			'UC-002'
		]);
	});

	it.each([
		['an actor name', 'actors', 'ACT-001', 'name'],
		['an actor description', 'actors', 'ACT-002', 'description'],
		['a use case description', 'useCases', 'UC-001', 'description'],
		['a class description', 'classes', 'DSN-001', 'description'],
		['a component name', 'components', 'DSN-006', 'name'],
		['a node name', 'nodes', 'DSN-008', 'name']
	])('names the element whose %s a step changed', async (_what, list, id, field) => {
		await run({
			'.aise/design.json': edit('todo-design.json', (d) => {
				const el = (d[list] as Record<string, unknown>[]).find((e) => e.id === id)!;
				el[field] = 'Something else entirely';
			})
		});
		expect((await reportData(store, 'TCK-001')).changedIds).toEqual([id]);
	});

	it('names a node whose link a step changed', async () => {
		const withLink = (protocol: string) =>
			edit('todo-design.json', (d) => {
				d.nodes = [
					...(d.nodes as object[]),
					{ id: 'DSN-009', name: 'Browser', kind: 'client', reqIds: [] }
				];
				d.links = [{ from: 'DSN-009', to: 'DSN-008', protocol }];
			});
		await store.writeFile('.aise/design.json', withLink('http'));
		await run({ '.aise/design.json': withLink('https') });
		expect((await reportData(store, 'TCK-001')).changedIds).toEqual(['DSN-008', 'DSN-009']);
	});

	it('merges requirement and design IDs in one sorted list', async () => {
		await run({
			'.aise/requirements.json': edit('todo-requirements.json', (d) => {
				(d.requirements as { id: string; text: string }[])[0].text = 'changed';
			}),
			'.aise/design.json': edit('todo-design.json', (d) => {
				(d.classes as { name: string }[])[0].name = 'Renamed';
			})
		});
		expect((await reportData(store, 'TCK-001')).changedIds).toEqual(['DSN-001', 'REQ-001']);
	});

	it('is empty when no step touched the artefacts, even if they changed after', async () => {
		await run({ 'src/a.ts': 'v1\n' });
		await store.writeFile('.aise/requirements.json', '{"requirements":[]}');
		expect((await reportData(store, 'TCK-001')).changedIds).toEqual([]);
	});

	it('treats an artefact the step created as having had no IDs', async () => {
		await rm(store.resolve('.aise/design.json'));
		await run({ '.aise/design.json': fixture('todo-design.json') });
		const ids = (await reportData(store, 'TCK-001')).changedIds;
		expect(ids).toContain('DSN-001');
		expect(ids).toContain('UC-001');
		expect(ids).not.toContain('REQ-001');
	});

	it('does not throw when the artefact backup is not valid JSON', async () => {
		await store.writeFile('.aise/requirements.json', 'not json');
		await run({ '.aise/requirements.json': fixture('todo-requirements.json') });
		expect((await reportData(store, 'TCK-001')).changedIds).toContain('REQ-001');
	});
});

describe('reportData tests', () => {
	const checks = async (over: Partial<TestChecks> = {}) =>
		writeTestChecks(store, {
			at: '2026-11-22T11:00:00.000Z',
			codeHash: await codeHash(store),
			testHash: await testHash(store),
			typecheck: null,
			result: {
				ok: false,
				passed: 7,
				failed: 2,
				tests: [],
				timedOut: false,
				logTail: ''
			},
			findings: [],
			testFixes: [],
			...over
		});

	it('is null without checks', async () => {
		expect((await reportData(store, 'TCK-001')).tests).toBeNull();
	});

	it('is null when the checks hold no test result', async () => {
		await checks({ result: null });
		expect((await reportData(store, 'TCK-001')).tests).toBeNull();
	});

	it('gives the counts and whether code or tests changed since', async () => {
		await checks();
		expect((await reportData(store, 'TCK-001')).tests).toEqual({
			at: '2026-11-22T11:00:00.000Z',
			passed: 7,
			failed: 2,
			outOfDate: false
		});
		await store.writeFile('src/a.ts', 'changed\n');
		expect((await reportData(store, 'TCK-001')).tests?.outOfDate).toBe(true);
		await store.writeFile('src/a.ts', 'v0\n');
		await store.writeFile('test/a.test.ts', 'x\n');
		expect((await reportData(store, 'TCK-001')).tests?.outOfDate).toBe(true);
	});
});
