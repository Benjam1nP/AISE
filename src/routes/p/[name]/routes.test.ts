import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actionFail } from '#lib/action-errors.server.ts';
import { ConflictError, getOrchestrator, NotFoundError } from '#lib/server/index.ts';
import { PathError } from '#lib/server/core/store.ts';
import { publish } from '../../../lib/server/orchestrator/bus';
import * as homePage from '../../+page.server';
import * as projectPage from './+page.server';
import { GET } from './events/+server';
import { GET as getFile } from './file/+server';

const g = globalThis as typeof globalThis & {
	__aiseOrchestrator?: unknown;
	__aiseListeners?: Map<string, Set<unknown>>;
};
let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-routes-'));
	vi.stubEnv('AISE_PROJECTS_DIR', root);
	delete g.__aiseOrchestrator;
	await getOrchestrator().createProject('demo');
});

afterEach(async () => {
	vi.useRealTimers();
	delete g.__aiseOrchestrator;
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

const post = (fields: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return new Request('http://localhost/x', { method: 'POST', body });
};
// The handlers only read these parts of the event.
const call = (fn: unknown, fields: Record<string, string>, name = 'demo') =>
	(fn as (e: unknown) => Promise<unknown>)({ request: post(fields), params: { name } }) as Promise<{
		status?: number;
		data?: { message: string; action?: string };
		ok?: boolean;
	}>;
const failure = (r: Awaited<ReturnType<typeof call>>) => ({ status: r.status, ...r.data });

describe('actionFail', () => {
	it('maps conflicts to 409, bad input to 400, unknown projects to 404', () => {
		expect(actionFail(new ConflictError('A run is already active')).status).toBe(409);
		expect(actionFail(new PathError('Not a valid project name: X')).status).toBe(400);
		expect(actionFail(new NotFoundError('No project named "x"')).status).toBe(404);
	});

	it('says in plain words what to do', () => {
		const r = actionFail(new ConflictError('A run is already active', 'run_active'), {
			action: 'send'
		});
		expect(r.data).toEqual({
			action: 'send',
			message: 'The agent is still working on this project. Wait for it to finish, then try again.'
		});
		expect(actionFail(new ConflictError('P1 gate failed: No open questions')).data.message).toBe(
			'P1 gate failed: No open questions.'
		);
	});

	it('does not add a second full stop to a Docker message that already ends with one', () => {
		expect(
			actionFail(new ConflictError('Docker is not running. Start Docker Desktop and retry.')).data
				.message
		).toBe('Docker is not running. Start Docker Desktop and retry.');
	});

	it('names the field of a zod error', async () => {
		const { RequirementsDoc } = await import('../../../lib/server/core/schemas/requirements');
		const parsed = RequirementsDoc.safeParse({});
		expect(parsed.success).toBe(false);
		const r = actionFail(parsed.error);
		expect(r.status).toBe(400);
		expect(r.data.message).toMatch(/Fix this and try again\.$/);
	});

	it('throws what it does not know', () => {
		expect(() => actionFail(new Error('disk on fire'))).toThrow('disk on fire');
	});
});

describe('project page', () => {
	it('loads a snapshot and answers 404 for an unknown project', async () => {
		const load = projectPage.load as unknown as (
			e: unknown
		) => Promise<{ snapshot: { name: string } }>;
		expect((await load({ params: { name: 'demo' } })).snapshot.name).toBe('demo');
		await expect(load({ params: { name: 'nope' } })).rejects.toMatchObject({ status: 404 });
		await expect(load({ params: { name: 'Bad Name' } })).rejects.toMatchObject({ status: 404 });
	});

	it('send: an empty message is 400, a P2 message before P1 is approved is 409', async () => {
		const a = projectPage.actions;
		expect(failure(await call(a.send, { phase: 'P1', text: '  ' }))).toMatchObject({
			status: 400,
			action: 'send',
			message: expect.stringContaining('The message is empty')
		});
		expect(failure(await call(a.send, { phase: 'P2', text: 'hi' }))).toMatchObject({
			status: 409,
			message: 'Approve P1 before working on the design.'
		});
		expect(failure(await call(a.send, { phase: 'P9', text: 'hi' })).status).toBe(400);
	});

	it('approve and discard on a fresh project are 409', async () => {
		const a = projectPage.actions;
		expect(failure(await call(a.approve, { phase: 'P1' }))).toMatchObject({
			status: 409,
			message: 'P1 has nothing to approve yet.'
		});
		expect(failure(await call(a.discard, {})).message).toBe('There is no run to discard.');
		expect(failure(await call(a.stillValid, {})).status).toBe(409);
		expect(failure(await call(a.update, {})).status).toBe(409);
	});

	it('editRequirements: broken JSON and a wrong shape are 400, a valid document is saved', async () => {
		const a = projectPage.actions;
		expect(failure(await call(a.editRequirements, { doc: '{nope' }))).toMatchObject({
			status: 400,
			message: expect.stringContaining('not valid JSON')
		});
		expect((await call(a.editRequirements, { doc: '{}' })).status).toBe(400);
		const doc = { requirements: [], openQuestions: [], assumptions: ['one user'], outOfScope: [] };
		expect(await call(a.editRequirements, { doc: JSON.stringify(doc) })).toEqual({
			ok: true,
			action: 'editRequirements'
		});
		const { snapshot } = await (
			projectPage.load as unknown as (
				e: unknown
			) => Promise<{ snapshot: { requirements: unknown } }>
		)({ params: { name: 'demo' } });
		expect(snapshot.requirements).toEqual(doc);
	});

	it('answers 404 for an unknown project', async () => {
		expect(failure(await call(projectPage.actions.discard, {}, 'nope')).status).toBe(404);
	});
});

describe('home page', () => {
	const create = (name: string) => call(homePage.actions.create, { name }, '');

	it('lists projects', async () => {
		const load = homePage.load as unknown as () => Promise<{ projects: string[] }>;
		expect((await load()).projects).toEqual(['demo']);
	});

	it('rejects an invalid name with 400 on the name field', async () => {
		expect(failure(await create('Bad Name!'))).toMatchObject({ status: 400, field: 'name' });
		expect(failure(await create('')).status).toBe(400);
	});

	it('answers 409 for an existing project and redirects after creating one', async () => {
		expect(failure(await create('demo'))).toMatchObject({
			status: 409,
			message: expect.stringContaining('already exists')
		});
		await expect(create('fresh')).rejects.toMatchObject({
			status: 303,
			location: '/p/fresh'
		});
		expect(await getOrchestrator().listProjects()).toEqual(['demo', 'fresh']);
	});
});

describe('events endpoint', () => {
	const open = (name = 'demo', signal?: AbortSignal) =>
		(GET as unknown as (e: unknown) => Promise<Response>)({
			params: { name },
			request: new Request(`http://localhost/p/${name}/events`, { signal })
		});
	const reader = (res: Response) => {
		const r = res.body!.getReader();
		const decoder = new TextDecoder();
		return async () => decoder.decode((await r.read()).value);
	};

	it('answers 404 for an unknown project', async () => {
		await expect(open('nope')).rejects.toMatchObject({ status: 404 });
	});

	it('streams bus events as data lines and unsubscribes on abort', async () => {
		const abort = new AbortController();
		const res = await open('demo', abort.signal);
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		const next = reader(res);
		expect(await next()).toBe(': connected\n\n');
		publish('demo', { type: 'changed' });
		publish('demo', { type: 'agent_text', runId: 'r1', text: 'hi' });
		expect(await next()).toBe('data: {"type":"changed"}\n\n');
		expect(await next()).toBe('data: {"type":"agent_text","runId":"r1","text":"hi"}\n\n');
		expect(g.__aiseListeners?.get('demo')?.size).toBe(1);
		abort.abort();
		expect(g.__aiseListeners?.has('demo')).toBe(false);
		expect(() => publish('demo', { type: 'changed' })).not.toThrow();
	});

	it('unsubscribes when the client cancels the stream', async () => {
		const res = await open();
		await res.body!.cancel();
		expect(g.__aiseListeners?.has('demo')).toBe(false);
	});

	it('sends a ping comment every 15 seconds', async () => {
		vi.useFakeTimers();
		const abort = new AbortController();
		const res = await open('demo', abort.signal);
		const next = reader(res);
		await next();
		await vi.advanceTimersByTimeAsync(15_000);
		expect(await next()).toBe(': ping\n\n');
		abort.abort();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('P4 actions', () => {
	afterEach(() => vi.restoreAllMocks());

	it('send and approve accept phase P4: a fresh project refuses them with 409, not 400', async () => {
		const a = projectPage.actions;
		expect(failure(await call(a.send, { phase: 'P4', text: 'hi' })).status).toBe(409);
		expect(failure(await call(a.approve, { phase: 'P4' })).status).toBe(409);
	});

	it('generate on a project without an approved design is 409', async () => {
		expect(failure(await call(projectPage.actions.generate, {})).status).toBe(409);
	});

	it('generate and checkCode call the orchestrator', async () => {
		const o = getOrchestrator();
		const gen = vi.spyOn(o, 'generateCode').mockResolvedValue({ runId: 'r1' });
		const check = vi.spyOn(o, 'checkCode').mockResolvedValue(undefined);
		expect(await call(projectPage.actions.generate, {})).toEqual({ ok: true, action: 'generate' });
		expect(gen).toHaveBeenCalledWith('demo');
		expect(await call(projectPage.actions.checkCode, {})).toEqual({
			ok: true,
			action: 'checkCode'
		});
		expect(check).toHaveBeenCalledWith('demo');
	});

	it('update with phase P4 calls updateStale(name, P4); without a phase it is P2', async () => {
		const o = getOrchestrator();
		const upd = vi.spyOn(o, 'updateStale').mockResolvedValue({ runId: 'r2' });
		expect(await call(projectPage.actions.update, { phase: 'P4' })).toEqual({
			ok: true,
			action: 'update'
		});
		expect(upd).toHaveBeenLastCalledWith('demo', 'P4');
		await call(projectPage.actions.update, {});
		expect(upd).toHaveBeenLastCalledWith('demo', 'P2');
	});

	it('stillValid takes the same phase field', async () => {
		const o = getOrchestrator();
		const still = vi.spyOn(o, 'stillValid').mockResolvedValue(undefined);
		await call(projectPage.actions.stillValid, { phase: 'P4' });
		expect(still).toHaveBeenLastCalledWith('demo', 'P4');
		await call(projectPage.actions.stillValid, {});
		expect(still).toHaveBeenLastCalledWith('demo', 'P2');
	});

	it('update and stillValid answer 400 for any other phase without calling the orchestrator', async () => {
		const o = getOrchestrator();
		const upd = vi.spyOn(o, 'updateStale');
		const still = vi.spyOn(o, 'stillValid');
		for (const phase of ['P1', 'p4', 'P9']) {
			expect(failure(await call(projectPage.actions.update, { phase }))).toMatchObject({
				status: 400,
				action: 'update'
			});
			expect(failure(await call(projectPage.actions.stillValid, { phase }))).toMatchObject({
				status: 400,
				action: 'stillValid'
			});
		}
		expect(upd).not.toHaveBeenCalled();
		expect(still).not.toHaveBeenCalled();
	});
});

describe('P5 actions', () => {
	afterEach(() => vi.restoreAllMocks());

	it('generateTests on a project without approved code is 409', async () => {
		expect(failure(await call(projectPage.actions.generateTests, {}))).toMatchObject({
			status: 409,
			action: 'generateTests'
		});
	});

	it('generateTests and checkTests call the orchestrator', async () => {
		const o = getOrchestrator();
		const gen = vi.spyOn(o, 'generateTests').mockResolvedValue({ runId: 'r5' });
		const check = vi.spyOn(o, 'checkTests').mockResolvedValue(undefined);
		expect(await call(projectPage.actions.generateTests, {})).toEqual({
			ok: true,
			action: 'generateTests'
		});
		expect(gen).toHaveBeenCalledWith('demo');
		expect(await call(projectPage.actions.checkTests, {})).toEqual({
			ok: true,
			action: 'checkTests'
		});
		expect(check).toHaveBeenCalledWith('demo');
	});

	it('triageTests calls triageTests(name); on a project without approved code it is 409', async () => {
		expect(failure(await call(projectPage.actions.triageTests, {}))).toMatchObject({
			status: 409,
			action: 'triageTests'
		});
		const triage = vi.spyOn(getOrchestrator(), 'triageTests').mockResolvedValue({ runId: 'r8' });
		expect(await call(projectPage.actions.triageTests, {})).toEqual({
			ok: true,
			action: 'triageTests'
		});
		expect(triage).toHaveBeenCalledWith('demo');
	});

	it('fixLoop calls fixLoop(name); on a project without approved code it is 409', async () => {
		expect(failure(await call(projectPage.actions.fixLoop, {}))).toMatchObject({
			status: 409,
			action: 'fixLoop'
		});
		const loop = vi.spyOn(getOrchestrator(), 'fixLoop').mockResolvedValue({ runId: 'r9' });
		expect(await call(projectPage.actions.fixLoop, {})).toEqual({
			ok: true,
			action: 'fixLoop'
		});
		expect(loop).toHaveBeenCalledWith('demo');
	});

	it('applyFix without a findingId is 400 and does not call the orchestrator', async () => {
		const apply = vi.spyOn(getOrchestrator(), 'applyFix');
		const missing: Record<string, string>[] = [{}, { findingId: '' }, { findingId: '   ' }];
		for (const fields of missing) {
			expect(failure(await call(projectPage.actions.applyFix, fields))).toMatchObject({
				status: 400,
				action: 'applyFix',
				message: 'Choose the finding to fix.'
			});
		}
		expect(apply).not.toHaveBeenCalled();
	});

	it('applyFix with a findingId calls applyFix(name, findingId)', async () => {
		const apply = vi.spyOn(getOrchestrator(), 'applyFix').mockResolvedValue({ runId: 'r6' });
		expect(await call(projectPage.actions.applyFix, { findingId: 'r1-1' })).toEqual({
			ok: true,
			action: 'applyFix'
		});
		expect(apply).toHaveBeenCalledWith('demo', 'r1-1');
	});

	it('applyFix on a project without approved code is 409, the orchestrator error', async () => {
		expect(failure(await call(projectPage.actions.applyFix, { findingId: 'r1-1' }))).toMatchObject({
			status: 409,
			action: 'applyFix'
		});
	});

	it('send, approve and stillValid accept phase P5 and pass it on', async () => {
		const o = getOrchestrator();
		const msg = vi.spyOn(o, 'sendMessage').mockResolvedValue({ runId: 'r7' });
		const approve = vi.spyOn(o, 'approve').mockResolvedValue(undefined);
		const still = vi.spyOn(o, 'stillValid').mockResolvedValue(undefined);
		await call(projectPage.actions.send, { phase: 'P5', text: 'more tests' });
		expect(msg).toHaveBeenCalledWith('demo', 'P5', 'more tests');
		await call(projectPage.actions.approve, { phase: 'P5' });
		expect(approve).toHaveBeenCalledWith('demo', 'P5', { anyway: false, override: false });
		await call(projectPage.actions.stillValid, { phase: 'P5' });
		expect(still).toHaveBeenCalledWith('demo', 'P5');
	});

	it('update with phase P5 calls updateStale(name, P5)', async () => {
		const upd = vi.spyOn(getOrchestrator(), 'updateStale').mockResolvedValue({ runId: 'r8' });
		expect(await call(projectPage.actions.update, { phase: 'P5' })).toEqual({
			ok: true,
			action: 'update'
		});
		expect(upd).toHaveBeenCalledWith('demo', 'P5');
	});

	it('send and approve with phase P9 answer 400, not a server error', async () => {
		const a = projectPage.actions;
		expect(failure(await call(a.send, { phase: 'P9', text: 'hi' }))).toMatchObject({
			status: 400,
			action: 'send'
		});
		expect(failure(await call(a.approve, { phase: 'P9' }))).toMatchObject({
			status: 400,
			action: 'approve'
		});
	});
});

describe('P6 actions', () => {
	afterEach(() => vi.restoreAllMocks());

	it('generateDeployment before P5 is approved is 409 with the reason', async () => {
		expect(failure(await call(projectPage.actions.generateDeployment, {}))).toMatchObject({
			status: 409,
			action: 'generateDeployment',
			message: 'Approve P1 before generating the deployment.'
		});
	});

	it('generateDeployment and checkDeploy call the orchestrator', async () => {
		const o = getOrchestrator();
		const gen = vi.spyOn(o, 'generateDeployment').mockResolvedValue({ runId: 'r9' });
		const check = vi.spyOn(o, 'checkDeploy').mockResolvedValue(undefined);
		expect(await call(projectPage.actions.generateDeployment, {})).toEqual({
			ok: true,
			action: 'generateDeployment'
		});
		expect(gen).toHaveBeenCalledWith('demo');
		expect(await call(projectPage.actions.checkDeploy, {})).toEqual({
			ok: true,
			action: 'checkDeploy'
		});
		expect(check).toHaveBeenCalledWith('demo');
	});

	it('checkDeploy without a compose.yaml is 409 with the orchestrator message', async () => {
		expect(failure(await call(projectPage.actions.checkDeploy, {}))).toMatchObject({
			status: 409,
			action: 'checkDeploy',
			message: 'There is no compose.yaml to check; generate the deployment first.'
		});
	});

	it('checkDeploy shows a Docker clash as a 409 message, like the other conflicts', async () => {
		vi.spyOn(getOrchestrator(), 'checkDeploy').mockRejectedValue(
			new ConflictError('Docker is not running. Start Docker Desktop and retry.')
		);
		expect(failure(await call(projectPage.actions.checkDeploy, {}))).toEqual({
			status: 409,
			action: 'checkDeploy',
			message: 'Docker is not running. Start Docker Desktop and retry.'
		});
	});

	it('update and stillValid accept phase P6 and pass it on', async () => {
		const o = getOrchestrator();
		const upd = vi.spyOn(o, 'updateStale').mockResolvedValue({ runId: 'r9' });
		const still = vi.spyOn(o, 'stillValid').mockResolvedValue(undefined);
		expect(await call(projectPage.actions.update, { phase: 'P6' })).toEqual({
			ok: true,
			action: 'update'
		});
		expect(upd).toHaveBeenCalledWith('demo', 'P6');
		expect(await call(projectPage.actions.stillValid, { phase: 'P6' })).toEqual({
			ok: true,
			action: 'stillValid'
		});
		expect(still).toHaveBeenCalledWith('demo', 'P6');
	});

	it('send and approve accept phase P6: a fresh project refuses them with 409 and the reason', async () => {
		const a = projectPage.actions;
		expect(failure(await call(a.send, { phase: 'P6', text: 'hi' }))).toEqual({
			status: 409,
			action: 'send',
			message: 'Approve P1 before working on the deployment.'
		});
		expect(failure(await call(a.approve, { phase: 'P6' }))).toEqual({
			status: 409,
			action: 'approve',
			message: 'Approve P1 before approving P6.'
		});
	});

	it('send and approve pass phase P6 on to the orchestrator when it is ready', async () => {
		const o = getOrchestrator();
		const send = vi.spyOn(o, 'sendMessage').mockResolvedValue({ runId: 'r9' });
		const approve = vi.spyOn(o, 'approve').mockResolvedValue(undefined);
		expect(await call(projectPage.actions.send, { phase: 'P6', text: 'hi' })).toEqual({
			ok: true,
			action: 'send'
		});
		expect(send).toHaveBeenCalledWith('demo', 'P6', 'hi');
		expect(await call(projectPage.actions.approve, { phase: 'P6' })).toEqual({
			ok: true,
			action: 'approve'
		});
		expect(approve).toHaveBeenCalledWith('demo', 'P6', { anyway: false, override: false });
	});

	it('update and stillValid name P2, P4, P5 and P6 when the phase is wrong', async () => {
		const a = projectPage.actions;
		expect(failure(await call(a.update, { phase: 'P7' }))).toEqual({
			status: 400,
			action: 'update',
			message: 'The phase must be P2, P4, P5 or P6.'
		});
		expect(failure(await call(a.stillValid, { phase: 'P7' }))).toEqual({
			status: 400,
			action: 'stillValid',
			message: 'The phase must be P2, P4, P5 or P6.'
		});
	});
});

describe('ticket actions', () => {
	afterEach(() => vi.restoreAllMocks());
	const a = projectPage.actions;
	const ticket = (ticketId: string, extra: Record<string, string> = {}) => ({ ticketId, ...extra });

	it('createTicket passes kind, title and description to the orchestrator', async () => {
		const create = vi
			.spyOn(getOrchestrator(), 'createTicket')
			.mockResolvedValue({ ticketId: 'TCK-001', runId: 'r9' });
		expect(
			await call(a.createTicket, { kind: 'bug', title: 'Login fails', description: 'On Safari' })
		).toEqual({ ok: true, action: 'createTicket' });
		expect(create).toHaveBeenCalledWith('demo', {
			kind: 'bug',
			title: 'Login fails',
			description: 'On Safari'
		});
	});

	it('createTicket answers 400 for a kind outside the four, without calling the orchestrator', async () => {
		const create = vi.spyOn(getOrchestrator(), 'createTicket');
		for (const kind of ['', 'feature', 'Bug', 'drift ', 'P1']) {
			expect(
				failure(await call(a.createTicket, { kind, title: 'Due dates', description: '' }))
			).toEqual({ status: 400, action: 'createTicket', message: 'Choose the ticket kind.' });
		}
		expect(failure(await call(a.createTicket, { title: 'Due dates' }))).toMatchObject({
			status: 400,
			message: 'Choose the ticket kind.'
		});
		expect(create).not.toHaveBeenCalled();
	});

	it('createTicket on a project whose tests are not approved is 409', async () => {
		expect(
			failure(await call(a.createTicket, { kind: 'change', title: 'Due dates', description: '' }))
		).toMatchObject({
			status: 409,
			action: 'createTicket',
			message: 'Approve P5 before opening the first ticket.'
		});
	});

	it('ticketSend passes the ticket ID and the text on', async () => {
		const send = vi
			.spyOn(getOrchestrator(), 'sendTicketMessage')
			.mockResolvedValue({ runId: 'r10' });
		expect(await call(a.ticketSend, ticket('TCK-001', { text: 'Which tables change?' }))).toEqual({
			ok: true,
			action: 'ticketSend'
		});
		expect(send).toHaveBeenCalledWith('demo', 'TCK-001', 'Which tables change?');
	});

	it('approvePlan passes the ticket ID, and the direction only when one is sent', async () => {
		const approve = vi.spyOn(getOrchestrator(), 'approvePlan').mockResolvedValue({ runId: 'r11' });
		expect(await call(a.approvePlan, ticket('TCK-002'))).toEqual({
			ok: true,
			action: 'approvePlan'
		});
		expect(approve).toHaveBeenLastCalledWith('demo', 'TCK-002', {});
		await call(a.approvePlan, ticket('TCK-002', { direction: 'design' }));
		expect(approve).toHaveBeenLastCalledWith('demo', 'TCK-002', { direction: 'design' });
		await call(a.approvePlan, ticket('TCK-002', { direction: 'code' }));
		expect(approve).toHaveBeenLastCalledWith('demo', 'TCK-002', { direction: 'code' });
	});

	it('approvePlan answers 400 for a direction other than design or code, without calling the orchestrator', async () => {
		const approve = vi.spyOn(getOrchestrator(), 'approvePlan');
		for (const direction of ['Design', 'p2', 'both', '', ' code']) {
			expect(failure(await call(a.approvePlan, ticket('TCK-002', { direction })))).toEqual({
				status: 400,
				action: 'approvePlan',
				message: 'The direction must be design or code.'
			});
		}
		expect(approve).not.toHaveBeenCalled();
	});

	it('ticket actions answer 400 for a missing or malformed ticket ID, without calling the orchestrator', async () => {
		const o = getOrchestrator();
		const send = vi.spyOn(o, 'sendTicketMessage');
		const approve = vi.spyOn(o, 'approvePlan');
		const reject = vi.spyOn(o, 'rejectTicket');
		const close = vi.spyOn(o, 'closeTicket');
		for (const ticketId of ['', '   ', 'TCK-1', 'TCK-0001', 'REQ-001', 'tck-001', '../TCK-001']) {
			const bad = { status: 400, message: 'Choose the ticket.' };
			expect(failure(await call(a.ticketSend, ticket(ticketId, { text: 'hi' })))).toEqual({
				...bad,
				action: 'ticketSend'
			});
			expect(failure(await call(a.approvePlan, ticket(ticketId)))).toEqual({
				...bad,
				action: 'approvePlan'
			});
			expect(failure(await call(a.rejectTicket, ticket(ticketId)))).toEqual({
				...bad,
				action: 'rejectTicket'
			});
			expect(failure(await call(a.closeTicket, ticket(ticketId)))).toEqual({
				...bad,
				action: 'closeTicket'
			});
		}
		expect(send).not.toHaveBeenCalled();
		expect(approve).not.toHaveBeenCalled();
		expect(reject).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});

	it('rejectTicket and closeTicket pass the ticket ID on, and openDriftTicket takes no fields', async () => {
		const o = getOrchestrator();
		const reject = vi.spyOn(o, 'rejectTicket').mockResolvedValue(undefined);
		const close = vi.spyOn(o, 'closeTicket').mockResolvedValue({ runId: 'r12' });
		const drift = vi
			.spyOn(o, 'openDriftTicket')
			.mockResolvedValue({ ticketId: 'TCK-003', runId: 'r13' });
		expect(await call(a.rejectTicket, ticket('TCK-001'))).toEqual({
			ok: true,
			action: 'rejectTicket'
		});
		expect(reject).toHaveBeenCalledWith('demo', 'TCK-001');
		expect(await call(a.closeTicket, ticket('TCK-001'))).toEqual({
			ok: true,
			action: 'closeTicket'
		});
		expect(close).toHaveBeenCalledWith('demo', 'TCK-001');
		expect(await call(a.openDriftTicket, {})).toEqual({ ok: true, action: 'openDriftTicket' });
		expect(drift).toHaveBeenCalledWith('demo');
	});

	it('ticket actions map a ConflictError to 409 and a NotFoundError to 404, naming the action', async () => {
		const o = getOrchestrator();
		const newTicket = { kind: 'bug', title: 'Login fails', description: '' };
		for (const [error, status] of [
			[new ConflictError('TCK-001 is open'), 409],
			[new NotFoundError('No ticket TCK-001'), 404]
		] as const) {
			vi.spyOn(o, 'createTicket').mockRejectedValueOnce(error);
			expect(failure(await call(a.createTicket, newTicket))).toMatchObject({
				status,
				action: 'createTicket'
			});
			vi.spyOn(o, 'sendTicketMessage').mockRejectedValueOnce(error);
			expect(failure(await call(a.ticketSend, ticket('TCK-001', { text: 'hi' })))).toMatchObject({
				status,
				action: 'ticketSend'
			});
			vi.spyOn(o, 'approvePlan').mockRejectedValueOnce(error);
			expect(failure(await call(a.approvePlan, ticket('TCK-001')))).toMatchObject({
				status,
				action: 'approvePlan'
			});
			vi.spyOn(o, 'rejectTicket').mockRejectedValueOnce(error);
			expect(failure(await call(a.rejectTicket, ticket('TCK-001')))).toMatchObject({
				status,
				action: 'rejectTicket'
			});
			vi.spyOn(o, 'closeTicket').mockRejectedValueOnce(error);
			expect(failure(await call(a.closeTicket, ticket('TCK-001')))).toMatchObject({
				status,
				action: 'closeTicket'
			});
			vi.spyOn(o, 'openDriftTicket').mockRejectedValueOnce(error);
			expect(failure(await call(a.openDriftTicket, {}))).toMatchObject({
				status,
				action: 'openDriftTicket'
			});
		}
	});

	it('createTicket answers 400 naming the field for an empty or over-long title or description', async () => {
		const create = vi.spyOn(getOrchestrator(), 'createTicket');
		const cases = [
			[{ title: '   ', description: '' }, 'title: Enter a title'],
			[{ title: 'x'.repeat(201), description: '' }, 'title: Keep the title under 200 characters'],
			[
				{ title: 'Due dates', description: 'x'.repeat(20001) },
				'description: Keep the description under 20000 characters'
			]
		] as const;
		for (const [fields, prefix] of cases) {
			const r = failure(await call(a.createTicket, { kind: 'change', ...fields }));
			expect(r).toMatchObject({ status: 400, action: 'createTicket' });
			expect(r.message).toContain(prefix);
			expect(r.message).not.toMatch(/\[|"code"/);
		}
		expect(create).not.toHaveBeenCalled();
	});

	it('createTicket accepts a 200 character title and a 20000 character description', async () => {
		const create = vi
			.spyOn(getOrchestrator(), 'createTicket')
			.mockResolvedValue({ ticketId: 'TCK-001', runId: 'r9' });
		const fields = { kind: 'change', title: 'x'.repeat(200), description: 'x'.repeat(20000) };
		expect(await call(a.createTicket, fields)).toEqual({ ok: true, action: 'createTicket' });
		expect(create).toHaveBeenCalledWith('demo', {
			kind: 'change',
			title: 'x'.repeat(200),
			description: 'x'.repeat(20000)
		});
	});

	it('a padded ticket ID reaches the orchestrator trimmed', async () => {
		const o = getOrchestrator();
		const send = vi.spyOn(o, 'sendTicketMessage').mockResolvedValue({ runId: 'r14' });
		const reject = vi.spyOn(o, 'rejectTicket').mockResolvedValue(undefined);
		await call(a.ticketSend, ticket(' TCK-001 ', { text: 'hi' }));
		expect(send).toHaveBeenCalledWith('demo', 'TCK-001', 'hi');
		await call(a.rejectTicket, ticket('\tTCK-001  '));
		expect(reject).toHaveBeenCalledWith('demo', 'TCK-001');
	});

	it('ticketSend answers 400 for an empty or blank message, without calling the orchestrator', async () => {
		const send = vi.spyOn(getOrchestrator(), 'sendTicketMessage');
		for (const text of ['', '   ', '\n']) {
			expect(failure(await call(a.ticketSend, ticket('TCK-001', { text })))).toMatchObject({
				status: 400,
				action: 'ticketSend',
				message: expect.stringContaining('The message is empty')
			});
		}
		expect(send).not.toHaveBeenCalled();
	});

	it('openDriftTicket on a project without stored drift checks is 409 with the orchestrator reason', async () => {
		expect(failure(await call(a.openDriftTicket, {}))).toMatchObject({
			status: 409,
			action: 'openDriftTicket',
			message: expect.stringContaining('Check again first')
		});
	});
});

describe('P3 actions', () => {
	const a = projectPage.actions;

	it('reviewDesign without a design is 409 with the orchestrator reason', async () => {
		expect(failure(await call(a.reviewDesign, {}))).toMatchObject({
			status: 409,
			action: 'reviewDesign',
			message: expect.stringContaining('There is no design to review yet')
		});
	});

	it('acceptProposal and rejectProposal pass the proposal ID on; an unknown one is 404', async () => {
		const o = getOrchestrator();
		const accept = vi.spyOn(o, 'acceptProposal').mockResolvedValue({ runId: 'r1' });
		const reject = vi.spyOn(o, 'rejectProposal').mockResolvedValue(undefined);
		expect(await call(a.acceptProposal, { proposalId: 'PRP-001' })).toEqual({
			ok: true,
			action: 'acceptProposal'
		});
		expect(accept).toHaveBeenCalledWith('demo', 'PRP-001');
		expect(await call(a.rejectProposal, { proposalId: ' PRP-002 ' })).toEqual({
			ok: true,
			action: 'rejectProposal'
		});
		expect(reject).toHaveBeenCalledWith('demo', 'PRP-002');
		reject.mockRestore();
		expect(failure(await call(a.rejectProposal, { proposalId: 'PRP-003' }))).toMatchObject({
			status: 404,
			action: 'rejectProposal'
		});
	});

	it('answers 400 for a missing or malformed proposal ID, without calling the orchestrator', async () => {
		const o = getOrchestrator();
		const accept = vi.spyOn(o, 'acceptProposal');
		const reject = vi.spyOn(o, 'rejectProposal');
		for (const proposalId of ['', 'PRP-1', 'TCK-001', '../PRP-001']) {
			const bad = { status: 400, message: 'Choose the proposal.' };
			expect(failure(await call(a.acceptProposal, { proposalId }))).toEqual({
				...bad,
				action: 'acceptProposal'
			});
			expect(failure(await call(a.rejectProposal, { proposalId }))).toEqual({
				...bad,
				action: 'rejectProposal'
			});
		}
		expect(accept).not.toHaveBeenCalled();
		expect(reject).not.toHaveBeenCalled();
	});
});

describe('file endpoint', () => {
	const inProject = (rel: string) => path.join(root, 'demo', rel);
	const put = async (rel: string, content: string) => {
		await mkdir(path.dirname(inProject(rel)), { recursive: true });
		await writeFile(inProject(rel), content);
	};
	const fileGet = (name: string, rel?: string) => {
		const url = new URL(`http://localhost/p/${name}/file`);
		if (rel !== undefined) url.searchParams.set('path', rel);
		return (getFile as unknown as (e: unknown) => Promise<Response>)({ params: { name }, url });
	};

	beforeEach(async () => {
		await put('src/tasks/Task.ts', 'export class Task {}\n');
	});

	it('returns the content of a code file as plain text', async () => {
		const res = await fileGet('demo', 'src/tasks/Task.ts');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(await res.text()).toBe('export class Task {}\n');
	});

	it('forbids content sniffing, so a generated file never runs as a page', async () => {
		const res = await fileGet('demo', 'src/tasks/Task.ts');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('serves test files under test/, and still refuses .aise/ and .env inside it', async () => {
		await put('test/UC-001.test.ts', "import { it } from 'vitest';\n");
		const res = await fileGet('demo', 'test/UC-001.test.ts');
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("import { it } from 'vitest';\n");
		await expect(fileGet('demo', '.aise/state.json')).rejects.toMatchObject({ status: 400 });
		await expect(fileGet('demo', 'test/.env')).rejects.toMatchObject({ status: 400 });
		await expect(fileGet('demo', 'test/../.aise/state.json')).rejects.toMatchObject({
			status: 400
		});
	});

	it('serves package.json at the root too', async () => {
		await put('package.json', '{"name":"demo"}\n');
		expect(await (await fileGet('demo', 'package.json')).text()).toBe('{"name":"demo"}\n');
	});

	it('serves the generated README.md for the Code tab', async () => {
		await put('README.md', '# demo\n');
		expect(await (await fileGet('demo', 'README.md')).text()).toBe('# demo\n');
	});

	it('answers 400 for a missing path, a refused path or a path outside the code folders', async () => {
		for (const rel of [
			undefined,
			'',
			'.env',
			'src/.env.local',
			'.aise/state.json',
			'src/../.env',
			'/etc/passwd',
			'package-lock.json',
			'srcx/a.ts',
			'testx/a.ts'
		]) {
			await expect(fileGet('demo', rel)).rejects.toMatchObject({ status: 400 });
		}
	});

	it('answers 404 for a missing file, a folder or an unknown project', async () => {
		await expect(fileGet('demo', 'src/missing.ts')).rejects.toMatchObject({ status: 404 });
		await expect(fileGet('demo', 'src/tasks')).rejects.toMatchObject({ status: 404 });
		await expect(fileGet('nope', 'src/tasks/Task.ts')).rejects.toMatchObject({ status: 404 });
	});

	it('answers 400 for a symlink to a file outside the project', async () => {
		await writeFile(path.join(root, 'secret.txt'), 'outside');
		await symlink(path.join(root, 'secret.txt'), inProject('src/link.ts'));
		await expect(fileGet('demo', 'src/link.ts')).rejects.toMatchObject({ status: 400 });
	});

	it('answers 400 for a link inside a shown folder that leads to a file that is not shown', async () => {
		await put('package-lock.json', '{}\n');
		await put('test/UC-001.test.ts', 'x\n');
		await symlink(inProject('package-lock.json'), inProject('test/lock.ts'));
		await symlink(inProject('package-lock.json'), inProject('src/lock.ts'));
		await expect(fileGet('demo', 'test/lock.ts')).rejects.toMatchObject({ status: 400 });
		await expect(fileGet('demo', 'src/lock.ts')).rejects.toMatchObject({ status: 400 });
		await symlink(inProject('package-lock.json'), inProject('README.md'));
		await expect(fileGet('demo', 'README.md')).rejects.toMatchObject({ status: 400 });
		// Secrets stay out even through a link (safePath refuses the resolved .env as well).
		await put('.env', 'SECRET=1\n');
		await symlink(inProject('.env'), inProject('test/env.ts'));
		await expect(fileGet('demo', 'test/env.ts')).rejects.toMatchObject({ status: 400 });
	});

	it('serves the deploy files Dockerfile, compose.yaml and RUN.md as text', async () => {
		const files = {
			Dockerfile: 'FROM node:22\n',
			'compose.yaml': 'services: {}\n',
			'RUN.md': '# Run\n'
		};
		for (const [rel, content] of Object.entries(files)) {
			await put(rel, content);
			const res = await fileGet('demo', rel);
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
			expect(await res.text()).toBe(content);
		}
	});

	it('answers 404 for a deploy file that has not been generated yet', async () => {
		await expect(fileGet('demo', 'compose.yaml')).rejects.toMatchObject({ status: 404 });
		await expect(fileGet('demo', 'RUN.md')).rejects.toMatchObject({ status: 404 });
	});

	it('refuses deploy names in another case and other root files that are not shown', async () => {
		await put('package-lock.json', '{}\n');
		await put('docker-compose.yml', 'services: {}\n');
		for (const rel of [
			'dockerfile',
			'COMPOSE.yaml',
			'run.md',
			'package-lock.json',
			'docker-compose.yml'
		]) {
			await expect(fileGet('demo', rel)).rejects.toMatchObject({ status: 400 });
		}
	});

	it('refuses a deploy file that links out of the project, as a symlink or a hard link', async () => {
		await writeFile(path.join(root, 'secret.txt'), 'outside');
		await symlink(path.join(root, 'secret.txt'), inProject('compose.yaml'));
		await expect(fileGet('demo', 'compose.yaml')).rejects.toMatchObject({ status: 400 });
		await link(path.join(root, 'secret.txt'), inProject('RUN.md'));
		await expect(fileGet('demo', 'RUN.md')).rejects.toMatchObject({ status: 400 });
	});

	it('refuses a deploy file that links to a file inside the project that is not shown', async () => {
		await put('package-lock.json', '{}\n');
		await symlink(inProject('package-lock.json'), inProject('Dockerfile'));
		await expect(fileGet('demo', 'Dockerfile')).rejects.toMatchObject({ status: 400 });
	});

	it('serves a link inside a shown folder that leads to a deploy file', async () => {
		await put('Dockerfile', 'FROM node:22\n');
		await put('test/UC-001.test.ts', 'x\n');
		await symlink(inProject('Dockerfile'), inProject('test/docker.ts'));
		expect(await (await fileGet('demo', 'test/docker.ts')).text()).toBe('FROM node:22\n');
	});

	it('serves a link inside a shown folder that leads to another shown file', async () => {
		await put('package.json', '{"name":"demo"}\n');
		await put('test/UC-001.test.ts', 'x\n');
		await symlink(inProject('package.json'), inProject('test/pkg.ts'));
		expect(await (await fileGet('demo', 'test/pkg.ts')).text()).toBe('{"name":"demo"}\n');
	});

	it('compares shown roots case sensitively and refuses hidden files under test/', async () => {
		await put('test/UC-001.test.ts', 'x\n');
		await put('src/a.ts', 'x\n');
		await put('test/.env.local', 'SECRET=1\n');
		await put('test/sub/.ENV', 'SECRET=1\n');
		for (const rel of ['TEST/UC-001.test.ts', 'SRC/a.ts', 'test/.env.local', 'test/sub/.ENV']) {
			await expect(fileGet('demo', rel)).rejects.toMatchObject({ status: 400 });
		}
	});

	it('answers 404 for the test folder itself, with or without a trailing slash', async () => {
		await put('test/UC-001.test.ts', 'x\n');
		await expect(fileGet('demo', 'test')).rejects.toMatchObject({ status: 404 });
		await expect(fileGet('demo', 'test/')).rejects.toMatchObject({ status: 404 });
	});

	it('answers 400 for a hard link to a file outside the project', async () => {
		await writeFile(path.join(root, 'secret.txt'), 'outside');
		await link(path.join(root, 'secret.txt'), inProject('src/hard.ts'));
		await expect(fileGet('demo', 'src/hard.ts')).rejects.toMatchObject({ status: 400 });
	});

	it('answers 413 for a file over 1 MB', async () => {
		await put('src/big.ts', 'x'.repeat(1024 * 1024 + 1));
		await expect(fileGet('demo', 'src/big.ts')).rejects.toMatchObject({ status: 413 });
	});
});
