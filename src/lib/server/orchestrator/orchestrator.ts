import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
	AGENTS,
	closeBrief,
	dbFile,
	deployBrief,
	deployUpdateBrief,
	driftDescription,
	entryBrief,
	fixBrief,
	reviewBrief,
	summariseRun,
	testUpdateBrief,
	ticketMessage,
	ticketTriageBrief,
	triageBrief,
	updateBrief
} from '../agents';
import { addUsage } from '../agents/cost';
import { runAgent } from '../agents/loop';
import type { AgentDef, AgentEvent, RunResult } from '../agents/types';
import { generateCode, type FileStatus, type GenerateEvent } from '../codegen/generate';
import { appendChat, deleteChat, readChat, type ChatEntry, type ChatKey } from '../core/chat';
import {
	codeHash,
	designHash,
	hashFiles,
	hasCode,
	listCodeFiles,
	listDocFiles,
	readChecks,
	runCodeChecks,
	type CodeChecks
} from '../core/code-state';
import { extraEnvVars } from '../core/deploy-env';
import { deployPlan } from '../core/deploy-plan';
import {
	deployArtefactHash,
	hasDeployFiles,
	listDeployFiles,
	readDeployCheck,
	type DeployCheck
} from '../core/deploy-state';
import { sha256, stableStringify } from '../core/hash';
import { renderAll } from '../core/render/mermaid';
import {
	appendRunEvent,
	createRun,
	listRuns,
	readBackup,
	restoreChecksBefore,
	restoreRun,
	saveChecksBefore,
	touchedFiles,
	updateRun,
	type RunMeta
} from '../core/runs';
import { DesignDoc } from '../core/schemas/design';
import { RequirementsDoc } from '../core/schemas/requirements';
import { Direction, TicketId, TicketKind, type Ticket } from '../core/schemas/tickets';
import {
	initialState,
	readState,
	writeState,
	type PhaseId,
	type PhaseState,
	type State
} from '../core/state';
import { isValidProjectName, PathError, ProjectStore } from '../core/store';
import {
	addTicket,
	findTicket,
	inProgress,
	readTickets,
	saveTicket,
	writeTickets
} from '../core/tickets';
import {
	findingOpen,
	listTestFiles,
	p5Hash,
	readRunFindings,
	readTestChecks,
	runTestChecks,
	testHash,
	unexplainedFailures,
	type TestChecks
} from '../core/test-state';
import { readDesignReview, uncoveredCriteria } from '../core/tools/coverage';
import { DESIGN_PATH } from '../core/tools/design';
import { deployCheck, type DeployCheckResult } from '../core/tools/deploy';
import { ToolError, type ToolContext } from '../core/tools/index';
import {
	DesignProposals,
	p3Status,
	PROPOSALS_PATH,
	readDesignProposals,
	resolveProposal
} from '../core/tools/proposals';
import { REQUIREMENTS_PATH, saveRequirements } from '../core/tools/requirements';
import { reportData } from '../core/ticket-report';
import { failureOf, fixLoop as runFixLoop, type AgentMessage } from '../testgen/fix-loop';
import { generateTests, recordUnreportedFixes, snapshotTests } from '../testgen/generate';
import { publish } from './bus';
import { checkGate, failedChecks, type GateResult } from './gates';
import {
	codeGate,
	designGate,
	designHashesOf,
	missingEntries,
	designProblems,
	GENERATE_MESSAGE,
	markP4Stale,
	p2NotReady,
	README,
	staleDesignIds,
	staleEntries,
	syncStartScripts,
	writeReadme
} from './p4';
import {
	FIX_LOOP_MESSAGE,
	GENERATE_TESTS_MESSAGE,
	markP5Stale,
	p5NotReady,
	staleTestIds,
	testGate,
	testHashesOf,
	testsBlocked
} from './p5';
import {
	deployBlocked,
	deployGate,
	deployHashesOf,
	GENERATE_DEPLOY_MESSAGE,
	markP6Stale,
	p6NotReady,
	readPackageJson,
	staleDeployIds
} from './p6';
import { changedIds, designDiff, reqHashes } from './staleness';
import {
	closeNotReady,
	entryRan,
	notReproduced,
	p7Status,
	planNotReady,
	restoreTicket,
	ticketBefore,
	ticketRunRefused,
	ticketSteps,
	type TicketStep
} from './tickets';

/** The action clashes with the project's current state (a run is active, a gate fails, ...). */
export class ConflictError extends Error {
	override name = 'ConflictError';
	/** Set for the clashes the UI explains in its own words. */
	constructor(
		message: string,
		readonly code?: 'run_active' | 'busy'
	) {
		super(message);
	}
}

export class NotFoundError extends Error {
	override name = 'NotFoundError';
}

type ChatPhase = 'P1' | 'P2' | 'P4' | 'P5' | 'P6';
const ChatPhase = z.enum(['P1', 'P2', 'P4', 'P5', 'P6']);
/**
 * The phases a run belongs to: a chat phase, P3 for a design review run, or P7 for a ticket run of
 * the maintenance agent. P3 and P7 write no phase state: both are derived in the snapshot.
 */
type RunPhase = ChatPhase | 'P3' | 'P7';
const isChatPhase = (p: string): p is ChatPhase => ChatPhase.safeParse(p).success;
/** The phases with staleness: Still valid and Update. */
const StalePhase = z.enum(['P2', 'P4', 'P5', 'P6']);
type StalePhase = z.infer<typeof StalePhase>;
const CHAT_PHASES = ChatPhase.options;
/**
 * Turn limits per agent: the code agent in P4 chat, Update and Apply fix runs, the test agent in
 * P5 (spec section 6), the deploy agent in P6 and the maintenance agent in a ticket.
 */
const AGENT_TURNS: Record<string, number> = {
	review: 8,
	code: 40,
	test: 30,
	deploy: 25,
	maintenance: 20
};
/** Cost guards per agent run in USD; the run fails with reason `cost_limit` above it. */
const AGENT_COST_LIMIT: Record<string, number> = { review: 0.5, deploy: 1, maintenance: 1 };
/** Deploy checks that reach `docker compose up` per deploy agent run. */
const DEPLOY_CHECKS_PER_RUN = 3;
const MessageText = z.string().trim().min(1, 'The message is empty');
/** What the developer gives a new ticket; addTicket validates the lengths. */
const NewTicket = z.object({
	kind: TicketKind,
	title: z.string(),
	description: z.string()
});

/** A ticket as the UI shows it: its chat, its runs (derived from RunMeta.ticketId) and its walk. */
export type TicketView = Ticket & {
	chat: ChatEntry[];
	runIds: string[];
	steps: TicketStep[];
	closeBlocked: string | null;
	notReproduced: boolean;
	/** The entry run finished and is not discarded (see entryRan); closing needs it. */
	entryRan: boolean;
};

export type ProjectSnapshot = {
	name: string;
	state: State;
	requirements: RequirementsDoc | null;
	design: DesignDoc | null;
	diagrams: ReturnType<typeof renderAll> | null;
	chat: Record<ChatPhase | 'P3', ChatEntry[]>;
	gates: Record<ChatPhase, GateResult>;
	costByPhase: Partial<Record<PhaseId, number>>;
	activeRun: { runId: string; phase: PhaseId; ticketId?: string } | null;
	lastRun: RunMeta | null;
	/** The run discardLastRun would discard next: the latest one not discarded yet. */
	discardableRun: RunMeta | null;
	staleReqIds: string[];
	/** Design IDs that changed since P4 was approved; empty unless P4 is stale. */
	staleDesignIds: string[];
	/** Paths of the code files (`src/`, `public/`, package.json, tsconfig.json), the test files (`test/`), the docs and the deploy files. */
	files: string[];
	/** Latest status per planned file of the active generation run (P4 or P5), else null. */
	codegen: Record<string, FileStatus> | null;
	/** The stored P4 checks, so the UI can list their items; null before any ran. */
	checks: CodeChecks | null;
	/** The stored P5 checks with findings and test fixes; null before any ran. */
	testChecks: TestChecks | null;
	/** REQ, UC and SEQ IDs that changed since the tests were made or confirmed. */
	staleTestIds: string[];
	/** The proposals of the design reviews (P3); null before the first review. */
	proposals: DesignProposals | null;
	/** The stored deploy check; null before any ran. */
	deployCheck: DeployCheck | null;
	/** The compose services the design plans (name and health url); empty without a design or a readable package.json. */
	deployServices: { name: string; healthUrl: string }[];
	/** Whether a Run deploy check is running, started from any tab. */
	deployCheckRunning: boolean;
	/** Service node IDs (and `dependencies`) that changed since the deployment was made or confirmed. */
	staleDeployIds: string[];
	/** Runs whose files were put back; their chat entries stay visible but leave the agent history. */
	discardedRunIds: string[];
	tickets: TicketView[];
	/** The stored P4 checks are current and show drift, and a ticket may open (Deviation 9). */
	canOpenDriftTicket: boolean;
};

type AgentName = 'requirements' | 'design' | 'review' | 'code' | 'test' | 'deploy' | 'maintenance';

type Deps = {
	root: string;
	agents?: Record<AgentName, AgentDef>;
	/** Review the design after every P2 run that changed it; the app turns it on (`getOrchestrator`), scripts and tests leave it off. */
	autoReview?: boolean;
	run?: typeof runAgent;
	summarise?: typeof summariseRun;
	generate?: typeof generateCode;
	checks?: typeof runCodeChecks;
	generateTests?: typeof generateTests;
	testChecks?: typeof runTestChecks;
	fixLoop?: typeof runFixLoop;
	/** Runs `deploy_check` without an LLM (Run deploy check); it stores the check itself. */
	deployCheck?: (
		ctx: ToolContext,
		input: { urls: string[]; timeoutMs?: number }
	) => Promise<DeployCheckResult>;
};

/** Holds a project for one action; `run` is set when an agent run takes the project over. */
type Claim = {
	run: { runId: string; phase: PhaseId; ticketId?: string } | null;
	/** Latest status per planned file while the run is a generation run. */
	codegen?: Record<string, FileStatus>;
	/** Set while Run deploy check runs, so every tab can show it. */
	deployCheck?: boolean;
};

const STATE = '.aise/state.json';
const REQS = REQUIREMENTS_PATH;
const DESIGN = DESIGN_PATH;
const AGENT_OF = {
	P1: 'requirements',
	P2: 'design',
	P3: 'review',
	P4: 'code',
	P5: 'test',
	P6: 'deploy',
	P7: 'maintenance'
} as const;
const AUTO_DESIGN = 'Create the design from the approved requirements.';
const REVIEW_MESSAGE = 'Review the design and propose improvements.';
/**
 * The stored checks a run rewrites; saved at its start so a discard brings them back: the P4 and
 * P5 checks with their findings for a P5 run, the deploy check for a P6 run.
 */
const CHECK_FILES: Partial<Record<ChatPhase, string[]>> = {
	P5: ['.aise/checks/P4.json', '.aise/checks/P5.json'],
	P6: ['.aise/checks/deploy.json']
};

const now = () => new Date().toISOString();
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const readReqs = (store: ProjectStore) => store.readJson(REQS, RequirementsDoc);
const readDesign = (store: ProjectStore) => store.readJson(DESIGN, DesignDoc);
const saveProposals = (store: ProjectStore, doc: DesignProposals, runId?: string) =>
	store.writeJson(PROPOSALS_PATH, DesignProposals, doc, runId);

