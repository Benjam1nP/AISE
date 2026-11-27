import type { Trace } from './server/core/trace';

/**
 * The traces of a project from `/p/<name>/trace`, for the links between the tabs. `load` fetches
 * again only when its key changes (the files, the stored checks, the requirements or the design),
 * and keeps the last traces while it does. A failed fetch keeps them too: links are a help, not data.
 */
export class TraceStore {
	traces = $state.raw<Record<string, Trace>>({});
	#key: string | undefined;

	async load(project: string, key: string): Promise<void> {
		if (key === this.#key) return;
		this.#key = key;
		try {
			const res = await fetch(`/p/${project}/trace`);
			if (!res.ok || key !== this.#key) return;
			const body = (await res.json()) as { traces: Record<string, Trace> };
			if (key === this.#key) this.traces = body.traces;
		} catch {
			// Keep what we have; the next change of the key tries again.
		}
	}
}
