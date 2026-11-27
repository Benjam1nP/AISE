import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AGENTS,
	closeBrief,
	deployBrief,
	deployUpdateBrief,
	driftDescription,
	entryBrief,
	fixBrief,
	testUpdateBrief,
	ticketMessage,
	ticketTriageBrief,
	triageBrief,
	updateBrief,
	reviewBrief,
	type summariseRun
} from '../agents';
import type { runAgent } from '../agents/loop';
import type { AgentDef, RunResult } from '../agents/types';
import type { FileStatus, generateCode } from '../codegen/generate';
import { planPaths } from '../codegen/plan';
import {
	codeHash,
	designHash,
	designHashes,
	writeChecks,
	type runCodeChecks
} from '../core/code-state';
import type { TestResult } from '../core/docker/parse';
import { deployHashes, deployPlan } from '../core/deploy-plan';
import { deployCheckHash, readDeployCheck, writeDeployCheck } from '../core/deploy-state';
import { DOCKER_DOWN } from '../core/docker/run';
import type { DriftItem } from '../core/drift';
import { appendChat, readChat } from '../core/chat';
import { createRun, listRuns, updateRun } from '../core/runs';
import { DesignDoc } from '../core/schemas/design';
import type { RequirementsDoc } from '../core/schemas/requirements';
import type { Ticket, TicketPlan } from '../core/schemas/tickets';
import { readState, writeState } from '../core/state';
import { PathError, ProjectStore } from '../core/store';
import { readTickets, writeTickets } from '../core/tickets';
import { reportData } from '../core/ticket-report';
import {
	appendRunFinding,
	findingOpen,
	readRunFindings,
	testHash,
	writeTestChecks,
	type Finding,
	type runTestChecks,
	type TestChecks
} from '../core/test-state';
import { executeTool, ToolError, type ToolContext } from '../core/tools';
import { DesignReview } from '../core/tools/coverage';
import { readDesignProposals } from '../core/tools/proposals';
import type { AgentMessage, fixLoop } from '../testgen/fix-loop';
import type { generateTests } from '../testgen/generate';
import { subscribe, type WorkspaceEvent } from './bus';
import { ConflictError, NotFoundError, Orchestrator } from './orchestrator';
import { FIX_LOOP_MESSAGE } from './p5';
import { GENERATE_DEPLOY_MESSAGE } from './p6';

/** While `hold` is set, appending a handoff (an entry with `from`) to a chat waits for it. */
const chatGate = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
vi.mock('../core/chat', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../core/chat')>();
	const appendChat: typeof mod.appendChat = async (store, key, entry) => {
		if (chatGate.hold && entry.from) await chatGate.hold;
		return mod.appendChat(store, key, entry);
	};
	return { ...mod, appendChat };
});

const fixture = <T>(name: string): T =>
	JSON.parse(readFileSync(new URL(`../../../../test/fixtures/${name}`, import.meta.url), 'utf8'));

type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
};

/** What the fake agents write and return; `hold` keeps every run open until it is resolved. */
type Fake = {
	reqs: RequirementsDoc | null;
	design: DesignDoc | null;
	cost: number;
	hold: Deferred | null;
	fail: Error | null;
	calls: {
		agent: AgentDef['name'];
		history: unknown;
		maxTurns?: number;
		costLimitUsd?: number;
		/** The deploy checks the run's context had left when it started. */
		deployChecksLeft?: number;
	}[];
	summaryFails: boolean;
	/** Files the fake generation run writes, and the ones a code agent run writes. */
	code: Record<string, string>;
	codeEdits: Record<string, string>;
	/** Whether the fake pipeline runs the checks itself (`checked` in its result). */
	generationChecks: boolean;
	/** Resolved when the fake pipeline has reported its files, before `hold`. */
	generating: Deferred | null;
	generateCalls: number;
	checkCalls: number;
	typecheckOk: boolean;
	typecheckTimedOut: boolean;
	checksFail: boolean;
	/** Keeps the fake checks open until it is resolved. */
	checksHold: Deferred | null;
	/** Leaves out src/app/main.ts, as a wiring step that ran out of turns does. */
	noEntry: boolean;
	/** Makes the fake generation report this failure after it wrote its files. */
	generationFails: string | null;
	/** Writes only the scaffold's package.json, then fails, as a first generation that died early. */
	scaffoldOnly: boolean;
	/** Files the fake test generation writes, and the ones a test agent run writes. */
	tests: Record<string, string>;
	testEdits: Record<string, string>;
	generateTestsCalls: number;
	testCheckCalls: number;
	/** What the fake test checks report, and the findings they keep while still open. */
	testResults: TestResult[];
	findings: Finding[];
	/** Makes the fake test run report a timeout. */
	testTimedOut: boolean;
	/** Code bugs a test agent run reports through report_code_bug. */
	reports: Omit<Finding, 'id' | 'runId'>[];
	/** Files a deploy agent run writes; with `deployRunPasses` it stores a passed check, as deploy_check does. */
	deployEdits: Record<string, string>;
	deployRunPasses: boolean;
	/** Replaces the fake agent's result, as a run that hit its cost limit. */
	runFailure: Pick<RunResult, 'error' | 'reason'> | null;
	/** Inputs of the fake deploy_check and whether it passes; `deployCheckError` makes it throw. */
	deployCheckCalls: { urls: string[] }[];
	deployCheckPasses: boolean;
	deployCheckError: Error | null;
	/** Keeps the fake deploy_check open until it is resolved. */
	deployCheckHold: Deferred | null;
	/** The plan a maintenance agent run saves through write_ticket_plan. */
	ticketPlan: TicketPlan | null;
	/** The report text a maintenance agent run saves through write_ticket_report. */
	ticketReport: string | null;
	/** The contexts the fake fix loop got, the handoffs it sends and whether it runs both checks. */
	loopCalls: ToolContext[];
	loopMessages: AgentMessage[];
	/** A handoff the fake loop sends last, right before it returns. */
	lastMessage: AgentMessage | null;
	/** Keeps the fake fix loop (only) open until it is resolved. */
	loopHold: Deferred | null;
	loopChecks: boolean;
	/** What a review agent run reports through report_design_proposals; null reports nothing. */
	proposals: unknown[] | null;
};

let root: string;
let fake: Fake;
let orch: Orchestrator;

/** What deploy_check stores: the current check hash and every url with its status. */
const storeDeployCheck = async (s: ProjectStore, passed: boolean, urls: string[]) =>
	writeDeployCheck(s, {
		at: new Date().toISOString(),
		filesHash: await deployCheckHash(s),
		passed,
		services: urls.map((url) => ({ url, status: passed ? 200 : 503 })),
		logTail: passed ? '' : 'app-server exited',
		durationMs: 1
	});

const fakeRun: typeof runAgent = async ({ def, ctx, history, onEvent, maxTurns, costLimitUsd }) => {
	fake.calls.push({
		agent: def.name,
		history,
		maxTurns,
		costLimitUsd,
		deployChecksLeft: ctx.deployChecks?.left
	});
	// Uses up the budget, so a counter shared between runs would show in the next call.
	if (ctx.deployChecks) ctx.deployChecks.left = 0;
	const edits =
		def.name === 'test'
			? fake.testEdits
			: def.name === 'deploy'
				? fake.deployEdits
				: fake.codeEdits;
	const writes: [string, unknown][] =
		def.name === 'review'
			? [['report_design_proposals', fake.proposals && { proposals: fake.proposals }]]
			: def.name === 'maintenance'
				? [
						['write_ticket_plan', fake.ticketPlan],
						['write_ticket_report', fake.ticketReport && { text: fake.ticketReport }]
					]
				: def.name === 'requirements'
					? [['write_requirements', fake.reqs]]
					: def.name === 'design'
						? [['update_design', fake.design]]
						: Object.entries(edits).map(([p, content]) => ['write_file', { path: p, content }]);
	if (def.name === 'test') for (const r of fake.reports) writes.push(['report_code_bug', r]);
	for (const [tool, input] of writes) {
		if (!input) continue;
		const r = await executeTool(ctx, tool, input, def.tools);
		onEvent({ type: 'tool', name: tool, input, result: r.content, isError: r.isError });
	}
	onEvent({ type: 'text', text: `${def.name} reply` });
	if (def.name === 'deploy' && fake.deployRunPasses)
		await storeDeployCheck(ctx.store, true, ['http://localhost:8080/health']);
	if (fake.hold) await fake.hold.promise;
	if (fake.fail) throw fake.fail;
	const usage = { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 };
	const text = `${def.name} reply`;
	if (fake.runFailure)
		return { status: 'failed', text, ...fake.runFailure, usage, costUsd: fake.cost, turns: 1 };
	return { status: 'done', text, usage, costUsd: fake.cost, turns: 1 };
};

const fakeDeployCheck = async (ctx: ToolContext, input: { urls: string[] }) => {
	fake.deployCheckCalls.push({ urls: input.urls });
	if (fake.deployCheckHold) await fake.deployCheckHold.promise;
	if (fake.deployCheckError) {
		// As deploy_check: a ToolError is stored as failed unless a check for these files exists.
		const prev = await readDeployCheck(ctx.store);
		const kept = prev !== null && prev.filesHash === (await deployCheckHash(ctx.store));
		if (fake.deployCheckError instanceof ToolError && !kept)
			await storeDeployCheck(ctx.store, false, input.urls);
		throw fake.deployCheckError;
	}
	await storeDeployCheck(ctx.store, fake.deployCheckPasses, input.urls);
	const services = input.urls.map((url) => ({ url, ok: fake.deployCheckPasses, status: 200 }));
	return { ok: fake.deployCheckPasses, services, logTail: '' };
};

const fakeSummarise: typeof summariseRun = async () => {
	if (fake.summaryFails) throw new Error('gate summary came back empty');
	return {
		text: 'summary',
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
		costUsd: 0.001
	};
};

const fakeChecks: typeof runCodeChecks = async (ctx) => {
	fake.checkCalls++;
	if (fake.checksHold) await fake.checksHold.promise;
	if (fake.checksFail) throw new Error('Docker is not running');
	const errors = fake.typecheckOk ? [] : [{ file: 'src/a.ts', line: 1, col: 1, message: 'bad' }];
	const checks = {
		at: new Date().toISOString(),
		codeHash: await codeHash(ctx.store),
		designHash: designHash(await ctx.store.readJson('.aise/design.json', DesignDoc)),
		typecheck: {
			ok: fake.typecheckOk && !fake.typecheckTimedOut,
			errors,
			timedOut: fake.typecheckTimedOut
		},
		drift: [],
		start: fake.typecheckOk && !fake.noEntry ? { ok: true, entries: [], timedOut: false } : null
	};
	await writeChecks(ctx.store, checks);
	return checks;
};

/** Writes `fake.code` through write_file (so discard works), reports each file, then waits on `hold`. */
const fakeGenerate: typeof generateCode = async ({ ctx, onEvent, checks }) => {
	fake.generateCalls++;
	const files: Record<string, FileStatus> = {};
	if (fake.scaffoldOnly) {
		const pkg = { path: 'package.json', content: '{}\n' };
		await executeTool(ctx, 'write_file', pkg, AGENTS.code.tools);
		throw new Error('boom');
	}
	for (const [p, content] of Object.entries(fake.code)) {
		onEvent({ type: 'file', path: p, status: 'writing', attempt: 1 });
		await executeTool(ctx, 'write_file', { path: p, content }, AGENTS.code.tools);
		files[p] = 'ok';
		onEvent({ type: 'file', path: p, status: 'ok', attempt: 1 });
		onEvent({
			type: 'worker',
			path: p,
			attempt: 1,
			event: { type: 'tool', name: 'write_file', input: { path: p }, result: 'ok', isError: false }
		});
	}
	onEvent({ type: 'wiring', event: { type: 'text', text: 'wired' } });
	if (!fake.noEntry) {
		const entry = { path: 'src/app/main.ts', content: 'export {};\n' };
		await executeTool(ctx, 'write_file', entry, AGENTS.code.tools);
	}
	fake.generating?.resolve();
	if (fake.hold) await fake.hold.promise;
	if (fake.generationChecks) await checks!(ctx);
	const usage = { input: 500, output: 50, cacheRead: 0, cacheWrite: 0 };
	const checked = fake.generationChecks;
	if (fake.generationFails)
		return {
			status: 'failed',
			error: fake.generationFails,
			text: 'wired',
			usage,
			costUsd: 0.2,
			turns: 3,
			files,
			checked
		};
	return { status: 'done', text: 'wired', usage, costUsd: 0.2, turns: 3, files, checked };
};

const fakeTestChecks: typeof runTestChecks = async (ctx) => {
	fake.testCheckCalls++;
	const run = await readRunFindings(ctx.store, ctx.runId);
	const tests = fake.testResults;
	const failed = tests.filter((t) => t.status === 'failed').length;
	const result = {
		ok: failed === 0 && !fake.testTimedOut,
		passed: tests.length - failed,
		failed,
		tests,
		timedOut: fake.testTimedOut,
		logTail: 'log'
	};
	const checks: TestChecks = {
		at: new Date().toISOString(),
		codeHash: await codeHash(ctx.store),
		testHash: await testHash(ctx.store),
		typecheck: { ok: true, errors: [], timedOut: false },
		result,
		// The fake keeps fake.findings while open and adds what the run reported, like runTestChecks.
		findings: [...fake.findings.filter((f) => findingOpen(f, result)), ...run.findings],
		testFixes: run.testFixes
	};
	await writeTestChecks(ctx.store, checks);
	return checks;
};

/** Writes `fake.tests` through write_file, reports each file, waits on `hold`, then runs the checks. */
const fakeGenerateTests: typeof generateTests = async ({ ctx, onEvent, checks }) => {
	fake.generateTestsCalls++;
	const files: Record<string, FileStatus> = {};
	for (const [p, content] of Object.entries(fake.tests)) {
		onEvent({ type: 'file', path: p, status: 'writing', attempt: 1 });
		await executeTool(ctx, 'write_file', { path: p, content }, AGENTS.test.tools);
		files[p] = 'ok';
		onEvent({ type: 'file', path: p, status: 'ok', attempt: 1 });
	}
	onEvent({ type: 'wiring', event: { type: 'text', text: 'triaged' } });
	fake.generating?.resolve();
	if (fake.hold) await fake.hold.promise;
	await checks!(ctx);
	const usage = { input: 300, output: 30, cacheRead: 0, cacheWrite: 0 };
	const failed = fake.generationFails;
	return {
		status: failed ? 'failed' : 'done',
		...(failed ? { error: failed } : {}),
		text: 'tests written',
		usage,
		costUsd: 0.1,
		turns: 2,
		files,
		checked: true
	};
};

/**
 * Sends `fake.loopMessages`, writes `fake.testEdits` as the test agent and `fake.codeEdits` as the
 * code agent (so discard restores both), waits on `hold`, then runs both checks if `loopChecks`.
 */
const fakeFixLoop: typeof fixLoop = async (opts) => {
	const { ctx, agents, onEvent, onMessage } = opts;
	fake.loopCalls.push(ctx);
	for (const m of fake.loopMessages) onMessage(m);
	const steps: [ToolContext, AgentDef, Record<string, string>][] = [
		[{ ...ctx, agent: 'test' }, agents.test, fake.testEdits],
		[{ ...ctx, agent: 'code', fixLoop: true }, agents.code, fake.codeEdits]
	];
	for (const [stepCtx, def, edits] of steps) {
		for (const [p, content] of Object.entries(edits)) {
			const r = await executeTool(stepCtx, 'write_file', { path: p, content }, def.tools);
			onEvent({
				type: 'tool',
				name: 'write_file',
				input: { path: p },
				result: r.content,
				isError: r.isError
			});
		}
	}
	onEvent({ type: 'text', text: 'loop reply' });
	if (fake.hold) await fake.hold.promise;
	if (fake.loopHold) await fake.loopHold.promise;
	if (fake.loopChecks) {
		await opts.codeChecks(ctx);
		await opts.testChecks(ctx);
	}
	if (fake.lastMessage) onMessage(fake.lastMessage);
	const usage = { input: 200, output: 20, cacheRead: 0, cacheWrite: 0 };
	const checked = fake.loopChecks;
	return { status: 'done', text: 'Fix loop: 1 round.', usage, costUsd: 0.3, turns: 2, checked };
};

const newOrchestrator = (autoReview = false) =>
	new Orchestrator({
		root,
		autoReview,
		run: fakeRun,
		summarise: fakeSummarise,
		generate: fakeGenerate,
		checks: fakeChecks,
		generateTests: fakeGenerateTests,
		testChecks: fakeTestChecks,
		deployCheck: fakeDeployCheck,
		fixLoop: fakeFixLoop
	});

/** Resolves with the next run_finished event of the project; subscribe before starting the run. */
const nextFinished = (name = 'todo') =>
	new Promise<Extract<WorkspaceEvent, { type: 'run_finished' }>>((resolve) => {
		const off = subscribe(name, (e) => {
			if (e.type === 'run_finished') {
				off();
				resolve(e);
			}
		});
	});

const send = async (phase: 'P1' | 'P2' | 'P4' | 'P5' | 'P6', text: string) => {
	const done = nextFinished();
	const { runId } = await orch.sendMessage('todo', phase, text);
	return { runId, finished: await done };
};

/** P1 written by one run and approved; the approval's automatic P2 run has finished. */
const approvedP1WithDesign = async () => {
	await send('P1', 'A to-do app for one person');
	const done = nextFinished();
	await orch.approve('todo', 'P1');
	await done;
};

/** Approves P2 and waits for the generation run that approval starts while there is no code. */
const approveP2 = async (opts: { override?: boolean } = {}) => {
	const done = nextFinished();
	await orch.approve('todo', 'P2', opts);
	const active = (await orch.snapshot('todo')).activeRun;
	if (active) await done;
	return active;
};

/** Approves P5 and waits for the deploy run that approval starts while there is no deployment. */
const approveP5 = async () => {
	const done = nextFinished();
	await orch.approve('todo', 'P5');
	if ((await orch.snapshot('todo')).activeRun) await done;
};

/** P1 and P2 approved; the generation run that P2's approval started has finished. */
const approvedP2WithCode = async () => {
	await approvedP1WithDesign();
	await approveP2();
};

/**
 * Code with a package.json, P4 approved; the test generation run its approval started has finished.
 * `fake.findings` stay out of the generation's checks (an open finding there starts a fix loop) and
 * are stored by a Run tests after it.
 */
const approvedP4WithTests = async () => {
	fake.code['package.json'] = '{}\n';
	await approvedP2WithCode();
	const findings = fake.findings;
	fake.findings = [];
	const done = nextFinished();
	await orch.approve('todo', 'P4');
	await done;
	fake.findings = findings;
	if (findings.length > 0) await orch.checkTests('todo');
};

const store = () => new ProjectStore(path.join(root, 'todo'));

const TEST_FILE = 'test/UC-001.test.ts';
const passed = (title: string): TestResult => ({
	name: `UC-001 Add task ${title}`,
	title,
	file: TEST_FILE,
	status: 'passed'
});
/** Every criterion of the to-do fixture covered and passing. */
const allTests = (): TestResult[] => [
	passed('REQ-001 AC1: added'),
	passed('REQ-001 AC2: empty title'),
	passed('REQ-002 AC1: list'),
	passed('REQ-002 AC2: order'),
	{ ...passed('REQ-003 AC1: manual: needs a restart'), status: 'todo' },
	passed('REQ-004 AC1: done')
];
const status = async (phase: 'P1' | 'P2' | 'P4') =>
	(await orch.snapshot('todo')).state.phases[phase].status;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-orch-'));
	fake = {
		reqs: fixture('todo-requirements.json'),
		design: fixture('todo-design.json'),
		cost: 0.01,
		hold: null,
		fail: null,
		calls: [],
		summaryFails: false,
		code: { 'src/task-api/Task.ts': 'export class Task {}\n' },
		codeEdits: {},
		generationChecks: false,
		generating: null,
		generateCalls: 0,
		checkCalls: 0,
		typecheckOk: true,
		typecheckTimedOut: false,
		checksFail: false,
		checksHold: null,
		noEntry: false,
		scaffoldOnly: false,
		generationFails: null,
		tests: {
			'test/UC-001.test.ts': "import { it } from 'vitest';\nit('REQ-001 AC1: added', () => {});\n"
		},
		testEdits: {},
		generateTestsCalls: 0,
		testCheckCalls: 0,
		testResults: allTests(),
		findings: [],
		testTimedOut: false,
		reports: [],
		deployEdits: {},
		deployRunPasses: false,
		runFailure: null,
		deployCheckCalls: [],
		deployCheckPasses: true,
		deployCheckError: null,
		deployCheckHold: null,
		ticketPlan: null,
		ticketReport: null,
		loopCalls: [],
		loopMessages: [],
		lastMessage: null,
		loopHold: null,
		loopChecks: false,
		proposals: null
	};
	orch = newOrchestrator();
	await orch.createProject('todo');
});

afterEach(async () => {
	fake.hold?.resolve();
	fake.deployCheckHold?.resolve();
	fake.checksHold?.resolve();
	fake.loopHold?.resolve();
	chatGate.hold = null;
	await rm(root, { recursive: true, force: true });
});

describe('projects', () => {
	it('creates and lists projects, rejects duplicates, bad names and unknown projects', async () => {
		await orch.createProject('booking');
		expect(await orch.listProjects()).toEqual(['booking', 'todo']);
		await expect(orch.createProject('todo')).rejects.toBeInstanceOf(ConflictError);
		await expect(orch.createProject('../x')).rejects.toBeInstanceOf(PathError);
		await expect(orch.snapshot('../x')).rejects.toBeInstanceOf(PathError);
		await expect(orch.snapshot('nope')).rejects.toBeInstanceOf(NotFoundError);
		const snap = await orch.snapshot('todo');
		expect(snap).toMatchObject({ requirements: null, design: null, diagrams: null, lastRun: null });
		expect(snap.state.phases.P1.status).toBe('not_started');
	});
});