/** The proposal, which must exist (NotFoundError) and be open (ConflictError), with its document. */
async function openProposal(store: ProjectStore, id: string) {
	const doc = await readDesignProposals(store);
	const p = doc?.proposals.find((x) => x.id === id);
	if (!doc || !p) throw new NotFoundError(`No proposal ${id}`);
	if (p.status !== 'open') throw new ConflictError(`${id} is ${p.status} already`);
	return { doc, p };
}

/**
 * Puts a proposal back to open, a gone one stays gone. When the review sits at `movedTo` (the design
 * an accept run left, see followDesign), it moves back to the design on disk. Other proposals keep
 * their status, so discarding an accept run never undoes a later reject.
 */
async function reopenProposal(
	store: ProjectStore,
	id: string,
	movedTo: string | null = null
): Promise<void> {
	const doc = await readDesignProposals(store);
	if (!doc) return;
	const reopened = doc.proposals.some((p) => p.id === id)
		? resolveProposal(doc, id, 'open', now())
		: doc;
	const hash = doc.designHash === movedTo ? designHash(await readDesign(store)) : null;
	await saveProposals(store, hash ? { ...reopened, designHash: hash } : reopened);
}

/** The design hash of a stored design text; null when it does not parse. */
function hashOfText(text: string): string | null {
	try {
		return designHash(DesignDoc.parse(JSON.parse(text)));
	} catch {
		return null;
	}
}

/**
 * After an accept run that ended done: a review that matched the design before the run moves to
 * the new design, so its other proposals stay current. A stale review stays stale, and a run that
 * left the design unchanged (no backup of it) moves nothing.
 */
async function followDesign(store: ProjectStore, runId: string): Promise<void> {
	const backup = await readBackup(store, runId, DESIGN);
	if (backup === null) return;
	const [doc, design] = await Promise.all([readDesignProposals(store), readDesign(store)]);
	const hash = designHash(design);
	if (doc && hash && doc.designHash === hashOfText(backup))
		await saveProposals(store, { ...doc, designHash: hash });
}

/**
 * The phase chat as alternating text messages; tool calls are not replayed (ruling R15) and
 * messages of discarded runs are left out.
 */
function toHistory(chat: ChatEntry[], discarded: Set<string>): Anthropic.MessageParam[] {
	const out: { role: 'user' | 'assistant'; content: string }[] = [];
	for (const e of chat) {
		if (e.runId && discarded.has(e.runId)) continue;
		if (e.text.trim() === '' || (out.length === 0 && e.role === 'assistant')) continue;
		const text = speakerOf(e) + e.text;
		const last = out.at(-1);
		if (last?.role === e.role) last.content += `\n\n${text}`;
		else out.push({ role: e.role, content: text });
	}
	return out;
}

/**
 * A fix loop handoff is stored as the test agent's turn; one the code agent or the checks sent
 * names its speaker, so the test agent does not read it as its own words.
 */
function speakerOf(e: ChatEntry): string {
	if (e.from === 'code') return 'Code agent: ';
	if (e.from === 'checks') return 'Checks: ';
	return '';
}

/**
 * A ticket chat as agent history: the fenced triage brief stands in for the plain opening message
 * the chat shows, and is kept when the run that wrote it is discarded; the rest as in toHistory.
 */
function ticketHistory(
	t: Ticket,
	chat: ChatEntry[],
	discarded: Set<string>
): Anthropic.MessageParam[] {
	const rest = chat[0]?.role === 'user' && chat[0].text === ticketMessage(t) ? chat.slice(1) : chat;
	const brief: ChatEntry = { role: 'user', text: ticketTriageBrief(t), at: '' };
	return toHistory([brief, ...rest], discarded);
}

/** The chat a run writes to: its ticket's chat for a P7 run, else its phase chat. */
const chatKeyOf = (run: Pick<RunMeta, 'phase' | 'ticketId'>): ChatKey =>
	run.phase === 'P7' && run.ticketId ? run.ticketId : run.phase;

/** The ticket a run belongs to, with the state discard puts back. */
type RunTicket = { id: string; prev: NonNullable<RunMeta['prevTicket']> };

/**
 * The ticket of a new run: the given one, else the ticket in progress, if any. A P7 run needs
 * one; a done or rejected ticket never gets a run.
 */
async function resolveTicket(
	store: ProjectStore,
	phase: RunPhase,
	given: RunTicket | undefined
): Promise<{ ticket: Ticket; prev: RunTicket['prev'] } | null> {
	const t = given ? await findTicket(store, given.id) : inProgress(await readTickets(store));
	if (given && !t) throw new NotFoundError(`Unknown ticket: ${given.id}`);
	if (!t) {
		if (phase === 'P7') throw new Error('A P7 run needs a ticket');
		return null;
	}
	const refused = ticketRunRefused(t);
	if (refused) throw new ConflictError(refused);
	return { ticket: t, prev: given?.prev ?? ticketBefore(t) };
}

/** Opening a ticket needs P5 approved or stale, or an existing ticket (plan Deviation 9). */
function ticketsAllowed(state: State, tickets: Ticket[]): boolean {
	const { status } = state.phases.P5;
	return status === 'approved' || status === 'stale' || tickets.length > 0;
}

/**
 * Why no drift ticket can open from the stored P4 checks; null when one can. The checks must be
 * taken at the current code and design and show drift. Reads the stored checks only, never runs them.
 */
function driftTicketRefused(
	checks: CodeChecks | null,
	code: string | null,
	design: DesignDoc | null,
	tickets: Ticket[]
): string | null {
	const open = tickets.find(
		(t) => t.kind === 'drift' && t.status !== 'done' && t.status !== 'rejected'
	);
	if (open) return `${open.id} already covers the drift; close or reject it first`;
	if (!checks || checks.codeHash !== code || checks.designHash !== designHash(design))
		return 'Check again first: the stored checks are not from the current code and design';
	if (checks.drift.length === 0) return 'No drift between the code and the design';
	return null;
}

/**
 * Why the ticket cannot close yet, naming what to do; null when it can: every walk phase approved
 * (closeNotReady) and the entry run finished (entryRan). The close action and the view use it.
 */
function closeRefused(
	t: Ticket,
	state: State,
	runs: readonly Pick<RunMeta, 'phase' | 'ticketId' | 'status' | 'entry'>[]
): string | null {
	const notReady = closeNotReady(CHAT_PHASES, state, t);
	if (notReady) return notReady;
	if (entryRan(t, runs)) return null;
	return `The entry run of ${t.id} in ${t.plan!.entry} has not finished; press Start the entry run again before closing`;
}

/**
 * The Still valid notes of a ticket chat for its report. They carry no run, so only notes dated
 * after the ticket's first kept walk run count: notes of an earlier, discarded walk are left out.
 */
function stillValidNotes(t: Ticket, chat: ChatEntry[], runs: RunMeta[]): string[] {
	const walk = runs.filter(
		(r) => r.ticketId === t.id && r.status !== 'discarded' && r.phase !== 'P7'
	);
	const first = byStart(walk)[0];
	if (!first) return [];
	return chat
		.filter((e) => e.role === 'user' && e.auto && !e.runId && e.at > first.startedAt)
		.map((e) => e.text);
}

/**
 * P4 keeps its design hashes, P5 its requirement and use case hashes and P6 its deploy hashes
 * through every status change; P1 and P2 keep none.
 */
function keptHashes(phase: ChatPhase, from: PhaseState | undefined): Partial<PhaseState> {
	if (phase === 'P4' && from?.designHashes) return { designHashes: from.designHashes };
	if (phase === 'P5' && from?.reqHashes && from.useCaseHashes)
		return { reqHashes: from.reqHashes, useCaseHashes: from.useCaseHashes };
	if (phase === 'P6' && from?.deployHashes) return { deployHashes: from.deployHashes };
	return {};
}

const hasTests = async (store: ProjectStore) => (await listTestFiles(store)).length > 0;

/**
 * After a run or a direct write: awaiting approval when the artefact exists, else not started.
 * P4 keeps the design hashes of `from` (the state the run started from, by default the current).
 */
async function reopen(
	store: ProjectStore,
	state: State,
	phase: ChatPhase,
	from: PhaseState | undefined = state.phases[phase]
): Promise<void> {
	const exists =
		phase === 'P4'
			? await hasCode(store)
			: phase === 'P5'
				? await hasTests(store)
				: phase === 'P6'
					? await hasDeployFiles(store)
					: await store.exists(phase === 'P1' ? REQS : DESIGN);
	state.phases[phase] = {
		status: exists ? 'awaiting_approval' : 'not_started',
		...keptHashes(phase, from)
	};
}

/** The state a run started from, when it is worth keeping: an approval, possibly gone stale. */
const keptPhase = (prev: PhaseState | undefined): PhaseState | null =>
	prev && (prev.status === 'approved' || prev.status === 'stale') ? prev : null;

/**
 * P4's artefact is the code; P5's covers code and tests, because Apply fix changes `src/` (spec
 * section 8); P6's is the three deploy files.
 */
async function artefactHash(store: ProjectStore, phase: ChatPhase): Promise<string | null> {
	if (phase === 'P4') return codeHash(store);
	if (phase === 'P5') return p5Hash(store);
	if (phase === 'P6') return deployArtefactHash(store);
	const doc = phase === 'P1' ? await readReqs(store) : await readDesign(store);
	return doc && sha256(stableStringify(doc));
}

/** The artefact hash a run ends with: none for a P7 run, and none for an artefact that does not parse. */
const postHash = (store: ProjectStore, phase: PhaseId): Promise<string | null | undefined> =>
	isChatPhase(phase)
		? artefactHash(store, phase).catch(() => undefined)
		: Promise.resolve(undefined);

type RunHashes = Pick<RunMeta, 'designHashes' | 'reqHashes' | 'useCaseHashes' | 'deployHashes'>;
/**
 * What a run records at its start besides its ticket: the hashes, `report` for a close run only
 * and `entry` for an entry run only.
 */
type RunExtra = RunHashes & Pick<RunMeta, 'report' | 'entry' | 'fixLoop' | 'fromProposal'>;

type RunOrigin = Pick<
	RunMeta,
	'phase' | 'prevPhase' | 'prevArtefactHash' | 'ticketId' | 'prevTicket' | 'report' | 'fromProposal'
> &
	RunHashes & {
		id?: string;
		status?: RunMeta['status'];
	};

/**
 * After a run: an approved (or stale) phase whose artefact the run left unchanged keeps that
 * state, for example after a question; otherwise the phase reopens for approval. A P4 generation
 * or Update run that finished sets the design hashes the code is now made from, also when it
 * touched no file (the code already matched), but never while no file is under `src/`, so a failed
 * first run that wrote only the scaffold leaves no stale banner. A failed run only does so when it
 * changed files and the code had no hashes yet, so a failed Update keeps the stale banner. P5
 * generation and Update runs do the same with the requirement and use case hashes, while some
 * file is under `test/`, and P6 ones with the deploy hashes while a deploy file exists.
 */
