import { fail } from '@sveltejs/kit';
import { actionFail, loadFail } from '#lib/action-errors.server.ts';
import { getOrchestrator } from '#lib/server/index.ts';
import type { RequirementsDoc } from '#lib/server/core/schemas/requirements.ts';
import {
	Direction,
	NewTicketFields,
	TicketId,
	TicketKind
} from '#lib/server/core/schemas/tickets.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		return { snapshot: await getOrchestrator().snapshot(params.name) };
	} catch (e) {
		loadFail(e);
	}
};

type Phase = 'P1' | 'P2' | 'P4' | 'P5' | 'P6';
type StalePhase = 'P2' | 'P4' | 'P5' | 'P6';
const text = (data: FormData, key: string) => {
	const v = data.get(key);
	return typeof v === 'string' ? v : '';
};
const flag = (data: FormData, key: string) => data.get(key) === 'true' || data.get(key) === 'on';

/** The phase field of Still valid and Update: P2 when absent, P4, P5 and P6 allowed, anything else is null. */
function stalePhase(data: FormData): StalePhase | null {
	const v = text(data, 'phase') || 'P2';
	return v === 'P2' || v === 'P4' || v === 'P5' || v === 'P6' ? v : null;
}
const badPhase = (action: string) =>
	fail(400, { action, message: 'The phase must be P2, P4, P5 or P6.' });

/** The ticketId field: a trimmed TCK ID, or null when it is missing or malformed. */
function ticketField(data: FormData): string | null {
	const parsed = TicketId.safeParse(text(data, 'ticketId').trim());
	return parsed.success ? parsed.data : null;
}
const badTicket = (action: string) => fail(400, { action, message: 'Choose the ticket.' });

/** The optional direction of a drift plan: {} when absent, null when sent but not design or code. */
function directionField(data: FormData): { direction?: 'design' | 'code' } | null {
	const raw = data.get('direction');
	if (raw === null) return {};
	const parsed = Direction.safeParse(raw);
	return parsed.success ? { direction: parsed.data } : null;
}

/** Runs one orchestrator call; a known error becomes a failed action that names the action. */
async function perform(action: string, fn: () => Promise<unknown>) {
	try {
		await fn();
		return { ok: true as const, action };
	} catch (e) {
		return actionFail(e, { action });
	}
}

export const actions: Actions = {
	send: async ({ request, params }) => {
		const data = await request.formData();
		return perform('send', () =>
			getOrchestrator().sendMessage(params.name, text(data, 'phase') as Phase, text(data, 'text'))
		);
	},
	approve: async ({ request, params }) => {
		const data = await request.formData();
		return perform('approve', () =>
			getOrchestrator().approve(params.name, text(data, 'phase') as Phase, {
				anyway: flag(data, 'anyway'),
				override: flag(data, 'override')
			})
		);
	},
	stillValid: async ({ request, params }) => {
		const phase = stalePhase(await request.formData());
		if (phase === null) return badPhase('stillValid');
		return perform('stillValid', () => getOrchestrator().stillValid(params.name, phase));
	},
	update: async ({ request, params }) => {
		const phase = stalePhase(await request.formData());
		if (phase === null) return badPhase('update');
		return perform('update', () => getOrchestrator().updateStale(params.name, phase));
	},
	generate: ({ params }) => perform('generate', () => getOrchestrator().generateCode(params.name)),
	checkCode: ({ params }) => perform('checkCode', () => getOrchestrator().checkCode(params.name)),
	generateTests: ({ params }) =>
		perform('generateTests', () => getOrchestrator().generateTests(params.name)),
	checkTests: ({ params }) =>
		perform('checkTests', () => getOrchestrator().checkTests(params.name)),
	triageTests: ({ params }) =>
		perform('triageTests', () => getOrchestrator().triageTests(params.name)),
	fixLoop: ({ params }) => perform('fixLoop', () => getOrchestrator().fixLoop(params.name)),
	generateDeployment: ({ params }) =>
		perform('generateDeployment', () => getOrchestrator().generateDeployment(params.name)),
	checkDeploy: ({ params }) =>
		perform('checkDeploy', () => getOrchestrator().checkDeploy(params.name)),
	applyFix: async ({ request, params }) => {
		const findingId = text(await request.formData(), 'findingId').trim();
		if (!findingId) return fail(400, { action: 'applyFix', message: 'Choose the finding to fix.' });
		return perform('applyFix', () => getOrchestrator().applyFix(params.name, findingId));
	},
	discard: ({ params }) => perform('discard', () => getOrchestrator().discardLastRun(params.name)),
	editRequirements: async ({ request, params }) => {
		const raw = text(await request.formData(), 'doc');
		let doc: RequirementsDoc;
		try {
			doc = JSON.parse(raw);
		} catch {
			return fail(400, {
				action: 'editRequirements',
				message: 'The requirements are not valid JSON. Fix the syntax and save again.'
			});
		}
		return perform('editRequirements', () => getOrchestrator().editRequirements(params.name, doc));
	},
	createTicket: async ({ request, params }) => {
		const data = await request.formData();
		const kind = TicketKind.safeParse(text(data, 'kind'));
		if (!kind.success) {
			return fail(400, { action: 'createTicket', message: 'Choose the ticket kind.' });
		}
		const fields = NewTicketFields.safeParse({
			title: text(data, 'title'),
			description: text(data, 'description')
		});
		if (!fields.success) return actionFail(fields.error, { action: 'createTicket' });
		const input = { kind: kind.data, ...fields.data };
		return perform('createTicket', () => getOrchestrator().createTicket(params.name, input));
	},
	ticketSend: async ({ request, params }) => {
		const data = await request.formData();
		const ticketId = ticketField(data);
		if (ticketId === null) return badTicket('ticketSend');
		const message = text(data, 'text').trim();
		if (!message) {
			return fail(400, {
				action: 'ticketSend',
				message: 'The message is empty. Write a message and send again.'
			});
		}
		return perform('ticketSend', () =>
			getOrchestrator().sendTicketMessage(params.name, ticketId, message)
		);
	},
	approvePlan: async ({ request, params }) => {
		const data = await request.formData();
		const ticketId = ticketField(data);
		if (ticketId === null) return badTicket('approvePlan');
		const opts = directionField(data);
		if (opts === null) {
			return fail(400, { action: 'approvePlan', message: 'The direction must be design or code.' });
		}
		return perform('approvePlan', () => getOrchestrator().approvePlan(params.name, ticketId, opts));
	},
	rejectTicket: async ({ request, params }) => {
		const ticketId = ticketField(await request.formData());
		if (ticketId === null) return badTicket('rejectTicket');
		return perform('rejectTicket', () => getOrchestrator().rejectTicket(params.name, ticketId));
	},
	closeTicket: async ({ request, params }) => {
		const ticketId = ticketField(await request.formData());
		if (ticketId === null) return badTicket('closeTicket');
		return perform('closeTicket', () => getOrchestrator().closeTicket(params.name, ticketId));
	},
	openDriftTicket: ({ params }) =>
		perform('openDriftTicket', () => getOrchestrator().openDriftTicket(params.name))
};
