import { nextId } from './ids';
import { listRuns } from './runs';
import { Ticket, TicketsDoc, type TicketKind } from './schemas/tickets';
import type { ProjectStore } from './store';

export const TICKETS_PATH = '.aise/tickets.json';

/** The tickets; a file that is not valid JSON or breaks the schema throws an error naming it. */
export async function readTickets(store: ProjectStore): Promise<Ticket[]> {
	try {
		return (await store.readJson(TICKETS_PATH, TicketsDoc))?.tickets ?? [];
	} catch (e) {
		throw new Error(`${TICKETS_PATH} is invalid: ${e instanceof Error ? e.message : String(e)}`, {
			cause: e
		});
	}
}

/** Never backed up: discard restores tickets from RunMeta.prevTicket instead. */
export async function writeTickets(store: ProjectStore, tickets: Ticket[]): Promise<void> {
	await store.writeJson(TICKETS_PATH, TicketsDoc, { tickets });
}

export async function findTicket(store: ProjectStore, id: string): Promise<Ticket | null> {
	return (await readTickets(store)).find((t) => t.id === id) ?? null;
}

/** Replaces one ticket by ID; throws when it does not exist. */
export async function saveTicket(store: ProjectStore, t: Ticket): Promise<void> {
	const all = await readTickets(store);
	const i = all.findIndex((x) => x.id === t.id);
	if (i < 0) throw new Error(`Unknown ticket: ${t.id}`);
	all[i] = Ticket.parse(t);
	await writeTickets(store, all);
}

/**
 * Appends an open ticket with the next free ID. An ID a run still names is never reused, so a
 * ticket dropped after its run was created does not hand that run to the next ticket.
 */
export async function addTicket(
	store: ProjectStore,
	input: { kind: TicketKind; title: string; description: string }
): Promise<Ticket> {
	const all = await readTickets(store);
	const t = Ticket.parse({
		...input,
		id: nextId('TCK', [
			...all.map((x) => x.id),
			// An unreadable runs folder fails the triage run's start right after.
			...(await listRuns(store).catch(() => [])).flatMap((r) => (r.ticketId ? [r.ticketId] : []))
		]),
		status: 'open',
		createdAt: new Date().toISOString()
	});
	await writeTickets(store, [...all, t]);
	return t;
}

/** The ticket in progress, if any (at most one, spec rule 8). */
export const inProgress = (tickets: Ticket[]) =>
	tickets.find((t) => t.status === 'in_progress') ?? null;