describe('runs', () => {
	it('runs the agent in the background and records the result', async () => {
		fake.hold = deferred();
		const events: WorkspaceEvent[] = [];
		const off = subscribe('todo', (e) => events.push(e));
		const done = nextFinished();
		const { runId } = await orch.sendMessage('todo', 'P1', 'A to-do app for one person');

		let snap = await orch.snapshot('todo');
		expect(snap.activeRun).toEqual({ runId, phase: 'P1' });
		expect(snap.state.phases.P1.status).toBe('running');
		expect(snap.chat.P1).toMatchObject([{ role: 'user', text: 'A to-do app for one person' }]);

		fake.hold.resolve();
		expect(await done).toEqual({ type: 'run_finished', runId, status: 'done', costUsd: 0.011 });
		off();
		snap = await orch.snapshot('todo');
		expect(snap.activeRun).toBeNull();
		expect(snap.state.phases.P1.status).toBe('awaiting_approval');
		expect(snap.requirements?.requirements).toHaveLength(4);
		expect(snap.chat.P1.map((c) => [c.role, c.runId])).toEqual([
			['user', runId],
			['assistant', runId]
		]);
		expect(snap.lastRun).toMatchObject({
			id: runId,
			status: 'done',
			summary: 'summary',
			costUsd: 0.011,
			usage: { input: 101, output: 11 }
		});
		expect(snap.gates.P1.passed).toBe(true);
		expect(events.map((e) => e.type)).toEqual([
			'run_started',
			'changed',
			'tool_call',
			'agent_text',
			'run_finished',
			'changed'
		]);
		const log = await readFile(store().resolve(`.aise/runs/${runId}/events.jsonl`), 'utf8');
		expect(log.trim().split('\n')).toHaveLength(2);
	});

	it('rejects a second message or an approval while a run is active (Review Focus 1)', async () => {
		fake.hold = deferred();
		const done = nextFinished();
		const results = await Promise.allSettled([
			orch.sendMessage('todo', 'P1', 'first'),
			orch.sendMessage('todo', 'P1', 'second')
		]);
		expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
		const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(rejected.reason).toBeInstanceOf(ConflictError);

		await expect(orch.sendMessage('todo', 'P1', 'third')).rejects.toThrow(
			new ConflictError('A run is already active', 'run_active')
		);
		await expect(orch.approve('todo', 'P1')).rejects.toThrow(ConflictError);
		await expect(orch.editRequirements('todo', fake.reqs!)).rejects.toThrow(ConflictError);
		await expect(orch.discardLastRun('todo')).rejects.toThrow(ConflictError);

		fake.hold.resolve();
		await done;
		expect(await listRuns(store())).toHaveLength(1);
		expect((await orch.snapshot('todo')).chat.P1).toHaveLength(2);
	});

	it('marks a throwing run failed, keeps its artefacts and frees the project', async () => {
		fake.fail = new Error('boom');
		const { runId, finished } = await send('P1', 'A to-do app');
		expect(finished).toMatchObject({ runId, status: 'failed', error: 'boom' });
		const snap = await orch.snapshot('todo');
		expect(snap.lastRun).toMatchObject({ status: 'failed', error: 'boom' });
		expect(snap.state.phases.P1.status).toBe('awaiting_approval');
		expect(snap.activeRun).toBeNull();

		fake.fail = null;
		expect((await send('P1', 'again')).finished.status).toBe('done');
	});

	it('marks a failed run without artefacts not_started', async () => {
		fake.reqs = null;
		fake.fail = new Error('rate limited');
		await send('P1', 'A to-do app');
		expect(await status('P1')).toBe('not_started');
	});

	it('keeps the run status when the summary fails', async () => {
		fake.summaryFails = true;
		const { finished } = await send('P1', 'A to-do app');
		expect(finished).toMatchObject({ status: 'done', costUsd: 0.01 });
		const run = (await orch.snapshot('todo')).lastRun!;
		expect(run.status).toBe('done');
		expect(run.summary).toBeUndefined();
	});

	it('gives the agent the phase chat as merged text messages ending with the new message', async () => {
		fake.reqs = null;
		fake.fail = new Error('boom');
		await send('P1', 'first');
		fake.fail = null;
		await send('P1', 'second');
		await send('P1', 'third');
		expect(fake.calls[2].history).toEqual([
			{ role: 'user', content: 'first\n\nsecond' },
			{ role: 'assistant', content: 'requirements reply' },
			{ role: 'user', content: 'third' }
		]);
	});

	it('sums run costs per phase, including discarded runs', async () => {
		await send('P1', 'one');
		await send('P1', 'two');
		fake.cost = 0.5;
		await send('P1', 'three');
		await orch.discardLastRun('todo');
		const snap = await orch.snapshot('todo');
		expect(snap.costByPhase.P1).toBeCloseTo(0.523);
		expect(snap.costByPhase.P2).toBeUndefined();
	});

	it('leaves discarded runs out of the agent history and lists them in the snapshot', async () => {
		const { runId } = await send('P1', 'first');
		await orch.discardLastRun('todo');
		await send('P1', 'second');
		expect(fake.calls[1].history).toEqual([{ role: 'user', content: 'second' }]);
		const snap = await orch.snapshot('todo');
		expect(snap.discardedRunIds).toEqual([runId]);
		expect(snap.chat.P1.filter((c) => c.runId === runId)).toHaveLength(2);
	});

	it('requires an approved P1 before a P2 message (R14)', async () => {
		await expect(orch.sendMessage('todo', 'P2', 'design it')).rejects.toThrow(ConflictError);
		await send('P1', 'A to-do app');
		await expect(orch.sendMessage('todo', 'P2', 'design it')).rejects.toThrow(ConflictError);
	});
});

describe('approval', () => {
	it('rejects approving P2 before P1 is approved', async () => {
		await send('P1', 'A to-do app');
		await expect(orch.approve('todo', 'P2')).rejects.toThrow(/P1/);
		await expect(orch.approve('todo', 'P2')).rejects.toBeInstanceOf(ConflictError);
	});

	it('approves P1 anyway by turning open questions into assumptions, then starts P2', async () => {
		fake.reqs!.openQuestions = [
			{ id: 'Q-001', text: 'Do tasks have due dates?', reqIds: [] },
			{ id: 'Q-002', text: 'Is there a login?', reqIds: [] }
		];
		await send('P1', 'A to-do app');
		await expect(orch.approve('todo', 'P1')).rejects.toThrow(/No open questions/);

		const done = nextFinished();
		await orch.approve('todo', 'P1', { anyway: true });
		let snap = await orch.snapshot('todo');
		expect(snap.requirements?.openQuestions).toEqual([]);
		expect(snap.requirements?.assumptions.filter((a) => a.startsWith('Assumed: '))).toEqual([
			'Assumed: Do tasks have due dates?',
			'Assumed: Is there a login?'
		]);
		expect(snap.state.phases.P1.status).toBe('approved');
		expect(snap.activeRun?.phase).toBe('P2');
		expect(snap.chat.P2).toMatchObject([
			{ role: 'user', text: 'Create the design from the approved requirements.', auto: true }
		]);

		await done;
		snap = await orch.snapshot('todo');
		expect(snap.state.phases.P2.status).toBe('awaiting_approval');
		expect(snap.diagrams?.sequences).toHaveLength(1);
		expect(snap.gates.P2.passed).toBe(true);
		// no coverage report was made: shown as a warning, not blocking
		expect(snap.gates.P2.checks.at(-1)).toEqual({
			label: 'Acceptance criteria covered',
			ok: false,
			detail: 'not run yet',
			advisory: true
		});
	});

	it('records an override when approving with a failing gate', async () => {
		await approvedP1WithDesign();
		const reqs = fake.reqs!;
		reqs.requirements.push({ ...reqs.requirements[0], id: 'REQ-005', title: 'Delete task' });
		await orch.editRequirements('todo', reqs);
		await orch.approve('todo', 'P1');
		await expect(orch.approve('todo', 'P2')).rejects.toThrow(/Every must requirement linked/);
		await orch.approve('todo', 'P2', { override: true });
		const snap = await orch.snapshot('todo');
		// The design predates REQ-005, so the approval is stale at once and names it.
		expect(snap.state.phases.P2.status).toBe('stale');
		expect(snap.staleReqIds).toEqual(['REQ-005']);
		expect(snap.state.phases.P2.override?.failed).toEqual(['Every must requirement linked']);
	});

	it('refuses to approve P1 over a failing gate, even with override', async () => {
		fake.reqs = { ...fake.reqs!, requirements: [] };
		await send('P1', 'Nothing yet');
		await expect(orch.approve('todo', 'P1', { override: true })).rejects.toThrow(/P1 gate failed/);
		expect(await status('P1')).toBe('awaiting_approval');
	});

	it('approving P2 records the requirements the design was made from', async () => {
		await approvedP1WithDesign();
		const reqs = fake.reqs!;
		reqs.requirements[1].title = 'Changed while P2 waits';
		await orch.editRequirements('todo', reqs);
		await orch.approve('todo', 'P1');
		await approveP2();
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P2.status).toBe('stale');
		expect(snap.staleReqIds).toEqual([reqs.requirements[1].id]);
	});

	it('marks P2 stale after a requirement changes, and stillValid clears it', async () => {
		await approvedP1WithDesign();
		await approveP2();
		const p2 = (await orch.snapshot('todo')).state.phases.P2;
		expect(p2.status).toBe('approved');
		expect(Object.keys(p2.reqHashes ?? {})).toEqual(['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004']);

		const reqs = fake.reqs!;
		reqs.requirements[1].acceptanceCriteria = ['Tasks are ordered newest first.'];
		await orch.editRequirements('todo', reqs);
		let snap = await orch.snapshot('todo');
		expect(snap.state.phases.P1.status).toBe('awaiting_approval');
		expect(snap.state.phases.P2.status).toBe('stale');
		expect(snap.staleReqIds).toEqual(['REQ-002']);

		reqs.requirements = reqs.requirements.filter((r) => r.id !== 'REQ-003');
		await orch.editRequirements('todo', reqs);
		expect((await orch.snapshot('todo')).staleReqIds).toEqual(['REQ-002', 'REQ-003']);

		await expect(orch.stillValid('todo', 'P2')).rejects.toThrow(/P1/);
		await orch.approve('todo', 'P1');
		await orch.stillValid('todo', 'P2');
		snap = await orch.snapshot('todo');
		expect(snap.state.phases.P2.status).toBe('approved');
		expect(snap.staleReqIds).toEqual([]);
	});

	it('updateStale starts a P2 run with the changed IDs', async () => {
		await approvedP1WithDesign();
		await approveP2();
		await expect(orch.updateStale('todo', 'P2')).rejects.toThrow(ConflictError);
		const reqs = fake.reqs!;
		reqs.requirements[1].title = 'Show tasks';
		await orch.editRequirements('todo', reqs);
		await orch.approve('todo', 'P1');

		fake.design!.classes[0].description = 'Updated for REQ-002';
		const done = nextFinished();
		await orch.updateStale('todo', 'P2');
		await done;
		const snap = await orch.snapshot('todo');
		expect(snap.chat.P2.at(-2)).toMatchObject({
			role: 'user',
			text: 'The requirements changed: REQ-002. Update only the affected design elements.'
		});
		expect(snap.state.phases.P2.status).toBe('awaiting_approval');
		expect(snap.staleReqIds).toEqual([]);
	});
});

describe('approval across runs (I2)', () => {
	it('a P1 run that writes nothing or the same document leaves P1 approved', async () => {
		await approvedP1WithDesign();
		const approvedAt = (await orch.snapshot('todo')).state.phases.P1.approvedAt;
		const reqs = fake.reqs;
		fake.reqs = null;
		await send('P1', 'Why is REQ-003 a must?');
		expect((await orch.snapshot('todo')).state.phases.P1).toMatchObject({
			status: 'approved',
			approvedAt
		});
		fake.reqs = reqs;
		await send('P1', 'Write it again');
		expect(await status('P1')).toBe('approved');
	});

	it('a P2 question while P2 is stale keeps it stale', async () => {
		await approvedP1WithDesign();
		await approveP2();
		fake.reqs!.requirements[1].title = 'Show tasks';
		await orch.editRequirements('todo', fake.reqs!);
		await orch.approve('todo', 'P1');
		await send('P2', 'Which class handles REQ-002?');
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P2.status).toBe('stale');
		expect(snap.staleReqIds).toEqual(['REQ-002']);
	});

	it('a run that changes the artefact reopens the phase', async () => {
		await approvedP1WithDesign();
		await approveP2();
		fake.reqs!.requirements[0].title = 'Create task';
		await send('P1', 'Rename REQ-001');
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P1.status).toBe('awaiting_approval');
		expect(snap.state.phases.P2.status).toBe('stale');
		expect(snap.staleReqIds).toEqual(['REQ-001']);
	});

	it('discarding an Update run brings back the stale P2 with the changed IDs', async () => {
		await approvedP1WithDesign();
		await approveP2();
		const before = await readFile(store().resolve('.aise/design.json'), 'utf8');
		fake.reqs!.requirements[1].acceptanceCriteria = ['Tasks are ordered newest first.'];
		await orch.editRequirements('todo', fake.reqs!);
		await orch.approve('todo', 'P1');

		fake.design!.classes[0].description = 'Updated for REQ-002';
		const done = nextFinished();
		await orch.updateStale('todo', 'P2');
		await done;
		expect(await status('P2')).toBe('awaiting_approval');

		await orch.discardLastRun('todo');
		expect(await readFile(store().resolve('.aise/design.json'), 'utf8')).toBe(before);
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P2.status).toBe('stale');
		expect(snap.staleReqIds).toEqual(['REQ-002']);
	});

	it('discarding a P1 run restores the earlier approval and clears staleness', async () => {
		await approvedP1WithDesign();
		await approveP2();
		fake.reqs!.requirements[0].title = 'Create task';
		await send('P1', 'Rename REQ-001');
		expect(await status('P2')).toBe('stale');

		await orch.discardLastRun('todo');
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P1.status).toBe('approved');
		expect(snap.state.phases.P2.status).toBe('approved');
		expect(snap.staleReqIds).toEqual([]);
	});
});

describe('discard after a manual edit', () => {
	it('does not restore an approval over requirements edited by hand', async () => {
		await approvedP1WithDesign();
		const reqs = fake.reqs;
		fake.reqs = null;
		await send('P1', 'Why is REQ-003 a must?');
		expect(await status('P1')).toBe('approved');
		fake.reqs = reqs;
		reqs!.requirements[0].title = 'Edited by hand';
		await orch.editRequirements('todo', reqs!);
		expect(await status('P1')).toBe('awaiting_approval');

		await orch.discardLastRun('todo');
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P1.status).toBe('awaiting_approval');
		expect(snap.requirements?.requirements[0].title).toBe('Edited by hand');
	});
});

describe('discard guards', () => {
	it('refuses to discard a run whose files were edited afterwards', async () => {
		await send('P1', 'A to-do app');
		const reqs = fake.reqs!;
		reqs.requirements[0].title = 'Edited by hand';
		await orch.editRequirements('todo', reqs);
		await expect(orch.discardLastRun('todo')).rejects.toThrow(/files changed after this run/);
		expect((await orch.snapshot('todo')).requirements?.requirements[0].title).toBe(
			'Edited by hand'
		);
	});

	it('offers the earlier run once the latest is discarded', async () => {
		await approvedP1WithDesign();
		await orch.discardLastRun('todo');
		const snap = await orch.snapshot('todo');
		expect(snap.lastRun).toMatchObject({ phase: 'P2', status: 'discarded' });
		expect(snap.discardableRun).toMatchObject({ phase: 'P1', status: 'done' });
	});
});

describe('runs over unreadable artefacts', () => {
	it('keeps a done run done and moves the phase out of running', async () => {
		const s = store();
		fake.reqs = null;
		fake.hold = deferred();
		const done = nextFinished();
		await orch.sendMessage('todo', 'P1', 'hello');
		await s.writeFile('.aise/requirements.json', '{"broken": true}');
		fake.hold.resolve();
		await done;
		const snap = await orch.snapshot('todo').catch(() => null);
		const state = await readState(s);
		expect(state.phases.P1.status).not.toBe('running');
		expect(snap?.activeRun ?? null).toBeNull();
	});
});

describe('discard and restart', () => {
	it('discardLastRun after a P2 run restores the prior design.json', async () => {
		await approvedP1WithDesign();
		const before = await readFile(store().resolve('.aise/design.json'), 'utf8');
		fake.design!.actors[0].description = 'Changed by the second run';
		await send('P2', 'Rename things');
		expect(await readFile(store().resolve('.aise/design.json'), 'utf8')).not.toBe(before);

		await orch.discardLastRun('todo');
		expect(await readFile(store().resolve('.aise/design.json'), 'utf8')).toBe(before);
		const snap = await orch.snapshot('todo');
		expect(snap.lastRun?.status).toBe('discarded');
		expect(snap.state.phases.P2.status).toBe('awaiting_approval');
	});

	it('discarding the first P1 run removes the requirements and resets P1', async () => {
		await send('P1', 'A to-do app');
		await orch.discardLastRun('todo');
		expect(await status('P1')).toBe('not_started');
		expect((await orch.snapshot('todo')).requirements).toBeNull();
		await expect(orch.discardLastRun('todo')).rejects.toThrow(ConflictError);
	});

	it('marks a run left running as failed with "server restarted" (Review Focus 2)', async () => {
		const s = store();
		const state = await readState(s);
		state.phases.P1 = { status: 'running' };
		await writeState(s, state);
		const run = await createRun(s, 'P1', 'requirements');

		orch = newOrchestrator();
		const snap = await orch.snapshot('todo');
		expect(snap.lastRun).toMatchObject({ id: run.id, status: 'failed', error: 'server restarted' });
		expect(snap.lastRun?.finishedAt).toBeDefined();
		expect(snap.state.phases.P1.status).toBe('not_started');
		expect(snap.activeRun).toBeNull();
	});
});

