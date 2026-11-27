import { nodeKebab } from '../codegen/plan';
import { clientNodeIds } from './client';
import type { DeploymentNode, DesignDoc, NodeLink } from './schemas/design';

/** The entry of the primary service node, and of a project without service nodes. */
export const MAIN_ENTRY = 'src/app/main.ts';
const MAIN_PORT = 8080;

/** One service node as P4 runs it: its own process, entry file and port. */
export type ServiceNode = {
	node: DeploymentNode;
	primary: boolean;
	entry: string;
	portVar: string;
	port: number;
	/** Classes of the components on this node, in component order. */
	classIds: string[];
	incoming: NodeLink[];
	outgoing: NodeLink[];
};

export { nodeKebab };
const envName = (node: DeploymentNode) => nodeKebab(node).toUpperCase().replaceAll('-', '_');
const scheme = (protocol: NodeLink['protocol']) => (protocol.startsWith('ws') ? 'ws' : 'http');

/**
 * The service nodes, primary first, then the others in design order. The primary is the service
 * node a client node links to over http, else the first service node; it keeps `src/app/main.ts`
 * and `PORT` (8080), and every other one gets `src/app/<node kebab>.ts` and `<NODE>_PORT` with
 * 8081, 8082, ... in design order.
 */
export function serviceNodes(design: DesignDoc): ServiceNode[] {
	const clients = clientNodeIds(design);
	const services = design.nodes.filter((n) => n.kind === 'service');
	const viaClient = design.links.find(
		(l) =>
			clients.has(l.from) &&
			services.some((n) => n.id === l.to) &&
			(l.protocol === 'http' || l.protocol === 'https')
	)?.to;
	const primary = services.find((n) => n.id === viaClient) ?? services[0];
	const role = (node: DeploymentNode, extra: number): ServiceNode => ({
		node,
		primary: node === primary,
		entry: node === primary ? MAIN_ENTRY : `src/app/${nodeKebab(node)}.ts`,
		portVar: node === primary ? 'PORT' : `${envName(node)}_PORT`,
		port: MAIN_PORT + extra,
		classIds: design.components.filter((c) => c.nodeId === node.id).flatMap((c) => c.classIds),
		incoming: design.links.filter((l) => l.to === node.id),
		outgoing: design.links.filter((l) => l.from === node.id)
	});
	if (!primary) return [];
	return [role(primary, 0), ...services.filter((n) => n !== primary).map((n, i) => role(n, i + 1))];
}

/**
 * The start scripts of a generated project: `start` runs `src/app/main.ts`, and every extra service
 * node gets `start:<node kebab>`, in `serviceNodes` order.
 */
export function startScripts(design: DesignDoc | null): Record<string, string> {
	const extra = (design ? serviceNodes(design) : []).filter((r) => !r.primary);
	return {
		start: `tsx ${MAIN_ENTRY}`,
		...Object.fromEntries(extra.map((r) => [`start:${nodeKebab(r.node)}`, `tsx ${r.entry}`]))
	};
}

/** Entry files P4 must write: `src/app/main.ts`, then one per extra service node. */
export function appEntries(design: DesignDoc): string[] {
	const extra = serviceNodes(design).filter((r) => !r.primary);
	return [MAIN_ENTRY, ...extra.map((r) => r.entry)];
}

const roleOf = (design: DesignDoc, id: string) =>
	serviceNodes(design).find((r) => r.node.id === id);

/**
 * Where the calling node's client class finds a service node it links to: `<PEER>_URL`, by
 * default localhost at the peer's port. Null when the link does not end at a service node.
 */
export function peerUrl(
	design: DesignDoc,
	link: NodeLink
): { variable: string; fallback: string } | null {
	const peer = roleOf(design, link.to);
	if (!peer) return null;
	return {
		variable: `${envName(peer.node)}_URL`,
		fallback: `${scheme(link.protocol)}://localhost:${peer.port}`
	};
}

/** Links from a client node to a service node other than the primary, which serves the page. */
export function browserLinks(design: DesignDoc): NodeLink[] {
	const clients = clientNodeIds(design);
	return design.links.filter((l) => clients.has(l.from) && roleOf(design, l.to)?.primary === false);
}

/**
 * The browser's URL of a non primary service node, served by the primary at `GET /api/config`
 * under `key`: `<NODE>_PUBLIC_URL`, by default localhost at the node's port.
 */
export function publicUrl(
	design: DesignDoc,
	link: NodeLink
): { key: string; variable: string; fallback: string } | null {
	const role = roleOf(design, link.to);
	if (!role) return null;
	return {
		key: nodeKebab(role.node),
		variable: `${envName(role.node)}_PUBLIC_URL`,
		fallback: `${scheme(link.protocol)}://localhost:${role.port}`
	};
}