async function afterRun(store: ProjectStore, state: State, run: RunOrigin): Promise<void> {
	const phase = ChatPhase.safeParse(run.phase);
	if (!phase.success || state.phases[phase.data].status !== 'running') return;
	await restoreOrReopen(store, state, phase.data, run);
	const adopts = async (stored: unknown, exists: () => Promise<boolean>) =>
		run.id !== undefined &&
		(await exists()) &&
		(run.status === 'done' ||
			(!(run.status === 'failed' && stored !== undefined) &&
				(await touchedFiles(store, run.id, README))));
	if (
		phase.data === 'P4' &&
		run.designHashes &&
		(await adopts(state.phases.P4.designHashes, () => hasCode(store)))
	) {
		state.phases.P4 = { ...state.phases.P4, designHashes: run.designHashes };
	}
	const { reqHashes: rh, useCaseHashes: uh } = run;
	if (
		phase.data === 'P5' &&
		rh &&
		uh &&
		(await adopts(state.phases.P5.useCaseHashes, () => hasTests(store)))
	) {
		state.phases.P5 = { ...state.phases.P5, reqHashes: rh, useCaseHashes: uh };
	}
	if (
		phase.data === 'P6' &&
		run.deployHashes &&
		(await adopts(state.phases.P6.deployHashes, () => hasDeployFiles(store)))
	) {
		state.phases.P6 = { ...state.phases.P6, deployHashes: run.deployHashes };
	}
}

/** Back to the state the run started from if the artefact still matches it, else reopen. */
async function restoreOrReopen(
	store: ProjectStore,
	state: State,
	phase: ChatPhase,
	run: RunOrigin
): Promise<void> {
	const prev = keptPhase(run.prevPhase);
	// An artefact that no longer parses counts as changed: the phase reopens instead of failing.
	const current = await artefactHash(store, phase).catch(() => undefined);
	const unchanged = run.prevArtefactHash !== undefined && current === run.prevArtefactHash;
	if (prev && unchanged) state.phases[phase] = prev;
	else await reopen(store, state, phase, run.prevPhase ?? state.phases[phase]);
}

function approval(
	failed: string[],
	hashes: Pick<PhaseState, 'reqHashes' | 'designHashes' | 'useCaseHashes' | 'deployHashes'> = {}
): PhaseState {
	const at = now();
	return {
		status: 'approved',
		approvedAt: at,
		...(failed.length > 0 ? { override: { at, failed } } : {}),
		...hashes
	};
}

/** IDs that changed since P2 was approved; empty unless P2 is stale. */
function staleIds(state: State, reqs: RequirementsDoc | null): string[] {
	const p2 = state.phases.P2;
	if (p2.status !== 'stale' || !p2.reqHashes) return [];
	return changedIds(p2.reqHashes, reqs ? reqHashes(reqs) : {});
}

/** An approved P2 turns stale while its stored hashes differ from the requirements, and back. */
function markStale(state: State, reqs: RequirementsDoc | null): void {
	const p2 = state.phases.P2;
	if ((p2.status !== 'approved' && p2.status !== 'stale') || !p2.reqHashes) return;
	const changed = changedIds(p2.reqHashes, reqs ? reqHashes(reqs) : {});
	p2.status = changed.length > 0 ? 'stale' : 'approved';
}

function requireP1Approved(state: State, action: string): void {
	if (state.phases.P1.status !== 'approved') {
		throw new ConflictError(`Approve P1 before ${action}`);
	}
}

function requireP2Ready(state: State, action: string): void {
	const reason = p2NotReady(state, action);
	if (reason) throw new ConflictError(reason);
}

/** P5 actions need P1 approved and P2 and P4 approved and not stale. */
function requireP5Ready(state: State, action: string): void {
	const reason = p5NotReady(state, action);
	if (reason) throw new ConflictError(reason);
}

/** P6 actions need P5 ready and P5 approved and not stale. */
function requireP6Ready(state: State, action: string): void {
	const reason = p6NotReady(state, action);
	if (reason) throw new ConflictError(reason);
}

/** The stored P5 checks when they were taken at the current code and tests, else ConflictError. */
async function currentTestChecks(store: ProjectStore): Promise<TestChecks> {
	const checks = await readTestChecks(store);
	const [code, test] = [await codeHash(store), await testHash(store)];
	if (!checks || checks.codeHash !== code || checks.testHash !== test) {
		throw new ConflictError('Run tests first, the results are out of date');
	}
	return checks;
}

/**
 * Recomputes P4 staleness from the design, P5 staleness from the requirements and the design and
 * P6 staleness from the design and package.json on disk; an unreadable artefact leaves them as
 * they are.
 */
async function refreshStale(store: ProjectStore, state: State): Promise<void> {
	const design = await readDesign(store).catch(() => undefined);
	if (design !== undefined) markP4Stale(state, design);
	// An unreadable design still lets requirement changes mark P5 stale.
	const reqs = await readReqs(store).catch(() => undefined);
	if (reqs !== undefined) markP5Stale(state, reqs, design);
	// An unreadable package.json (null) keeps P6 as it is; markP6Stale checks that.
	if (design !== undefined) markP6Stale(state, design, await readPackageJson(store));
}

/** Runs sorted by start time; run IDs alone misorder runs of different phases in one second. */
const byStart = (runs: RunMeta[]) =>
	[...runs].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));

const latestKept = (runs: RunMeta[]) =>
	byStart(runs)
		.filter((r) => r.status !== 'discarded')
		.at(-1) ?? null;

/** The requirement hashes of the P2 run that last wrote the design, if it recorded them. */
async function designMadeFrom(store: ProjectStore): Promise<Record<string, string> | undefined> {
	const runs = byStart(await listRuns(store)).filter(
		(r) => r.phase === 'P2' && r.status !== 'discarded'
	);
	for (const run of runs.reverse()) {
		if (await touchedFiles(store, run.id)) return run.reqHashes;
	}
	return undefined;
}

/** How a run does its work: an agent run, or a generation pipeline (P4, P5). */
type Work = (
	onEvent: (e: AgentEvent) => void,
	/** Appends an entry to the run's events file only: nothing is published and the summary never sees it. */
	logOnly: (entry: object) => void
) => Promise<RunResult & { checked?: boolean }>;

/**
 * Decides, once a run settled and before its claim is released, whether another run follows on
 * the same claim; returns what starts it, else null. Deciding has no side effects.
 */
type FollowUp = (status: RunMeta['status']) => Promise<(() => Promise<void>) | null>;

/**
 * Plain code that owns phase state, gates, staleness and runs for P1, P2, P4, P5 and P6. One action or run per
 * project at a time: the claim is taken synchronously, before the first await, so a second call
 * fails with ConflictError instead of starting a second run.
 */
export class Orchestrator {
	/** Settles once runs left `running` by an earlier process are marked failed; every method awaits it. */
	readonly ready: Promise<void>;
	private readonly root: string;
	private readonly agents: Record<AgentName, AgentDef>;
	private readonly run: typeof runAgent;
	private readonly summarise: typeof summariseRun;
	private readonly generate: typeof generateCode;
	private readonly checks: typeof runCodeChecks;
	private readonly testgen: typeof generateTests;
	private readonly testChecks: typeof runTestChecks;
	private readonly loop: typeof runFixLoop;
	private readonly deployCheck: NonNullable<Deps['deployCheck']>;
	private readonly autoReview: boolean;
	private readonly claims = new Map<string, Claim>();

	constructor(deps: Deps) {
		this.root = path.resolve(deps.root);
		this.agents = deps.agents ?? AGENTS;
		this.run = deps.run ?? runAgent;
		this.summarise = deps.summarise ?? summariseRun;
		this.generate = deps.generate ?? generateCode;
		this.checks = deps.checks ?? runCodeChecks;
		this.testgen = deps.generateTests ?? generateTests;
		this.testChecks = deps.testChecks ?? runTestChecks;
		this.loop = deps.fixLoop ?? runFixLoop;
		this.autoReview = deps.autoReview ?? false;
		this.deployCheck =
			deps.deployCheck ??
			((ctx, input) =>
				deployCheck.run(ctx, deployCheck.input.parse(input)) as Promise<DeployCheckResult>);
		this.ready = this.recover();
	}

	async listProjects(): Promise<string[]> {
		await this.ready;
		return this.projectNames();
	}

	async createProject(name: string): Promise<void> {
		await this.exclusive(
			name,
			async (store) => {
				if (await store.exists(STATE)) throw new ConflictError(`Project "${name}" already exists`);
				await writeState(store, initialState());
			},
			false
		);
	}

	async snapshot(name: string): Promise<ProjectSnapshot> {
		const store = this.storeFor(name);
		await this.ready;
		await this.mustExist(store, name);
		const [
			state,
			requirements,
			design,
			p1,
			p2,
			p3,
			p4,
			p5,
			p6,
			runs,
			checks,
			testChecks,
			files,
			tests,
			docs,
			deployFiles,
			deployCheck,
			pkg,
			tickets,
			proposals
		] = await Promise.all([
			readState(store),
			readReqs(store),
			readDesign(store),
			readChat(store, 'P1'),
			readChat(store, 'P2'),
			readChat(store, 'P3'),
			readChat(store, 'P4'),
			readChat(store, 'P5'),
			readChat(store, 'P6'),
			listRuns(store),
			readChecks(store),
			readTestChecks(store),
			listCodeFiles(store),
			listTestFiles(store),
			listDocFiles(store),
			listDeployFiles(store),
			readDeployCheck(store),
			readPackageJson(store),
			readTickets(store),
			readDesignProposals(store)
		]);
		const costByPhase: Partial<Record<PhaseId, number>> = {};
		for (const r of runs) costByPhase[r.phase] = (costByPhase[r.phase] ?? 0) + r.costUsd;
		const claim = this.claims.get(name);
		const active = claim?.run;
		// Hashed once: the P4 gate and the drift ticket rule both compare the stored checks with it.
		const code = await hashFiles(store, files);
		return {
			name,
			// P3 is derived from the proposals and P7 from the tickets (plan Deviation 4); state.json
			// keeps its own entries.
			state: {
				...state,
				phases: {
					...state.phases,
					P3: {
						status: active?.phase === 'P3' ? 'running' : p3Status(proposals, designHash(design))
					},
					P7: { status: p7Status(tickets, active ?? null) }
				}
			},
			requirements,
			design,
			diagrams: design && renderAll(design, name),
			chat: { P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6 },
			gates: {
				P1: checkGate('P1', requirements, design),
				P2: await designGate(store, requirements, design),
				P4: checkGate('P4', requirements, design, checks, code, missingEntries(files, design)),
				P5: await testGate(store, requirements),
				P6: await deployGate(store, design)
			},
			costByPhase,
			activeRun: active ? { ...active } : null,
			lastRun: byStart(runs).at(-1) ?? null,
			discardableRun: latestKept(runs),
			staleReqIds: staleIds(state, requirements),
			staleDesignIds: staleDesignIds(state, design),
			files: [...files, ...tests, ...docs, ...deployFiles].sort(),
			codegen: claim?.codegen ? { ...claim.codegen } : null,
			checks,
			testChecks,
			proposals,
			staleTestIds: staleTestIds(state, requirements, design),
			deployCheck,
			deployCheckRunning: claim?.deployCheck === true,
			deployServices:
				design && pkg !== null
					? deployPlan(design, pkg).services.map((s) => ({ name: s.name, healthUrl: s.healthUrl }))
					: [],
			staleDeployIds: staleDeployIds(state, design, pkg),
			discardedRunIds: runs.filter((r) => r.status === 'discarded').map((r) => r.id),
			tickets: await this.ticketViews(store, state, tickets, runs),
			canOpenDriftTicket:
				ticketsAllowed(state, tickets) && driftTicketRefused(checks, code, design, tickets) === null
		};
	}