describe('P4', () => {
	const gateP4 = async () => (await orch.snapshot('todo')).gates.P4;
	const taskFile = 'src/task-api/Task.ts';
	/** Changes the design through a P2 run and approves it again. */
	const changeDesign = async (edit: (d: DesignDoc) => void, opts: { override?: boolean } = {}) => {
		edit(fake.design!);
		await send('P2', 'Change the design');
		await approveP2(opts);
	};

	it('approving P2 without code starts a generation run; with code it does not', async () => {
		await approvedP1WithDesign();
		const done = nextFinished();
		await orch.approve('todo', 'P2');
		let snap = await orch.snapshot('todo');
		expect(snap.activeRun?.phase).toBe('P4');
		expect(snap.chat.P4).toMatchObject([
			{ role: 'user', text: 'Generate the code from the approved design.', auto: true }
		]);
		await done;
		snap = await orch.snapshot('todo');
		expect(snap.state.phases.P4.status).toBe('awaiting_approval');
		expect(snap.files).toEqual(['README.md', 'src/app/main.ts', taskFile]);
		expect(snap.lastRun).toMatchObject({ phase: 'P4', agent: 'code', status: 'done' });
		expect(snap.lastRun?.designHashes?.['DSN-001']).toBeDefined();

		await changeDesign((d) => (d.classes[0].description = 'Changed'));
		expect((await orch.snapshot('todo')).activeRun).toBeNull();
		expect(fake.generateCalls).toBe(1);
	});

	it('generateCode needs an approved P2 that is not stale', async () => {
		await approvedP1WithDesign();
		await expect(orch.generateCode('todo')).rejects.toThrow(/Approve P2/);
		fake.reqs!.requirements[1].title = 'Show tasks';
		await orch.editRequirements('todo', fake.reqs!);
		await orch.approve('todo', 'P1');
		await orch.approve('todo', 'P2');
		expect(await status('P2')).toBe('stale');
		await expect(orch.generateCode('todo')).rejects.toThrow(/P2 is stale/);
		expect(fake.generateCalls).toBe(0);
	});

	it('generateCode refuses a design with validation issues, and once code exists', async () => {
		await approvedP1WithDesign();
		// update_design refuses such a design; a hand edit (or MCP) can still leave one on disk.
		const broken = structuredClone(fake.design!);
		broken.classes[0].relations.push({ kind: 'association', targetId: 'DSN-404' });
		await store().writeFile('.aise/design.json', JSON.stringify(broken));
		expect(await approveP2({ override: true })).toBeNull();
		expect(await status('P2')).toBe('approved');
		await expect(orch.generateCode('todo')).rejects.toThrow(/design has issues.*DSN-404/);

		await changeDesign(() => {});
		expect(await status('P4')).toBe('awaiting_approval');
		await expect(orch.generateCode('todo')).rejects.toThrow(/exists already/);
		expect(fake.generateCalls).toBe(1);
	});

	it('a P4 run ends with the checks and the gate passes on clean checks', async () => {
		await approvedP2WithCode();
		expect(fake.checkCalls).toBe(1);
		const snap = await orch.snapshot('todo');
		expect(snap.gates.P4).toEqual({
			passed: true,
			checks: [
				{ label: 'Code exists', ok: true },
				{ label: 'App entry exists', ok: true },
				{ label: 'Typecheck passes', ok: true },
				{ label: 'Code matches the design', ok: true },
				{ label: 'App starts', ok: true }
			]
		});
		expect(snap.checks?.codeHash).toBe(await codeHash(store()));
		expect(snap.lastRun).toMatchObject({ costUsd: 0.201, summary: 'summary' });

		// A pipeline that ran the checks itself is not checked again.
		fake.generationChecks = true;
		await orch.discardLastRun('todo');
		await orch.generateCode('todo');
		await nextFinished();
		expect(fake.checkCalls).toBe(2);
	});

	it('a P4 chat run ends with the checks', async () => {
		await approvedP2WithCode();
		fake.codeEdits = { [taskFile]: 'export class Task { id = 0; }\n' };
		await send('P4', 'Add an id');
		expect(fake.checkCalls).toBe(2);
		expect((await gateP4()).passed).toBe(true);
	});

	it('records a checks failure in the run and leaves the gate unchecked', async () => {
		await approvedP1WithDesign();
		fake.checksFail = true;
		const done = nextFinished();
		await orch.approve('todo', 'P2');
		expect(await done).toMatchObject({
			status: 'failed',
			error: 'The checks could not run: Docker is not running'
		});
		expect(await status('P4')).toBe('awaiting_approval');
		expect((await gateP4()).checks[2]).toEqual({
			label: 'Typecheck passes',
			ok: false,
			detail: 'not run yet'
		});
	});

	it('a hand edit after the checks turns the gate out of date (Review Focus 3)', async () => {
		await approvedP2WithCode();
		await writeFile(store().resolve(taskFile), 'export class Task { edited = true; }\n');
		const gate = await gateP4();
		expect(gate.passed).toBe(false);
		expect(gate.checks.slice(2)).toEqual([
			{ label: 'Typecheck passes', ok: false, detail: 'out of date' },
			{ label: 'Code matches the design', ok: false, detail: 'out of date' },
			{ label: 'App starts', ok: false, detail: 'out of date' }
		]);
		await orch.checkCode('todo');
		expect((await gateP4()).passed).toBe(true);
	});

	it('approving P4 over a failing gate needs override and is recorded', async () => {
		fake.typecheckOk = false;
		await approvedP2WithCode();
		await expect(orch.approve('todo', 'P4')).rejects.toThrow(/P4 gate failed: Typecheck passes/);
		await orch.approve('todo', 'P4', { override: true });
		const p4 = (await orch.snapshot('todo')).state.phases.P4;
		expect(p4.status).toBe('approved');
		expect(p4.override?.failed).toEqual(['Typecheck passes', 'App starts']);
	});

	it('a design change on a class makes P4 stale; a description change does not', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		await changeDesign((d) => (d.classes[0].description = 'Only the description'));
		expect(await status('P4')).toBe('approved');

		// Stale as soon as a P2 run changes the class, and still after P2 is approved again.
		fake.design!.classes[0].attributes.push({ name: 'note', type: 'string' });
		await send('P2', 'Add a note to tasks');
		expect(await status('P4')).toBe('stale');
		await approveP2();
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P4.status).toBe('stale');
		expect(snap.staleDesignIds).toEqual(['DSN-001']);
	});

	it('a P4 chat run does not refresh the design hashes, so P4 stays stale', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		await changeDesign((d) => d.classes[0].attributes.push({ name: 'note', type: 'string' }));
		fake.codeEdits = { [taskFile]: 'export class Task { note = ""; }\n' };
		fake.hold = deferred();
		const done = nextFinished();
		await orch.sendMessage('todo', 'P4', 'Add the note');
		expect((await orch.snapshot('todo')).staleDesignIds).toEqual(['DSN-001']);
		fake.hold.resolve();
		fake.hold = null;
		await done;
		// Awaiting approval for the chat change, and still showing what the design changed.
		let snap = await orch.snapshot('todo');
		expect(snap.state.phases.P4.status).toBe('awaiting_approval');
		expect(snap.staleDesignIds).toEqual(['DSN-001']);

		// An Update from there clears the IDs; discarding it brings them back.
		fake.codeEdits = { [taskFile]: 'export class Task { note = "x"; }\n' };
		const updated = nextFinished();
		await orch.updateStale('todo', 'P4');
		await updated;
		expect((await orch.snapshot('todo')).staleDesignIds).toEqual([]);
		await orch.discardLastRun('todo');
		expect((await orch.snapshot('todo')).staleDesignIds).toEqual(['DSN-001']);

		await orch.checkCode('todo');
		await orch.approve('todo', 'P4');
		snap = await orch.snapshot('todo');
		expect(snap.state.phases.P4.status).toBe('stale');
		expect(snap.staleDesignIds).toEqual(['DSN-001']);
	});

	it('refuses to approve a stale P4', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		await changeDesign((d) => d.classes[0].attributes.push({ name: 'note', type: 'string' }));
		await expect(orch.approve('todo', 'P4')).rejects.toThrow(
			new ConflictError('P4 is stale: choose Update or Still valid')
		);
	});

	it('P4 is approved again with no stale IDs once the design returns to the stored hashes', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		const original = structuredClone(fake.design!);
		await changeDesign((d) => d.classes[0].attributes.push({ name: 'note', type: 'string' }));
		expect(await status('P4')).toBe('stale');
		fake.design = original;
		await changeDesign(() => {});
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P4.status).toBe('approved');
		expect(snap.staleDesignIds).toEqual([]);
	});

	it('discarding the P2 run that made P4 stale makes it approved again', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		fake.design!.classes[0].attributes.push({ name: 'note', type: 'string' });
		await send('P2', 'Add a note to tasks');
		expect(await status('P4')).toBe('stale');
		await orch.discardLastRun('todo');
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P4.status).toBe('approved');
		expect(snap.staleDesignIds).toEqual([]);
	});

	it('P4 actions need P2 approved and not stale', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		fake.reqs!.requirements[1].title = 'Show tasks';
		await orch.editRequirements('todo', fake.reqs!);
		expect(await status('P2')).toBe('stale');
		await expect(orch.sendMessage('todo', 'P4', 'hi')).rejects.toThrow(/P2 is stale/);
		await expect(orch.approve('todo', 'P4')).rejects.toThrow(/P2 is stale/);
		await expect(orch.stillValid('todo', 'P4')).rejects.toThrow(/P2 is stale/);
		await expect(orch.updateStale('todo', 'P4')).rejects.toThrow(/P2 is stale/);
		await expect(orch.generateCode('todo')).rejects.toThrow(/P2 is stale/);
	});

	it('a P4 chat message needs code', async () => {
		await approvedP2WithCode();
		await orch.discardLastRun('todo');
		await expect(orch.sendMessage('todo', 'P4', 'hi')).rejects.toThrow(
			new ConflictError('Generate the code first')
		);
	});

	it('P4 chat runs get 40 turns', async () => {
		await approvedP2WithCode();
		await send('P4', 'Explain the code');
		expect(fake.calls.at(-1)).toMatchObject({ agent: 'code', maxTurns: 40 });
	});

	it('a typecheck timeout fails the run and the gate shows it', async () => {
		await approvedP2WithCode();
		fake.typecheckTimedOut = true;
		const { finished } = await send('P4', 'Explain the code');
		expect(finished).toMatchObject({ status: 'failed', error: 'Typecheck timed out' });
		expect((await gateP4()).checks[2]).toEqual({
			label: 'Typecheck passes',
			ok: false,
			detail: 'timed out'
		});
	});

	it('checkCode stores a timed out typecheck for the gate', async () => {
		await approvedP2WithCode();
		fake.typecheckTimedOut = true;
		await orch.checkCode('todo');
		expect((await gateP4()).checks[2]).toMatchObject({ ok: false, detail: 'timed out' });
	});

	it('checkCode is refused during a run and during another action', async () => {
		await approvedP2WithCode();
		fake.hold = deferred();
		const done = nextFinished();
		await orch.sendMessage('todo', 'P4', 'Explain the code');
		await expect(orch.checkCode('todo')).rejects.toThrow(
			new ConflictError('A run is already active', 'run_active')
		);
		fake.hold.resolve();
		await done;

		fake.checksHold = deferred();
		const first = orch.checkCode('todo');
		await expect(orch.checkCode('todo')).rejects.toThrow(
			new ConflictError('Another action is running', 'busy')
		);
		fake.checksHold.resolve();
		await first;
	});

	it('a failed automatic start leaves P2 approved and reports a failed run', async () => {
		await approvedP1WithDesign();
		// A folder where the P4 chat log goes makes recording the run's first message fail.
		await mkdir(store().resolve('.aise/chat/P4.jsonl'), { recursive: true });
		const done = nextFinished();
		await orch.approve('todo', 'P2');
		expect(await done).toMatchObject({ status: 'failed' });
		const snap = await orch.snapshot('todo').catch(() => null);
		expect((await readState(store())).phases.P2.status).toBe('approved');
		expect(snap?.activeRun ?? null).toBeNull();
	});

	it('projectDir resolves a project folder and validates the name', () => {
		expect(orch.projectDir('todo')).toBe(path.join(root, 'todo'));
		expect(() => orch.projectDir('../x')).toThrow(PathError);
	});

	it('updateStale starts a code agent run with the changed, added and removed IDs', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		await expect(orch.updateStale('todo', 'P4')).rejects.toThrow(/P4 is not stale/);
		await changeDesign(
			(d) => {
				d.classes[0].attributes.push({ name: 'note', type: 'string' });
				d.classes = d.classes.filter((c) => c.id !== 'DSN-005');
				d.components[1].classIds = ['DSN-010'];
				d.classes.push({ ...d.classes[0], id: 'DSN-010', name: 'Tag', reqIds: [] });
			},
			{ override: true }
		);
		expect(await status('P4')).toBe('stale');
		fake.codeEdits = { [taskFile]: 'export class Task { note = ""; }\n' };
		const done = nextFinished();
		const { runId } = await orch.updateStale('todo', 'P4');
		await done;
		expect(fake.calls.at(-1)?.agent).toBe('code');
		const snap = await orch.snapshot('todo');
		expect(snap.chat.P4.find((c) => c.runId === runId && c.role === 'user')?.text).toBe(
			updateBrief(['DSN-001', 'DSN-007'], ['DSN-010'], ['DSN-005'], snap.design)
		);
		expect(snap.state.phases.P4.status).toBe('awaiting_approval');
		await orch.approve('todo', 'P4');
		expect((await orch.snapshot('todo')).state.phases.P4.status).toBe('approved');
	});

	it('a failed Update run that changed files keeps P4 stale', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		await changeDesign((d) => d.classes[0].attributes.push({ name: 'note', type: 'string' }));
		expect((await orch.snapshot('todo')).staleDesignIds).toEqual(['DSN-001']);
		fake.codeEdits = { [taskFile]: 'export class Task { note = ""; }\n' };
		fake.fail = new Error('boom');
		const done = nextFinished();
		await orch.updateStale('todo', 'P4');
		expect(await done).toMatchObject({ status: 'failed' });
		fake.fail = null;
		expect((await orch.snapshot('todo')).staleDesignIds).toEqual(['DSN-001']);
	});

	it('a done Update run that touched no file still adopts the design hashes', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		await changeDesign((d) => d.classes[0].attributes.push({ name: 'note', type: 'string' }));
		expect((await orch.snapshot('todo')).staleDesignIds).toEqual(['DSN-001']);
		fake.codeEdits = {};
		const done = nextFinished();
		await orch.updateStale('todo', 'P4');
		expect(await done).toMatchObject({ status: 'done' });
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P4.designHashes).toEqual(designHashes(snap.design!));
		expect(snap.staleDesignIds).toEqual([]);
		expect(snap.state.phases.P4.status).not.toBe('stale');
	});

	it('stillValid re-approves a stale P4 with the current hashes', async () => {
		await approvedP2WithCode();
		await expect(orch.stillValid('todo', 'P4')).rejects.toThrow(/P4 is not stale/);
		await orch.approve('todo', 'P4');
		await changeDesign((d) => d.classes[0].attributes.push({ name: 'note', type: 'string' }));
		expect(await status('P4')).toBe('stale');
		await orch.stillValid('todo', 'P4');
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P4.status).toBe('approved');
		expect(snap.state.phases.P4.designHashes).toEqual(designHashes(snap.design!));
		expect(snap.staleDesignIds).toEqual([]);
	});

	it('stillValid leaves the P4 gate out of date, not green, until the checks run again', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		expect((await gateP4()).passed).toBe(true);
		await changeDesign((d) => d.classes[0].attributes.push({ name: 'note', type: 'string' }));
		await orch.stillValid('todo', 'P4');
		const gate = await gateP4();
		expect(gate.passed).toBe(false);
		expect(gate.checks.slice(2)).toEqual([
			{ label: 'Typecheck passes', ok: false, detail: 'out of date' },
			{ label: 'Code matches the design', ok: false, detail: 'out of date' },
			{ label: 'App starts', ok: false, detail: 'out of date' }
		]);
		await orch.checkCode('todo');
		expect((await gateP4()).passed).toBe(true);
	});

	it('fails the App entry check when the wiring step left no src/app/main.ts', async () => {
		fake.noEntry = true;
		await approvedP2WithCode();
		expect((await gateP4()).checks).toEqual([
			{ label: 'Code exists', ok: true },
			{ label: 'App entry exists', ok: false, detail: 'src/app/main.ts' },
			{ label: 'Typecheck passes', ok: true },
			{ label: 'Code matches the design', ok: true },
			{ label: 'App starts', ok: false, detail: 'no app entry' }
		]);
		expect((await gateP4()).passed).toBe(false);
	});

	it('fails the App entry check while an extra service node has no entry, also on approval', async () => {
		fake.design!.nodes.push({ id: 'DSN-020', name: 'Live', kind: 'service', reqIds: [] });
		await approvedP2WithCode();
		expect((await gateP4()).checks[1]).toEqual({
			label: 'App entry exists',
			ok: false,
			detail: 'src/app/live.ts'
		});
		await expect(orch.approve('todo', 'P4')).rejects.toThrow('App entry exists');
	});

	it('syncs the start scripts after each run and lists the entry of a removed node in the Update brief', async () => {
		const service = (id: string, name: string) => ({
			id,
			name,
			kind: 'service' as const,
			reqIds: []
		});
		const pkg = (scripts: Record<string, string>) =>
			`${JSON.stringify({ name: 'todo', scripts }, null, '\t')}\n`;
		const scripts = async () => JSON.parse((await store().readText('package.json'))!).scripts;
		fake.design!.nodes.push(service('DSN-020', 'Old'), service('DSN-022', 'Keep'));
		fake.code['src/app/old.ts'] = 'export {};\n';
		fake.code['src/app/keep.ts'] = 'export {};\n';
		fake.code['package.json'] = pkg({ start: 'tsx src/app/main.ts', test: 'vitest run' });
		// the pipeline ran the checks itself, so the synced package.json needs them again
		fake.generationChecks = true;
		await approvedP2WithCode();
		expect(await scripts()).toEqual({
			start: 'tsx src/app/main.ts',
			'start:old': 'tsx src/app/old.ts',
			'start:keep': 'tsx src/app/keep.ts',
			test: 'vitest run'
		});
		expect((await gateP4()).passed).toBe(true);

		// P4 stays unapproved: approving it would start the test generation
		await changeDesign((d) => {
			d.nodes = d.nodes.filter((n) => n.id !== 'DSN-020');
			d.nodes.push(service('DSN-021', 'Live'));
		});
		fake.codeEdits = { 'src/app/live.ts': 'export {};\n' };
		const done = nextFinished();
		const { runId } = await orch.updateStale('todo', 'P4');
		await done;
		const brief = (await orch.snapshot('todo')).chat.P4.find(
			(c) => c.runId === runId && c.role === 'user'
		)?.text;
		expect(brief).toContain(
			'Entries of service nodes the design no longer has; delete them with delete_file:\n- src/app/old.ts\n\n'
		);
		// the run left src/app/old.ts, so its script stays and the next Update brief names it again
		expect(await scripts()).toEqual({
			start: 'tsx src/app/main.ts',
			'start:keep': 'tsx src/app/keep.ts',
			'start:live': 'tsx src/app/live.ts',
			'start:old': 'tsx src/app/old.ts',
			test: 'vitest run'
		});
	});

	it('a failed first generation that wrote only the scaffold stores no design hashes', async () => {
		await approvedP1WithDesign();
		fake.scaffoldOnly = true;
		const done = nextFinished();
		await orch.approve('todo', 'P2');
		expect(await done).toMatchObject({ status: 'failed', error: 'boom' });
		fake.design!.classes[0].name = 'Renamed';
		await send('P2', 'Change the design');
		const snap = await orch.snapshot('todo');
		expect(snap.files).toEqual(['package.json']);
		expect(snap.state.phases.P4.designHashes).toBeUndefined();
		expect(snap.staleDesignIds).toEqual([]);
	});

	it('a generation run writes README.md from the design; discarding the run removes it', async () => {
		await approvedP2WithCode();
		const readme = () => store().readText('README.md');
		expect(await readme()).toContain(`| Task | \`${taskFile}\` | DSN-001 |`);
		await orch.discardLastRun('todo');
		expect(await readme()).toBeNull();
	});

	it('the snapshot lists README.md once it exists, so the Code tab can show it', async () => {
		await approvedP2WithCode();
		expect((await orch.snapshot('todo')).files).toContain('README.md');
		await orch.discardLastRun('todo');
		expect((await orch.snapshot('todo')).files).not.toContain('README.md');
	});

	it('a P4 run that changes nothing leaves README.md alone, so it stays discardable after an edit', async () => {
		await approvedP2WithCode();
		await send('P4', 'What does Task do?');
		await writeFile(store().resolve(taskFile), 'export class Task { edited = true; }\n');
		await expect(orch.discardLastRun('todo')).resolves.toBeUndefined();
	});

	it('README.md lists only the planned files that exist', async () => {
		await approvedP2WithCode();
		const planned = Object.values(planPaths(fake.design!));
		expect(planned.length).toBeGreaterThan(2);
		const readme = (await store().readText('README.md'))!;
		expect(readme).toContain(`\`${taskFile}\``);
		for (const p of planned.filter((x) => x !== taskFile)) expect(readme).not.toContain(p);
	});

	it('a failed generation run that left code still renders README.md', async () => {
		await approvedP1WithDesign();
		fake.generationFails = 'worker failed';
		const finished = nextFinished();
		await orch.approve('todo', 'P2');
		expect(await finished).toMatchObject({ status: 'failed', error: 'worker failed' });
		expect(await store().readText('README.md')).toContain(`\`${taskFile}\``);
	});

	it('discarding a generation run removes its files', async () => {
		await approvedP2WithCode();
		await orch.discardLastRun('todo');
		const snap = await orch.snapshot('todo');
		expect(snap.files).toEqual([]);
		expect(snap.state.phases.P4.status).toBe('not_started');
	});

	it('refuses to discard a P4 run after the code changed by hand (Review Focus 4)', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		await writeFile(store().resolve(taskFile), 'export class Task { edited = true; }\n');
		await expect(orch.discardLastRun('todo')).rejects.toThrow(/files changed after this run/);
		expect(await readFile(store().resolve(taskFile), 'utf8')).toContain('edited');
		expect(await status('P4')).toBe('approved');
	});

	it('a restart marks a P4 run left running failed and settles P4', async () => {
		const s = store();
		const state = await readState(s);
		state.phases.P4 = { status: 'running' };
		await writeState(s, state);
		const run = await createRun(s, 'P4', 'code');
		orch = newOrchestrator();
		const snap = await orch.snapshot('todo');
		expect(snap.lastRun).toMatchObject({ id: run.id, status: 'failed', error: 'server restarted' });
		expect(snap.state.phases.P4.status).toBe('not_started');
	});

	it('a restart settles P4 left running without a run file', async () => {
		await approvedP2WithCode();
		const s = store();
		const state = await readState(s);
		state.phases.P4 = { ...state.phases.P4, status: 'running' };
		await writeState(s, state);
		orch = newOrchestrator();
		const snap = await orch.snapshot('todo');
		expect(snap.state.phases.P4.status).toBe('awaiting_approval');
		expect(snap.state.phases.P4.designHashes).toEqual(designHashes(snap.design!));
	});

	it('logs worker tool calls to the run events file without streaming them', async () => {
		await approvedP1WithDesign();
		fake.hold = deferred();
		fake.generating = deferred();
		const events: WorkspaceEvent[] = [];
		const off = subscribe('todo', (e) => events.push(e));
		const done = nextFinished();
		await orch.approve('todo', 'P2');
		await fake.generating.promise;
		const { runId } = (await orch.snapshot('todo')).activeRun!;
		fake.hold.resolve();
		await done;
		off();
		expect(events.filter((e) => e.type === 'tool_call')).toEqual([]);
		const log = (await readFile(store().resolve(`.aise/runs/${runId}/events.jsonl`), 'utf8'))
			.trim()
			.split('\n')
			.map((l) => JSON.parse(l));
		expect(log).toContainEqual(
			expect.objectContaining({
				type: 'worker',
				path: taskFile,
				attempt: 1,
				event: expect.objectContaining({ name: 'write_file' })
			})
		);
	});

	it('publishes codegen_file events and shows the latest status per file in the snapshot', async () => {
		await approvedP1WithDesign();
		fake.hold = deferred();
		fake.generating = deferred();
		const events: WorkspaceEvent[] = [];
		const off = subscribe('todo', (e) => events.push(e));
		const done = nextFinished();
		await orch.approve('todo', 'P2');
		await fake.generating.promise;
		const { runId } = (await orch.snapshot('todo')).activeRun!;
		expect((await orch.snapshot('todo')).codegen).toEqual({ [taskFile]: 'ok' });
		expect(events.filter((e) => e.type === 'codegen_file')).toEqual([
			{ type: 'codegen_file', runId, path: taskFile, status: 'writing', attempt: 1 },
			{ type: 'codegen_file', runId, path: taskFile, status: 'ok', attempt: 1 }
		]);
		expect(events).toContainEqual({ type: 'agent_text', runId, text: 'wired' });
		fake.hold.resolve();
		await done;
		off();
		expect((await orch.snapshot('todo')).codegen).toBeNull();
	});
});

describe('P5', () => {
	const taskFile = 'src/task-api/Task.ts';
	const snap = () => orch.snapshot('todo');
	const p5 = async () => (await snap()).state.phases.P5;
	const finding: Finding = {
		id: '20261121-100000-P5-1',
		runId: '20261121-100000-P5',
		test: 'REQ-001 AC2: empty title',
		file: TEST_FILE,
		reqId: 'REQ-001',
		explanation: 'An empty title is accepted.',
		proposedFix: 'Reject an empty title in addTask.'
	};
	/** REQ-001 AC2 fails with a message, as the finding says. */
	const failingAc2 = (): TestResult[] =>
		allTests().map((t) =>
			t.title === finding.test ? { ...t, status: 'failed', error: 'expected 400, got 201' } : t
		);

	const applyFix = async (id: string) => {
		const done = nextFinished();
		const { runId } = await orch.applyFix('todo', id);
		await done;
		return runId;
	};

	it('approving P4 starts test generation only when there are no tests', async () => {
		fake.code['package.json'] = '{}\n';
		await approvedP2WithCode();
		fake.hold = deferred();
		fake.generating = deferred();
		const events: WorkspaceEvent[] = [];
		const off = subscribe('todo', (e) => events.push(e));
		const done = nextFinished();
		await orch.approve('todo', 'P4');
		await fake.generating.promise;
		let s = await snap();
		const runId = s.activeRun!.runId;
		expect(s.activeRun?.phase).toBe('P5');
		expect(s.codegen).toEqual({ [TEST_FILE]: 'ok' });
		expect(s.chat.P5).toMatchObject([
			{
				role: 'user',
				text: 'Generate the tests from the approved requirements and design.',
				auto: true
			}
		]);
		fake.hold.resolve();
		await done;
		off();
		expect(events).toContainEqual({
			type: 'codegen_file',
			runId,
			path: TEST_FILE,
			status: 'ok',
			attempt: 1
		});
		expect(events).toContainEqual({ type: 'agent_text', runId, text: 'triaged' });
		s = await snap();
		expect(s.state.phases.P5.status).toBe('awaiting_approval');
		expect(s.files).toEqual(['README.md', 'package.json', 'src/app/main.ts', taskFile, TEST_FILE]);
		expect(s.lastRun).toMatchObject({ phase: 'P5', agent: 'test', status: 'done' });
		expect(s.codegen).toBeNull();
		// The pipeline ran the checks itself; they are not run again.
		expect(fake.testCheckCalls).toBe(1);
		expect(s.testChecks?.testHash).toBe(await testHash(store()));

		// A code change approved again starts nothing: the tests exist.
		fake.codeEdits = { [taskFile]: 'export class Task { id = 0; }\n' };
		await send('P4', 'Add an id');
		await orch.approve('todo', 'P4');
		expect((await snap()).activeRun).toBeNull();
		expect(fake.generateTestsCalls).toBe(1);
		expect(await p5()).toMatchObject({ status: 'awaiting_approval' });
	});

	it('approving P4 without a package.json starts no test run and does not fail', async () => {
		await approvedP2WithCode();
		await orch.approve('todo', 'P4');
		const s = await snap();
		expect(s.activeRun).toBeNull();
		expect(s.state.phases.P4.status).toBe('approved');
		await expect(orch.generateTests('todo')).rejects.toThrow(/package.json/);
		expect(fake.generateTestsCalls).toBe(0);
	});

	it('P5 actions need P4 approved and not stale; generateTests refuses once tests exist', async () => {
		fake.code['package.json'] = '{}\n';
		await approvedP2WithCode();
		await expect(orch.generateTests('todo')).rejects.toThrow(/Approve P4/);
		await expect(orch.sendMessage('todo', 'P5', 'hi')).rejects.toThrow(/Approve P4/);
		const done = nextFinished();
		await orch.approve('todo', 'P4');
		await done;
		await expect(orch.generateTests('todo')).rejects.toThrow(/exist already/);

		fake.design!.classes[0].attributes.push({ name: 'note', type: 'string' });
		await send('P2', 'Add a note to tasks');
		// P2 must be approved too; its approval leaves P4 stale.
		await expect(orch.generateTests('todo')).rejects.toThrow(/Approve P2/);
		await approveP2();
		expect((await snap()).state.phases.P4.status).toBe('stale');
		await expect(orch.generateTests('todo')).rejects.toThrow(/P4 is stale/);
		await expect(orch.sendMessage('todo', 'P5', 'hi')).rejects.toThrow(/P4 is stale/);
		await expect(orch.approve('todo', 'P5')).rejects.toThrow(/P4 is stale/);
		await expect(orch.applyFix('todo', finding.id)).rejects.toThrow(/P4 is stale/);
		await expect(orch.updateStale('todo', 'P5')).rejects.toThrow(/P4 is stale/);
		await expect(orch.stillValid('todo', 'P5')).rejects.toThrow(/P4 is stale/);
		expect(fake.generateTestsCalls).toBe(1);
	});

	it('a P5 chat run uses the test agent with 30 turns and ends with the test checks', async () => {
		await approvedP4WithTests();
		fake.testEdits = { [TEST_FILE]: '// renamed\n' };
		await send('P5', 'Rename a test');
		expect(fake.calls.at(-1)).toMatchObject({ agent: 'test', maxTurns: 30 });
		expect(fake.testCheckCalls).toBe(2);
		expect((await snap()).gates.P5.passed).toBe(true);
	});

	it('the gate passes on current checks and is out of date after a src/ or test/ edit (Review Focus 3)', async () => {
		await approvedP4WithTests();
		expect((await snap()).gates.P5).toEqual({
			passed: true,
			checks: [
				{ label: 'Tests exist', ok: true },
				{ label: 'Every must criterion has a test', ok: true },
				{ label: 'Tests type check', ok: true },
				{ label: 'All tests pass', ok: true }
			]
		});
		const outOfDate = [
			{ label: 'Tests type check', ok: false, detail: 'out of date' },
			{ label: 'All tests pass', ok: false, detail: 'out of date' }
		];
		await writeFile(store().resolve(taskFile), 'export class Task { edited = true; }\n');
		expect((await snap()).gates.P5.checks.slice(2)).toEqual(outOfDate);
		await orch.checkTests('todo');
		expect((await snap()).gates.P5.passed).toBe(true);
		await writeFile(store().resolve(TEST_FILE), '// edited\n');
		expect((await snap()).gates.P5.checks.slice(2)).toEqual(outOfDate);
		// Edits make the checks out of date, never P5 stale.
		expect(await p5()).toMatchObject({ status: 'awaiting_approval' });
	});

	it('approving P5 over a failing gate needs override and records the hashes', async () => {
		fake.testResults = failingAc2();
		await approvedP4WithTests();
		await expect(orch.approve('todo', 'P5')).rejects.toThrow(/P5 gate failed: All tests pass/);
		await orch.approve('todo', 'P5', { override: true });
		const state = await p5();
		expect(state.status).toBe('approved');
		expect(state.override?.failed).toEqual(['All tests pass']);
		expect(Object.keys(state.reqHashes ?? {})).toEqual([
			'REQ-001',
			'REQ-002',
			'REQ-003',
			'REQ-004'
		]);
		expect(Object.keys(state.useCaseHashes ?? {}).sort()).toEqual([
			'SEQ-001',
			'UC-001',
			'UC-002',
			'UC-003'
		]);
	});

	it('an approved P5 turns stale on a criterion change, not on a use case description change', async () => {
		await approvedP4WithTests();
		await approveP5();
		fake.design!.useCases[0].description = 'Only the description';
		await send('P2', 'Reword the use case');
		await approveP2();
		expect(await p5()).toMatchObject({ status: 'approved' });

		fake.reqs!.requirements[0].acceptanceCriteria.push('A title over 200 characters is rejected.');
		await orch.editRequirements('todo', fake.reqs!);
		await orch.approve('todo', 'P1');
		await orch.stillValid('todo', 'P2');
		const s = await snap();
		expect(s.state.phases.P5.status).toBe('stale');
		expect(s.staleTestIds).toEqual(['REQ-001']);
		await expect(orch.approve('todo', 'P5')).rejects.toThrow(/P5 is stale/);
	});

	it('an approved P5 turns stale on a sequence change, and back when that run is discarded', async () => {
		await approvedP4WithTests();
		await approveP5();
		fake.design!.sequences[0].messages.pop();
		await send('P2', 'Shorten the sequence');
		let s = await snap();
		expect(s.state.phases.P5.status).toBe('stale');
		expect(s.staleTestIds).toEqual(['SEQ-001']);
		// Sequences do not make the code stale.
		expect(s.state.phases.P4.status).toBe('approved');
		await orch.discardLastRun('todo');
		s = await snap();
		expect(s.state.phases.P5.status).toBe('approved');
		expect(s.staleTestIds).toEqual([]);
	});

	it('Update runs the test agent with the changed IDs; Still valid re-approves', async () => {
		await approvedP4WithTests();
		await approveP5();
		await expect(orch.updateStale('todo', 'P5')).rejects.toThrow(/P5 is not stale/);
		await expect(orch.stillValid('todo', 'P5')).rejects.toThrow(/P5 is not stale/);

		fake.reqs!.requirements[0].acceptanceCriteria.push('A title over 200 characters is rejected.');
		await orch.editRequirements('todo', fake.reqs!);
		await orch.approve('todo', 'P1');
		fake.design!.sequences[0].messages.pop();
		await send('P2', 'Shorten the sequence');
		await approveP2();
		expect((await snap()).staleTestIds).toEqual(['REQ-001', 'SEQ-001']);

		fake.testEdits = { [TEST_FILE]: '// updated\n' };
		fake.testResults = [...allTests(), passed('REQ-001 AC3: long title')];
		const done = nextFinished();
		const { runId } = await orch.updateStale('todo', 'P5');
		await done;
		expect(fake.calls.at(-1)?.agent).toBe('test');
		let s = await snap();
		expect(s.chat.P5.find((c) => c.runId === runId && c.role === 'user')?.text).toBe(
			testUpdateBrief(['REQ-001', 'SEQ-001'], [], [])
		);
		expect(s.staleTestIds).toEqual([]);
		expect(s.state.phases.P5.status).toBe('awaiting_approval');
		await approveP5();
		expect(await p5()).toMatchObject({ status: 'approved' });

		fake.design!.sequences[0].messages.pop();
		await send('P2', 'Shorten it again');
		await approveP2();
		expect(await p5()).toMatchObject({ status: 'stale' });
		await orch.stillValid('todo', 'P5');
		s = await snap();
		expect(s.state.phases.P5.status).toBe('approved');
		expect(s.staleTestIds).toEqual([]);
	});

	it('Apply fix runs the code agent on the finding, refreshes both checks and refuses a resolved finding', async () => {
		// A second failing test: the brief carries only the finding's own failure.
		fake.testResults = failingAc2().map((t) =>
			t.title === 'REQ-001 AC1: added' ? { ...t, status: 'failed', error: 'unrelated failure' } : t
		);
		fake.findings = [finding];
		await approvedP4WithTests();
		expect((await snap()).testChecks?.findings).toEqual([finding]);
		await expect(orch.applyFix('todo', 'nope')).rejects.toBeInstanceOf(ConflictError);

		fake.testResults = allTests();
		fake.codeEdits = { [taskFile]: 'export class Task { title = ""; }\n' };
		const [codeChecks, testChecks] = [fake.checkCalls, fake.testCheckCalls];
		const runId = await applyFix(finding.id);
		const call = fake.calls.at(-1)!;
		expect(call).toMatchObject({ agent: 'code', maxTurns: 40 });
		expect(call.history).toEqual([
			{
				role: 'user',
				content: fixBrief(finding, TEST_FILE, fake.tests[TEST_FILE]!, 'expected 400, got 201')
			}
		]);
		const s = await snap();
		expect(s.lastRun).toMatchObject({ id: runId, phase: 'P5', agent: 'code', status: 'done' });
		expect([fake.checkCalls, fake.testCheckCalls]).toEqual([codeChecks + 1, testChecks + 1]);
		const hash = await codeHash(store());
		expect(s.checks?.codeHash).toBe(hash);
		expect(s.testChecks?.codeHash).toBe(hash);
		expect(s.testChecks?.findings).toEqual([]);
		await expect(orch.applyFix('todo', finding.id)).rejects.toBeInstanceOf(ConflictError);
	});

	it('discarding an Apply fix run restores src/ and refuses after a later code or test edit (Review Focus 5)', async () => {
		fake.testResults = failingAc2();
		fake.findings = [finding];
		await approvedP4WithTests();
		await orch.approve('todo', 'P5', { override: true });
		const before = await readFile(store().resolve(taskFile), 'utf8');
		const fixed = 'export class Task { title = ""; }\n';
		fake.codeEdits = { [taskFile]: fixed };
		await applyFix(finding.id);
		expect(await p5()).toMatchObject({ status: 'awaiting_approval' });

		await writeFile(store().resolve(TEST_FILE), '// edited\n');
		await expect(orch.discardLastRun('todo')).rejects.toThrow(/files changed after this run/);
		await writeFile(store().resolve(TEST_FILE), fake.tests[TEST_FILE]!);
		await writeFile(store().resolve(taskFile), 'export class Task { other = 1; }\n');
		await expect(orch.discardLastRun('todo')).rejects.toThrow(/files changed after this run/);
		await writeFile(store().resolve(taskFile), fixed);

		await orch.discardLastRun('todo');
		expect(await readFile(store().resolve(taskFile), 'utf8')).toBe(before);
		expect(await p5()).toMatchObject({ status: 'approved' });
	});

	it('a restart marks a P5 run left running failed and settles P5', async () => {
		await approvedP4WithTests();
		const s = store();
		const state = await readState(s);
		state.phases.P5 = { ...state.phases.P5, status: 'running' };
		await writeState(s, state);
		const run = await createRun(s, 'P5', 'test');
		orch = newOrchestrator();
		const sn = await orch.snapshot('todo');
		expect(sn.lastRun).toMatchObject({ id: run.id, status: 'failed', error: 'server restarted' });
		expect(sn.state.phases.P5.status).toBe('awaiting_approval');
	});
});

