import type { Component, DesignDoc } from './schemas/design';

/** The browser page: the code of every component on a client node, which holds no classes. */
export const PAGE = 'public/index.html';

/** IDs of the client nodes (the browser). */
export const clientNodeIds = (design: DesignDoc): Set<string> =>
	new Set(design.nodes.filter((n) => n.kind === 'client').map((n) => n.id));

/** Components on client nodes (the browser), in design order. */
export function clientComponents(design: DesignDoc): Component[] {
	const clients = clientNodeIds(design);
	return design.components.filter((c) => clients.has(c.nodeId));
}
