import type { ProjectSnapshot } from '#lib/server/index.ts';

type Ticket = ProjectSnapshot['tickets'][number];
type Tone = 'new' | 'active' | 'pending' | 'error' | 'info' | 'default';

export const KIND_LABEL: Record<Ticket['kind'], string> = {
	change: 'Change request',
	requirement: 'New requirement',
	bug: 'Bug',
	drift: 'Drift'
};

export const STATUS_LABEL: Record<Ticket['status'], string> = {
	open: 'Open',
	triaged: 'Triaged',
	in_progress: 'In progress',
	done: 'Done',
	rejected: 'Rejected'
};

/** Orange (`new`) marks a ticket that needs the developer or the agent now. */
export const STATUS_TONE: Record<Ticket['status'], Tone> = {
	open: 'pending',
	triaged: 'new',
	in_progress: 'new',
	done: 'active',
	rejected: 'default'
};

/** Phase names as the rail shows them; an unknown phase shows its ID. */
const PHASE_NAME: Record<string, string> = {
	P1: 'Requirements',
	P2: 'Design',
	P4: 'Code',
	P5: 'Tests',
	P6: 'Deployment'
};
export const phaseName = (phase: string): string => PHASE_NAME[phase] ?? phase;

/**
 * The plain line an entry run writes to its phase chat (orchestrator approvePlan). Retry would
 * resend only this line, without the plan; the ticket's Start the entry run again resends the plan.
 */
export const ENTRY_LINE = /^Plan of TCK-\d{3,} approved\.$/;