describe('P5 review', () => {
	const taskFile = 'src/task-api/Task.ts';
	const snap = () => orch.snapshot('todo');
	const finding: Finding = {
		id: '20261121-100000-P5-1',
		runId: '20261121-100000-P5',
		test: 'REQ-001 AC2: empty title',
		file: TEST_FILE,
		reqId: 'REQ-001',
		explanation: 'An empty title is accepted.',
		proposedFix: 'Reject an empty title in addTask.'
	};
	const failingAc2 = (): TestResult[] =>
		allTests().map((t) =>
			t.title === finding.test ? { ...t, status: 'failed', error: 'expected 400, got 201' } : t
		);
	const outOfDate = /Run tests first, the results are out of date/;

	it('Apply fix refuses out of date results: after a src/ edit, a test/ edit, and a discarded generation', async () => {
		fake.testResults = failingAc2();
		fake.findings = [finding];
		await approvedP4WithTests();
		const original = await readFile(store().resolve(taskFile), 'utf8');
		await writeFile(store().resolve(taskFile), 'export class Task { edited = true; }\n');
		await expect(orch.applyFix('todo', finding.id)).rejects.toThrow(outOfDate);
		await writeFile(store().resolve(taskFile), original);
		await writeFile(store().resolve(TEST_FILE), '// edited\n');
		await expect(orch.applyFix('todo', finding.id)).rejects.toThrow(outOfDate);
		await writeFile(store().resolve(TEST_FILE), fake.tests[TEST_FILE]!);
		await orch.discardLastRun('todo');
		expect((await snap()).files).not.toContain(TEST_FILE);
		await expect(orch.applyFix('todo', finding.id)).rejects.toThrow(outOfDate);
		expect(fake.calls.some((c) => c.agent === 'code')).toBe(false);
	});

	it('Apply fix refuses a finding whose test passes in the stored result, or whose file is gone', async () => {
		await approvedP4WithTests();
		const base = (await snap()).testChecks!;
		await writeTestChecks(store(), { ...base, findings: [finding] });
		await expect(orch.applyFix('todo', finding.id)).rejects.toThrow(/no longer fails/);
		const ghost = { ...finding, file: 'test/UC-009.test.ts' };
		const failing: TestResult = {
			...passed(finding.test),
			file: ghost.file,
			status: 'failed',
			error: 'x'
		};
		const result = {
			...base.result!,
			ok: false,
			failed: 1,
			tests: [...base.result!.tests, failing]
		};
		await writeTestChecks(store(), { ...base, result, findings: [ghost] });
		await expect(orch.applyFix('todo', ghost.id)).rejects.toThrow(/no longer exists/);
	});

	it('discarding an Apply fix run brings back the finding and the pre-fix checks', async () => {
		fake.testResults = failingAc2();
		fake.findings = [finding];
		await approvedP4WithTests();
		const before = await snap();
		expect(before.gates.P5.checks[3]).toEqual({
			label: 'All tests pass',
			ok: false,
			detail: '1 failed'
		});
		fake.testResults = allTests();
		fake.codeEdits = { [taskFile]: 'export class Task { title = ""; }\n' };
		const done = nextFinished();
		await orch.applyFix('todo', finding.id);
		await done;
		let s = await snap();
		expect(s.testChecks?.findings).toEqual([]);
		expect(s.gates.P5.passed).toBe(true);

		await orch.discardLastRun('todo');
		s = await snap();
		expect(s.testChecks?.findings).toEqual([finding]);
		expect(findingOpen(finding, s.testChecks!.result)).toBe(true);
		expect(s.gates.P5).toEqual(before.gates.P5);
		expect(s.gates.P4).toEqual(before.gates.P4);
	});

	it('a requirement change before approval leaves P5 stale; the IDs survive a chat run until Still valid', async () => {
		await approvedP4WithTests();
		fake.reqs!.requirements[1].title = 'Show tasks';
		await orch.editRequirements('todo', fake.reqs!);
		await orch.approve('todo', 'P1');
		await orch.stillValid('todo', 'P2');
		await approveP5();
		let s = await snap();
		expect(s.state.phases.P5.status).toBe('stale');
		expect(s.staleTestIds).toEqual(['REQ-002']);

		fake.testEdits = { [TEST_FILE]: '// tidied\n' };
		await send('P5', 'Tidy a test');
		s = await snap();
		expect(s.state.phases.P5.status).toBe('awaiting_approval');
		expect(s.staleTestIds).toEqual(['REQ-002']);

		await orch.stillValid('todo', 'P5');
		s = await snap();
		expect(s.state.phases.P5.status).toBe('awaiting_approval');
		expect(s.staleTestIds).toEqual([]);
	});

	it('approving P4 over a failing gate starts no paid test generation', async () => {
		fake.code['package.json'] = '{}\n';
		fake.typecheckOk = false;
		await approvedP2WithCode();
		await orch.approve('todo', 'P4', { override: true });
		const s = await snap();
		expect(s.state.phases.P4.status).toBe('approved');
		expect(s.state.phases.P4.override?.failed).toEqual(['Typecheck passes', 'App starts']);
		expect(s.activeRun).toBeNull();
		expect(fake.generateTestsCalls).toBe(0);
	});

	it('a P4 approval that ends stale starts no test generation', async () => {
		fake.code['package.json'] = '{}\n';
		await approvedP2WithCode();
		fake.design!.classes[0].attributes.push({ name: 'note', type: 'string' });
		await send('P2', 'Add a note to tasks');
		await approveP2();
		await orch.approve('todo', 'P4', { override: true });
		const s = await snap();
		expect(s.state.phases.P4.status).toBe('stale');
		expect(s.activeRun).toBeNull();
		expect(fake.generateTestsCalls).toBe(0);
	});

	it('a requirement change marks P5 stale even while the design is unreadable', async () => {
		await approvedP4WithTests();
		await approveP5();
		await writeFile(store().resolve('.aise/design.json'), '{ not json');
		fake.reqs!.requirements[1].title = 'Show tasks';
		await orch.editRequirements('todo', fake.reqs!);
		expect((await readState(store())).phases.P5.status).toBe('stale');
	});

	it('a test run timeout fails the P5 run', async () => {
		await approvedP4WithTests();
		fake.testTimedOut = true;
		const { finished } = await send('P5', 'Run them again');
		expect(finished).toMatchObject({ status: 'failed', error: 'Test run timed out' });
	});
});

describe('P5 Explain failures, upstream readiness and discard', () => {
	const snap = () => orch.snapshot('todo');
	const finding: Finding = {
		id: '20261121-100000-P5-1',
		runId: '20261121-100000-P5',
		test: 'REQ-001 AC2: empty title',
		file: TEST_FILE,
		reqId: 'REQ-001',
		explanation: 'An empty title is accepted.',
		proposedFix: 'Reject an empty title in addTask.'
	};
	const fail = (title: string, error: string) => (t: TestResult) =>
		t.title === title ? { ...t, status: 'failed' as const, error } : t;
	/** AC2 fails (the finding's test) and AC1 fails without a finding. */
	const twoFailing = (): TestResult[] =>
		allTests()
			.map(fail(finding.test, 'expected 400, got 201'))
			.map(fail('REQ-001 AC1: added', 'expected 201, got 500'));
	const triage = async () => {
		const done = nextFinished();
		const { runId } = await orch.triageTests('todo');
		const finished = await done;
		return { runId, finished };
	};

	it('refuses without approved code, on out of date results, without failures and when every failure is explained', async () => {
		await expect(orch.triageTests('todo')).rejects.toThrow(/Approve P1/);
		fake.testResults = twoFailing();
		fake.findings = [finding];
		await approvedP4WithTests();
		await writeFile(store().resolve(TEST_FILE), '// edited\n');
		await expect(orch.triageTests('todo')).rejects.toThrow(/Run tests first/);
		await writeFile(store().resolve(TEST_FILE), fake.tests[TEST_FILE]!);

		fake.testResults = allTests();
		await orch.checkTests('todo');
		await expect(orch.triageTests('todo')).rejects.toThrow(/No test fails/);

		// A file that does not load is no triage case.
		const suite: TestResult = {
			name: TEST_FILE,
			title: TEST_FILE,
			file: TEST_FILE,
			status: 'failed',
			suite: true,
			error: 'SyntaxError'
		};
		fake.testResults = [...allTests(), suite];
		await orch.checkTests('todo');
		await expect(orch.triageTests('todo')).rejects.toThrow(/No test fails/);

		fake.testResults = allTests().map(fail(finding.test, 'expected 400, got 201'));
		await orch.checkTests('todo');
		await expect(orch.triageTests('todo')).rejects.toThrow(/already explained/);
		expect(fake.calls.some((c) => c.agent === 'test')).toBe(false);
	});

	it('runs the test agent on the unexplained failures only; its findings land in the checks', async () => {
		fake.testResults = twoFailing();
		fake.findings = [finding];
		await approvedP4WithTests();
		const ac1 = fake.testResults.find((t) => t.title === 'REQ-001 AC1: added')!;
		fake.reports = [
			{
				test: ac1.title,
				file: TEST_FILE,
				reqId: 'REQ-001',
				explanation: 'The service throws on add.',
				proposedFix: 'Catch nothing; fix addTask.'
			}
		];
		const checksBefore = fake.testCheckCalls;
		const { runId, finished } = await triage();
		expect(finished.status).toBe('done');
		const call = fake.calls.at(-1)!;
		expect(call).toMatchObject({ agent: 'test', maxTurns: 30 });
		expect(call.history).toEqual([{ role: 'user', content: triageBrief([ac1], 'log') }]);
		expect(JSON.stringify(call.history)).not.toContain(finding.test);
		expect(fake.testCheckCalls).toBe(checksBefore + 1);

		const s = await snap();
		expect(s.lastRun).toMatchObject({ id: runId, phase: 'P5', agent: 'test', status: 'done' });
		expect(s.chat.P5.find((c) => c.runId === runId && c.role === 'user')).toMatchObject({
			text: 'Explain the failing tests.',
			auto: true
		});
		expect(s.testChecks?.findings).toEqual([
			finding,
			{ ...fake.reports[0], id: `${runId}-1`, runId }
		]);
		await expect(orch.triageTests('todo')).rejects.toThrow(/already explained/);
	});

	it('records a test the triage changed without a report', async () => {
		fake.testResults = twoFailing();
		await approvedP4WithTests();
		fake.testEdits = { [TEST_FILE]: '// weakened\n' };
		const { runId } = await triage();
		expect((await snap()).testChecks?.testFixes).toEqual([
			{
				runId,
				test: 'UC-001.test.ts',
				file: TEST_FILE,
				reason: 'changed during triage without a report'
			}
		]);
	});

	it('P5 actions name the upstream phase: P1 reopened by a requirement edit, then P2 stale', async () => {
		await approvedP4WithTests();
		await approveP5();
		fake.reqs!.requirements[0].acceptanceCriteria.push('A title over 200 characters is rejected.');
		await orch.editRequirements('todo', fake.reqs!);
		let s = await snap();
		expect(s.state.phases.P1.status).toBe('awaiting_approval');
		expect(s.state.phases.P2.status).toBe('stale');
		expect(s.state.phases.P4.status).toBe('approved');
		expect(s.state.phases.P5.status).toBe('stale');
		await expect(orch.updateStale('todo', 'P5')).rejects.toThrow(/Approve P1/);
		await expect(orch.stillValid('todo', 'P5')).rejects.toThrow(/Approve P1/);

		await orch.approve('todo', 'P1');
		s = await snap();
		expect(s.state.phases.P2.status).toBe('stale');
		expect(s.activeRun).toBeNull();
		const p2Stale = /P2 is stale/;
		await expect(orch.updateStale('todo', 'P5')).rejects.toThrow(p2Stale);
		await expect(orch.stillValid('todo', 'P5')).rejects.toThrow(p2Stale);
		await expect(orch.approve('todo', 'P5')).rejects.toThrow(p2Stale);
		await expect(orch.applyFix('todo', finding.id)).rejects.toThrow(p2Stale);
		await expect(orch.triageTests('todo')).rejects.toThrow(p2Stale);
		await expect(orch.generateTests('todo')).rejects.toThrow(p2Stale);
		await expect(orch.sendMessage('todo', 'P5', 'hi')).rejects.toThrow(p2Stale);
		expect(fake.calls.some((c) => c.agent === 'test' || c.agent === 'code')).toBe(false);
	});

	it('discarding an Apply fix run that changed only README.md leaves the current checks', async () => {
		fake.testResults = twoFailing();
		fake.findings = [finding];
		await approvedP4WithTests();
		// The design gained a class since generation, so the fix run rewrites README.md.
		await writeFile(store().resolve('README.md'), 'stale\n');
		fake.testResults = allTests();
		const done = nextFinished();
		await orch.applyFix('todo', finding.id);
		await done;
		expect(await store().readText('README.md')).not.toBe('stale\n');
		const current = (await snap()).testChecks;
		expect(current?.findings).toEqual([]);
		await orch.discardLastRun('todo');
		expect(await store().readText('README.md')).toBe('stale\n');
		expect((await snap()).testChecks).toEqual(current);
	});

	it('discarding a P5 run that changed no file leaves the current checks', async () => {
		await approvedP4WithTests();
		await send('P5', 'Which tests cover REQ-001?');
		fake.testResults = twoFailing();
		await orch.checkTests('todo');
		const current = (await snap()).testChecks;
		expect(current?.result?.failed).toBe(2);
		await orch.discardLastRun('todo');
		expect((await snap()).testChecks).toEqual(current);
	});
});

