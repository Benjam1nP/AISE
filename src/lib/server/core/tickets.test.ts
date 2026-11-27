import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	addTicket,
	findTicket,
	inProgress,
	readTickets,
	saveTicket,
	TICKETS_PATH
} from './tickets';
import { Ticket } from './schemas/tickets';
import { ProjectStore } from './store';

let root: string;
let store: ProjectStore;

const input = { kind: 'change' as const, title: 'Rename a field', description: 'Details' };

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-tickets-'));
	store = new ProjectStore(path.join(root, 'proj'));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('ticket store', () => {
	it('reads an empty list when the project has no tickets file', async () => {
		expect(await readTickets(store)).toEqual([]);
	});

	it('names the file when it is not valid JSON or breaks the schema', async () => {
		await store.writeFile(TICKETS_PATH, '{ not json');
		await expect(readTickets(store)).rejects.toThrow(/^\.aise\/tickets\.json is invalid: /);
		await store.writeFile(TICKETS_PATH, JSON.stringify({ tickets: [{ id: 'TCK-1' }] }));
		await expect(readTickets(store)).rejects.toThrow(/^\.aise\/tickets\.json is invalid: /);
	});

	it('stores tickets under .aise/tickets.json', () => {
		expect(TICKETS_PATH).toBe('.aise/tickets.json');
	});

	it('gives the first ticket ID TCK-001 with status open', async () => {
		const t = await addTicket(store, input);
		expect(t.id).toBe('TCK-001');
		expect(t.status).toBe('open');
		expect(await readTickets(store)).toEqual([t]);
	});

	it('numbers tickets in order', async () => {
		await addTicket(store, input);
		await addTicket(store, input);
		const third = await addTicket(store, input);
		expect(third.id).toBe('TCK-003');
	});

	it('never reuses the ID of a rejected ticket', async () => {
		await addTicket(store, input);
		await addTicket(store, input);
		const third = await addTicket(store, input);
		await saveTicket(store, { ...third, status: 'rejected' });
		const next = await addTicket(store, input);
		expect(next.id).toBe('TCK-004');
	});

	it('refuses to save a ticket that does not exist', async () => {
		await addTicket(store, input);
		const ghost = { ...input, id: 'TCK-009', status: 'open' as const, createdAt: 'x' };
		await expect(saveTicket(store, ghost as Ticket)).rejects.toThrow('Unknown ticket: TCK-009');
	});

	it('refuses an empty title', async () => {
		await expect(addTicket(store, { ...input, title: '   ' })).rejects.toThrow();
		expect(await readTickets(store)).toEqual([]);
	});

	it('finds a ticket by ID', async () => {
		await addTicket(store, input);
		const second = await addTicket(store, { ...input, title: 'Second' });
		expect(await findTicket(store, 'TCK-002')).toEqual(second);
		expect(await findTicket(store, 'TCK-404')).toBeNull();
	});

	it('finds the one ticket in progress', async () => {
		const first = await addTicket(store, input);
		const second = await addTicket(store, input);
		expect(inProgress(await readTickets(store))).toBeNull();
		await saveTicket(store, { ...second, status: 'in_progress' });
		const found = inProgress(await readTickets(store));
		expect(found?.id).toBe(second.id);
		expect(found?.id).not.toBe(first.id);
	});
});
