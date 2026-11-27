import { codeHash, isFile } from '../core/code-state';
import { sha256, stableStringify } from '../core/hash';
import type { DesignDoc } from '../core/schemas/design';
import type { RequirementsDoc } from '../core/schemas/requirements';
import type { State } from '../core/state';
import type { ProjectStore } from '../core/store';
import { listTestFiles, readTestChecks, testHash } from '../core/test-state';
import { checkTestGate, type GateResult } from './gates';
import { p2NotReady } from './p4';
import { changedIds, reqHashes } from './staleness';

/** The user message of a test generation run in the P5 chat. */
export const GENERATE_TESTS_MESSAGE =
	'Generate the tests from the approved requirements and design.';

/** The user message of a fix loop run in the P5 chat. */
export const FIX_LOOP_MESSAGE =
	'Fix the failing tests: the test agent and the code agent work through them together.';

/** Why P5 cannot act yet: P4 must be approved and not stale (spec section 8); null when it can. */
export function p4NotReady(state: State, action: string): string | null {
	const { status } = state.phases.P4;
	if (status === 'stale')
		return `P4 is stale; update it or confirm it is still valid before ${action}`;
	if (status !== 'approved') return `Approve P4 before ${action}`;
	return null;
}

/**
 * Why a P5 action cannot run: P1 approved, P2 approved and not stale, and P4 approved and not
 * stale, checked upstream first so the message names the phase to fix. Null when it can.
 */
export function p5NotReady(state: State, action: string): string | null {
	if (state.phases.P1.status !== 'approved') return `Approve P1 before ${action}`;
	return p2NotReady(state, action) ?? p4NotReady(state, action);
}

/**
 * Why a test generation run cannot start, besides P4: it needs the requirements, the design and
 * the scaffold's package.json (without it nothing can run), and no tests yet. Null when it can.
 */
export async function testsBlocked(
	store: ProjectStore,
	reqs: RequirementsDoc | null,
	design: DesignDoc | null
): Promise<string | null> {
	if (!reqs || !design) return 'Generating tests needs the requirements and the design';
	if (!(await isFile(store, 'package.json')))
		return 'Generating tests needs the package.json of the code; generate the code first';
	if ((await listTestFiles(store)).length > 0)
		return 'The tests exist already; change them through the chat or Update';
	return null;
}

/** The P5 gate from the stored checks and the current hashes; never runs Docker. */
export async function testGate(
	store: ProjectStore,
	reqs: RequirementsDoc | null
): Promise<GateResult> {
	const [checks, code, test, testFiles] = await Promise.all([
		readTestChecks(store),
		codeHash(store),
		testHash(store),
		listTestFiles(store)
	]);
	return checkTestGate(reqs, { checks, codeHash: code, testHash: test, testFiles });
}

/**
 * Per use case and sequence ID, the hash of the fields tests depend on: name and REQ IDs of a use
 * case; name, use case and messages of a sequence. A description edit never changes it.
 */
export function useCaseHashes(design: DesignDoc | null): Record<string, string> {
	const out: Record<string, string> = {};
	if (!design) return out;
	const h = (v: unknown) => sha256(stableStringify(v));
	for (const u of design.useCases) out[u.id] = h({ name: u.name, reqIds: u.reqIds });
	for (const s of design.sequences)
		out[s.id] = h({ name: s.name, useCaseId: s.useCaseId, messages: s.messages });
	return out;
}

/** The hashes P5 records: the requirements and the use cases and sequences. */
export const testHashesOf = (reqs: RequirementsDoc | null, design: DesignDoc | null) => ({
	reqHashes: reqs ? reqHashes(reqs) : {},
	useCaseHashes: useCaseHashes(design)
});

/**
 * REQ, UC and SEQ IDs that changed since the tests were last made or confirmed. Read from the P5
 * phase state whatever its status, so the stale banner stays after a chat run reopens P5. An
 * unreadable design (`undefined`) compares the requirements only.
 */
export function staleTestIds(
	state: State,
	reqs: RequirementsDoc | null,
	design: DesignDoc | null | undefined
): string[] {
	const p5 = state.phases.P5;
	if (!p5.reqHashes || !p5.useCaseHashes) return [];
	const reqIds = changedIds(p5.reqHashes, reqs ? reqHashes(reqs) : {});
	if (design === undefined) return reqIds;
	return [...reqIds, ...changedIds(p5.useCaseHashes, useCaseHashes(design))].sort();
}

/** An approved P5 turns stale while its stored hashes differ from the artefacts, and back. */
export function markP5Stale(
	state: State,
	reqs: RequirementsDoc | null,
	design: DesignDoc | null | undefined
): void {
	const p5 = state.phases.P5;
	if (p5.status !== 'approved' && p5.status !== 'stale') return;
	p5.status = staleTestIds(state, reqs, design).length > 0 ? 'stale' : 'approved';
}