describe('P5 fix loop', () => {
	const taskFile = 'src/task-api/Task.ts';
	const snap = () => orch.snapshot('todo');
	const finding: Finding = {
		id: '20261121-100000-P5-1',
		runId: '20261121-100000-P5',
		test: 'REQ-001 AC2: empty title',
		file: TEST_FILE,
		reqId: 'REQ-001',
		explanation: 'An empty title is accepted.',
		proposedFix: 'Reject an empty title in addTask.'
	};
	const failingAc2 = (): TestResult[] =>
		allTests().map((t) =>
			t.title === finding.test ? { ...t, status: 'failed', error: 'expected 400, got 201' } : t
		);
	/** Tests passing, P4 approved; then AC2 fails with an open finding in the stored checks. */
	const withOpenFinding = async () => {
		fake.testResults = failingAc2();
		fake.findings = [finding];
		await approvedP4WithTests();
	};
	const runLoop = async () => {
		const done = nextFinished();
		const { runId } = await orch.fixLoop('todo');
		const finished = await done;
		return { runId, finished };
	};
	const loopRuns = async () => (await listRuns(store())).filter((r) => r.fixLoop);
	const p4Checks = '.aise/checks/P4.json';
	const p5Checks = '.aise/checks/P5.json';

	it('fix loop refuses without approved code, on out of date results and when no test fails', async () => {
		await expect(orch.fixLoop('todo')).rejects.toThrow(/Approve P1/);
		await approvedP4WithTests();
		await expect(orch.fixLoop('todo')).rejects.toThrow('No test fails, nothing to fix');
		// A file that does not load is no case for the loop either.
		const suite: TestResult = {
			name: TEST_FILE,
			title: TEST_FILE,
			file: TEST_FILE,
			status: 'failed',
			suite: true,
			error: 'SyntaxError'
		};
		fake.testResults = [...allTests(), suite];
		await orch.checkTests('todo');
		await expect(orch.fixLoop('todo')).rejects.toThrow('No test fails, nothing to fix');

		fake.testResults = failingAc2();
		await orch.checkTests('todo');
		await writeFile(store().resolve(TEST_FILE), '// edited\n');
		await expect(orch.fixLoop('todo')).rejects.toThrow(/Run tests first/);
		expect(fake.loopCalls).toEqual([]);
		expect(await loopRuns()).toEqual([]);
	});

	it('fix loop refuses stored checks without a test result, whatever their findings', async () => {
		await approvedP4WithTests();
		const base = (await snap()).testChecks!;
		await writeTestChecks(store(), { ...base, result: null, findings: [finding] });
		await expect(orch.fixLoop('todo')).rejects.toThrow(/there is no test result/);
		expect(await loopRuns()).toEqual([]);
	});

	it('fix loop starts a P5 run of the test agent that ends with both checks and the README', async () => {
		await withOpenFinding();
		await writeFile(store().resolve('README.md'), 'stale\n');
		fake.testResults = allTests();
		fake.codeEdits = { [taskFile]: 'export class Task { title = ""; }\n' };
		const [codeChecks, testChecks] = [fake.checkCalls, fake.testCheckCalls];
		const { runId, finished } = await runLoop();
		expect(finished).toMatchObject({ runId, status: 'done' });
		expect(fake.loopCalls).toHaveLength(1);
		const ctx = fake.loopCalls[0]!;
		expect(ctx).toMatchObject({ runId, projectName: 'todo', agent: 'test' });
		expect(ctx.writeOnly).toBeUndefined();
		const run = (await listRuns(store())).find((r) => r.id === runId)!;
		expect(run).toMatchObject({ phase: 'P5', agent: 'test', fixLoop: true, status: 'done' });
		expect(run.reqHashes).toBeUndefined();
		expect(run.useCaseHashes).toBeUndefined();
		// The loop did not run the checks itself, so the run ends with both.
		expect([fake.checkCalls, fake.testCheckCalls]).toEqual([codeChecks + 1, testChecks + 1]);
		expect(await store().readText('README.md')).not.toBe('stale\n');
		const s = await snap();
		expect(s.testChecks?.findings).toEqual([]);
		expect(s.state.phases.P4.status).toBe('approved');
		expect(s.chat.P5.find((e) => e.runId === runId)).toEqual({
			role: 'user',
			text: FIX_LOOP_MESSAGE,
			at: expect.any(String),
			runId,
			auto: true
		});
	});

	it('fix loop publishes, logs and records every handoff in the P5 chat with from and to', async () => {
		await withOpenFinding();
		fake.testResults = allTests();
		fake.loopMessages = [
			{ from: 'test', to: 'code', text: `Please fix ${finding.id}`, findingIds: [finding.id] },
			{ from: 'code', to: 'test', text: `${finding.id} fixed`, findingIds: [finding.id] },
			{ from: 'checks', to: 'test', text: 'Round 1: 5 passed, 0 failed', findingIds: [] }
		];
		const events: WorkspaceEvent[] = [];
		const off = subscribe('todo', (e) => events.push(e));
		const { runId } = await runLoop();
		off();
		const expected = fake.loopMessages.map((m, i) => ({
			type: 'agent_message',
			runId,
			...m,
			seq: i + 1
		}));
		expect(events.filter((e) => e.type === 'agent_message')).toEqual(expected);
		expect(events).toContainEqual({ type: 'agent_text', runId, text: 'loop reply' });
		const log = (await readFile(store().resolve(`.aise/runs/${runId}/events.jsonl`), 'utf8'))
			.trim()
			.split('\n')
			.map((l) => JSON.parse(l));
		const logged = log.filter((e) => e.type === 'agent_message');
		expect(logged).toEqual(
			fake.loopMessages.map((m, i) => ({
				at: expect.any(String),
				type: 'agent_message',
				...m,
				seq: i + 1
			}))
		);
		const chat = (await snap()).chat.P5.filter((e) => e.runId === runId);
		const handoffs = fake.loopMessages.map(({ from, to, text }, i) => ({
			role: 'assistant',
			text,
			at: expect.any(String),
			runId,
			auto: true,
			from,
			to,
			seq: i + 1
		}));
		expect(chat).toEqual([
			expect.objectContaining({ role: 'user', text: FIX_LOOP_MESSAGE }),
			...handoffs,
			expect.objectContaining({ role: 'assistant', text: 'Fix loop: 1 round.' })
		]);
	});

	it('a test generation run that left an open code bug finding hands over to a fix loop on the same claim', async () => {
		fake.code['package.json'] = '{}\n';
		await approvedP2WithCode();
		fake.testResults = failingAc2();
		fake.findings = [finding];
		const events: WorkspaceEvent[] = [];
		let during: unknown;
		const off = subscribe('todo', (e) => {
			events.push(e);
			// A click the moment generation finishes finds the claim still held.
			if (e.type === 'run_finished' && during === undefined)
				during = orch.fixLoop('todo').catch((err: unknown) => err);
		});
		const loopDone = new Promise<void>((resolve) => {
			const stop = subscribe('todo', (e) => {
				if (e.type === 'run_finished' && fake.loopCalls.length > 0) {
					stop();
					resolve();
				}
			});
		});
		await orch.approve('todo', 'P4');
		await loopDone;
		off();
		expect(await during).toMatchObject({ code: 'run_active' });
		const runs = [...(await listRuns(store()))].sort((a, b) =>
			a.startedAt.localeCompare(b.startedAt)
		);
		const [gen, loop] = runs.slice(-2);
		expect(gen).toMatchObject({ phase: 'P5', agent: 'test', status: 'done' });
		expect(gen!.fixLoop).toBeUndefined();
		expect(loop).toMatchObject({ phase: 'P5', agent: 'test', fixLoop: true, status: 'done' });
		expect(await loopRuns()).toHaveLength(1);
		// The generation run is reported finished before the loop starts.
		const order = events
			.filter((e) => e.type === 'run_started' || e.type === 'run_finished')
			.map((e) => `${e.type} ${e.runId}`);
		expect(order.slice(-4)).toEqual([
			`run_started ${gen!.id}`,
			`run_finished ${gen!.id}`,
			`run_started ${loop!.id}`,
			`run_finished ${loop!.id}`
		]);
		const genFinished = events.findIndex((e) => e.type === 'run_finished' && e.runId === gen!.id);
		expect(events[genFinished + 1]).toEqual({ type: 'changed' });
		expect((await snap()).activeRun).toBeNull();
	});

	it('a fix loop that cannot start after test generation leaves the project free', async () => {
		fake.code['package.json'] = '{}\n';
		await approvedP2WithCode();
		fake.testResults = failingAc2();
		fake.findings = [finding];
		const internals = orch as unknown as { startFixLoop: () => Promise<string> };
		const start = vi.spyOn(internals, 'startFixLoop').mockRejectedValueOnce(new Error('boom'));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const events: WorkspaceEvent[] = [];
		// The generation's run_finished and changed, then the failure and the changed of the release.
		const released = new Promise<void>((resolve) => {
			let finished = 0;
			const off = subscribe('todo', (e) => {
				events.push(e);
				if (e.type === 'run_finished') finished++;
				else if (finished === 2 && e.type === 'changed') {
					off();
					resolve();
				}
			});
		});
		await orch.approve('todo', 'P4');
		await released;
		expect(start).toHaveBeenCalledTimes(1);
		expect(logged).toHaveBeenCalledWith(
			expect.stringMatching(/could not start the run after run/),
			expect.any(Error)
		);
		logged.mockRestore();
		// The developer sees why nothing followed, as when an automatic run cannot start.
		const finishes = events.filter((e) => e.type === 'run_finished');
		expect(finishes.at(-1)).toEqual({
			type: 'run_finished',
			runId: '',
			status: 'failed',
			error: 'boom',
			costUsd: 0
		});
		expect(await loopRuns()).toEqual([]);
		expect((await snap()).activeRun).toBeNull();
		const { finished } = await runLoop();
		expect(finished).toMatchObject({ status: 'done' });
		expect(await loopRuns()).toHaveLength(1);
	});

	it('a test generation run without an open code bug finding, or one that failed, starts no fix loop', async () => {
		fake.testResults = failingAc2();
		await approvedP4WithTests();
		expect(fake.loopCalls).toEqual([]);
		expect(await loopRuns()).toEqual([]);
		expect((await snap()).activeRun).toBeNull();

		// A failed generation hands nothing over, even with an open finding.
		await orch.discardLastRun('todo');
		await rm(store().resolve('test'), { recursive: true, force: true });
		fake.findings = [finding];
		fake.generationFails = 'triage stopped';
		const done = nextFinished();
		const changed = new Promise<void>((resolve) => {
			let finished = false;
			const off = subscribe('todo', (e) => {
				if (e.type === 'run_finished') finished = true;
				else if (finished && e.type === 'changed') {
					off();
					resolve();
				}
			});
		});
		await orch.generateTests('todo');
		expect(await done).toMatchObject({ status: 'failed' });
		await changed;
		expect((await snap()).testChecks?.findings).toEqual([finding]);
		expect(fake.loopCalls).toEqual([]);
		expect((await snap()).activeRun).toBeNull();
	});

	it('the generation file progress is gone while the fix loop it handed over to runs', async () => {
		fake.code['package.json'] = '{}\n';
		await approvedP2WithCode();
		fake.testResults = failingAc2();
		fake.findings = [finding];
		fake.loopHold = deferred();
		// The generation's run_started, then the loop's.
		const started = new Promise<string>((resolve) => {
			let p5 = 0;
			const off = subscribe('todo', (e) => {
				if (e.type === 'run_started' && e.phase === 'P5' && ++p5 === 2) {
					off();
					resolve(e.runId);
				}
			});
		});
		await orch.approve('todo', 'P4');
		const loopId = await started;
		await vi.waitFor(() => expect(fake.loopCalls).toHaveLength(1));
		const s = await snap();
		expect(s.activeRun).toMatchObject({ runId: loopId, phase: 'P5' });
		expect(s.codegen).toBeNull();
		const done = nextFinished();
		fake.loopHold.resolve();
		await done;
	});

	it('the handoffs stay before the run reply in the chat when the last one comes as the loop ends', async () => {
		await withOpenFinding();
		fake.testResults = allTests();
		fake.lastMessage = {
			from: 'checks',
			to: 'test',
			text: 'Round 1: 5 passed, 0 failed',
			findingIds: []
		};
		// The handoff is written slowly; the run must wait for it before its own reply.
		chatGate.hold = new Promise((resolve) => setTimeout(resolve, 150));
		const { runId } = await runLoop();
		const chat = (await snap()).chat.P5.filter((e) => e.runId === runId);
		expect(chat.map((e) => e.text)).toEqual([
			FIX_LOOP_MESSAGE,
			'Round 1: 5 passed, 0 failed',
			'Fix loop: 1 round.'
		]);
	});

	it('a later P5 chat run reads the code agent and checks handoffs with their speaker', async () => {
		await withOpenFinding();
		fake.testResults = allTests();
		fake.loopMessages = [
			{ from: 'test', to: 'code', text: `Please fix ${finding.id}`, findingIds: [finding.id] },
			{ from: 'code', to: 'test', text: `${finding.id} fixed`, findingIds: [finding.id] },
			{ from: 'checks', to: 'test', text: 'Round 1: 5 passed, 0 failed', findingIds: [] }
		];
		await runLoop();
		await send('P5', 'What did the loop change?');
		const history = fake.calls.at(-1)!.history as { role: string; content: string }[];
		const loopTurn = history.find((m) => m.content.includes(`Please fix ${finding.id}`))!;
		expect(loopTurn.role).toBe('assistant');
		expect(loopTurn.content).toBe(
			[
				`Please fix ${finding.id}`,
				`Code agent: ${finding.id} fixed`,
				'Checks: Round 1: 5 passed, 0 failed',
				'Fix loop: 1 round.'
			].join('\n\n')
		);
	});

	it('discarding a fix loop run restores src/, test/ and both checks files (Review Focus 1)', async () => {
		await withOpenFinding();
		const files = [taskFile, TEST_FILE, p4Checks, p5Checks];
		const before = await Promise.all(files.map((f) => store().readText(f)));
		fake.testResults = allTests();
		fake.loopChecks = true;
		fake.codeEdits = { [taskFile]: 'export class Task { title = ""; }\n' };
		fake.testEdits = {
			[TEST_FILE]: "import { it } from 'vitest';\nit('REQ-001 AC2: x', () => {});\n"
		};
		const [codeChecks, testChecks] = [fake.checkCalls, fake.testCheckCalls];
		await runLoop();
		// The loop ran both checks last: no final checks on top.
		expect([fake.checkCalls, fake.testCheckCalls]).toEqual([codeChecks + 1, testChecks + 1]);
		const after = await Promise.all(files.map((f) => store().readText(f)));
		for (const [i, f] of files.entries()) expect(after[i], f).not.toBe(before[i]);

		await orch.discardLastRun('todo');
		expect(await Promise.all(files.map((f) => store().readText(f)))).toEqual(before);
		const s = await snap();
		expect(s.testChecks?.findings).toEqual([finding]);
	});

	it('two fix loop calls in a row give one run (Review Focus 2)', async () => {
		await withOpenFinding();
		fake.hold = deferred();
		const both = await Promise.allSettled([orch.fixLoop('todo'), orch.fixLoop('todo')]);
		expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
		const rejected = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(rejected.reason).toBeInstanceOf(ConflictError);
		await expect(orch.fixLoop('todo')).rejects.toMatchObject({ code: 'run_active' });
		const done = nextFinished();
		fake.hold.resolve();
		await done;
		expect(await loopRuns()).toHaveLength(1);
		expect(fake.loopCalls).toHaveLength(1);
	});

	it('a restart marks an interrupted fix loop run failed and a new fix loop then works (Review Focus 4)', async () => {
		await withOpenFinding();
		const s = store();
		const state = await readState(s);
		state.phases.P5 = { ...state.phases.P5, status: 'running' };
		await writeState(s, state);
		const run = await createRun(s, 'P5', 'test');
		await updateRun(s, run.id, { fixLoop: true });
		orch = newOrchestrator();
		const sn = await snap();
		expect(sn.lastRun).toMatchObject({
			id: run.id,
			fixLoop: true,
			status: 'failed',
			error: 'server restarted'
		});
		expect(sn.state.phases.P5.status).not.toBe('running');
		expect(sn.activeRun).toBeNull();
		const { runId, finished } = await runLoop();
		expect(finished).toMatchObject({ runId, status: 'done' });
	});
});

describe('P6', () => {
	const COMPOSE = `services:
  app-server:
    build: .
    command: npm start
    environment:
      PORT: "8080"
      DB_PATH: /data/app.db
      ADMIN_PASSWORD: change-me-admin-password
    ports: ['127.0.0.1:8080:8080']
    volumes: ['data:/data']
volumes:
  data: {}
`;
	const DEPLOY = {
		Dockerfile: 'FROM node:22-slim\n',
		'compose.yaml': COMPOSE,
		'RUN.md': '# Run\n'
	};
	const RUN_LINK = 'Run it with Docker: see [RUN.md](RUN.md).';
	const URLS = ['http://localhost:8080/health'];
	const snap = () => orch.snapshot('todo');
	const p6 = async () => (await snap()).state.phases.P6;
	const text = (rel: string) => readFile(store().resolve(rel), 'utf8');
	const put = (rel: string, content: string) => writeFile(store().resolve(rel), content);
	const pkg = async () => JSON.parse(await text('package.json')) as Record<string, unknown>;
	const design = async () => (await store().readJson('.aise/design.json', DesignDoc))!;

	beforeEach(() => {
		fake.code['package.json'] = '{}\n';
		// A variable the plan does not set: the brief gives it a placeholder.
		fake.code['src/task-api/Task.ts'] =
			'export class Task {}\nexport const pw = process.env.ADMIN_PASSWORD;\n';
		fake.deployEdits = { ...DEPLOY };
		fake.deployRunPasses = true;
	});

	/** Code and tests approved up to P4; the test generation run its approval started has finished. */
	const approvedP4WithTests = async () => {
		await approvedP2WithCode();
		const done = nextFinished();
		await orch.approve('todo', 'P4');
		await done;
	};

	/** P5 approved; the deploy run its approval started has finished. */
	const approvedP5WithDeploy = async () => {
		await approvedP4WithTests();
		const done = nextFinished();
		await orch.approve('todo', 'P5');
		await done;
	};

	it('names the planned services in the snapshot, and none while package.json is unreadable', async () => {
		await approvedP5WithDeploy();
		expect((await snap()).deployServices).toEqual([
			{ name: 'app-server', healthUrl: 'http://localhost:8080/health' }
		]);
		await put('package.json', '{ not json');
		expect((await snap()).deployServices).toEqual([]);
	});

	/**
	 * The deployment approved, then the start script edited by hand and a P6 question asked;
	 * returns the package.json from before the edit.
	 */
	const staleByStartScript = async () => {
		await approvedP5WithDeploy();
		await orch.approve('todo', 'P6');
		const p = await pkg();
		await put('package.json', JSON.stringify({ ...p, scripts: { start: 'node other.js' } }));
		fake.deployEdits = {};
		await send('P6', 'Why port 8080?');
		return p;
	};

	it('approving P5 starts the deploy run with the plan, 25 turns, $1 and 3 checks', async () => {
		await approvedP4WithTests();
		fake.hold = deferred();
		const done = nextFinished();
		await orch.approve('todo', 'P5');
		let s = await snap();
		expect(s.activeRun?.phase).toBe('P6');
		expect(s.chat.P6).toMatchObject([{ role: 'user', text: GENERATE_DEPLOY_MESSAGE, auto: true }]);
		fake.hold.resolve();
		expect(await done).toMatchObject({ status: 'done' });

		const plan = deployPlan(await design(), await pkg());
		const call = fake.calls.at(-1)!;
		expect(call).toMatchObject({
			agent: 'deploy',
			maxTurns: 25,
			costLimitUsd: 1,
			deployChecksLeft: 3
		});
		expect(call.history).toEqual([
			{ role: 'user', content: deployBrief(plan, 'todo', ['ADMIN_PASSWORD']) }
		]);
		s = await snap();
		expect(s.state.phases.P5.status).toBe('approved');
		expect(s.state.phases.P6).toEqual({
			status: 'awaiting_approval',
			deployHashes: deployHashes(await design(), await pkg())
		});
		expect(s.files).toEqual(expect.arrayContaining(['Dockerfile', 'RUN.md', 'compose.yaml']));
		expect(s.deployCheck?.passed).toBe(true);
		expect(s.gates.P6.passed).toBe(true);
		expect(s.staleDeployIds).toEqual([]);
		expect(await text('README.md')).toContain(RUN_LINK);

		// Every deploy run gets its own budget; other agents get none.
		await send('P6', 'Why port 8080?');
		expect(fake.calls.at(-1)).toMatchObject({
			agent: 'deploy',
			costLimitUsd: 1,
			deployChecksLeft: 3
		});
		expect(fake.calls[0]).toMatchObject({
			agent: 'requirements',
			costLimitUsd: undefined,
			deployChecksLeft: undefined
		});
	});

	it('an override starts no deploy run; Generate deployment does, and discarding it restores the files and the check', async () => {
		fake.testResults = allTests().map((t, i) => (i === 0 ? { ...t, status: 'failed' } : t));
		await approvedP4WithTests();
		await orch.approve('todo', 'P5', { override: true });
		expect((await snap()).activeRun).toBeNull();
		expect(fake.calls.some((c) => c.agent === 'deploy')).toBe(false);
		await expect(orch.sendMessage('todo', 'P6', 'hi')).rejects.toThrow(
			/Generate the deployment first/
		);
		const readme = await text('README.md');

		const done = nextFinished();
		await orch.generateDeployment('todo');
		await done;
		expect(fake.calls.at(-1)?.agent).toBe('deploy');
		expect(await p6()).toMatchObject({ status: 'awaiting_approval' });
		expect(await text('README.md')).toContain(RUN_LINK);
		await expect(orch.generateDeployment('todo')).rejects.toThrow(/exist already/);

		await orch.discardLastRun('todo');
		const s = await snap();
		expect(s.files).not.toContain('compose.yaml');
		expect(s.files).not.toContain('RUN.md');
		expect(s.deployCheck).toBeNull();
		expect(s.state.phases.P6).toEqual({ status: 'not_started' });
		expect(await text('README.md')).toBe(readme);
	});

	it('refuses to generate before P5 is approved, while it is stale and once a deploy file exists', async () => {
		await approvedP4WithTests();
		await expect(orch.generateDeployment('todo')).rejects.toThrow(/Approve P5/);
		await expect(orch.sendMessage('todo', 'P6', 'hi')).rejects.toThrow(/Approve P5/);

		// A compose.yaml written by hand: approving P5 starts nothing, Generate refuses.
		await put('compose.yaml', COMPOSE);
		await orch.approve('todo', 'P5');
		expect((await snap()).activeRun).toBeNull();
		await expect(orch.generateDeployment('todo')).rejects.toThrow(/exist already/);
		await send('P6', 'hi');

		const s = store();
		const state = await readState(s);
		state.phases.P5 = { ...state.phases.P5, status: 'stale' };
		await writeState(s, state);
		await expect(orch.generateDeployment('todo')).rejects.toThrow(/P5 is stale/);
		await expect(orch.approve('todo', 'P6')).rejects.toThrow(/P5 is stale/);
		expect(fake.calls.filter((c) => c.agent === 'deploy')).toHaveLength(1);
		expect(fake.calls.at(-1)?.history).toEqual([{ role: 'user', content: 'hi' }]);
	});

	it('checkDeploy probes the planned urls and stores the check; a ToolError is no exception', async () => {
		fake.deployRunPasses = false;
		await approvedP5WithDeploy();
		expect((await snap()).gates.P6.checks.at(-1)).toEqual({
			label: 'Deploy check passed',
			ok: false,
			detail: 'not run yet'
		});
		await orch.checkDeploy('todo');
		expect(fake.deployCheckCalls).toEqual([{ urls: URLS }]);
		expect((await snap()).gates.P6.passed).toBe(true);

		// Docker down after a pass for the same files: the tool keeps the pass, so the message must
		// reach the developer as an error.
		fake.deployCheckError = new ToolError(DOCKER_DOWN);
		const err = await orch.checkDeploy('todo').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ConflictError);
		expect((err as Error).message).toBe(DOCKER_DOWN);
		expect((await snap()).gates.P6.passed).toBe(true);

		// Once the files change, the same refusal is stored as a failed check: no error.
		await put('RUN.md', '# Run\n');
		await put('compose.yaml', `${COMPOSE}# edited\n`);
		await expect(orch.checkDeploy('todo')).resolves.toBeUndefined();
		const failedCheck = (await snap()).deployCheck;
		expect(failedCheck).toMatchObject({ passed: false });
		// A refusal for the same files stores nothing new, so its message comes back as an error.
		await expect(orch.checkDeploy('todo')).rejects.toThrow(DOCKER_DOWN);
		expect((await snap()).deployCheck).toEqual(failedCheck);
		fake.deployCheckError = new Error('disk full');
		await expect(orch.checkDeploy('todo')).rejects.toThrow(/disk full/);
	});

	it('approval records the hashes the run made the deployment from, not the current ones', async () => {
		await approvedP5WithDeploy();
		const p = await pkg();
		await put('package.json', JSON.stringify({ ...p, scripts: { start: 'node other.js' } }));
		await orch.approve('todo', 'P6', { override: true });
		const s = await snap();
		expect(s.state.phases.P6.status).toBe('stale');
		expect(s.staleDeployIds).toEqual(['DSN-008']);
	});

	it('checkDeploy tells other tabs at its start that a check is running', async () => {
		await approvedP5WithDeploy();
		fake.deployCheckHold = deferred();
		const events: WorkspaceEvent[] = [];
		const off = subscribe('todo', (e) => events.push(e));
		const checking = orch.checkDeploy('todo');
		await vi.waitFor(() => expect(fake.deployCheckCalls).toHaveLength(1));
		off();
		expect(events).toContainEqual({ type: 'changed' });
		expect((await snap()).deployCheckRunning).toBe(true);
		fake.deployCheckHold.resolve();
		await checking;
		expect((await snap()).deployCheckRunning).toBe(false);
	});

	it('checkDeploy needs compose.yaml and stores a refused check as failed (real tool, no Docker)', async () => {
		await approvedP2WithCode();
		orch = new Orchestrator({ root, run: fakeRun, summarise: fakeSummarise });
		await expect(orch.checkDeploy('todo')).rejects.toBeInstanceOf(ConflictError);
		await put('compose.yaml', COMPOSE.replace('build: .', 'build: .\n    restart: always'));
		await expect(orch.checkDeploy('todo')).resolves.toBeUndefined();
		const s = await snap();
		expect(s.deployCheck).toMatchObject({
			passed: false,
			services: [{ url: URLS[0], status: null }]
		});
		const gate = s.gates.P6.checks.at(-1)!;
		expect(gate.ok).toBe(false);
		expect(gate.detail).toMatch(/app-server no answer \(compose\.yaml is not allowed/);
	});

	it('approves P6 on a passing gate, needs override on a failing one, and records the hashes', async () => {
		fake.deployRunPasses = false;
		await approvedP5WithDeploy();
		await expect(orch.approve('todo', 'P6')).rejects.toThrow(/P6 gate failed: Deploy check passed/);
		await orch.approve('todo', 'P6', { override: true });
		const state = await p6();
		expect(state).toMatchObject({
			status: 'approved',
			override: { failed: ['Deploy check passed'] },
			deployHashes: deployHashes(await design(), await pkg())
		});
		await expect(orch.approve('todo', 'P6')).rejects.toThrow(/already approved/);
	});

	it('a cost limit fails the run with its message and keeps what it wrote', async () => {
		await approvedP4WithTests();
		fake.runFailure = { reason: 'cost_limit', error: 'cost limit ($1) reached' };
		const done = nextFinished();
		await orch.approve('todo', 'P5');
		expect(await done).toMatchObject({ status: 'failed', error: 'cost limit ($1) reached' });
		const s = await snap();
		expect(s.lastRun).toMatchObject({
			phase: 'P6',
			status: 'failed',
			error: 'cost limit ($1) reached'
		});
		expect(s.state.phases.P6.status).toBe('awaiting_approval');
		expect(s.activeRun).toBeNull();
	});

	it('turns stale on a start script or dependency change, not while package.json is unreadable', async () => {
		const p = await staleByStartScript();
		let s = await snap();
		expect(s.state.phases.P6.status).toBe('stale');
		expect(s.staleDeployIds).toEqual(['DSN-008']);
		await expect(orch.approve('todo', 'P6')).rejects.toThrow(/P6 is stale/);

		// The start script back, a dependency added.
		await put('package.json', JSON.stringify({ ...p, dependencies: { a: '1' } }));
		await send('P6', 'And now?');
		s = await snap();
		expect(s.state.phases.P6.status).toBe('stale');
		expect(s.staleDeployIds).toEqual(['dependencies']);

		await put('package.json', '{ not json');
		await send('P6', 'Still there?');
		s = await snap();
		expect(s.state.phases.P6.status).toBe('stale');
		expect(s.staleDeployIds).toEqual([]);

		await put('package.json', JSON.stringify(p));
		await send('P6', 'And back?');
		expect(await p6()).toMatchObject({ status: 'approved' });
	});

	it('an unreadable package.json leaves an approved P6 approved', async () => {
		await approvedP5WithDeploy();
		await orch.approve('todo', 'P6');
		await put('package.json', '{ not json');
		fake.deployEdits = {};
		await send('P6', 'Why port 8080?');
		expect(await p6()).toMatchObject({ status: 'approved' });
	});

	it('turns stale on a link change, not on a class change', async () => {
		await approvedP5WithDeploy();
		await orch.approve('todo', 'P6');
		fake.design!.classes[0].attributes.push({ name: 'note', type: 'string' });
		await send('P2', 'Add a note to tasks');
		await approveP2();
		let s = await snap();
		expect(s.state.phases.P4.status).toBe('stale');
		expect(s.state.phases.P6.status).toBe('approved');

		fake.design!.nodes.push({ id: 'DSN-009', name: 'Mail service', kind: 'external', reqIds: [] });
		fake.design!.links.push({ from: 'DSN-008', to: 'DSN-009', protocol: 'https' });
		await send('P2', 'Send mail');
		await approveP2({ override: true });
		s = await snap();
		expect(s.state.phases.P6.status).toBe('stale');
		expect(s.staleDeployIds).toEqual(['DSN-008']);
	});

	it('Update runs the deploy agent with the changed node; Still valid re-approves', async () => {
		await approvedP5WithDeploy();
		await orch.approve('todo', 'P6');
		await expect(orch.updateStale('todo', 'P6')).rejects.toThrow(/P6 is not stale/);
		await expect(orch.stillValid('todo', 'P6')).rejects.toThrow(/P6 is not stale/);
		const p = await pkg();
		await put('package.json', JSON.stringify({ ...p, scripts: { start: 'node other.js' } }));
		fake.deployEdits = {};
		await send('P6', 'Why port 8080?');
		expect(await p6()).toMatchObject({ status: 'stale' });

		fake.deployEdits = { 'RUN.md': '# Run, updated\n' };
		const done = nextFinished();
		await orch.updateStale('todo', 'P6');
		await done;
		const plan = deployPlan(await design(), await pkg());
		const call = fake.calls.at(-1)!;
		expect(call).toMatchObject({ agent: 'deploy', costLimitUsd: 1, deployChecksLeft: 3 });
		expect(call.history).toEqual([
			{
				role: 'user',
				content: deployUpdateBrief(plan, ['DSN-008'], [], [], await design(), ['ADMIN_PASSWORD'])
			}
		]);
		let s = await snap();
		expect(s.chat.P6.at(-2)).toMatchObject({ role: 'user', auto: true });
		expect(s.chat.P6.at(-2)?.text).toContain('DSN-008');
		expect(s.staleDeployIds).toEqual([]);
		expect(s.state.phases.P6).toMatchObject({
			status: 'awaiting_approval',
			deployHashes: deployHashes(await design(), await pkg())
		});
		await orch.approve('todo', 'P6');

		await put('package.json', JSON.stringify({ ...p, scripts: { start: 'node third.js' } }));
		fake.deployEdits = {};
		await send('P6', 'Again?');
		expect(await p6()).toMatchObject({ status: 'stale' });
		await orch.stillValid('todo', 'P6');
		s = await snap();
		expect(s.state.phases.P6).toMatchObject({
			status: 'approved',
			deployHashes: deployHashes(await design(), await pkg())
		});
		expect(s.staleDeployIds).toEqual([]);
	});

	it('discarding a P6 run restores the files and deploy.json, and refuses after a later compose.yaml edit (Review Focus 5)', async () => {
		await approvedP5WithDeploy();
		await orch.approve('todo', 'P6');
		const check = await text('.aise/checks/deploy.json');
		const changed = `${COMPOSE}# with a note\n`;
		fake.deployEdits = { 'compose.yaml': changed };
		await send('P6', 'Add a note');
		expect(await text('.aise/checks/deploy.json')).not.toBe(check);
		expect(await p6()).toMatchObject({ status: 'awaiting_approval' });

		await put('compose.yaml', `${changed}# by hand\n`);
		await expect(orch.discardLastRun('todo')).rejects.toThrow(/files changed after this run/);
		await put('compose.yaml', changed);

		await orch.discardLastRun('todo');
		expect(await text('compose.yaml')).toBe(COMPOSE);
		expect(await text('.aise/checks/deploy.json')).toBe(check);
		const s = await snap();
		expect(s.state.phases.P6.status).toBe('approved');
		expect(s.gates.P6.passed).toBe(true);
	});

	it('approving hand written deploy files records hashes only from a readable package.json', async () => {
		await approvedP4WithTests();
		await put('compose.yaml', COMPOSE);
		await orch.approve('todo', 'P5');
		fake.deployEdits = {};
		await send('P6', 'hi');
		await put('package.json', '{ not json');
		await orch.approve('todo', 'P6', { override: true });
		expect((await p6()).deployHashes).toBeUndefined();
	});

	it('discarding a P6 run keeps the README link while RUN.md exists', async () => {
		await approvedP4WithTests();
		await put('compose.yaml', COMPOSE);
		await put('RUN.md', '# Run\n');
		await orch.approve('todo', 'P5');
		expect(await text('README.md')).not.toContain(RUN_LINK);
		fake.deployEdits = {};
		fake.deployRunPasses = false;
		await send('P6', 'Why port 8080?');
		expect(await text('README.md')).toContain(RUN_LINK);
		// The run changed only README.md; its backup has no link, but RUN.md is still there.
		await orch.discardLastRun('todo');
		expect(await text('README.md')).toContain(RUN_LINK);
	});

	it('a restart marks a P6 run left running failed and settles P6', async () => {
		await approvedP5WithDeploy();
		const s = store();
		const state = await readState(s);
		state.phases.P6 = { ...state.phases.P6, status: 'running' };
		await writeState(s, state);
		const run = await createRun(s, 'P6', 'deploy');
		orch = newOrchestrator();
		const sn = await orch.snapshot('todo');
		expect(sn.lastRun).toMatchObject({ id: run.id, status: 'failed', error: 'server restarted' });
		expect(sn.state.phases.P6).toMatchObject({
			status: 'awaiting_approval',
			deployHashes: deployHashes(await design(), await pkg())
		});
	});
});

