import type { FileStatus } from '../codegen/generate';
import type { AgentRole } from '../core/chat';
import type { PhaseId } from '../core/state';

/** Everything the workspace UI hears about a project, streamed over SSE. */
export type WorkspaceEvent =
	| { type: 'run_started'; runId: string; phase: PhaseId; ticketId?: string }
	| { type: 'agent_text'; runId: string; text: string }
	| {
			type: 'tool_call';
			runId: string;
			name: string;
			input: unknown;
			result: string;
			isError: boolean;
	  }
	| {
			type: 'run_finished';
			runId: string;
			status: 'done' | 'failed';
			error?: string;
			costUsd: number;
	  }
	| {
			type: 'agent_message';
			runId: string;
			from: AgentRole;
			to: AgentRole;
			text: string;
			findingIds: string[];
			/** The handoff's position in its run, from 1; the chat entry carries the same. */
			seq: number;
	  }
	| { type: 'codegen_file'; runId: string; path: string; status: FileStatus; attempt: number }
	| { type: 'changed' };

type Listeners = Map<string, Set<(e: WorkspaceEvent) => void>>;

// On globalThis like the orchestrator (see ../index.ts), so a module re-evaluated by Vite dev still
// reaches the subscribers of the surviving orchestrator.
const g = globalThis as typeof globalThis & { __aiseListeners?: Listeners };
const listeners: Listeners = (g.__aiseListeners ??= new Map());

export function subscribe(project: string, fn: (e: WorkspaceEvent) => void): () => void {
	let set = listeners.get(project);
	if (!set) listeners.set(project, (set = new Set()));
	set.add(fn);
	return () => {
		set.delete(fn);
		if (set.size === 0 && listeners.get(project) === set) listeners.delete(project);
	};
}

/** A throwing listener (for example a closed SSE stream) must not stop the others or the run. */
export function publish(project: string, e: WorkspaceEvent): void {
	for (const fn of [...(listeners.get(project) ?? [])]) {
		try {
			fn(e);
		} catch (err) {
			console.error(`event listener for ${project} failed`, err);
		}
	}
}