	/**
	 * Opens a ticket and triages it in a P7 run of the maintenance agent: the model gets the
	 * fenced triage brief, the ticket chat the plain message. Needs P5 approved or stale, or an
	 * existing ticket (plan Deviation 9).
	 */
	async createTicket(
		name: string,
		input: { kind: TicketKind; title: string; description: string }
	): Promise<{ ticketId: string; runId: string }> {
		return this.exclusive(name, async (store, claim) =>
			this.openTicket(store, name, claim, NewTicket.parse(input))
		);
	}

	/**
	 * Opens a drift ticket from the stored P4 checks, which must be taken at the current code and
	 * design and show drift, and triages it like createTicket. Never runs the checks itself.
	 */
	async openDriftTicket(name: string): Promise<{ ticketId: string; runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			const checks = await readChecks(store);
			const design = await readDesign(store);
			const tickets = await readTickets(store);
			const refused = driftTicketRefused(checks, await codeHash(store), design, tickets);
			if (refused) throw new ConflictError(refused);
			return this.openTicket(store, name, claim, {
				kind: 'drift',
				title: 'Drift between code and design',
				description: driftDescription(checks!.drift)
			});
		});
	}

	/**
	 * Closes a ticket in a P7 run of the maintenance agent marked `report`, the only run that may
	 * call write_ticket_report. Refused while a walk phase is not approved (naming it) and until
	 * the entry run finished. The model gets the close brief, the ticket chat a plain line; the
	 * ticket turns done only through write_ticket_report, and a close run that fails or is
	 * discarded puts it back in progress.
	 */
	async closeTicket(name: string, ticketId: string): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			const id = TicketId.parse(ticketId);
			const t = await findTicket(store, id);
			if (!t) throw new NotFoundError(`No ticket ${id}`);
			const runs = await listRuns(store);
			const refused = closeRefused(t, await readState(store), runs);
			if (refused) throw new ConflictError(refused);
			const notes = stillValidNotes(t, await readChat(store, id), runs);
			const brief = closeBrief(t, await reportData(store, id), notes);
			const agent = { def: this.agents.maintenance, brief };
			const text = `Close ${id} and write the change report.`;
			const args = [text, true, { report: true }, agent, { id, prev: ticketBefore(t) }] as const;
			return { runId: await this.startRun(store, name, claim, 'P7', ...args) };
		});
	}

	/** A developer message in a ticket chat: a P7 run with the history of that ticket only. */
	async sendTicketMessage(
		name: string,
		ticketId: string,
		text: string
	): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			const id = TicketId.parse(ticketId);
			const message = MessageText.parse(text);
			const t = await findTicket(store, id);
			if (!t) throw new NotFoundError(`No ticket ${id}`);
			const ticket = { id, prev: ticketBefore(t) };
			return {
				runId: await this.startRun(store, name, claim, 'P7', message, false, {}, undefined, ticket)
			};
		});
	}

	/**
	 * Approves a triaged plan: the ticket goes in progress and its entry phase agent gets the fenced
	 * entry brief, the phase chat a short plain line. For a drift ticket `direction` switches the
	 * plan (design: P2, code: P4), saved before the checks. Refused, naming the phase, while an
	 * earlier phase is not approved or the entry phase's own precondition fails; one ticket in
	 * progress at a time. On a ticket in progress whose entry run did not finish (failed or
	 * interrupted) it starts the entry run again ("Start the entry run again"), with the same brief
	 * and the same ticket state for discard (triaged); the direction is fixed by then.
	 */
	async approvePlan(
		name: string,
		ticketId: string,
		opts: { direction?: 'design' | 'code' } = {}
	): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			const id = TicketId.parse(ticketId);
			const direction = opts.direction === undefined ? undefined : Direction.parse(opts.direction);
			let t = await findTicket(store, id);
			if (!t) throw new NotFoundError(`No ticket ${id}`);
			const refused = `${id} is ${t.status}; only a triaged ticket with a plan can start`;
			if (!t.plan) throw new ConflictError(refused);
			const restart = t.status === 'in_progress';
			if (restart) {
				if (entryRan(t, await listRuns(store))) {
					throw new ConflictError(`${id} is in progress and its entry run finished`);
				}
				if (direction) throw new ConflictError('The direction is fixed once the plan is approved');
			} else if (t.status !== 'triaged') {
				throw new ConflictError(refused);
			}
			const busy = inProgress(await readTickets(store));
			if (busy && busy.id !== id)
				throw new ConflictError(`${busy.id} is in progress; close it first`);
			if (direction) {
				if (t.kind !== 'drift') throw new ConflictError('Only a drift ticket has a direction');
				t = { ...t, plan: { ...t.plan, direction, entry: direction === 'design' ? 'P2' : 'P4' } };
				await saveTicket(store, t);
				publish(name, { type: 'changed' });
			}
			const plan = t.plan!;
			const entry = plan.entry;
			const state = await readState(store);
			const notReady = planNotReady(CHAT_PHASES, state, entry);
			if (notReady) throw new ConflictError(notReady);
			const action = 'approving the plan';
			if (entry === 'P2') requireP1Approved(state, action);
			if (entry === 'P4') {
				requireP2Ready(state, action);
				if (!(await hasCode(store))) throw new ConflictError('Generate the code first');
			}
			if (entry === 'P5') {
				requireP5Ready(state, action);
				if (!(await hasTests(store))) throw new ConflictError('Generate the tests first');
			}
			// A restart records the ticket as before the first entry run: discard goes back to triaged.
			const prev = { ...ticketBefore(t), status: 'triaged' as const };
			// The chat shows a plain line without ticket content: toHistory replays it unfenced.
			const agent = { def: this.agents[AGENT_OF[entry]], brief: entryBrief(t, plan) };
			const text = `Plan of ${t.id} approved.`;
			const args = [text, true, { entry: true }, agent, { id, prev }] as const;
			try {
				await saveTicket(store, { ...t, status: 'in_progress' });
				return { runId: await this.startRun(store, name, claim, entry, ...args) };
			} catch (e) {
				// A restart that cannot start leaves the ticket in progress, as it was.
				if (!restart) {
					await this.putBack(store, id, prev);
					publish(name, { type: 'changed' });
				}
				throw e;
			}
		});
	}

	/** Rejects an open or triaged ticket; one in progress needs its runs discarded first. */
	async rejectTicket(name: string, ticketId: string): Promise<void> {
		await this.exclusive(name, async (store) => {
			const id = TicketId.parse(ticketId);
			const t = await findTicket(store, id);
			if (!t) throw new NotFoundError(`No ticket ${id}`);
			if (t.status === 'in_progress') {
				throw new ConflictError(`${id} is in progress. Discard this ticket's runs first`);
			}
			if (t.status !== 'open' && t.status !== 'triaged') {
				throw new ConflictError(`${id} is ${t.status} already`);
			}
			await saveTicket(store, { ...t, status: 'rejected' });
			publish(name, { type: 'changed' });
		});
	}

	async sendMessage(name: string, phase: ChatPhase, text: string): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			const p = ChatPhase.parse(phase);
			const t = MessageText.parse(text);
			// R14: the design comes from approved requirements.
			if (p === 'P2') requireP1Approved(await readState(store), 'working on the design');
			if (p === 'P4') {
				requireP2Ready(await readState(store), 'working on the code');
				if (!(await hasCode(store))) throw new ConflictError('Generate the code first');
			}
			if (p === 'P5') {
				requireP5Ready(await readState(store), 'working on the tests');
				if (!(await hasTests(store))) throw new ConflictError('Generate the tests first');
			}
			if (p === 'P6') {
				requireP6Ready(await readState(store), 'working on the deployment');
				if (!(await hasDeployFiles(store)))
					throw new ConflictError('Generate the deployment first');
			}
			return { runId: await this.startRun(store, name, claim, p, t, false) };
		});
	}

	async approve(
		name: string,
		phase: ChatPhase,
		opts: { anyway?: boolean; override?: boolean } = {}
	): Promise<void> {
		await this.exclusive(name, async (store, claim) => {
			const p = ChatPhase.parse(phase);
			const state = await readState(store);
			if (p === 'P2') requireP1Approved(state, 'approving P2');
			if (p === 'P4') requireP2Ready(state, 'approving P4');
			if (p === 'P5') requireP5Ready(state, 'approving P5');
			if (p === 'P6') requireP6Ready(state, 'approving P6');
			const { status } = state.phases[p];
			if (status === 'approved') throw new ConflictError(`${p} is already approved`);
			if ((p === 'P4' || p === 'P5' || p === 'P6') && status === 'stale') {
				throw new ConflictError(`${p} is stale: choose Update or Still valid`);
			}
			if (status === 'not_started') throw new ConflictError(`${p} has nothing to approve yet`);

			const current = await readReqs(store);
			let reqs = current;
			if (p === 'P1' && opts.anyway && reqs && reqs.openQuestions.length > 0) {
				reqs = {
					...reqs,
					assumptions: [
						...reqs.assumptions,
						...reqs.openQuestions.map((q) => `Assumed: ${q.text}`)
					],
					openQuestions: []
				};
			}
			const design = p === 'P1' ? null : await readDesign(store);
			const gate =
				p === 'P4'
					? await codeGate(store, reqs, design)
					: p === 'P5'
						? await testGate(store, reqs)
						: p === 'P6'
							? await deployGate(store, design)
							: p === 'P2'
								? await designGate(store, reqs, design)
								: checkGate(p, reqs, design);
			const failed = failedChecks(gate);
			// P2, P4, P5 and P6 can be approved over a failing gate; P1 answers open questions with `anyway`.
			if (failed.length > 0 && !(opts.override && p !== 'P1')) {
				throw new ConflictError(`${p} gate failed: ${failed.join(', ')}`);
			}
			if (reqs && reqs !== current) await saveRequirements(store, reqs);

			// P2 records the requirements its design was made from, P4 keeps the design its code was
			// made from and P5 what its tests were made from, so an artefact that predates its input is
			// stale right after approval.
			if (p === 'P2' && reqs) {
				state.phases.P2 = approval(failed, {
					reqHashes: (await designMadeFrom(store)) ?? reqHashes(reqs)
				});
			} else if (p === 'P4') {
				state.phases.P4 = approval(failed, {
					designHashes: state.phases.P4.designHashes ?? designHashesOf(design)
				});
			} else if (p === 'P5') {
				const kept = keptHashes('P5', state.phases.P5);
				state.phases.P5 = approval(failed, kept.useCaseHashes ? kept : testHashesOf(reqs, design));
			} else if (p === 'P6') {
				// Hashes only from a readable package.json: an empty one would mark every node changed.
				const pkg = await readPackageJson(store);
				const deployHashes =
					state.phases.P6.deployHashes ?? (pkg === null ? undefined : deployHashesOf(design, pkg));
				state.phases.P6 = approval(failed, deployHashes ? { deployHashes } : {});
			} else {
				state.phases[p] = approval(failed);
			}
			markStale(state, reqs);
			await refreshStale(store, state);
			await writeState(store, state);
			if (p === 'P1' && !(await store.exists(DESIGN))) {
				await this.startRun(store, name, claim, 'P2', AUTO_DESIGN, true);
			}
			// The first code comes from the first approved design; later changes go through Update.
			if (
				p === 'P2' &&
				!p2NotReady(state, 'generating code') &&
				!designProblems(design, reqs) &&
				!(await hasCode(store))
			) {
				await this.autoStart(name, claim, 'code generation', () =>
					this.startGeneration(store, name, claim, design!, reqs)
				);
			}
			// The first tests come from the first approved code; later changes go through chat or Update.
			// An override over a failing gate starts nothing paid on its own.
			if (
				p === 'P4' &&
				failed.length === 0 &&
				!p5NotReady(state, 'generating tests') &&
				!(await testsBlocked(store, reqs, design))
			) {
				await this.autoStart(name, claim, 'test generation', () =>
					this.startTestGeneration(store, name, claim, design!, reqs!)
				);
			}
			// The first deployment comes from the first approved tests, the same way.
			if (
				p === 'P5' &&
				failed.length === 0 &&
				!p6NotReady(state, 'generating the deployment') &&
				!(await deployBlocked(store, design))
			) {
				await this.autoStart(name, claim, 'the deployment', () =>
					this.startDeployment(store, name, claim, design!)
				);
			}
			publish(name, { type: 'changed' });
		});
	}

	/**
	 * Re-approves a stale P2, P4, P5 or P6 unchanged; a failing gate is recorded as an override. A
	 * P4, P5 or P6 awaiting approval with stale IDs (after a chat run) takes the current hashes and
	 * keeps waiting for approval.
	 */
	async stillValid(name: string, phase: StalePhase): Promise<void> {
		await this.exclusive(name, async (store) => {
			const p = StalePhase.parse(phase);
			const state = await readState(store);
			if (p === 'P2') requireP1Approved(state, 'confirming P2');
			else if (p === 'P4') requireP2Ready(state, 'confirming P4');
			else if (p === 'P5') requireP5Ready(state, 'confirming P5');
			else requireP6Ready(state, 'confirming P6');
			const reqs = await readReqs(store);
			const design = await readDesign(store);
			if (p === 'P6') {
				const pkg = await readPackageJson(store);
				// staleDeployIds is empty for an unreadable package.json, so pkg is set below.
				if (staleDeployIds(state, design, pkg).length === 0) {
					throw new ConflictError('P6 is not stale');
				}
				const deployHashes = deployHashesOf(design, pkg);
				if (state.phases.P6.status === 'stale') {
					const failed = failedChecks(await deployGate(store, design));
					state.phases.P6 = approval(failed, { deployHashes });
				} else {
					state.phases.P6 = { ...state.phases.P6, deployHashes };
				}
			} else if (p === 'P5') {
				if (staleTestIds(state, reqs, design).length === 0) {
					throw new ConflictError('P5 is not stale');
				}
				const hashes = testHashesOf(reqs, design);
				if (state.phases.P5.status === 'stale') {
					const failed = failedChecks(await testGate(store, reqs));
					state.phases.P5 = approval(failed, hashes);
				} else {
					state.phases.P5 = { ...state.phases.P5, ...hashes };
				}
			} else if (p === 'P2') {
				if (state.phases.P2.status !== 'stale') throw new ConflictError('P2 is not stale');
				const failed = failedChecks(await designGate(store, reqs, design));
				state.phases.P2 = approval(failed, { reqHashes: reqs ? reqHashes(reqs) : {} });
			} else {
				if (staleDesignIds(state, design).length === 0) {
					throw new ConflictError('P4 is not stale');
				}
				const designHashes = designHashesOf(design);
				if (state.phases.P4.status === 'stale') {
					const failed = failedChecks(await codeGate(store, reqs, design));
					state.phases.P4 = approval(failed, { designHashes });
				} else {
					state.phases.P4 = { ...state.phases.P4, designHashes };
				}
			}
			await writeState(store, state);
			// Still valid starts no run, so the ticket in progress gets a note for its report instead.
			// A failed note is logged and never fails the confirmation, which is saved already.
			try {
				const ticket = inProgress(await readTickets(store));
				if (ticket) {
					const note: ChatEntry = {
						role: 'user',
						text: `${p} confirmed still valid.`,
						at: now(),
						auto: true
					};
					await appendChat(store, ticket.id, note);
				}
			} catch (e) {
				console.error(`could not note ${p} still valid in the ticket chat`, e);
			}
			publish(name, { type: 'changed' });
		});
	}

	async updateStale(name: string, phase: StalePhase): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			const p = StalePhase.parse(phase);
			const state = await readState(store);
			if (p === 'P6') {
				requireP6Ready(state, 'updating P6');
				const [design, pkg] = await Promise.all([readDesign(store), readPackageJson(store)]);
				const stored = state.phases.P6.deployHashes;
				// staleDeployIds is empty for an unreadable package.json, so pkg is set below.
				if (!stored || staleDeployIds(state, design, pkg).length === 0) {
					throw new ConflictError('P6 is not stale');
				}
				if (!design) throw new ConflictError('Updating the deployment needs the design');
				const current = deployHashesOf(design, pkg);
				const { changed, added, removed } = designDiff(stored, current);
				const plan = deployPlan(design, pkg);
				const extra = await extraEnvVars(store, plan);
				const brief = deployUpdateBrief(plan, changed, added, removed, design, extra);
				const ids = [...changed, ...added, ...removed].sort();
				const text = `The deployment inputs changed: ${ids.join(', ')}. Update the deployment.`;
				const agent = { def: this.agents.deploy, brief };
				const hashes = { deployHashes: current };
				return {
					runId: await this.startRun(store, name, claim, 'P6', text, true, hashes, agent)
				};
			}
			if (p === 'P2') {
				requireP1Approved(state, 'updating P2');
				const ids = staleIds(state, await readReqs(store));
				if (ids.length === 0) throw new ConflictError('P2 is not stale');
				const text = `The requirements changed: ${ids.join(', ')}. Update only the affected design elements.`;
				return { runId: await this.startRun(store, name, claim, 'P2', text, true) };
			}
			if (p === 'P5') {
				requireP5Ready(state, 'updating P5');
				const [reqs, design] = await Promise.all([readReqs(store), readDesign(store)]);
				const { reqHashes: rh, useCaseHashes: uh } = state.phases.P5;
				if (!rh || !uh || staleTestIds(state, reqs, design).length === 0) {
					throw new ConflictError('P5 is not stale');
				}
				const current = testHashesOf(reqs, design);
				const { changed, added, removed } = designDiff(
					{ ...rh, ...uh },
					{ ...current.reqHashes, ...current.useCaseHashes }
				);
				const text = testUpdateBrief(changed, added, removed);
				return { runId: await this.startRun(store, name, claim, 'P5', text, true, current) };
			}
			requireP2Ready(state, 'updating P4');
			const design = await readDesign(store);
			const stored = state.phases.P4.designHashes;
			if (!stored || staleDesignIds(state, design).length === 0) {
				throw new ConflictError('P4 is not stale');
			}
			const current = designHashesOf(design);
			const { changed, added, removed } = designDiff(stored, current);
			const text = updateBrief(
				changed,
				added,
				removed,
				design,
				design ? dbFile(design, name) : null,
				await staleEntries(store, design)
			);
			return {
				runId: await this.startRun(store, name, claim, 'P4', text, true, { designHashes: current })
			};
		});
	}

	/**
	 * Starts the generation pipeline (spec section 5). Needs P2 approved and not stale, a design
	 * without validation issues and no code yet: once code exists it changes through chat or Update.
	 */
	async generateCode(name: string): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			requireP2Ready(await readState(store), 'generating code');
			const [design, reqs] = await Promise.all([readDesign(store), readReqs(store)]);
			const problems = designProblems(design, reqs);
			if (problems) throw new ConflictError(problems);
			if (await hasCode(store)) {
				throw new ConflictError('The code exists already; change it through the chat or Update');
			}
			return { runId: await this.startGeneration(store, name, claim, design!, reqs) };
		});
	}

	/**
	 * Starts the test generation pipeline (P5 spec section 5). Needs P4 approved and not stale, the
	 * requirements, the design and a package.json, and no tests yet: once tests exist they change
	 * through chat or Update.
	 */
	async generateTests(name: string): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			requireP5Ready(await readState(store), 'generating tests');
			const [design, reqs] = await Promise.all([readDesign(store), readReqs(store)]);
			const blocked = await testsBlocked(store, reqs, design);
			if (blocked) throw new ConflictError(blocked);
			return { runId: await this.startTestGeneration(store, name, claim, design!, reqs!) };
		});
	}

	/**
	 * Runs typecheck and the tests and stores them for the P5 gate, without an LLM. Like checkCode
	 * it needs no approval: it changes no file but the derived checks. Docker errors propagate.
	 */
	async checkTests(name: string): Promise<void> {
		await this.exclusive(name, async (store) => {
			await this.testChecks({ store, runId: '', projectName: name, agent: 'test' });
			publish(name, { type: 'changed' });
		});
	}

	/**
	 * Starts the deploy agent on the plan (P6 spec). Needs P5 approved and not stale, the design and
	 * package.json, and no deploy file yet: once one exists the files change through chat or Update.
	 */
	async generateDeployment(name: string): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			requireP6Ready(await readState(store), 'generating the deployment');
			const design = await readDesign(store);
			const blocked = await deployBlocked(store, design);
			if (blocked) throw new ConflictError(blocked);
			return { runId: await this.startDeployment(store, name, claim, design!) };
		});
	}

	/**
	 * Runs `deploy_check` on the plan's health urls without an LLM; the tool stores the result for
	 * the P6 gate. Like checkTests it needs no approval. A refusal or Docker down (ToolError) is a
	 * result too when the tool stored it as a failed check; when it kept a pass for the same files
	 * instead, nothing would show, so the message comes back as a ConflictError. It tells the UI at
	 * the start and at the end, since a check can take minutes.
	 */
	async checkDeploy(name: string): Promise<void> {
		await this.exclusive(name, async (store, claim) => {
			if (!(await store.exists('compose.yaml')))
				throw new ConflictError('There is no compose.yaml to check; generate the deployment first');
			const [design, pkg] = await Promise.all([readDesign(store), readPackageJson(store)]);
			if (!design || pkg === null)
				throw new ConflictError('Checking the deployment needs the design and package.json');
			const urls = deployPlan(design, pkg).services.map((s) => s.healthUrl);
			const ctx: ToolContext = { store, runId: '', projectName: name, agent: 'deploy' };
			const before = (await readDeployCheck(store))?.at;
			claim.deployCheck = true;
			publish(name, { type: 'changed' });
			try {
				await this.deployCheck(ctx, { urls });
			} catch (e) {
				if (!(e instanceof ToolError)) throw e;
				if ((await readDeployCheck(store))?.at === before) throw new ConflictError(e.message);
			} finally {
				claim.deployCheck = false;
				publish(name, { type: 'changed' });
			}
		});
	}

	/**
	 * Hands an open finding to the code agent (P5 spec section 5.5): a P5 run of agent `code` whose
	 * only message is the fix brief with the test file and that test's failure. It ends with the P4
	 * and the P5 checks; Discard last run restores `src/`.
	 */
	async applyFix(name: string, findingId: string): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			requireP5Ready(await readState(store), 'applying a fix');
			const checks = await currentTestChecks(store);
			const f = checks.findings.find((x) => x.id === findingId);
			if (!f || !findingOpen(f, checks.result)) {
				throw new ConflictError('This finding is unknown or its test no longer fails');
			}
			const content = await store.readText(f.file);
			if (content === null) {
				throw new ConflictError(`The test file ${f.file} no longer exists; run tests first`);
			}
			const brief = fixBrief(f, f.file, content, failureOf(f, checks.result));
			const text = `Apply the fix for "${f.test}" (${f.id}).`;
			const agent = { def: this.agents.code, brief };
			return { runId: await this.startRun(store, name, claim, 'P5', text, true, {}, agent) };
		});
	}

	/**
	 * Explain failures: triage of the stored failing tests that no open finding explains, after a
	 * hand edit or a Run tests (spec section 1, the demo path). A P5 run of the test agent whose
	 * only message is `triageBrief` with those tests and the stored log tail; it ends with the P5
	 * checks, which merge the reported findings and test fixes. A test file it changed without a
	 * report is recorded, as in generation triage. Needs current stored checks.
	 */
	async triageTests(name: string): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			requireP5Ready(await readState(store), 'explaining failures');
			const checks = await currentTestChecks(store);
			const failures = unexplainedFailures(checks.result, checks.findings);
			if (failures.length === 0) {
				const failing = checks.result?.tests.some((t) => t.status === 'failed' && !t.suite);
				throw new ConflictError(
					failing ? 'Every failing test is already explained' : 'No test fails, nothing to explain'
				);
			}
			const brief = triageBrief(failures, checks.result?.logTail ?? '');
			const agent = { def: this.agents.test, brief, recordTestChanges: true };
			const text = 'Explain the failing tests.';
			return { runId: await this.startRun(store, name, claim, 'P5', text, true, {}, agent) };
		});
	}

	/**
	 * Fix automatically: a fix loop run in which the test agent and the code agent work through the
	 * open code bug findings and the unexplained failures of the stored checks (fix loop spec,
	 * Triggers). Needs current stored checks with at least one of either.
	 */
	async fixLoop(name: string): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			requireP5Ready(await readState(store), 'fixing the failing tests');
			const checks = await currentTestChecks(store);
			// Without a result every unresolved finding counts as open: nothing confirms it fails.
			if (checks.result === null)
				throw new ConflictError('Run tests first, there is no test result');
			const open = checks.findings.some((f) => findingOpen(f, checks.result));
			if (!open && unexplainedFailures(checks.result, checks.findings).length === 0) {
				throw new ConflictError('No test fails, nothing to fix');
			}
			return { runId: await this.startFixLoop(store, name, claim) };
		});
	}

	/** Starts a design review (P3): a run of the review agent on the current design. */
	async reviewDesign(name: string): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			if (!(await readDesign(store).catch(() => null)))
				throw new ConflictError('There is no design to review yet');
			return { runId: await this.startReview(store, name, claim) };
		});
	}

	/**
	 * Accepts an open proposal: marks it accepted and hands it to the design agent in a P2 run with
	 * `fromProposal`, which starts no review after it. Discarding that run reopens the proposal.
	 */
	async acceptProposal(name: string, id: string): Promise<{ runId: string }> {
		return this.exclusive(name, async (store, claim) => {
			requireP1Approved(await readState(store), 'changing the design');
			const { doc, p } = await openProposal(store, id);
			await saveProposals(store, resolveProposal(doc, id, 'accepted', now()));
			const text = `Apply review proposal ${id}: ${p.title}. ${p.change}`;
			try {
				const extra = { fromProposal: id };
				return { runId: await this.startRun(store, name, claim, 'P2', text, true, extra) };
			} catch (e) {
				await reopenProposal(store, id);
				throw e;
			}
		});
	}

	/** Rejects an open proposal; no run. */
	async rejectProposal(name: string, id: string): Promise<void> {
		await this.exclusive(name, async (store) => {
			const { doc } = await openProposal(store, id);
			await saveProposals(store, resolveProposal(doc, id, 'rejected', now()));
			publish(name, { type: 'changed' });
		});
	}

	/** The folder of a project; throws PathError for a name that is not a valid project name. */
	projectDir(name: string): string {
		return this.storeFor(name).dir;
	}

	/**
	 * Runs typecheck and drift on the current code and stores them for the P4 gate. A timed out
	 * typecheck is stored as such and shows in the gate; Docker errors propagate.
	 */
	async checkCode(name: string): Promise<void> {
		await this.exclusive(name, async (store) => {
			// No run: the checks only read the code and write the checks file, which is never backed up.
			await this.checks({ store, runId: '', projectName: name, agent: 'code' });
			publish(name, { type: 'changed' });
		});
	}

	async editRequirements(name: string, doc: RequirementsDoc): Promise<void> {
		await this.exclusive(name, async (store) => {
			const reqs = RequirementsDoc.parse(doc);
			await saveRequirements(store, reqs);
			const state = await readState(store);
			await reopen(store, state, 'P1');
			markStale(state, reqs);
			await refreshStale(store, state);
			await writeState(store, state);
			publish(name, { type: 'changed' });
		});
	}

	/**
	 * Restores the files of the latest run that is not discarded yet and the phase state it
	 * started from; repeated calls walk back.
	 */
	async discardLastRun(name: string): Promise<void> {
		await this.exclusive(name, async (store) => {
			const run = latestKept(await listRuns(store));
			if (!run) throw new ConflictError('There is no run to discard');
			if (run.status === 'running')
				throw new ConflictError('A run is already active', 'run_active');
			const phase = ChatPhase.safeParse(run.phase);
			if (
				phase.success &&
				run.postArtefactHash !== undefined &&
				(await touchedFiles(store, run.id)) &&
				// An unreadable artefact counts as changed.
				(await artefactHash(store, phase.data).catch(() => undefined)) !== run.postArtefactHash
			) {
				throw new ConflictError(
					'The files changed after this run (an edit or an approval); discarding it would undo those changes'
				);
			}
			// A README rewrite alone leaves the files, and so the stored checks, as they were.
			const touched = await touchedFiles(store, run.id, README);
			// The design an accept run left, where followDesign may have moved the review.
			const acceptedAt = run.fromProposal ? designHash(await readDesign(store)) : null;
			await restoreRun(store, run.id);
			// P5 runs rewrite the checks, findings included; restored files need the old ones. A run
			// that changed no file leaves the current checks, which still describe the files.
			if ((run.phase === 'P5' || run.phase === 'P6') && touched)
				await restoreChecksBefore(store, run.id);
			// The README links RUN.md only while it exists.
			if (run.phase === 'P6') await this.readme(store, run.id, name);
			// A ticket's P7 run changed no artefact: the phase state stays as it is. An MCP write run
			// (P7 without a ticket) changed files, so staleness is recomputed after it.
			if (phase.success || !run.ticketId) {
				const state = await readState(store);
				if (phase.success) await restoreOrReopen(store, state, phase.data, run);
				markStale(state, await readReqs(store));
				await refreshStale(store, state);
				await writeState(store, state);
			}
			if (run.ticketId && run.prevTicket) await this.putBack(store, run.ticketId, run.prevTicket);
			if (run.fromProposal) await reopenProposal(store, run.fromProposal, acceptedAt);
			publish(name, { type: 'changed' });
		});
	}

	// --- internals ---

	/** Adds a ticket and starts its triage run; refused unless tickets are allowed (Deviation 9). */
	private async openTicket(
		store: ProjectStore,
		name: string,
		claim: Claim,
		fields: { kind: TicketKind; title: string; description: string }
	): Promise<{ ticketId: string; runId: string }> {
		if (!ticketsAllowed(await readState(store), await readTickets(store))) {
			throw new ConflictError('Approve P5 before opening the first ticket');
		}
		const t = await addTicket(store, fields);
		const ticket = { id: t.id, prev: ticketBefore(t) };
		try {
			const text = ticketMessage(t);
			const args = [text, false, {}, undefined, ticket] as const;
			return { ticketId: t.id, runId: await this.startRun(store, name, claim, 'P7', ...args) };
		} catch (e) {
			await this.dropTicket(store, t.id);
			throw e;
		}
	}

	/**
	 * Removes a ticket whose triage run could not start, and its chat, so a retry makes no second
	 * ticket and the reused ID opens an empty chat. A failure here is logged; the error of the run
	 * start is the one the caller sees.
	 */
	private async dropTicket(store: ProjectStore, id: string): Promise<void> {
		try {
			await writeTickets(
				store,
				(await readTickets(store)).filter((x) => x.id !== id)
			);
			await deleteChat(store, id);
		} catch (e) {
			console.error(`could not remove ticket ${id} after its run failed to start`, e);
		}
	}

	/**
	 * Puts a ticket back to the state a run recorded before it. A ticket that is gone, or that the
	 * developer rejected since, stays as it is: a discard never takes back a rejection.
	 */
	private async putBack(
		store: ProjectStore,
		id: string,
		prev: NonNullable<RunMeta['prevTicket']>
	): Promise<void> {
		const t = await findTicket(store, id);
		if (t && t.status !== 'rejected') await saveTicket(store, restoreTicket(t, prev));
	}

	private async ticketViews(
		store: ProjectStore,
		state: State,
		tickets: Ticket[],
		runs: RunMeta[]
	): Promise<TicketView[]> {
		const sorted = byStart(runs);
		return Promise.all(
			tickets.map(async (t) => {
				const own = sorted.filter((r) => r.ticketId === t.id && r.status !== 'discarded');
				// Only finished test agent runs say whether the bug was reproduced; a fix loop fixes, so
				// its findings say nothing about it.
				const test = this.agents.test.name;
				const p5 = own.filter(
					(r) => r.phase === 'P5' && r.agent === test && !r.fixLoop && r.status === 'done'
				);
				const findings =
					t.kind === 'bug' && t.status === 'in_progress'
						? await Promise.all(p5.map((r) => readRunFindings(store, r.id)))
						: [];
				return {
					...t,
					chat: await readChat(store, t.id),
					runIds: own.map((r) => r.id),
					steps: ticketSteps(CHAT_PHASES, state, t),
					closeBlocked: t.status === 'in_progress' ? closeRefused(t, state, own) : null,
					notReproduced: notReproduced(t, findings),
					entryRan: entryRan(t, own)
				};
			})
		);
	}

	private storeFor(name: string): ProjectStore {
		if (!isValidProjectName(name)) throw new PathError(`Not a valid project name: ${name}`);
		return new ProjectStore(path.join(this.root, name));
	}

	private async mustExist(store: ProjectStore, name: string): Promise<void> {
		if (!(await store.exists(STATE))) throw new NotFoundError(`No project named "${name}"`);
	}

	private async projectNames(): Promise<string[]> {
		let entries;
		try {
			entries = await readdir(this.root, { withFileTypes: true });
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw e;
		}
		const names: string[] = [];
		for (const e of entries) {
			if (!e.isDirectory() || !isValidProjectName(e.name)) continue;
			if (await this.storeFor(e.name).exists(STATE)) names.push(e.name);
		}
		return names.sort();
	}

	/**
	 * Claims the project synchronously, then runs `fn`. The claim is released when `fn` ends,
	 * unless `fn` started a run; the run releases it when it finishes.
	 */
	private async exclusive<T>(
		name: string,
		fn: (store: ProjectStore, claim: Claim) => Promise<T>,
		mustExist = true
	): Promise<T> {
		const store = this.storeFor(name);
		const held = this.claims.get(name);
		if (held) {
			throw held.run
				? new ConflictError('A run is already active', 'run_active')
				: new ConflictError('Another action is running', 'busy');
		}
		const claim: Claim = { run: null };
		this.claims.set(name, claim);
		try {
			await this.ready;
			if (mustExist) await this.mustExist(store, name);
			return await fn(store, claim);
		} finally {
			if (claim.run === null) this.release(name, claim);
		}
	}

	private release(name: string, claim: Claim): void {
		if (this.claims.get(name) === claim) this.claims.delete(name);
	}

	/**
	 * Records the user message, sets the phase running and tells the UI; returns the chat history.
	 * The run belongs to `ticket`, else to the ticket in progress, if any. A P7 run is a ticket
	 * run: it writes to the ticket chat and leaves the phase state alone.
	 */
	private async openRun(
		store: ProjectStore,
		name: string,
		claim: Claim,
		phase: RunPhase,
		agent: string,
		text: string,
		auto: boolean,
		extra: RunExtra = {},
		ticket?: RunTicket
	): Promise<{ run: RunMeta; history: Anthropic.MessageParam[] }> {
		const owner = await resolveTicket(store, phase, ticket);
		const ticketFields = owner ? { ticketId: owner.ticket.id, prevTicket: owner.prev } : {};
		let run = await createRun(store, phase, agent);
		claim.run = { runId: run.id, phase, ...(owner && { ticketId: owner.ticket.id }) };
		let history: Anthropic.MessageParam[];
		try {
			const key = chatKeyOf({ phase, ...ticketFields });
			const checkFiles = isChatPhase(phase) ? CHECK_FILES[phase] : undefined;
			if (checkFiles) await saveChecksBefore(store, run.id, checkFiles);
			await appendChat(store, key, {
				role: 'user',
				text,
				at: now(),
				runId: run.id,
				...(auto ? { auto } : {})
			});
			if (phase === 'P7' || phase === 'P3') {
				run = await updateRun(store, run.id, { ...extra, ...ticketFields });
			} else {
				const state = await readState(store);
				const reqs = phase === 'P2' ? await readReqs(store) : null;
				run = await updateRun(store, run.id, {
					prevPhase: state.phases[phase],
					prevArtefactHash: await artefactHash(store, phase),
					...(reqs ? { reqHashes: reqHashes(reqs) } : {}),
					...extra,
					...ticketFields
				});
				state.phases[phase] = { status: 'running', ...keptHashes(phase, state.phases[phase]) };
				await writeState(store, state);
			}
			const discarded = (await listRuns(store)).filter((r) => r.status === 'discarded');
			const skip = new Set(discarded.map((r) => r.id));
			const chat = await readChat(store, key);
			history =
				phase === 'P7' && owner ? ticketHistory(owner.ticket, chat, skip) : toHistory(chat, skip);
		} catch (e) {
			await this.abort(store, name, claim, run, messageOf(e), 0, false);
			throw e;
		}
		publish(name, {
			type: 'run_started',
			runId: run.id,
			phase,
			...(owner && { ticketId: owner.ticket.id })
		});
		publish(name, { type: 'changed' });
		return { run, history };
	}

	/**
	 * Starts the phase agent in the background. `hashes` are set by Update runs only: the design a
	 * P4 Update patches the code to, the requirements and use cases a P5 Update patches the tests
	 * to, which the run adopts when it settles. `agent` replaces the phase agent and its chat
	 * history with one message (Apply fix, Explain failures); `text` still goes to the chat. With
	 * `recordTestChanges` a test file changed without a `report_test_fix` gets one recorded.
	 * `ticket` names the ticket the run belongs to (see openRun).
	 */
	private async startRun(
		store: ProjectStore,
		name: string,
		claim: Claim,
		phase: RunPhase,
		text: string,
		auto: boolean,
		hashes: RunExtra = {},
		agent?: { def: AgentDef; brief: string; recordTestChanges?: boolean },
		ticket?: RunTicket
	): Promise<string> {
		const def = agent?.def ?? this.agents[AGENT_OF[phase]];
		const args = [def.name, text, auto, hashes, ticket] as const;
		const opened = await this.openRun(store, name, claim, phase, ...args);
		const { run } = opened;
		const history: Anthropic.MessageParam[] = agent
			? [{ role: 'user', content: agent.brief }]
			: opened.history;
		const ctx: ToolContext = {
			store,
			runId: run.id,
			projectName: name,
			agent: def.name,
			// Every deploy run gets its own check budget.
			...(def.name === 'deploy' ? { deployChecks: { left: DEPLOY_CHECKS_PER_RUN } } : {})
		};
		const limit = AGENT_TURNS[def.name];
		const cost = AGENT_COST_LIMIT[def.name];
		const opts = {
			...(limit === undefined ? {} : { maxTurns: limit }),
			...(cost === undefined ? {} : { costLimitUsd: cost })
		};
		const review =
			phase === 'P2' && this.autoReview && !hashes.fromProposal
				? this.reviewAfter(store, name, claim, run)
				: undefined;
		const work: Work = async (onEvent) => {
			if (!agent?.recordTestChanges) return this.run({ def, ctx, history, onEvent, ...opts });
			const before = await snapshotTests(ctx);
			try {
				return await this.run({ def, ctx, history, onEvent, ...opts });
			} finally {
				await recordUnreportedFixes(ctx, before);
			}
		};
		void this.execute(store, name, claim, run, ctx, work, review);
		return run.id;
	}

	/** Starts the review agent on the current design, briefed with the computed uncovered criteria. */
	private async startReview(store: ProjectStore, name: string, claim: Claim): Promise<string> {
		const [reqs, design, coverage] = await Promise.all([
			readReqs(store).catch(() => null),
			readDesign(store).catch(() => null),
			readDesignReview(store)
		]);
		const current = reqs && coverage && coverage.designHash === designHash(design);
		const uncovered = current ? uncoveredCriteria(coverage.rows, reqs) : null;
		const agent = { def: this.agents.review, brief: reviewBrief(uncovered) };
		return this.startRun(store, name, claim, 'P3', REVIEW_MESSAGE, true, {}, agent);
	}

	/** After a P2 run that ended done and changed the design, a review follows on the same claim. */
	private reviewAfter(store: ProjectStore, name: string, claim: Claim, run: RunMeta): FollowUp {
		return async (status) => {
			if (status !== 'done') return null;
			const hash = await artefactHash(store, 'P2').catch(() => null);
			if (!hash || hash === run.prevArtefactHash) return null;
			return async () => {
				await this.startReview(store, name, claim);
			};
		};
	}

	/**
	 * Starts the generation run of P2's or P4's approval. Its failure must not undo that approval:
	 * it is logged, and reported as a failed run (abort already did so once the run file existed).
	 */
	private async autoStart(
		name: string,
		claim: Claim,
		what: string,
		start: () => Promise<string>
	): Promise<void> {
		try {
			await start();
		} catch (e) {
			console.error(`could not start ${what} for ${name}`, e);
			if (claim.run === null) {
				publish(name, {
					type: 'run_finished',
					runId: '',
					status: 'failed',
					error: messageOf(e),
					costUsd: 0
				});
			}
		}
	}

	/** Starts the generation pipeline in the background; file progress goes to the claim and the bus. */
	private async startGeneration(
		store: ProjectStore,
		name: string,
		claim: Claim,
		design: DesignDoc,
		reqs: RequirementsDoc | null
	): Promise<string> {
		if (!reqs) throw new ConflictError('Generating code needs the requirements');
		const def = this.agents.code;
		const { run } = await this.openRun(store, name, claim, 'P4', def.name, GENERATE_MESSAGE, true, {
			designHashes: designHashesOf(design)
		});
		const ctx: ToolContext = { store, runId: run.id, projectName: name, agent: def.name };
		void this.execute(store, name, claim, run, ctx, (onEvent, logOnly) =>
			this.generate({
				ctx,
				design,
				reqs,
				run: this.run,
				checks: this.checks,
				onEvent: this.pipelineEvents(name, claim, run.id, onEvent, logOnly)
			})
		);
		return run.id;
	}

	/** Starts the test generation pipeline in the background, like startGeneration (P5 spec section 5). */
	private async startTestGeneration(
		store: ProjectStore,
		name: string,
		claim: Claim,
		design: DesignDoc,
		reqs: RequirementsDoc
	): Promise<string> {
		const def = this.agents.test;
		const hashes = testHashesOf(reqs, design);
		const message = GENERATE_TESTS_MESSAGE;
		const opened = await this.openRun(store, name, claim, 'P5', def.name, message, true, hashes);
		const { run } = opened;
		const ctx: ToolContext = { store, runId: run.id, projectName: name, agent: def.name };
		// A finished generation that left an open code bug finding hands over to the fix loop.
		const next: FollowUp = async (status) => {
			if (status !== 'done') return null;
			const checks = await readTestChecks(store);
			if (!checks?.result || !checks.findings.some((f) => findingOpen(f, checks.result)))
				return null;
			return async () => {
				await this.startFixLoop(store, name, claim);
			};
		};
		const work: Work = (onEvent, logOnly) =>
			this.testgen({
				ctx,
				design,
				reqs,
				run: this.run,
				checks: this.testChecks,
				onEvent: this.pipelineEvents(name, claim, run.id, onEvent, logOnly)
			});
		void this.execute(store, name, claim, run, ctx, work, next);
		return run.id;
	}

	/**
	 * Starts the fix loop in the background: a P5 run of the test agent with `fixLoop` set and no
	 * hashes to adopt. Every handoff between the agents is published, logged in the run's events
	 * and appended to the P5 chat with `from` and `to`. The caller makes sure the stored checks are
	 * current.
	 */
	private async startFixLoop(store: ProjectStore, name: string, claim: Claim): Promise<string> {
		const { test, code } = this.agents;
		const extra = { fixLoop: true } as const;
		const args = [test.name, FIX_LOOP_MESSAGE, true, extra] as const;
		const { run } = await this.openRun(store, name, claim, 'P5', ...args);
		const ctx: ToolContext = { store, runId: run.id, projectName: name, agent: test.name };
		void this.execute(store, name, claim, run, ctx, async (onEvent, logOnly) => {
			let chat = Promise.resolve();
			// The handoff's position in the run, so the chat can match a live one to its stored entry.
			let seq = 0;
			const onMessage = (message: AgentMessage) => {
				const m = { ...message, seq: ++seq };
				publish(name, { type: 'agent_message', runId: run.id, ...m });
				logOnly({ type: 'agent_message', ...m });
				// The P5 chat is the test agent's history: a handoff reads as its side of the loop.
				const entry = { role: 'assistant' as const, text: m.text, at: now(), runId: run.id };
				const { from, to } = m;
				chat = chat
					.then(() =>
						appendChat(store, chatKeyOf(run), { ...entry, auto: true, from, to, seq: m.seq })
					)
					.catch((e) => console.error(`could not record a handoff of run ${run.id}`, e));
			};
			try {
				return await this.loop({
					ctx,
					agents: { test, code },
					run: this.run,
					codeChecks: this.checks,
					testChecks: this.testChecks,
					onEvent,
					onMessage
				});
			} finally {
				// The handoffs come before the run's own reply in the chat.
				await chat;
			}
		});
		return run.id;
	}

	/** Starts the deploy agent on the plan's brief, recording the deploy hashes it is made from. */
	private async startDeployment(
		store: ProjectStore,
		name: string,
		claim: Claim,
		design: DesignDoc
	): Promise<string> {
		const pkg = await readPackageJson(store);
		if (pkg === null)
			throw new ConflictError('Generating the deployment needs the package.json of the code');
		const plan = deployPlan(design, pkg);
		const brief = deployBrief(plan, name, await extraEnvVars(store, plan));
		const hashes = { deployHashes: deployHashesOf(design, pkg) };
		const agent = { def: this.agents.deploy, brief };
		const text = GENERATE_DEPLOY_MESSAGE;
		return this.startRun(store, name, claim, 'P6', text, true, hashes, agent);
	}

	/** Renders README.md under the run; it is documentation, so a failure is logged, never fatal. */
	private async readme(
		store: ProjectStore,
		runId: string,
		name: string,
		logOnly?: (entry: object) => void
	): Promise<void> {
		await writeReadme(store, runId, name).catch((e) => {
			console.error(`could not write README.md for run ${runId}`, e);
			logOnly?.({ type: 'readme_error', message: messageOf(e) });
		});
	}

	/**
	 * Routes pipeline events: file progress to the claim and the bus, the wiring or triage agent to
	 * the run stream, worker calls to the run log only.
	 */
	private pipelineEvents(
		name: string,
		claim: Claim,
		runId: string,
		onEvent: (e: AgentEvent) => void,
		logOnly: (entry: object) => void
	): (e: GenerateEvent) => void {
		const files: Record<string, FileStatus> = {};
		claim.codegen = files;
		return (e) => {
			if (e.type === 'file') {
				files[e.path] = e.status;
				const { path: p, status, attempt } = e;
				publish(name, { type: 'codegen_file', runId, path: p, status, attempt });
			} else if (e.type === 'wiring') onEvent(e.event);
			else logOnly(e);
		};
	}

	/**
	 * The background part of a run. Never rejects: any error ends in abort(). A P4 or P5 run ends
	 * with its checks so the gate is current; a generation run that ran them reports `checked`.
	 * `next` may start another run on the same claim once this one settled: this run is reported
	 * finished first, and the claim is released only when nothing started.
	 */
	private async execute(
		store: ProjectStore,
		name: string,
		claim: Claim,
		run: RunMeta,
		ctx: ToolContext,
		work: Work,
		next?: FollowUp
	): Promise<void> {
		const events: AgentEvent[] = [];
		let log = Promise.resolve();
		let costUsd = 0;
		let recorded = false;
		const append = (entry: object) => {
			log = log
				.then(() => appendRunEvent(store, run.id, entry))
				.catch((err) => console.error(`could not log an event of run ${run.id}`, err));
		};
		const logOnly = (e: object) => append({ at: now(), ...e });
		const onEvent = (e: AgentEvent) => {
			events.push(e);
			append({ at: now(), ...e });
			const { id: runId } = run;
			publish(
				name,
				e.type === 'text'
					? { type: 'agent_text', runId, text: e.text }
					: {
							type: 'tool_call',
							runId,
							name: e.name,
							input: e.input,
							result: e.result,
							isError: e.isError
						}
			);
		};
		try {
			const result = await work(onEvent, logOnly);
			await log;
			costUsd = result.costUsd;
			let usage = result.usage;
			let { status, error: failure } = result;
			// A failed run can leave new code too, so any run that wrote a file renders the README and
			// syncs the start scripts; a synced package.json changes the code hash, so it is checked again.
			let synced = false;
			if (this.isCodeRun(run) && (status === 'done' || (await touchedFiles(store, run.id)))) {
				synced = await syncStartScripts(store, run.id).catch((e) => {
					console.error(`could not sync the start scripts for run ${run.id}`, e);
					logOnly({ type: 'scripts_error', message: messageOf(e) });
					return false;
				});
				// The README is documentation: a failure to render it is logged and never fails the run.
				await this.readme(store, run.id, name, logOnly);
				await log;
			}
			// A P6 run may add RUN.md, which the README links. No final checks: deploy_check stored them.
			if (run.phase === 'P6') {
				await this.readme(store, run.id, name, logOnly);
				await log;
			}
			if (!result.checked || synced) {
				const problem = await this.finalChecks(run, ctx);
				if (problem !== undefined) {
					status = 'failed';
					failure ??= problem;
				}
			}
			// A close run is done only once write_ticket_report closed the ticket.
			if (run.report && status === 'done' && run.ticketId) {
				if ((await findTicket(store, run.ticketId))?.status !== 'done') {
					status = 'failed';
					failure ??= 'The agent did not write the change report';
				}
			}
			let summary: string | undefined;
			try {
				const s = await this.summarise(run.phase, result.text, events);
				summary = s.text;
				usage = addUsage(usage, s.usage);
				costUsd += s.costUsd;
			} catch {
				// No summary (for example an empty reply after a refusal); the run keeps its status.
			}
			const error = failure === undefined ? {} : { error: failure };
			const post = await postHash(store, run.phase);
			await updateRun(store, run.id, {
				status,
				finishedAt: now(),
				usage,
				costUsd,
				...error,
				...(summary === undefined ? {} : { summary }),
				...(post === undefined ? {} : { postArtefactHash: post })
			});
			recorded = true;
			if (result.text.trim() !== '') {
				await appendChat(store, chatKeyOf(run), {
					role: 'assistant',
					text: result.text,
					at: now(),
					runId: run.id
				});
			}
			await this.settle(store, { ...run, status });
			const follow = next
				? await next(status).catch((e) => {
						console.error(`could not decide on a run after run ${run.id}`, e);
						return null;
					})
				: null;
			const finished = () => {
				publish(name, { type: 'run_finished', runId: run.id, status, ...error, costUsd });
				publish(name, { type: 'changed' });
			};
			if (!follow) {
				this.release(name, claim);
				finished();
				return;
			}
			// The claim stays held, so an action now gets run_active; the next run takes it over.
			finished();
			delete claim.codegen;
			let startError: string | undefined;
			await follow().catch((e) => {
				console.error(`could not start the run after run ${run.id} of ${name}`, e);
				startError = messageOf(e);
			});
			if (claim.run?.runId === run.id) {
				// No run started, so none reports the failure: it is reported without a run, as
				// autoStart does, and the project is free again.
				this.release(name, claim);
				if (startError !== undefined) {
					const failed = { runId: '', status: 'failed', error: startError, costUsd: 0 } as const;
					publish(name, { type: 'run_finished', ...failed });
				}
				publish(name, { type: 'changed' });
			}
		} catch (e) {
			await log;
			await this.abort(store, name, claim, run, messageOf(e), costUsd, recorded);
		}
	}

	/** A run that may change `src/`: any P4 run, an Apply fix run (P5, code agent) and a fix loop. */
	private isCodeRun(run: RunMeta): boolean {
		return (
			run.phase === 'P4' ||
			(run.phase === 'P5' && (run.agent === this.agents.code.name || run.fixLoop === true))
		);
	}

	/**
	 * The checks that end a run: P4 runs the code checks, P5 the test checks, and an Apply fix or a
	 * fix loop run both. Returns why the run fails (a timeout, Docker down: the gate then keeps
	 * showing out of date), else undefined.
	 */
	private async finalChecks(run: RunMeta, ctx: ToolContext): Promise<string | undefined> {
		// A P6 run's check is deploy_check's stored result; nothing runs again.
		let problem: string | undefined;
		try {
			if (this.isCodeRun(run) && (await this.checks(ctx)).typecheck?.timedOut)
				problem = 'Typecheck timed out';
			if (run.phase === 'P5') {
				const t = await this.testChecks(ctx);
				if (t.typecheck?.timedOut) problem ??= 'Typecheck timed out';
				else if (t.result?.timedOut) problem ??= 'Test run timed out';
			}
		} catch (e) {
			problem ??= `The checks could not run: ${messageOf(e)}`;
		}
		return problem;
	}

	/**
	 * Recomputes the phase of a finished run and the staleness of P2, P4, P5 and P6 from the
	 * artefacts on disk. A P7 run changed no artefact and leaves the phase state alone.
	 */
	private async settle(store: ProjectStore, run: RunOrigin): Promise<void> {
		// write_ticket_report sets done during the run; only a close run that finished keeps it.
		if (run.report && run.status !== 'done' && run.ticketId && run.prevTicket)
			await this.putBack(store, run.ticketId, run.prevTicket);
		// An accept run: done moves the review along; otherwise, with the design unchanged, the
		// proposal is open again.
		if (run.fromProposal && run.status === 'done' && run.id) await followDesign(store, run.id);
		else if (
			run.fromProposal &&
			(await artefactHash(store, 'P2').catch(() => undefined)) === run.prevArtefactHash
		)
			await reopenProposal(store, run.fromProposal);
		if (!isChatPhase(run.phase)) return;
		const state = await readState(store);
		await afterRun(store, state, run);
		// Unparseable requirements leave staleness as it is rather than keep the phase running.
		const reqs = await readReqs(store).catch(() => undefined);
		if (reqs !== undefined) markStale(state, reqs);
		await refreshStale(store, state);
		await writeState(store, state);
	}

	/**
	 * Last resort for a run that cannot finish normally: mark it failed, unless its result was
	 * already recorded, move its phase out of `running` and tell the UI.
	 */
	private async abort(
		store: ProjectStore,
		name: string,
		claim: Claim,
		run: RunMeta,
		error: string,
		costUsd: number,
		recorded: boolean
	): Promise<void> {
		try {
			if (!recorded) {
				const post = await postHash(store, run.phase);
				await updateRun(store, run.id, {
					status: 'failed',
					error,
					finishedAt: now(),
					...(post === undefined ? {} : { postArtefactHash: post })
				});
			}
			await this.settle(store, { ...run, status: 'failed' });
		} catch (e) {
			console.error(`could not record the failure of run ${run.id}`, e);
		}
		this.release(name, claim);
		publish(name, { type: 'run_finished', runId: run.id, status: 'failed', error, costUsd });
		publish(name, { type: 'changed' });
	}

	/** Marks runs left `running` by an earlier process failed and moves their phases out of `running`. */
	private async recover(): Promise<void> {
		let names: string[];
		try {
			names = await this.projectNames();
		} catch (e) {
			console.error('could not list projects for recovery', e);
			return;
		}
		for (const name of names) {
			try {
				const store = this.storeFor(name);
				for (const run of await listRuns(store)) {
					if (run.status !== 'running') continue;
					const failed = await updateRun(store, run.id, {
						status: 'failed',
						error: 'server restarted',
						finishedAt: now()
					});
					await this.settle(store, failed);
				}
				// A phase left running without a run file reopens.
				const state = await readState(store);
				if (CHAT_PHASES.some((p) => state.phases[p].status === 'running')) {
					for (const phase of CHAT_PHASES) await this.settle(store, { phase });
				}
			} catch (e) {
				console.error(`could not recover project ${name}`, e);
			}
		}
	}
}
