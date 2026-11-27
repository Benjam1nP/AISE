import { invalidateAll } from '$app/navigation';
import type { WorkspaceEvent } from '#lib/server/orchestrator/bus.ts';
import { applyCodegen, applyEvent, type CodegenLive, type LiveRun } from './live-run.ts';

/**
 * The browser end of `/p/<name>/events`: keeps the live run of the active run and tells the page
 * to reload its data when the project changes. It also keeps the file states of a generation run. EventSource reconnects on its own; `lost` is true
 * from the first error until the connection is back, and a reconnect reloads the data once.
 */
export class WorkspaceStream {
	live = $state<LiveRun | null>(null);
	/** File states of a generation run, updated by `codegen_file` events. */
	codegen = $state<CodegenLive | null>(null);
	lost = $state(false);

	/** Opens the stream and returns the function that closes it. Call it from onMount. */
	connect(project: string): () => void {
		const source = new EventSource(`/p/${project}/events`);
		source.onmessage = (message) => {
			let event: WorkspaceEvent;
			try {
				event = JSON.parse(message.data);
			} catch {
				return;
			}
			this.live = applyEvent(this.live, event);
			this.codegen = applyCodegen(this.codegen, event);
			if (event.type === 'changed' || event.type === 'run_finished') void invalidateAll();
		};
		source.onerror = () => {
			this.lost = true;
		};
		source.onopen = () => {
			if (!this.lost) return;
			this.lost = false;
			// States heard before the drop may be stale; the reloaded snapshot knows the current ones.
			this.codegen = null;
			void invalidateAll();
		};
		return () => source.close();
	}
}
