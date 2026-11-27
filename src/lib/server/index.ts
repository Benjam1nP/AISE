import path from 'node:path';
import { Orchestrator } from './orchestrator/orchestrator';

export {
	ConflictError,
	NotFoundError,
	Orchestrator,
	type ProjectSnapshot
} from './orchestrator/orchestrator';
export { subscribe, type WorkspaceEvent } from './orchestrator/bus';
export type { GateResult } from './orchestrator/gates';

// On globalThis, not in module scope: Vite dev re-evaluates server modules on edit, and a second
// instance would mark the first one's live run failed and accept a second run on the project.
const g = globalThis as typeof globalThis & { __aiseOrchestrator?: Orchestrator };

/** One orchestrator per server process; projects live in AISE_PROJECTS_DIR, relative to the cwd. */
export function getOrchestrator(): Orchestrator {
	g.__aiseOrchestrator ??= new Orchestrator({
		root: path.resolve(process.env.AISE_PROJECTS_DIR ?? 'showcases')
	});
	return g.__aiseOrchestrator;
}
