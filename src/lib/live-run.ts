import type { FileStatus } from '#lib/server/codegen/generate.ts';
import type { AgentRole } from '#lib/server/core/chat.ts';
import type { PhaseId } from '#lib/server/core/state.ts';
import type { WorkspaceEvent } from '#lib/server/orchestrator/bus.ts';

export type LiveItem =
	| { kind: 'text'; text: string }
	| { kind: 'message'; from: AgentRole; to: AgentRole; text: string; seq: number }
	| { kind: 'tool'; name: string; input: unknown; result: string; isError: boolean };

/** What the browser heard of the active run since it connected; earlier output is not replayed. */
export type LiveRun = { runId: string; phase: PhaseId | null; items: LiveItem[] };

/** The file states of a generation run as the browser heard them since it connected. */
export type CodegenLive = { runId: string; files: Record<string, FileStatus> };

/** Folds a `codegen_file` event into the live progress; a new run starts a new one. */
export function applyCodegen(live: CodegenLive | null, e: WorkspaceEvent): CodegenLive | null {
	if (e.type === 'run_started') return null;
	if (e.type !== 'codegen_file') return live;
	const files = live?.runId === e.runId ? live.files : {};
	return { runId: e.runId, files: { ...files, [e.path]: e.status } };
}

/** The row of the wiring step in the progress map; the same value as `WIRING_PATH` on the server. */
export const WIRING_ROW = 'src/app/';

/**
 * The progress to show: the snapshot's map (what the server knew at load) updated by the events of
 * the same run. Without a snapshot map (it is set a moment after the run starts) the events alone
 * count; null when neither knows of a generation run.
 */
export function codegenProgress(
	snapshot: Record<string, FileStatus> | null,
	live: CodegenLive | null,
	activeRunId: string | undefined
): Record<string, FileStatus> | null {
	const events = live && live.runId === activeRunId ? live.files : null;
	if (!snapshot) return events;
	return events ? { ...snapshot, ...events } : snapshot;
}

const AGENT_LABEL: Record<AgentRole, string> = {
	test: 'Test agent',
	code: 'Code agent',
	checks: 'Checks'
};

/** How the chat names a party of a fix loop handoff. */
export function agentLabel(role: AgentRole): string {
	return AGENT_LABEL[role];
}

export type OrbMood = 'working' | 'searching' | 'composing';

/** Folds one workspace event into the live run. Events of a newer run replace the older one. */
export function applyEvent(live: LiveRun | null, e: WorkspaceEvent): LiveRun | null {
	if (e.type === 'run_started') return { runId: e.runId, phase: e.phase, items: [] };
	if (e.type !== 'agent_text' && e.type !== 'agent_message' && e.type !== 'tool_call') return live;
	const base = live?.runId === e.runId ? live : { runId: e.runId, phase: null, items: [] };
	const item: LiveItem =
		e.type === 'agent_text'
			? { kind: 'text', text: e.text }
			: e.type === 'agent_message'
				? { kind: 'message', from: e.from, to: e.to, text: e.text, seq: e.seq }
				: { kind: 'tool', name: e.name, input: e.input, result: e.result, isError: e.isError };
	return { ...base, items: [...base.items, item] };
}

/** Waiting for the model: working. After a tool call until the next text: searching. Text or an agent message: composing. */
export function orbMood(items: LiveItem[]): OrbMood {
	const last = items.at(-1);
	if (!last) return 'working';
	return last.kind === 'tool' ? 'searching' : 'composing';
}

/** The run error in plain words for the chat banner. */
export function failureReason(error: string | undefined): string {
	if (!error) return 'The agent stopped before it finished.';
	if (error === 'server restarted') return 'The server restarted while the agent was working.';
	return `The agent stopped before it finished: ${error}`;
}

export function formatUsd(n: number): string {
	return `$${n.toFixed(3)}`;
}
