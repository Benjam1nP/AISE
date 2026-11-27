import { z } from 'zod';
import type { ProjectStore } from './store';

export const PHASES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] as const;
export const PhaseId = z.enum(PHASES);
export type PhaseId = z.infer<typeof PhaseId>;

export const PhaseStatus = z.enum([
	'not_started',
	'running',
	'awaiting_approval',
	'approved',
	'stale'
]);
export type PhaseStatus = z.infer<typeof PhaseStatus>;

export const PhaseState = z.object({
	status: PhaseStatus,
	approvedAt: z.string().optional(),
	override: z.object({ at: z.string(), failed: z.array(z.string()) }).optional(),
	reqHashes: z.record(z.string(), z.string()).optional(),
	/** P4: per design element ID, the hash of the fields code depends on (spec section 8). */
	designHashes: z.record(z.string(), z.string()).optional(),
	/** P5: per use case and sequence ID, the hash of the fields tests depend on (spec section 8). */
	useCaseHashes: z.record(z.string(), z.string()).optional(),
	/** P6: per service node ID and `dependencies`, the hash of what the deployment depends on. */
	deployHashes: z.record(z.string(), z.string()).optional()
});
export type PhaseState = z.infer<typeof PhaseState>;

export const State = z.object({ phases: z.record(PhaseId, PhaseState) });
export type State = z.infer<typeof State>;

const STATE_FILE = '.aise/state.json';

export function initialState(): State {
	const phases = Object.fromEntries(PHASES.map((p) => [p, { status: 'not_started' as const }]));
	return { phases: phases as State['phases'] };
}

/** The saved state, or the initial state for a project that has none yet. */
export async function readState(store: ProjectStore): Promise<State> {
	return (await store.readJson(STATE_FILE, State)) ?? initialState();
}

export async function writeState(store: ProjectStore, s: State): Promise<void> {
	await store.writeJson(STATE_FILE, State, s);
}