describe('tickets', () => {
	const snap = () => orch.snapshot('todo');
	const input = {
		kind: 'change' as const,
		title: 'Due dates',
		description: 'Tasks need a due date.'
	};
	const plan: TicketPlan = { entry: 'P2', affectedIds: [], files: [], steps: ['Add a due date'] };

	/**
	 * P1 to P5 approved, written directly: tickets need P5 approved or stale. P2 keeps requirement
	 * hashes that match nothing on disk, so any staleness refresh would turn it stale.
	 */
	const allApproved = async () => {
		const s = await readState(store());
		for (const p of ['P1', 'P2', 'P4', 'P5'] as const) s.phases[p] = { status: 'approved' };
		s.phases.P2.reqHashes = { 'REQ-001': 'not on disk' };
		await writeState(store(), s);
	};

	const create = async () => {
		const done = nextFinished();
		const ids = await orch.createTicket('todo', input);
		return { ...ids, finished: await done };
	};

	const message = async (id: string, text: string) => {
		const done = nextFinished();
		const { runId } = await orch.sendTicketMessage('todo', id, text);
		return { runId, finished: await done };
	};

	const inProgress = (over: Partial<Ticket> = {}): Ticket => ({
		id: 'TCK-001',
		kind: 'change',
		title: 'Due dates',
		description: '',
		status: 'in_progress',
		createdAt: '2026-11-22T09:00:00.000Z',
		plan: { ...plan, entry: 'P1' },
		...over
	});

	it('refuses a ticket before P5 is approved or stale', async () => {
		await expect(orch.createTicket('todo', input)).rejects.toThrow(ConflictError);
		expect(await readTickets(store())).toEqual([]);
		expect(await listRuns(store())).toEqual([]);
	});

	it('allows a ticket while P5 is stale, or once a ticket exists', async () => {
		const s = await readState(store());
		s.phases.P5 = { status: 'stale' };
		await writeState(store(), s);
		await create();
		s.phases.P5 = { status: 'awaiting_approval' };
		await writeState(store(), s);
		await create();
		expect((await readTickets(store())).map((t) => t.id)).toEqual(['TCK-001', 'TCK-002']);
	});

	it('creates an open ticket and triages it in a P7 run with its own chat', async () => {
		await allApproved();
		const before = await readState(store());
		const { ticketId, runId, finished } = await create();
		expect(ticketId).toBe('TCK-001');
		expect(finished.status).toBe('done');
		const [t] = await readTickets(store());
		expect(t).toMatchObject({ id: 'TCK-001', status: 'open', ...input });
		const [run] = await listRuns(store());
		expect(run).toMatchObject({
			id: runId,
			phase: 'P7',
			agent: 'maintenance',
			ticketId: 'TCK-001',
			prevTicket: { status: 'open' }
		});
		expect(run.report).toBeUndefined();
		expect(run.prevPhase).toBeUndefined();
		expect(run.prevArtefactHash).toBeUndefined();
		// The model gets the fenced triage brief, the chat shows the plain message.
		expect(fake.calls).toEqual([
			{
				agent: 'maintenance',
				costLimitUsd: 1,
				history: [{ role: 'user', content: ticketTriageBrief(t) }],
				maxTurns: 20
			}
		]);
		expect(await readChat(store(), 'TCK-001')).toMatchObject([
			{ role: 'user', text: ticketMessage(t), runId },
			{ role: 'assistant', text: 'maintenance reply', runId }
		]);
		expect(await readChat(store(), 'P1')).toEqual([]);
		expect(await readChat(store(), 'P7')).toEqual([]);
		expect(await readState(store())).toEqual(before);
		// A P7 run runs no checks.
		expect(fake.checkCalls).toBe(0);
		expect(fake.testCheckCalls).toBe(0);
	});

	it('a triage run that writes a plan leaves the ticket triaged; P7 shows running, then awaiting approval', async () => {
		await allApproved();
		fake.ticketPlan = plan;
		fake.hold = deferred();
		const done = nextFinished();
		const { runId } = await orch.createTicket('todo', input);
		let s = await snap();
		expect(s.activeRun).toEqual({ runId, phase: 'P7', ticketId: 'TCK-001' });
		expect(s.state.phases.P7.status).toBe('running');
		fake.hold.resolve();
		await done;
		s = await snap();
		expect(s.activeRun).toBeNull();
		expect(s.state.phases.P7.status).toBe('awaiting_approval');
		const [t] = s.tickets;
		expect(t).toMatchObject({ id: 'TCK-001', status: 'triaged', plan, runIds: [runId] });
		expect(t.steps.map((x) => x.phase)).toEqual(['P2', 'P4', 'P5']);
		expect(t.steps[0]).toEqual({ phase: 'P2', status: 'approved', entry: true });
		expect(t.chat.map((e) => e.role)).toEqual(['user', 'assistant']);
		// Only a ticket in progress can be blocked from closing.
		expect(t.closeBlocked).toBeNull();
		expect(t.notReproduced).toBe(false);
		// state.json keeps its own P7 entry; only the snapshot derives it.
		expect((await readState(store())).phases.P7.status).toBe('not_started');
	});

	it('the snapshot shows P7 not started without tickets, approved once all are settled', async () => {
		expect((await snap()).state.phases.P7.status).toBe('not_started');
		expect((await snap()).tickets).toEqual([]);
		await writeTickets(store(), [
			inProgress({ status: 'done' }),
			inProgress({ id: 'TCK-002', status: 'rejected' })
		]);
		expect((await snap()).state.phases.P7.status).toBe('approved');
	});

	it('a ticket message runs with the history of that ticket only and never marks a report run', async () => {
		await allApproved();
		await create();
		await send('P1', 'Unrelated P1 message');
		const other = await orch.createTicket('todo', { ...input, title: 'Other' });
		await nextFinished();
		expect(other.ticketId).toBe('TCK-002');
		fake.calls = [];
		const { runId } = await message('TCK-001', 'Only the web client');
		const [t] = await readTickets(store());
		expect(fake.calls).toEqual([
			{
				agent: 'maintenance',
				costLimitUsd: 1,
				history: [
					{ role: 'user', content: ticketTriageBrief(t) },
					{ role: 'assistant', content: 'maintenance reply' },
					{ role: 'user', content: 'Only the web client' }
				],
				maxTurns: 20
			}
		]);
		const run = (await listRuns(store())).find((r) => r.id === runId)!;
		expect(run).toMatchObject({ phase: 'P7', ticketId: 'TCK-001', prevTicket: { status: 'open' } });
		expect(run.report).toBeUndefined();
		expect((await readChat(store(), 'TCK-001')).at(-2)).toMatchObject({
			role: 'user',
			text: 'Only the web client',
			runId
		});
	});

	it('refuses a message to a done or rejected ticket and to an unknown one', async () => {
		await writeTickets(store(), [
			inProgress({ status: 'done' }),
			inProgress({ id: 'TCK-002', status: 'rejected' })
		]);
		await expect(orch.sendTicketMessage('todo', 'TCK-001', 'more')).rejects.toThrow(ConflictError);
		await expect(orch.sendTicketMessage('todo', 'TCK-002', 'more')).rejects.toThrow(ConflictError);
		await expect(orch.sendTicketMessage('todo', 'TCK-009', 'more')).rejects.toThrow(NotFoundError);
		expect(await listRuns(store())).toEqual([]);
	});

	it('a run started while a ticket is in progress carries its ID and the ticket before it', async () => {
		await writeTickets(store(), [inProgress()]);
		const { runId } = await send('P1', 'Add a due date');
		const run = (await listRuns(store())).find((r) => r.id === runId)!;
		expect(run).toMatchObject({
			phase: 'P1',
			ticketId: 'TCK-001',
			prevTicket: { status: 'in_progress', plan: { ...plan, entry: 'P1' } }
		});
		expect(run.report).toBeUndefined();
		// The phase chat keeps the message; the ticket chat does not.
		expect(await readChat(store(), 'P1')).toHaveLength(2);
		expect(await readChat(store(), 'TCK-001')).toEqual([]);
		expect((await snap()).tickets[0].runIds).toEqual([runId]);
		// P1 is awaiting approval now, so the ticket cannot close.
		expect((await snap()).tickets[0].closeBlocked).toMatch(/^Approve P1/);
	});

	it('an Update run started during a ticket carries its ID', async () => {
		const s = await readState(store());
		s.phases.P1 = { status: 'approved' };
		s.phases.P2 = { status: 'stale', reqHashes: { 'REQ-001': 'not on disk' } };
		await writeState(store(), s);
		await writeTickets(store(), [inProgress()]);
		const done = nextFinished();
		const { runId } = await orch.updateStale('todo', 'P2');
		await done;
		const run = (await listRuns(store())).find((r) => r.id === runId)!;
		expect(run).toMatchObject({ phase: 'P2', ticketId: 'TCK-001' });
	});

	it('a ticket run holds the project: other messages are refused until it ends', async () => {
		await allApproved();
		fake.hold = deferred();
		const done = nextFinished();
		await orch.createTicket('todo', input);
		await expect(orch.sendMessage('todo', 'P1', 'hi')).rejects.toThrow(ConflictError);
		await expect(orch.sendTicketMessage('todo', 'TCK-001', 'hi')).rejects.toThrow(ConflictError);
		await expect(orch.createTicket('todo', input)).rejects.toThrow(ConflictError);
		fake.hold.resolve();
		await done;
		expect(await listRuns(store())).toHaveLength(1);
	});

	it('a ticket whose triage run cannot start is removed, so a retry gets the same ID', async () => {
		await allApproved();
		// A file where the runs folder belongs makes createRun fail.
		await store().writeFile('.aise/runs', 'blocked');
		// A chat left from a start that failed later must not open the retried ticket's chat.
		await appendChat(store(), 'TCK-001', { role: 'user', text: 'left over', at: '' });
		await expect(orch.createTicket('todo', input)).rejects.toThrow();
		expect(await readTickets(store())).toEqual([]);
		expect(await readChat(store(), 'TCK-001')).toEqual([]);
		await rm(path.join(root, 'todo', '.aise/runs'));
		const { ticketId } = await create();
		expect(ticketId).toBe('TCK-001');
		expect((await readTickets(store())).map((t) => t.id)).toEqual(['TCK-001']);
	});

	it('never reuses a ticket ID that a run still names', async () => {
		await allApproved();
		const run = await createRun(store(), 'P7', 'maintenance');
		await updateRun(store(), run.id, { status: 'failed', ticketId: 'TCK-001' });
		const { ticketId } = await create();
		expect(ticketId).toBe('TCK-002');
	});

	it('a done fix loop run of a bug ticket proves nothing about reproduction', async () => {
		// The entry is a code agent run; the loop that follows is no test agent run of the ticket.
		await writeTickets(store(), [inProgress({ kind: 'bug', plan: { ...plan, entry: 'P4' } })]);
		const entry = await createRun(store(), 'P4', 'code');
		await updateRun(store(), entry.id, { status: 'done', ticketId: 'TCK-001' });
		const loop = await createRun(store(), 'P5', 'test');
		await updateRun(store(), loop.id, { status: 'done', ticketId: 'TCK-001', fixLoop: true });
		expect((await snap()).tickets.map((t) => t.notReproduced)).toEqual([false]);
	});

	it('a bug ticket whose P5 run reported no code bug shows not reproduced', async () => {
		await writeTickets(store(), [
			inProgress({ kind: 'bug', plan: { ...plan, entry: 'P5' } }),
			inProgress({ id: 'TCK-002', kind: 'bug', status: 'triaged', plan: { ...plan, entry: 'P5' } })
		]);
		expect((await snap()).tickets.map((t) => t.notReproduced)).toEqual([false, false]);
		// A running or failed test run, or an Apply fix run of the code agent, proves nothing.
		const running = await createRun(store(), 'P5', 'test');
		await updateRun(store(), running.id, { ticketId: 'TCK-001' });
		const failed = await createRun(store(), 'P5', 'test');
		await updateRun(store(), failed.id, { status: 'failed', ticketId: 'TCK-001' });
		const fix = await createRun(store(), 'P5', 'code');
		await updateRun(store(), fix.id, { status: 'done', ticketId: 'TCK-001' });
		expect((await snap()).tickets.map((t) => t.notReproduced)).toEqual([false, false]);
		const run = await createRun(store(), 'P5', 'test');
		await updateRun(store(), run.id, { status: 'done', ticketId: 'TCK-001' });
		// A discarded run's code bug no longer counts.
		const gone = await createRun(store(), 'P5', 'test');
		await updateRun(store(), gone.id, { status: 'discarded', ticketId: 'TCK-001' });
		await appendRunFinding(store(), gone.id, {
			test: 'REQ-001 AC2: empty title',
			file: TEST_FILE,
			reqId: 'REQ-001',
			explanation: 'An empty title is accepted.',
			proposedFix: 'Reject an empty title in addTask.'
		});
		expect((await snap()).tickets.map((t) => t.notReproduced)).toEqual([true, false]);
		// Discarded runs are not the ticket's runs.
		expect((await snap()).tickets[0].runIds).not.toContain(gone.id);
	});

	it('a run without a ticket in progress carries no ticket', async () => {
		await writeTickets(store(), [inProgress({ status: 'triaged' })]);
		const { runId } = await send('P1', 'Add a due date');
		const run = (await listRuns(store())).find((r) => r.id === runId)!;
		expect(run.ticketId).toBeUndefined();
		expect(run.prevTicket).toBeUndefined();
	});

	it('a P7 run that throws settles failed without touching the phases', async () => {
		await allApproved();
		const before = await readState(store());
		fake.fail = new Error('boom');
		const { runId, finished } = await create();
		expect(finished).toMatchObject({ runId, status: 'failed', error: 'boom' });
		const [run] = await listRuns(store());
		expect(run).toMatchObject({ phase: 'P7', status: 'failed', ticketId: 'TCK-001' });
		expect(await readState(store())).toEqual(before);
		expect((await snap()).activeRun).toBeNull();
	});

	it('a restart marks a P7 run left running failed without touching the phases', async () => {
		await allApproved();
		await writeTickets(store(), [inProgress({ status: 'open', plan: undefined })]);
		const before = await readState(store());
		await createRun(store(), 'P7', 'maintenance');
		orch = newOrchestrator();
		await orch.ready;
		const [run] = await listRuns(store());
		expect(run).toMatchObject({ status: 'failed', error: 'server restarted' });
		expect(await readState(store())).toEqual(before);
	});
});

