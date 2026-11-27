import {
	deployCheckHash,
	hasDeployFiles,
	listDeployFiles,
	readDeployCheck
} from '../core/deploy-state';
import { composeProblems, deployHashes, deployPlan } from '../core/deploy-plan';
import type { DesignDoc } from '../core/schemas/design';
import type { State } from '../core/state';
import type { ProjectStore } from '../core/store';
import { checkDeployGate, type GateResult } from './gates';
import { p5NotReady } from './p5';
import { changedIds } from './staleness';

/** The user message of a deploy run in the P6 chat. */
export const GENERATE_DEPLOY_MESSAGE = 'Generate the deployment from the approved design and code.';

/**
 * Why a P6 action cannot run: P1, P2 and P4 approved and not stale (as for P5), then P5 approved
 * and not stale, checked upstream first so the message names the phase to fix. Null when it can.
 */
export function p6NotReady(state: State, action: string): string | null {
	const upstream = p5NotReady(state, action);
	if (upstream) return upstream;
	const { status } = state.phases.P5;
	if (status === 'stale')
		return `P5 is stale; update it or confirm it is still valid before ${action}`;
	if (status !== 'approved') return `Approve P5 before ${action}`;
	return null;
}

/** The project's package.json as an object; null when missing, unreadable, unparseable or not an object. */
export async function readPackageJson(store: ProjectStore): Promise<unknown | null> {
	// Any read error (a folder named package.json, no permission) counts as unreadable.
	const text = await store.readText('package.json').catch(() => null);
	if (text === null) return null;
	try {
		const parsed: unknown = JSON.parse(text);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Why a deploy run cannot start, besides P5: it needs the design and the code's package.json,
 * and no deploy file yet. Null when it can.
 */
export async function deployBlocked(
	store: ProjectStore,
	design: DesignDoc | null
): Promise<string | null> {
	if (!design) return 'Generating the deployment needs the design';
	if ((await readPackageJson(store)) === null)
		return 'Generating the deployment needs the package.json of the code; generate the code first';
	if (await hasDeployFiles(store))
		return 'The deployment files exist already; change them through the chat or Update';
	return null;
}

/** The P6 gate from the files, the compose text, the stored check and the current hash; never runs Docker. */
export async function deployGate(
	store: ProjectStore,
	design: DesignDoc | null
): Promise<GateResult> {
	const [files, pkg, compose, check, checkHash] = await Promise.all([
		listDeployFiles(store),
		readPackageJson(store),
		store.readText('compose.yaml'),
		readDeployCheck(store),
		deployCheckHash(store)
	]);
	const plan = design && pkg ? deployPlan(design, pkg) : null;
	return checkDeployGate({
		files,
		problems: plan ? composeProblems(plan, compose ?? '') : null,
		check,
		checkHash,
		services: plan?.services.map((s) => ({ name: s.name, healthUrl: s.healthUrl }))
	});
}

/** The hashes P6 records: service nodes with their links and start scripts, and the dependencies. */
export const deployHashesOf = (design: DesignDoc | null, pkg: unknown) => deployHashes(design, pkg);

/**
 * Service node IDs (and `dependencies`) that changed since the deployment was last made or
 * confirmed. Read from the P6 phase state whatever its status, so the stale banner stays after a
 * chat run reopens P6. `pkg` is `readPackageJson`'s result: null (missing or broken, as while the
 * developer edits it) compares nothing, since hashing it as empty would mark every node changed.
 */
export function staleDeployIds(state: State, design: DesignDoc | null, pkg: unknown): string[] {
	if (pkg === null) return [];
	const stored = state.phases.P6.deployHashes;
	return stored ? changedIds(stored, deployHashesOf(design, pkg)) : [];
}

/** An approved P6 turns stale while its stored hashes differ from the design and package.json, and back. */
export function markP6Stale(state: State, design: DesignDoc | null, pkg: unknown): void {
	const p6 = state.phases.P6;
	if (p6.status !== 'approved' && p6.status !== 'stale') return;
	// An unreadable package.json says nothing about staleness: keep the status as it is.
	if (pkg === null) return;
	p6.status = staleDeployIds(state, design, pkg).length > 0 ? 'stale' : 'approved';
}
