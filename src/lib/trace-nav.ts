// Pure rules for the trace links between the tabs: where an ID is shown, and how its diagram marks it.
// No node imports: the browser imports this file.
import type { DesignDoc } from './server/core/schemas/design';

export type DiagramKind = 'useCase' | 'class' | 'sequence' | 'deployment';

/** Where an ID is shown: its requirement row, or the diagram that draws it (a sequence picks its diagram). */
export type TraceTarget =
	| { tab: 'requirements'; id: string }
	| { tab: 'diagrams'; id: string; kind: DiagramKind; seqId?: string };

/** The CSS class a diagram puts on the element it was opened for. */
export const FOCUS_CLASS = 'aiseFocus';

/**
 * The tab and diagram of an ID: REQ the requirements, UC and ACT the use case diagram, a DSN class
 * the class diagram, a DSN component or node the deployment diagram, SEQ its sequence diagram.
 * Undefined for an ID the design does not have (a DSN, UC, SEQ or ACT) or any other ID.
 */
export function traceTarget(id: string, design: DesignDoc | null): TraceTarget | undefined {
	if (/^REQ-\d{3}$/.test(id)) return { tab: 'requirements', id };
	if (!design) return undefined;
	const has = (list: { id: string }[]) => list.some((x) => x.id === id);
	if (has(design.useCases) || has(design.actors)) return { tab: 'diagrams', id, kind: 'useCase' };
	if (has(design.classes)) return { tab: 'diagrams', id, kind: 'class' };
	if (has(design.components) || has(design.nodes)) {
		return { tab: 'diagrams', id, kind: 'deployment' };
	}
	if (has(design.sequences)) return { tab: 'diagrams', id, kind: 'sequence', seqId: id };
	return undefined;
}

/**
 * The diagram source with one element marked by `FOCUS_CLASS`. Node names follow `render/mermaid.ts`:
 * the Mermaid ID for flowcharts, the class name for the class diagram. A sequence diagram, an ID
 * the diagram does not draw, or no ID gives the source unchanged.
 */
export function focusSource(
	source: string,
	kind: DiagramKind,
	id: string | undefined,
	design: DesignDoc | null
): string {
	if (!id || !design) return source;
	if (kind === 'class') {
		const c = design.classes.find((x) => x.id === id);
		return c ? `${source}\n  cssClass "${c.name}" ${FOCUS_CLASS}` : source;
	}
	const drawn =
		kind === 'useCase'
			? [...design.useCases, ...design.actors]
			: kind === 'deployment'
				? [...design.components, ...design.nodes]
				: [];
	if (!drawn.some((x) => x.id === id)) return source;
	return `${source}\n  classDef ${FOCUS_CLASS} stroke-width:3px\n  class ${id.replaceAll('-', '_')} ${FOCUS_CLASS}`;
}

/** Display names of every requirement and design ID: the title or the name. */
export function traceNames(
	reqs: { id: string; title: string }[],
	design: DesignDoc | null
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const r of reqs) out[r.id] = r.title;
	if (!design) return out;
	for (const list of [
		design.actors,
		design.useCases,
		design.classes,
		design.components,
		design.nodes,
		design.sequences
	]) {
		for (const x of list) out[x.id] = x.name;
	}
	return out;
}