describe('ticket plans, reject and rollbacks', () => {
	const snap = () => orch.snapshot('todo');
	const input = {
		kind: 'change' as const,
		title: 'Due dates',
		description: 'Tasks need a due date.'
	};
	const plan: TicketPlan = {
		entry: 'P2',
		affectedIds: ['REQ-001'],
		files: [],
		steps: ['Add a due date']
	};
	const triaged = (over: Partial<Ticket> = {}): Ticket => ({
		id: 'TCK-001',
		kind: 'change',
		title: 'Due dates',
		description: 'Tasks need a due date.',
		status: 'triaged',
		createdAt: '2026-11-22T09:00:00.000Z',
		plan,
		...over
	});

	/** P1 to P5 approved through the real flow, so every phase keeps its hashes. */
	const allApproved = async () => {
		fake.code['package.json'] = '{}\n';
		await approvedP2WithCode();
		const done = nextFinished();
		await orch.approve('todo', 'P4');
		await done;
		// Approving P5 starts the first deployment; discarding it leaves P6 not started.
		const deployed = nextFinished();
		await orch.approve('todo', 'P5');
		await deployed;
		await orch.discardLastRun('todo');
		fake.calls = [];
	};

	const approvePlan = async (id: string, opts: { direction?: 'design' | 'code' } = {}) => {
		const done = nextFinished();
		const { runId } = await orch.approvePlan('todo', id, opts);
		return { runId, finished: await done };
	};

	const create = async () => {
		const done = nextFinished();
		const ids = await orch.createTicket('todo', input);
		return { ...ids, finished: await done };
	};

	const discard = () => orch.discardLastRun('todo');

	const ticket = async (id = 'TCK-001') => (await readTickets(store())).find((t) => t.id === id)!;

	it.each([
		{ kind: 'requirement', entry: 'P1', agent: 'requirements' },
		{ kind: 'change', entry: 'P2', agent: 'design' },
		{ kind: 'bug', entry: 'P5', agent: 'test' }
	] as const)(
		'approving a $kind plan sends the entry brief to the $entry agent',
		async ({ kind, entry, agent }) => {
			await allApproved();
			const t = triaged({ kind, plan: { ...plan, entry } });
			await writeTickets(store(), [t]);
			const { runId, finished } = await approvePlan('TCK-001');
			expect(finished.status).toBe('done');
			// The model gets the fenced brief; the phase chat shows a short plain line.
			const history = [{ role: 'user', content: entryBrief(t, t.plan!) }];
			const maxTurns = agent === 'test' ? 30 : undefined;
			expect(fake.calls).toEqual([{ agent, history, maxTurns }]);
			const chat = await readChat(store(), entry);
			const line = chat.find((e) => e.runId === runId && e.role === 'user')!;
			expect(line).toMatchObject({ text: 'Plan of TCK-001 approved.', auto: true });
			expect(await readChat(store(), 'TCK-001')).toEqual([]);
			const run = (await listRuns(store())).find((r) => r.id === runId)!;
			expect(run).toMatchObject({
				phase: entry,
				agent,
				ticketId: 'TCK-001',
				prevTicket: { status: 'triaged', plan: t.plan },
				entry: true
			});
			expect(run.report).toBeUndefined();
			expect(await ticket()).toMatchObject({ status: 'in_progress', plan: t.plan });
			expect((await snap()).tickets[0].entryRan).toBe(true);
		}
	);

	it('a drift plan switched to the code direction goes to the code agent in P4 and is saved', async () => {
		await allApproved();
		const drift = { ...plan, entry: 'P2' as const, direction: 'design' as const };
		await writeTickets(store(), [triaged({ kind: 'drift', plan: drift })]);
		const { runId } = await approvePlan('TCK-001', { direction: 'code' });
		const saved = { ...drift, entry: 'P4', direction: 'code' };
		expect((await ticket()).plan).toEqual(saved);
		const run = (await listRuns(store())).find((r) => r.id === runId)!;
		expect(run).toMatchObject({ phase: 'P4', agent: 'code', prevTicket: { plan: saved } });
		expect(fake.calls.map((c) => c.agent)).toEqual(['code']);
		expect((fake.calls[0].history as { content: string }[])[0].content).toMatch(
			/Make the code match the design/
		);
	});

	it('a drift plan switched to the design direction goes to P2', async () => {
		await allApproved();
		const drift = { ...plan, entry: 'P4' as const, direction: 'code' as const };
		await writeTickets(store(), [triaged({ kind: 'drift', plan: drift })]);
		const { runId } = await approvePlan('TCK-001', { direction: 'design' });
		expect((await ticket()).plan).toMatchObject({ entry: 'P2', direction: 'design' });
		expect((await listRuns(store())).find((r) => r.id === runId)!.phase).toBe('P2');
	});

	it('refuses a direction for a ticket that is not a drift ticket', async () => {
		await allApproved();
		await writeTickets(store(), [triaged()]);
		await expect(orch.approvePlan('todo', 'TCK-001', { direction: 'code' })).rejects.toThrow(
			ConflictError
		);
		expect(await ticket()).toEqual(triaged());
	});

	it('refuses while an earlier phase awaits approval, naming it', async () => {
		await allApproved();
		// P4's own precondition checks P2 only; the walk rule finds P1.
		const drift = triaged({ kind: 'drift', plan: { ...plan, entry: 'P4', direction: 'code' } });
		await writeTickets(store(), [drift]);
		const s = await readState(store());
		s.phases.P1 = { status: 'awaiting_approval' };
		await writeState(store(), s);
		const runs = (await listRuns(store())).length;
		await expect(orch.approvePlan('todo', 'TCK-001')).rejects.toThrow(/Approve P1/);
		expect(await ticket()).toEqual(drift);
		expect(await listRuns(store())).toHaveLength(runs);
	});

	it("refuses when the entry phase's own precondition fails, naming the phase", async () => {
		// P1 not started passes the walk rule; P2 still needs P1 approved.
		await writeTickets(store(), [triaged()]);
		await expect(orch.approvePlan('todo', 'TCK-001')).rejects.toThrow(/Approve P1/);
		const s = await readState(store());
		for (const p of ['P1', 'P2'] as const) s.phases[p] = { status: 'approved' };
		await writeState(store(), s);
		await writeTickets(store(), [triaged({ plan: { ...plan, entry: 'P4' } })]);
		await expect(orch.approvePlan('todo', 'TCK-001')).rejects.toThrow(/Generate the code first/);
		// A drift direction is saved even when the switched plan is refused.
		await writeTickets(store(), [
			triaged({ kind: 'drift', plan: { ...plan, direction: 'design' } })
		]);
		const events: string[] = [];
		const off = subscribe('todo', (e) => events.push(e.type));
		await expect(orch.approvePlan('todo', 'TCK-001', { direction: 'code' })).rejects.toThrow(
			/Generate the code first/
		);
		off();
		// The saved direction reaches the UI.
		expect(events).toContain('changed');
		expect(await ticket()).toMatchObject({
			status: 'triaged',
			plan: { entry: 'P4', direction: 'code' }
		});
		await writeTickets(store(), [triaged({ kind: 'bug', plan: { ...plan, entry: 'P5' } })]);
		await expect(orch.approvePlan('todo', 'TCK-001')).rejects.toThrow(/Approve P4/);
		expect((await ticket()).status).toBe('triaged');
	});

	it('refuses a P5 entry without tests', async () => {
		const s = await readState(store());
		for (const p of ['P1', 'P2', 'P4'] as const) s.phases[p] = { status: 'approved' };
		await writeState(store(), s);
		await writeTickets(store(), [triaged({ kind: 'bug', plan: { ...plan, entry: 'P5' } })]);
		await expect(orch.approvePlan('todo', 'TCK-001')).rejects.toThrow(/Generate the tests first/);
		expect((await ticket()).status).toBe('triaged');
	});

	it('refuses while an earlier phase is stale, naming it', async () => {
		await allApproved();
		const drift = triaged({ kind: 'drift', plan: { ...plan, entry: 'P4', direction: 'code' } });
		await writeTickets(store(), [drift]);
		const s = await readState(store());
		s.phases.P1 = { ...s.phases.P1, status: 'stale' };
		await writeState(store(), s);
		await expect(orch.approvePlan('todo', 'TCK-001')).rejects.toThrow(/^P1 is stale/);
		expect(await ticket()).toEqual(drift);
	});

	it('a direction on a done or in progress ticket changes nothing', async () => {
		await allApproved();
		const drift = { ...plan, direction: 'design' as const };
		const tickets = [
			triaged({ kind: 'drift', status: 'done', plan: drift }),
			triaged({ id: 'TCK-002', kind: 'drift', status: 'in_progress', plan: drift })
		];
		await writeTickets(store(), tickets);
		for (const id of ['TCK-001', 'TCK-002']) {
			await expect(orch.approvePlan('todo', id, { direction: 'code' })).rejects.toThrow(
				ConflictError
			);
		}
		expect(await readTickets(store())).toEqual(tickets);
	});

	it('refuses a ticket that is not triaged', async () => {
		await allApproved();
		await writeTickets(store(), [
			triaged({ status: 'open', plan: undefined }),
			triaged({ id: 'TCK-002', status: 'done' }),
			triaged({ id: 'TCK-003', status: 'rejected' })
		]);
		for (const id of ['TCK-001', 'TCK-002', 'TCK-003']) {
			await expect(orch.approvePlan('todo', id)).rejects.toThrow(/only a triaged ticket/);
		}
		await expect(orch.approvePlan('todo', 'TCK-009')).rejects.toThrow(NotFoundError);
		expect((await readTickets(store())).map((t) => t.status)).toEqual(['open', 'done', 'rejected']);
	});

	it('refuses while another ticket is in progress', async () => {
		await allApproved();
		await writeTickets(store(), [triaged(), triaged({ id: 'TCK-002', status: 'in_progress' })]);
		await expect(orch.approvePlan('todo', 'TCK-001')).rejects.toThrow(/TCK-002 is in progress/);
		expect((await readTickets(store())).map((t) => t.status)).toEqual(['triaged', 'in_progress']);
	});

	it('puts the ticket back to triaged when the entry run cannot start', async () => {
		const s = await readState(store());
		for (const p of ['P1', 'P2', 'P4', 'P5'] as const) s.phases[p] = { status: 'approved' };
		await writeState(store(), s);
		await writeTickets(store(), [triaged({ kind: 'requirement', plan: { ...plan, entry: 'P1' } })]);
		// A file where the runs folder belongs makes createRun fail.
		await store().writeFile('.aise/runs', 'blocked');
		const events: string[] = [];
		const off = subscribe('todo', (e) => events.push(e.type));
		await expect(orch.approvePlan('todo', 'TCK-001')).rejects.toThrow();
		off();
		expect(events).toContain('changed');
		expect((await ticket()).status).toBe('triaged');
	});

	it('a failed entry run leaves the ticket in progress without an entry run', async () => {
		await allApproved();
		await writeTickets(store(), [triaged()]);
		fake.fail = new Error('boom');
		const { finished } = await approvePlan('TCK-001');
		expect(finished.status).toBe('failed');
		expect((await ticket()).status).toBe('in_progress');
		expect((await snap()).tickets[0].entryRan).toBe(false);
	});

	it('a Retry of a failed entry run in the phase chat is not the entry run: Close stays refused', async () => {
		await allApproved();
		await writeTickets(store(), [triaged()]);
		fake.fail = new Error('boom');
		await approvePlan('TCK-001');
		fake.fail = null;
		// The phase chat's Retry resends only the plain line; the run gets the ticket but not the plan.
		const { runId, finished } = await send('P2', 'Plan of TCK-001 approved.');
		expect(finished.status).toBe('done');
		const run = (await listRuns(store())).find((r) => r.id === runId)!;
		expect(run.ticketId).toBe('TCK-001');
		expect(run.entry).toBeUndefined();
		expect((await snap()).tickets[0].entryRan).toBe(false);
		// The walk is approved (the run changed nothing), so only the missing entry run blocks.
		await expect(orch.closeTicket('todo', 'TCK-001')).rejects.toThrow(/Start the entry run again/);
	});

	it('Start the entry run again resends the entry brief and records the ticket as triaged before it', async () => {
		await allApproved();
		const t = triaged();
		await writeTickets(store(), [t]);
		fake.fail = new Error('boom');
		await approvePlan('TCK-001');
		fake.fail = null;
		fake.calls = [];
		const { runId, finished } = await approvePlan('TCK-001');
		expect(finished.status).toBe('done');
		expect(fake.calls).toEqual([
			{ agent: 'design', history: [{ role: 'user', content: entryBrief(t, plan) }] }
		]);
		const run = (await listRuns(store())).find((r) => r.id === runId)!;
		expect(run).toMatchObject({
			phase: 'P2',
			ticketId: 'TCK-001',
			entry: true,
			prevTicket: { status: 'triaged', plan }
		});
		expect((await ticket()).status).toBe('in_progress');
		expect((await snap()).tickets[0].entryRan).toBe(true);
		// Discarding it walks the ticket back to triaged, as for the first entry run.
		await discard();
		expect(await ticket()).toMatchObject({ status: 'triaged', plan });
	});

	it('refuses to start the entry run again once it finished, or with a direction', async () => {
		await allApproved();
		const drift = { ...plan, direction: 'design' as const };
		await writeTickets(store(), [triaged({ kind: 'drift', plan: drift })]);
		fake.fail = new Error('boom');
		await approvePlan('TCK-001');
		fake.fail = null;
		await expect(orch.approvePlan('todo', 'TCK-001', { direction: 'design' })).rejects.toThrow(
			/direction/
		);
		await approvePlan('TCK-001');
		const runs = (await listRuns(store())).length;
		await expect(orch.approvePlan('todo', 'TCK-001')).rejects.toThrow(/entry run finished/);
		expect(await listRuns(store())).toHaveLength(runs);
		expect((await ticket()).status).toBe('in_progress');
	});

	it('discard walks the ticket back: entry run to triaged, triage run to open; later tickets stay', async () => {
		await allApproved();
		fake.ticketPlan = plan;
		await create();
		const later = triaged({ id: 'TCK-002', status: 'open', plan: undefined, title: 'Later' });
		await writeTickets(store(), [...(await readTickets(store())), later]);
		const p2 = (await readState(store())).phases.P2;
		await approvePlan('TCK-001');
		expect((await ticket()).status).toBe('in_progress');

		await discard();
		expect(await ticket()).toMatchObject({ status: 'triaged', plan });
		expect((await snap()).tickets[0].entryRan).toBe(false);
		expect((await readState(store())).phases.P2).toEqual(p2);
		expect(await ticket('TCK-002')).toEqual(later);

		// Discarding the P7 run leaves the phase state alone: no staleness is recomputed.
		const s = await readState(store());
		s.phases.P2 = { ...s.phases.P2, reqHashes: { 'REQ-001': 'not on disk' } };
		await writeState(store(), s);
		await discard();
		const t = await ticket();
		expect(t.status).toBe('open');
		expect(t.plan).toBeUndefined();
		expect(await readState(store())).toEqual(s);
		expect(await ticket('TCK-002')).toEqual(later);
	});

	it('discarding an MCP write run (P7 without a ticket) still recomputes staleness', async () => {
		await allApproved();
		const mcp = await createRun(store(), 'P7', 'mcp');
		await updateRun(store(), mcp.id, { status: 'done' });
		const s = await readState(store());
		s.phases.P2 = { ...s.phases.P2, reqHashes: { 'REQ-001': 'not on disk' } };
		await writeState(store(), s);
		await discard();
		expect((await readState(store())).phases.P2.status).toBe('stale');
	});

	it('discarding a later phase run keeps the ticket in progress', async () => {
		await allApproved();
		await writeTickets(store(), [triaged({ kind: 'requirement', plan: { ...plan, entry: 'P1' } })]);
		await approvePlan('TCK-001');
		const { runId } = await send('P1', 'Also a reminder');
		expect((await listRuns(store())).find((r) => r.id === runId)!.ticketId).toBe('TCK-001');
		await discard();
		expect((await ticket()).status).toBe('in_progress');
		expect((await snap()).tickets[0].entryRan).toBe(true);
	});

	it('discarding the second triage round brings the first plan back', async () => {
		await allApproved();
		fake.ticketPlan = plan;
		await create();
		const second = { ...plan, steps: ['Add a due date and a reminder'] };
		fake.ticketPlan = second;
		const done = nextFinished();
		await orch.sendTicketMessage('todo', 'TCK-001', 'Also a reminder');
		await done;
		expect((await ticket()).plan).toEqual(second);
		await discard();
		expect(await ticket()).toMatchObject({ status: 'triaged', plan });
	});

	it('rejects an open or triaged ticket; refuses in progress, done and rejected ones', async () => {
		await writeTickets(store(), [
			triaged({ status: 'open', plan: undefined }),
			triaged({ id: 'TCK-002' }),
			triaged({ id: 'TCK-003', status: 'in_progress' }),
			triaged({ id: 'TCK-004', status: 'done' }),
			triaged({ id: 'TCK-005', status: 'rejected' })
		]);
		await orch.rejectTicket('todo', 'TCK-001');
		await orch.rejectTicket('todo', 'TCK-002');
		await expect(orch.rejectTicket('todo', 'TCK-003')).rejects.toThrow(
			/Discard this ticket's runs first/
		);
		await expect(orch.rejectTicket('todo', 'TCK-004')).rejects.toThrow(ConflictError);
		await expect(orch.rejectTicket('todo', 'TCK-005')).rejects.toThrow(ConflictError);
		await expect(orch.rejectTicket('todo', 'TCK-009')).rejects.toThrow(NotFoundError);
		expect((await readTickets(store())).map((t) => t.status)).toEqual([
			'rejected',
			'rejected',
			'in_progress',
			'done',
			'rejected'
		]);
		expect((await ticket('TCK-002')).plan).toEqual(plan);
	});

	it('discarding the triage run of a rejected ticket keeps it rejected', async () => {
		await allApproved();
		fake.ticketPlan = plan;
		await create();
		await orch.rejectTicket('todo', 'TCK-001');
		await discard();
		expect((await ticket()).status).toBe('rejected');
	});

	it('Still valid during a ticket adds a note to its chat and starts no run', async () => {
		await allApproved();
		await writeTickets(store(), [triaged({ status: 'in_progress' }), triaged({ id: 'TCK-002' })]);
		const s = await readState(store());
		const [first] = Object.keys(s.phases.P4.designHashes!);
		s.phases.P4 = {
			...s.phases.P4,
			status: 'stale',
			designHashes: { ...s.phases.P4.designHashes, [first]: 'old' }
		};
		await writeState(store(), s);
		const runs = (await listRuns(store())).length;
		await orch.stillValid('todo', 'P4');
		expect((await readState(store())).phases.P4.status).toBe('approved');
		expect(await readChat(store(), 'TCK-001')).toMatchObject([
			{ role: 'user', text: 'P4 confirmed still valid.', auto: true }
		]);
		expect(await readChat(store(), 'TCK-002')).toEqual([]);
		expect(await listRuns(store())).toHaveLength(runs);
	});

	it('Still valid confirms even when the ticket note cannot be written', async () => {
		await allApproved();
		await writeTickets(store(), [triaged({ status: 'in_progress' })]);
		const s = await readState(store());
		const [first] = Object.keys(s.phases.P4.designHashes!);
		s.phases.P4 = {
			...s.phases.P4,
			status: 'stale',
			designHashes: { ...s.phases.P4.designHashes, [first]: 'old' }
		};
		await writeState(store(), s);
		// A folder where the ticket chat file belongs makes the append fail.
		await mkdir(path.join(root, 'todo', '.aise/chat/TCK-001.jsonl'), { recursive: true });
		await orch.stillValid('todo', 'P4');
		expect((await readState(store())).phases.P4.status).toBe('approved');
	});

	it('Still valid without a ticket in progress writes no ticket chat', async () => {
		await allApproved();
		await writeTickets(store(), [triaged()]);
		const s = await readState(store());
		const [first] = Object.keys(s.phases.P4.designHashes!);
		s.phases.P4 = {
			...s.phases.P4,
			status: 'stale',
			designHashes: { ...s.phases.P4.designHashes, [first]: 'old' }
		};
		await writeState(store(), s);
		await orch.stillValid('todo', 'P4');
		expect(await readChat(store(), 'TCK-001')).toEqual([]);
	});
});

