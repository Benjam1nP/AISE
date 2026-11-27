import { z } from 'zod';
import { ID_PATTERNS } from '../ids';
import { PhaseId } from '../state';

export const TicketId = z.string().regex(ID_PATTERNS.TCK, 'must be a ticket ID such as "TCK-001"');
export const TicketKind = z.enum(['change', 'requirement', 'bug', 'drift']);
export const TicketStatus = z.enum(['open', 'triaged', 'in_progress', 'done', 'rejected']);
export const EntryPhase = z.enum(['P1', 'P2', 'P4', 'P5']);
export const Direction = z.enum(['design', 'code']);

export const TicketPlan = z.object({
	entry: EntryPhase,
	affectedIds: z.array(z.string()),
	files: z.array(z.string()),
	steps: z.array(z.string().trim().min(1)).min(1),
	direction: Direction.optional()
});

export const ReportStep = z.object({
	runId: z.string(),
	phase: PhaseId,
	agent: z.string(),
	status: z.enum(['running', 'done', 'failed', 'discarded']),
	summary: z.string().optional(),
	files: z.array(z.string())
});

export const TicketReport = z.object({
	at: z.string(),
	text: z.string(),
	steps: z.array(ReportStep),
	changedIds: z.array(z.string()),
	files: z.array(z.object({ path: z.string(), diff: z.string() })),
	tests: z
		.object({ at: z.string(), passed: z.number(), failed: z.number(), outOfDate: z.boolean() })
		.nullable()
});

/** The title and description a developer gives a ticket; the messages show in the form. */
export const TicketTitle = z
	.string()
	.trim()
	.min(1, 'Enter a title')
	.max(200, 'Keep the title under 200 characters');
export const TicketDescription = z
	.string()
	.max(20000, 'Keep the description under 20000 characters');
export const NewTicketFields = z.object({ title: TicketTitle, description: TicketDescription });

export const Ticket = z.object({
	id: TicketId,
	kind: TicketKind,
	title: TicketTitle,
	description: TicketDescription,
	status: TicketStatus,
	createdAt: z.string(),
	plan: TicketPlan.optional(),
	report: TicketReport.optional()
});
export const TicketsDoc = z.object({ tickets: z.array(Ticket) });

export type TicketKind = z.infer<typeof TicketKind>;
export type TicketStatus = z.infer<typeof TicketStatus>;
export type EntryPhase = z.infer<typeof EntryPhase>;
export type TicketPlan = z.infer<typeof TicketPlan>;
export type TicketReport = z.infer<typeof TicketReport>;
export type Ticket = z.infer<typeof Ticket>;
