import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRun, listRuns, readBackup, readRun, runFiles, updateRun } from './runs';
import { ProjectStore, PathError } from './store';

let root: string;
let store: ProjectStore;

const plan = {
	entry: 'P1' as const,
	affectedIds: ['REQ-001'],
	files: [],
	steps: ['Add a due date']
};

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-runs-'));
	store = new ProjectStore(path.join(root, 'proj'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('ticket fields on runs', () => {
	it('round trips ticketId and prevTicket through updateRun and listRuns', async () => {
		const run = await createRun(store, 'P7', 'maintenance');
		await updateRun(store, run.id, {
			ticketId: 'TCK-001',
			prevTicket: { status: 'triaged', plan }
		});
		const [meta] = await listRuns(store);
		expect(meta.ticketId).toBe('TCK-001');
		expect(meta.prevTicket).toEqual({ status: 'triaged', plan });
	});

	it('refuses a ticketId that is not a ticket ID', async () => {
		const run = await createRun(store, 'P7', 'maintenance');
		await expect(updateRun(store, run.id, { ticketId: 'TCK-1' })).rejects.toThrow();
	});

	it('refuses a prevTicket with a status that is not a ticket status', async () => {
		const run = await createRun(store, 'P7', 'maintenance');
		const bad = { status: 'running' } as unknown as { status: 'open' };
		await expect(updateRun(store, run.id, { prevTicket: bad })).rejects.toThrow();
	});
});

describe('readRun', () => {
	it('returns the run for its ID', async () => {
		const run = await createRun(store, 'P1', 'requirements');
		expect((await readRun(store, run.id))?.id).toBe(run.id);
	});

	it('returns null for a run ID that does not exist', async () => {
		expect(await readRun(store, '20261122-100000-P1')).toBeNull();
	});

	it('returns null for a malformed ID instead of throwing', async () => {
		expect(await readRun(store, 'nope')).toBeNull();
		expect(await readRun(store, '../../x')).toBeNull();
	});
});

describe('runFiles', () => {
	it('lists backed up files as modified and created files as created, sorted, without created.json', async () => {
		await store.writeFile('z.json', 'old');
		const run = await createRun(store, 'P2', 'design');
		await store.writeFile('z.json', 'new', run.id);
		await store.writeFile('docs/a.md', 'made', run.id);
		expect(await runFiles(store, run.id)).toEqual([
			{ path: 'docs/a.md', created: true },
			{ path: 'z.json', created: false }
		]);
	});

	it('is empty for a run that changed no file', async () => {
		const run = await createRun(store, 'P1', 'requirements');
		expect(await runFiles(store, run.id)).toEqual([]);
	});
});

describe('readBackup', () => {
	it('returns the content saved before the run first changed the file', async () => {
		await store.writeFile('b.json', 'old');
		const run = await createRun(store, 'P2', 'design');
		await store.writeFile('b.json', 'new', run.id);
		await store.writeFile('b.json', 'newer', run.id);
		expect(await readBackup(store, run.id, 'b.json')).toBe('old');
	});

	it('returns null for a file the run created', async () => {
		const run = await createRun(store, 'P2', 'design');
		await store.writeFile('docs/a.md', 'made', run.id);
		expect(await readBackup(store, run.id, 'docs/a.md')).toBeNull();
	});

	it('returns null for a file the run never touched', async () => {
		await store.writeFile('other.json', 'kept');
		const run = await createRun(store, 'P2', 'design');
		expect(await readBackup(store, run.id, 'other.json')).toBeNull();
	});

	it('never returns the created list as the backup of a root created.json', async () => {
		const run = await createRun(store, 'P2', 'design');
		await store.writeFile('x.json', 'made', run.id);
		expect(await readBackup(store, run.id, 'created.json')).toBeNull();
	});

	it('refuses a path that leaves the project', async () => {
		const run = await createRun(store, 'P2', 'design');
		await expect(readBackup(store, run.id, '../x.json')).rejects.toBeInstanceOf(PathError);
	});
});