describe('closing tickets and drift tickets', () => {
	const snap = () => orch.snapshot('todo');
	const plan: TicketPlan = { entry: 'P5', affectedIds: [], files: [], steps: ['Reproduce it'] };
	const ticketOf = (over: Partial<Ticket> = {}): Ticket => ({
		id: 'TCK-001',
		kind: 'bug',
		title: 'Empty titles are saved',
		description: 'An empty title is accepted.',
		status: 'triaged',
		createdAt: '2026-11-22T09:00:00.000Z',
		plan,
		...over
	});
	const ticket = async (id = 'TCK-001') => (await readTickets(store())).find((t) => t.id === id)!;

	/** P1 to P5 approved through the real flow, so every phase keeps its hashes. */
	const allApproved = async () => {
		fake.code['package.json'] = '{}\n';
		await approvedP2WithCode();
		const done = nextFinished();
		await orch.approve('todo', 'P4');
		await done;
		// Approving P5 starts the first deployment; discarding it leaves P6 not started.
		const deployed = nextFinished();
		await orch.approve('todo', 'P5');
		await deployed;
		await orch.discardLastRun('todo');
		fake.calls = [];
	};

	/** Phases set directly, without hashes; tickets and runs are written directly too. */
	const phases = async (over: Partial<Record<'P1' | 'P2' | 'P4' | 'P5', string>> = {}) => {
		const s = await readState(store());
		for (const p of ['P1', 'P2', 'P4', 'P5'] as const)
			s.phases[p] = { status: (over[p] ?? 'approved') as 'approved' };
		await writeState(store(), s);
	};

	/** A finished run of the ticket in `phase`, as the entry run would leave it. */
	const entryRun = async (phase: 'P1' | 'P5', status: 'done' | 'failed' | 'discarded' = 'done') => {
		const run = await createRun(store(), phase, phase === 'P1' ? 'requirements' : 'test');
		await updateRun(store(), run.id, { status, ticketId: 'TCK-001', entry: true });
		return run;
	};

	const close = async (id = 'TCK-001') => {
		const done = nextFinished();
		const { runId } = await orch.closeTicket('todo', id);
		return { runId, finished: await done };
	};

	/** A bug ticket in progress whose P5 entry run changed a test file, and P5 approved again. */
	const walked = async () => {
		await allApproved();
		await writeTickets(store(), [ticketOf()]);
		fake.testEdits = {
			[TEST_FILE]: "import { it } from 'vitest';\nit('REQ-001 AC2: empty', () => {});\n"
		};
		const done = nextFinished();
		const { runId } = await orch.approvePlan('todo', 'TCK-001');
		await done;
		fake.testEdits = {};
		// Approving P5 starts the first deployment in the ticket (tested on its own below);
		// discarding it keeps these close tests to P5.
		const deployed = nextFinished();
		await orch.approve('todo', 'P5');
		await deployed;
		await orch.discardLastRun('todo');
		fake.calls = [];
		return runId;
	};

	it('approving P5 in a bug ticket walk with no deploy files starts P6 in the ticket; Close waits for it', async () => {
		await allApproved();
		await writeTickets(store(), [ticketOf()]);
		fake.testEdits = {
			[TEST_FILE]: "import { it } from 'vitest';\nit('REQ-001 AC2: empty', () => {});\n"
		};
		const entry = nextFinished();
		await orch.approvePlan('todo', 'TCK-001');
		await entry;
		fake.testEdits = {};
		fake.deployEdits = { Dockerfile: 'FROM node:22\n', 'compose.yaml': 'services: {}\n' };
		const deployed = nextFinished();
		await orch.approve('todo', 'P5');
		const { runId } = await deployed;
		const run = (await listRuns(store())).find((r) => r.id === runId)!;
		expect(run).toMatchObject({ phase: 'P6', agent: 'deploy', ticketId: 'TCK-001' });
		const view = (await orch.snapshot('todo')).tickets.find((t) => t.id === 'TCK-001')!;
		expect(view.steps.map((st) => st.phase)).toEqual(['P5', 'P6']);
		expect(view.closeBlocked).toMatch(/Approve P6/);
		await expect(orch.closeTicket('todo', 'TCK-001')).rejects.toThrow(/Approve P6/);
		// Once P6 is approved (over its failing deploy check) the ticket closes.
		await orch.approve('todo', 'P6', { override: true });
		fake.ticketReport = 'Reproduced by a test; the deployment was generated on the way.';
		const { finished } = await close();
		expect(finished.status).toBe('done');
		expect((await ticket()).status).toBe('done');
	});

	it('refuses to close while a walk phase is stale or awaits approval, naming it', async () => {
		const t = ticketOf({
			kind: 'requirement',
			status: 'in_progress',
			plan: { ...plan, entry: 'P1' }
		});
		await writeTickets(store(), [t]);
		await entryRun('P1');
		await phases({ P4: 'stale' });
		await expect(orch.closeTicket('todo', 'TCK-001')).rejects.toThrow(/P4 is stale/);
		await phases({ P2: 'awaiting_approval', P4: 'stale' });
		await expect(orch.closeTicket('todo', 'TCK-001')).rejects.toThrow(/Approve P2/);
		expect((await snap()).tickets[0].closeBlocked).toMatch(/Approve P2/);
		expect((await listRuns(store())).filter((r) => r.phase === 'P7')).toEqual([]);
	});

	it('refuses to close before the entry run finished: none, failed or discarded', async () => {
		await phases();
		await writeTickets(store(), [ticketOf({ status: 'in_progress' })]);
		await expect(orch.closeTicket('todo', 'TCK-001')).rejects.toThrow(/entry run/);
		await entryRun('P5', 'failed');
		await expect(orch.closeTicket('todo', 'TCK-001')).rejects.toThrow(/entry run/);
		await entryRun('P5', 'discarded');
		await expect(orch.closeTicket('todo', 'TCK-001')).rejects.toThrow(/entry run/);
		// A run of the ticket in another phase is not the entry run.
		await entryRun('P1');
		await expect(orch.closeTicket('todo', 'TCK-001')).rejects.toThrow(/entry run/);
		expect((await listRuns(store())).filter((r) => r.phase === 'P7')).toEqual([]);
	});

	it('refuses to close a ticket that is not in progress, or that does not exist', async () => {
		await phases();
		await writeTickets(store(), [
			ticketOf({ status: 'done' }),
			ticketOf({ id: 'TCK-002', status: 'triaged' })
		]);
		await entryRun('P5');
		await expect(orch.closeTicket('todo', 'TCK-001')).rejects.toThrow(ConflictError);
		await expect(orch.closeTicket('todo', 'TCK-002')).rejects.toThrow(ConflictError);
		await expect(orch.closeTicket('todo', 'TCK-009')).rejects.toThrow(NotFoundError);
		expect((await listRuns(store())).filter((r) => r.phase === 'P7')).toEqual([]);
	});

	it('a walk with P5 not started closes', async () => {
		await phases({ P5: 'not_started' });
		const t = ticketOf({
			kind: 'requirement',
			status: 'in_progress',
			plan: { ...plan, entry: 'P1' }
		});
		await writeTickets(store(), [t]);
		await entryRun('P1');
		fake.ticketReport = 'Done.';
		const { finished } = await close();
		expect(finished.status).toBe('done');
		expect((await ticket()).status).toBe('done');
	});

	it('closes in a marked P7 report run: the model gets the close brief, the ticket is done', async () => {
		const entryId = await walked();
		const before = await ticket();
		// A Still valid note from before the first kept run (an earlier, discarded walk) is left out.
		const runs = await listRuns(store());
		const start = runs.find((r) => r.id === entryId)!.startedAt;
		const early = new Date(Date.parse(start) - 60_000).toISOString();
		const late = new Date(Date.parse(start) + 1).toISOString();
		await appendChat(store(), 'TCK-001', {
			role: 'user',
			text: 'P2 confirmed still valid.',
			at: early,
			auto: true
		});
		await appendChat(store(), 'TCK-001', {
			role: 'user',
			text: 'P4 confirmed still valid.',
			at: late,
			auto: true
		});
		fake.ticketReport = 'The bug is reproduced by a new test.';
		const { runId, finished } = await close();
		expect(finished.status).toBe('done');

		const data = await reportData(store(), 'TCK-001');
		expect(fake.calls).toEqual([
			{
				agent: 'maintenance',
				costLimitUsd: 1,
				history: [
					{ role: 'user', content: closeBrief(before, data, ['P4 confirmed still valid.']) }
				],
				maxTurns: 20
			}
		]);
		const run = (await listRuns(store())).find((r) => r.id === runId)!;
		expect(run).toMatchObject({
			phase: 'P7',
			agent: 'maintenance',
			ticketId: 'TCK-001',
			report: true,
			prevTicket: { status: 'in_progress', plan }
		});
		expect(await readChat(store(), 'TCK-001')).toMatchObject([
			{ text: 'P2 confirmed still valid.' },
			{ text: 'P4 confirmed still valid.' },
			{ role: 'user', text: 'Close TCK-001 and write the change report.', runId },
			{ role: 'assistant', runId }
		]);
		const t = await ticket();
		expect(t.status).toBe('done');
		expect(t.report).toMatchObject({ text: 'The bug is reproduced by a new test.' });
		expect(t.report!.steps).toEqual([
			expect.objectContaining({ runId: entryId, files: [TEST_FILE] })
		]);
		expect(t.report!.tests).toMatchObject({
			passed: allTests().length,
			failed: 0,
			outOfDate: false
		});
		expect((await snap()).state.phases.P7.status).toBe('approved');
		// Nothing more runs on a done ticket.
		await expect(orch.sendTicketMessage('todo', 'TCK-001', 'Again')).rejects.toThrow(ConflictError);
	});

	it('discarding the report run puts the ticket back in progress without a report', async () => {
		await walked();
		fake.ticketReport = 'Report.';
		await close();
		expect((await ticket()).status).toBe('done');
		await orch.discardLastRun('todo');
		const t = await ticket();
		expect(t.status).toBe('in_progress');
		expect(t.report).toBeUndefined();
	});

	it('a close run that does not write the report fails and leaves the ticket in progress', async () => {
		await walked();
		const { finished } = await close();
		expect(finished).toMatchObject({
			status: 'failed',
			error: 'The agent did not write the change report'
		});
		expect((await ticket()).status).toBe('in_progress');
	});

	it('a close run that fails after writing the report leaves the ticket in progress', async () => {
		await walked();
		fake.ticketReport = 'Report.';
		fake.fail = new Error('boom');
		const { finished } = await close();
		expect(finished.status).toBe('failed');
		const t = await ticket();
		expect(t.status).toBe('in_progress');
		expect(t.report).toBeUndefined();
	});

	it('a failed entry run blocks Close in the snapshot too', async () => {
		await phases();
		await writeTickets(store(), [ticketOf({ status: 'in_progress' })]);
		await entryRun('P5', 'failed');
		expect((await snap()).tickets[0].closeBlocked).toMatch(/Start the entry run again/);
		await entryRun('P5');
		expect((await snap()).tickets[0].closeBlocked).toBeNull();
	});

	it('a second close after a failed one gives the model only the Still valid notes', async () => {
		await walked();
		await orch.checkCode('todo');
		const s = await readState(store());
		const [first] = Object.keys(s.phases.P4.designHashes!);
		s.phases.P4 = {
			...s.phases.P4,
			status: 'stale',
			designHashes: { ...s.phases.P4.designHashes, [first]: 'old' }
		};
		await writeState(store(), s);
		await orch.stillValid('todo', 'P4');
		fake.ticketReport = 'Report.';
		fake.fail = new Error('boom');
		await close();
		expect((await ticket()).status).toBe('in_progress');
		fake.fail = null;
		fake.calls = [];
		await close();
		expect((await ticket()).status).toBe('done');
		const brief = (fake.calls[0].history as { content: string }[])[0].content;
		const notes = brief.split('Notes:\n')[1].split('\n\n')[0];
		expect(notes).toBe(['```', '- P4 confirmed still valid.', '```'].join('\n'));
	});

	it('a walk discarded and walked again gives the model only the notes of the new walk', async () => {
		const staleP4 = async () => {
			const s = await readState(store());
			const [first] = Object.keys(s.phases.P4.designHashes!);
			s.phases.P4 = {
				...s.phases.P4,
				status: 'stale',
				designHashes: { ...s.phases.P4.designHashes, [first]: 'old' }
			};
			await writeState(store(), s);
		};
		await walked();
		await staleP4();
		await orch.stillValid('todo', 'P4');
		await orch.discardLastRun('todo');
		expect((await ticket()).status).toBe('triaged');
		const done = nextFinished();
		await orch.approvePlan('todo', 'TCK-001');
		await done;
		// The second entry run changes no test file, so P5 stays approved.
		await staleP4();
		await orch.stillValid('todo', 'P4');
		const chat = await readChat(store(), 'TCK-001');
		expect(chat.filter((e) => e.text === 'P4 confirmed still valid.')).toHaveLength(2);
		const before = await ticket();
		fake.ticketReport = 'Report.';
		fake.calls = [];
		await close();
		const data = await reportData(store(), 'TCK-001');
		expect(fake.calls[0].history).toEqual([
			{ role: 'user', content: closeBrief(before, data, ['P4 confirmed still valid.']) }
		]);
	});

	it('a restart during the close run puts the ticket back in progress without a report', async () => {
		await phases();
		const t = ticketOf({ status: 'in_progress' });
		await entryRun('P5');
		const run = await createRun(store(), 'P7', 'maintenance');
		await updateRun(store(), run.id, {
			ticketId: 'TCK-001',
			report: true,
			prevTicket: { status: 'in_progress', plan }
		});
		const report = {
			at: '2026-11-22T10:00:00.000Z',
			text: 'r',
			steps: [],
			changedIds: [],
			files: [],
			tests: null
		};
		await writeTickets(store(), [{ ...t, status: 'done', report }]);
		orch = newOrchestrator();
		await orch.ready;
		const after = await ticket();
		expect(after.status).toBe('in_progress');
		expect(after.report).toBeUndefined();
		expect((await listRuns(store())).find((r) => r.id === run.id)!.status).toBe('failed');
	});

	it('a drift ticket walks end to end in the design direction', async () => {
		await allApproved();
		// A hand edit adds a method the design lacks; Check again stores the drift it finds.
		const taskFile = 'src/task-api/Task.ts';
		await store().writeFile(taskFile, 'export class Task { note = ""; }\n');
		await storeChecks([
			{ ...driftItem, kind: 'changed', details: ['attribute note is in the code only'] }
		]);
		fake.ticketPlan = {
			entry: 'P2',
			direction: 'design',
			affectedIds: ['DSN-001'],
			files: [taskFile],
			steps: ['Add note to Task']
		};
		await openDrift();
		expect((await ticket()).status).toBe('triaged');
		expect((await snap()).canOpenDriftTicket).toBe(false);

		fake.design!.classes[0].attributes.push({ name: 'note', type: 'string' });
		const done = nextFinished();
		await orch.approvePlan('todo', 'TCK-001', { direction: 'design' });
		expect((await done).status).toBe('done');
		expect(fake.calls.at(-1)!.agent).toBe('design');
		await approveP2();
		expect(await status('P4')).toBe('stale');
		expect((await snap()).tickets[0].closeBlocked).toMatch(/P4 is stale/);

		// The developer checks the code again before Still valid, and the tests before Close.
		await orch.checkCode('todo');
		await orch.stillValid('todo', 'P4');
		expect(await status('P4')).toBe('approved');
		await orch.checkTests('todo');
		expect((await snap()).tickets[0].closeBlocked).toBeNull();

		fake.ticketReport = 'The design now has the note the code had.';
		const closed = await close();
		expect(closed.finished.status).toBe('done');
		const t = await ticket();
		expect(t.status).toBe('done');
		expect(t.report!.changedIds).toContain('DSN-001');
		expect(t.report!.tests).toMatchObject({ outOfDate: false });
		expect((await snap()).state.phases.P7.status).toBe('approved');
	});

	const driftItem: DriftItem = {
		kind: 'missing_in_code',
		id: 'DSN-001',
		name: 'Task',
		details: ['class Task is in the design but not in the code']
	};
	/** Stores P4 checks taken at the current code and design, with `drift`. */
	const storeChecks = async (
		drift: DriftItem[],
		over: { codeHash?: string; designHash?: string } = {}
	) =>
		writeChecks(store(), {
			at: new Date().toISOString(),
			codeHash: await codeHash(store()),
			designHash: designHash(await store().readJson('.aise/design.json', DesignDoc)),
			typecheck: { ok: true, errors: [], timedOut: false },
			drift,
			...over
		});
	const openDrift = async () => {
		const done = nextFinished();
		const ids = await orch.openDriftTicket('todo');
		return { ...ids, finished: await done };
	};

	it('opens no drift ticket without current checks or without drift', async () => {
		await allApproved();
		await rm(path.join(root, 'todo', '.aise/checks/P4.json'));
		await expect(orch.openDriftTicket('todo')).rejects.toThrow(/Check again first/);
		await storeChecks([driftItem], { codeHash: 'old' });
		expect((await snap()).canOpenDriftTicket).toBe(false);
		await expect(orch.openDriftTicket('todo')).rejects.toThrow(/Check again first/);
		await storeChecks([driftItem], { designHash: 'old' });
		expect((await snap()).canOpenDriftTicket).toBe(false);
		await expect(orch.openDriftTicket('todo')).rejects.toThrow(/Check again first/);
		await storeChecks([]);
		expect((await snap()).canOpenDriftTicket).toBe(false);
		await expect(orch.openDriftTicket('todo')).rejects.toThrow(/No drift/);
		expect(await readTickets(store())).toEqual([]);
		expect(fake.calls).toEqual([]);
	});

	it('opens no drift ticket before P5 is approved and no ticket exists', async () => {
		await approvedP2WithCode();
		await storeChecks([driftItem]);
		expect((await snap()).canOpenDriftTicket).toBe(false);
		await expect(orch.openDriftTicket('todo')).rejects.toThrow(ConflictError);
		expect(await readTickets(store())).toEqual([]);
	});

	it('opens a drift ticket from the current drift and triages it', async () => {
		await allApproved();
		await storeChecks([driftItem]);
		expect((await snap()).canOpenDriftTicket).toBe(true);
		const checkCalls = fake.checkCalls;
		const { ticketId, runId, finished } = await openDrift();
		expect(finished.status).toBe('done');
		expect(ticketId).toBe('TCK-001');
		const t = await ticket();
		expect(t).toMatchObject({
			kind: 'drift',
			status: 'open',
			title: 'Drift between code and design',
			description: driftDescription([driftItem])
		});
		expect(t.description).toContain('DSN-001');
		expect(fake.calls).toEqual([
			{
				agent: 'maintenance',
				costLimitUsd: 1,
				history: [{ role: 'user', content: ticketTriageBrief(t) }],
				maxTurns: 20
			}
		]);
		expect((await listRuns(store())).find((r) => r.id === runId)).toMatchObject({
			phase: 'P7',
			ticketId: 'TCK-001'
		});
		// Neither the button nor the ticket runs the checks.
		expect(fake.checkCalls).toBe(checkCalls);
	});

	it.each(['open', 'triaged', 'in_progress'] as const)(
		'opens no second drift ticket while one is %s',
		async (st) => {
			await allApproved();
			await storeChecks([driftItem]);
			await writeTickets(store(), [
				ticketOf({ kind: 'drift', status: st, plan: { ...plan, entry: 'P2', direction: 'design' } })
			]);
			expect((await snap()).canOpenDriftTicket).toBe(false);
			await expect(orch.openDriftTicket('todo')).rejects.toThrow(
				/TCK-001 already covers the drift/
			);
			expect(await readTickets(store())).toHaveLength(1);
		}
	);

	it('opens a drift ticket again once the earlier one is done or rejected, or beside other kinds', async () => {
		await allApproved();
		await storeChecks([driftItem]);
		await writeTickets(store(), [
			ticketOf({ kind: 'drift', status: 'done' }),
			ticketOf({ id: 'TCK-002', kind: 'drift', status: 'rejected' }),
			ticketOf({ id: 'TCK-003', status: 'triaged' })
		]);
		expect((await snap()).canOpenDriftTicket).toBe(true);
	});
});

describe('P3 design review', () => {
	const snap = () => orch.snapshot('todo');
	const proposal = (title: string) => ({
		kind: 'missing_method',
		title,
		change: `${title} in one sentence.`,
		elementIds: ['DSN-001'],
		reqIds: ['REQ-001']
	});
	/** Waits until no run is active; a P2 run may start a review on the same claim. */
	const idle = async () => {
		while ((await snap()).activeRun) await new Promise((r) => setTimeout(r, 5));
	};
	/** The fixture design with one use case renamed, so a P2 run changes the design. */
	const changedDesign = (at = 0, name = 'Add a task'): DesignDoc => {
		const d = fixture<DesignDoc>('todo-design.json');
		const useCases = d.useCases.map((u, i) => (i === at ? { ...u, name } : u));
		return { ...d, useCases };
	};
	const review = async () => {
		const done = nextFinished();
		const { runId } = await orch.reviewDesign('todo');
		await done;
		return runId;
	};
	const p3 = async () => (await snap()).state.phases.P3.status;

	beforeEach(() => {
		fake.proposals = [proposal('Add delete'), proposal('Add rename')];
	});

	it('reviews the design after a P2 run that changed it, never after an unchanged one', async () => {
		orch = newOrchestrator(true);
		await send('P1', 'A to-do app for one person');
		await orch.approve('todo', 'P1');
		await idle();
		let s = await snap();
		expect(s.lastRun).toMatchObject({ phase: 'P3', agent: 'review', status: 'done' });
		expect(fake.calls.at(-1)).toMatchObject({ agent: 'review', maxTurns: 8, costLimitUsd: 0.5 });
		expect(fake.calls.at(-1)?.history).toEqual([{ role: 'user', content: reviewBrief(null) }]);
		expect(s.proposals?.proposals.map((p) => `${p.id} ${p.status}`)).toEqual([
			'PRP-001 open',
			'PRP-002 open'
		]);
		expect(s.state.phases.P3.status).toBe('awaiting_approval');
		expect(s.chat.P3.map((c) => c.role)).toEqual(['user', 'assistant']);
		const runs = (await listRuns(store())).length;
		await send('P2', 'Is anything missing?');
		await idle();
		s = await snap();
		expect(s.lastRun?.phase).toBe('P2');
		expect(await listRuns(store())).toHaveLength(runs + 1);
	});

	it('runs on demand with the computed uncovered criteria, and refuses without a design or while busy', async () => {
		await expect(orch.reviewDesign('todo')).rejects.toThrow('There is no design to review yet');
		await approvedP1WithDesign();
		const design = (await snap()).design!;
		const rows = [{ reqId: 'REQ-001', criterion: 1, coveredBy: [] }];
		await store().writeJson('.aise/design-review.json', DesignReview, {
			designHash: designHash(design)!,
			rows
		});
		fake.hold = deferred();
		const done = nextFinished();
		await orch.reviewDesign('todo');
		expect(await p3()).toBe('running');
		expect((await snap()).activeRun?.phase).toBe('P3');
		await expect(orch.reviewDesign('todo')).rejects.toMatchObject({ code: 'run_active' });
		await expect(orch.acceptProposal('todo', 'PRP-001')).rejects.toMatchObject({
			code: 'run_active'
		});
		fake.hold.resolve();
		await done;
		const brief = fake.calls.at(-1)?.history as { content: string }[];
		expect(brief[0].content).toContain('- REQ-001 AC1:');
		expect(brief[0].content).toContain('- REQ-002 AC1:');
	});

	it('accept starts a P2 run with the proposal, keeps the review current and starts no review', async () => {
		orch = newOrchestrator(true);
		await approvedP1WithDesign();
		await idle();
		fake.design = changedDesign();
		const done = nextFinished();
		const { runId } = await orch.acceptProposal('todo', 'PRP-001');
		expect((await snap()).proposals?.proposals[0].status).toBe('accepted');
		await done;
		await idle();
		const s = await snap();
		expect(s.lastRun).toMatchObject({ id: runId, phase: 'P2', fromProposal: 'PRP-001' });
		expect(s.chat.P2.at(-2)?.text).toBe(
			'Apply review proposal PRP-001: Add delete. Add delete in one sentence.'
		);
		expect(s.proposals?.designHash).toBe(designHash(s.design));
		expect(s.state.phases.P3.status).toBe('awaiting_approval');
		await expect(orch.acceptProposal('todo', 'PRP-001')).rejects.toThrow('PRP-001 is accepted');
		await expect(orch.acceptProposal('todo', 'PRP-009')).rejects.toBeInstanceOf(NotFoundError);
	});

	it('discarding the accept run reopens the proposal at the old design', async () => {
		await approvedP1WithDesign();
		await review();
		const before = (await snap()).proposals;
		fake.design = changedDesign();
		const done = nextFinished();
		await orch.acceptProposal('todo', 'PRP-001');
		await done;
		expect((await snap()).proposals?.designHash).not.toBe(before?.designHash);
		await orch.discardLastRun('todo');
		const s = await snap();
		expect(s.proposals).toEqual(before);
		expect(s.state.phases.P3.status).toBe('awaiting_approval');
	});

	it('reject needs no run; P3 is approved once nothing is open and stale after a design change', async () => {
		await approvedP1WithDesign();
		await review();
		const calls = fake.calls.length;
		await orch.rejectProposal('todo', 'PRP-001');
		expect(await p3()).toBe('awaiting_approval');
		await orch.rejectProposal('todo', 'PRP-002');
		expect(fake.calls).toHaveLength(calls);
		const s = await snap();
		expect(s.proposals?.proposals.map((p) => p.status)).toEqual(['rejected', 'rejected']);
		expect(s.state.phases.P3.status).toBe('approved');
		await expect(orch.rejectProposal('todo', 'PRP-002')).rejects.toBeInstanceOf(ConflictError);
		fake.design = changedDesign();
		await send('P2', 'Rename the first use case');
		expect(await p3()).toBe('stale');
	});

	it('discarding a review run takes its proposals back', async () => {
		await approvedP1WithDesign();
		await review();
		await orch.discardLastRun('todo');
		const s = await snap();
		expect(s.proposals).toBeNull();
		expect(s.state.phases.P3.status).toBe('not_started');
	});

	it('an accept leaves a stale review stale', async () => {
		await approvedP1WithDesign();
		await review();
		const reviewed = (await snap()).proposals!.designHash;
		fake.design = changedDesign();
		await send('P2', 'Rename the first use case');
		expect(await p3()).toBe('stale');
		fake.design = changedDesign(1, 'List the tasks');
		const done = nextFinished();
		await orch.acceptProposal('todo', 'PRP-001');
		expect((await done).status).toBe('done');
		expect((await snap()).proposals?.designHash).toBe(reviewed);
		expect(await p3()).toBe('stale');
	});

	it('discarding an accept run keeps a later reject and moves the review back', async () => {
		await approvedP1WithDesign();
		await review();
		const reviewed = (await snap()).proposals!.designHash;
		fake.design = changedDesign();
		const done = nextFinished();
		await orch.acceptProposal('todo', 'PRP-001');
		await done;
		await orch.rejectProposal('todo', 'PRP-002');
		await orch.discardLastRun('todo');
		const s = await snap();
		expect(s.proposals?.proposals.map((p) => `${p.id} ${p.status}`)).toEqual([
			'PRP-001 open',
			'PRP-002 rejected'
		]);
		expect(s.proposals?.designHash).toBe(reviewed);
		expect(s.state.phases.P3.status).toBe('awaiting_approval');
	});

	it('an accept run that fails reopens its proposal unless it changed the design', async () => {
		await approvedP1WithDesign();
		await review();
		fake.runFailure = { error: 'boom', reason: 'error' };
		fake.design = null;
		let done = nextFinished();
		await orch.acceptProposal('todo', 'PRP-001');
		expect((await done).status).toBe('failed');
		expect((await snap()).proposals?.proposals[0].status).toBe('open');
		fake.design = changedDesign();
		done = nextFinished();
		await orch.acceptProposal('todo', 'PRP-001');
		expect((await done).status).toBe('failed');
		expect((await snap()).proposals?.proposals[0].status).toBe('accepted');
	});

	it('an accept run that ends done without changing the design reopens its proposal', async () => {
		await approvedP1WithDesign();
		await review();
		fake.design = null;
		const done = nextFinished();
		await orch.acceptProposal('todo', 'PRP-001');
		expect((await done).status).toBe('done');
		expect((await snap()).proposals?.proposals[0].status).toBe('open');
	});

	it('an accept that cannot start its run reopens the proposal', async () => {
		await approvedP1WithDesign();
		await review();
		await writeFile(store().resolve('.aise/requirements.json'), '{');
		await expect(orch.acceptProposal('todo', 'PRP-001')).rejects.toThrow(SyntaxError);
		expect((await readDesignProposals(store()))?.proposals[0].status).toBe('open');
	});

	it('a failed P2 run that changed the design starts no review', async () => {
		orch = newOrchestrator(true);
		await send('P1', 'A to-do app for one person');
		fake.runFailure = { error: 'boom', reason: 'error' };
		await orch.approve('todo', 'P1');
		await idle();
		const s = await snap();
		expect(s.design).not.toBeNull();
		expect(s.lastRun).toMatchObject({ phase: 'P2', status: 'failed' });
		expect((await listRuns(store())).some((r) => r.phase === 'P3')).toBe(false);
	});

	it('a review during a ticket in progress belongs to it, and discarding it keeps the ticket', async () => {
		orch = newOrchestrator(true);
		await approvedP1WithDesign();
		await idle();
		const plan: TicketPlan = { entry: 'P2', affectedIds: [], files: [], steps: ['Rename'] };
		const t: Ticket = {
			id: 'TCK-001',
			kind: 'change',
			title: 'Rename a use case',
			description: 'The first use case needs a clearer name.',
			status: 'in_progress',
			createdAt: '2026-11-27T09:00:00.000Z',
			plan
		};
		await writeTickets(store(), [t]);
		fake.design = changedDesign();
		const { runId } = await send('P2', 'Rename the first use case');
		await idle();
		const s = await snap();
		expect(s.lastRun).toMatchObject({
			phase: 'P3',
			ticketId: 'TCK-001',
			prevTicket: { status: 'in_progress' }
		});
		expect(s.tickets[0].runIds).toEqual([runId, s.lastRun!.id]);
		await orch.discardLastRun('todo');
		const after = await snap();
		expect(after.tickets[0]).toMatchObject({ status: 'in_progress', runIds: [runId] });
	});
});
