import { parse } from 'yaml';
import { storesData } from '../agents/code-worker';
import { browserLinks, nodeKebab, peerUrl, publicUrl, serviceNodes } from './nodes';
import { sha256, stableStringify } from './hash';
import type { DesignDoc } from './schemas/design';

/** One compose service the design asks for. */
export type PlannedService = {
	/** Compose service: nodeKebab(node), 'app' without service nodes. */
	name: string;
	nodeId: string | null;
	primary: boolean;
	/** 'start' | `start:${kebab}` */
	script: string;
	/** 'npm start' | `npm run start:${kebab}` */
	command: string;
	/** 'PORT' | `${NODE}_PORT` */
	portVar: string;
	/** Container port, equal to the published host port. */
	port: number;
	/** portVar, DB_PATH, peer and public urls. */
	env: Record<string, string>;
	/** `<PEER>_URL` variables the gate requires, sorted. */
	peerVars: string[];
	volume: { name: 'data'; target: '/data' } | null;
	healthUrl: string;
};

export type DeployPlan = {
	services: PlannedService[];
	volumes: string[];
	/** Planned start scripts that package.json does not have. */
	missingScripts: string[];
};

const DATA_VOLUME = { name: 'data', target: '/data' } as const;
const DB_PATH = '/data/app.db';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `scripts` of a package.json, whatever else it holds. */
function scriptsOf(packageJson: unknown): Record<string, string> {
	const scripts = isObj(packageJson) ? packageJson.scripts : null;
	if (!isObj(scripts)) return {};
	return Object.fromEntries(
		Object.entries(scripts).filter((e): e is [string, string] => typeof e[1] === 'string')
	);
}

/**
 * The compose services a design needs: one per service node, in `serviceNodes` order, each with
 * its start command, ports, volume and environment. A design without service nodes gets one
 * service `app` (as `startScripts` gives it one `start` script). The deploy agent's brief and the
 * gate's consistency check both read this.
 */
export function deployPlan(design: DesignDoc, packageJson: unknown): DeployPlan {
	const roles = serviceNodes(design);
	const classById = new Map(design.classes.map((c) => [c.id, c]));
	const peerName = (id: string) => nodeKebab(roles.find((r) => r.node.id === id)!.node);
	const publicLinks = browserLinks(design);

	const services: PlannedService[] =
		roles.length === 0
			? [
					{
						name: 'app',
						nodeId: null,
						primary: true,
						script: 'start',
						command: 'npm start',
						portVar: 'PORT',
						port: 8080,
						env: { PORT: '8080' },
						peerVars: [],
						volume: null,
						healthUrl: 'http://localhost:8080/health'
					}
				]
			: roles.map((r) => {
					const kebab = nodeKebab(r.node);
					const env: Record<string, string> = { [r.portVar]: String(r.port) };
					const stores = r.classIds.some((id) => {
						const cls = classById.get(id);
						return cls ? storesData(cls, design) : false;
					});
					if (stores) env.DB_PATH = DB_PATH;
					const peerVars = new Set<string>();
					for (const link of r.outgoing) {
						const peer = link.to === r.node.id ? null : peerUrl(design, link);
						if (!peer) continue;
						env[peer.variable] = peer.fallback.replace('localhost', peerName(link.to));
						peerVars.add(peer.variable);
					}
					if (r.primary) {
						for (const link of publicLinks) {
							const pub = publicUrl(design, link);
							if (pub) env[pub.variable] = pub.fallback;
						}
					}
					return {
						name: kebab,
						nodeId: r.node.id,
						primary: r.primary,
						script: r.primary ? 'start' : `start:${kebab}`,
						command: r.primary ? 'npm start' : `npm run start:${kebab}`,
						portVar: r.portVar,
						port: r.port,
						env,
						peerVars: [...peerVars].sort(),
						volume: stores ? { ...DATA_VOLUME } : null,
						healthUrl: `http://localhost:${r.port}/health`
					};
				});

	// without service nodes the one app service stores data when any class does
	if (roles.length === 0 && design.classes.some((c) => storesData(c, design))) {
		services[0].env.DB_PATH = DB_PATH;
		services[0].volume = { ...DATA_VOLUME };
	}

	const scripts = scriptsOf(packageJson);
	return {
		services,
		volumes: services.some((s) => s.volume) ? ['data'] : [],
		missingScripts: services.map((s) => s.script).filter((s) => !(s in scripts))
	};
}

/** A command as Compose runs it: a list joined by spaces, runs of whitespace collapsed, trimmed. */
const asText = (v: unknown): string =>
	(Array.isArray(v) ? v.map(String).join(' ') : typeof v === 'string' ? v : '')
		.replace(/\s+/g, ' ')
		.trim();

/** Variable names of a compose `environment`, a map or a list of `KEY=value`. */
function envNames(env: unknown): Set<string> {
	if (Array.isArray(env)) return new Set(env.map((e) => String(e).split('=')[0]));
	return new Set(isObj(env) ? Object.keys(env) : []);
}

/**
 * What the compose text does not match in the plan, one sorted line per problem: a missing or
 * extra service, a wrong or absent command, a missing peer URL variable. Only the gated facts are
 * read; ports, volumes and the rest stay the agent's.
 */
export function composeProblems(plan: DeployPlan, composeText: string): string[] {
	let doc: unknown;
	try {
		doc = parse(composeText, { merge: true });
	} catch (e) {
		return [`compose.yaml is not valid YAML: ${e instanceof Error ? e.message : String(e)}`];
	}
	const services = isObj(doc) && isObj(doc.services) ? doc.services : {};
	const problems: string[] = [];
	for (const planned of plan.services) {
		const found = services[planned.name];
		if (found === undefined) {
			problems.push(`service "${planned.name}" is missing`);
			continue;
		}
		const service = isObj(found) ? found : {};
		const command = asText(service.command);
		if (command !== planned.command)
			problems.push(`service "${planned.name}" runs "${command}", expected "${planned.command}"`);
		const names = envNames(service.environment);
		for (const variable of planned.peerVars)
			if (!names.has(variable)) problems.push(`service "${planned.name}" lacks ${variable}`);
	}
	const planned = new Set(plan.services.map((s) => s.name));
	for (const name of Object.keys(services))
		if (!planned.has(name)) problems.push(`service "${name}" is not a service node of the design`);
	return problems.sort();
}

/**
 * What P6 was made from, for staleness: per service node ID a hash of its name, environment
 * (port, storing, peer and public urls), links (ends and protocol) and start script, plus `dependencies` over package.json's
 * dependency lists. Descriptions, methods and link labels are not in it. `{}` without a design.
 */
export function deployHashes(
	design: DesignDoc | null,
	packageJson: unknown
): Record<string, string> {
	if (!design) return {};
	const scripts = scriptsOf(packageJson);
	const pkg = isObj(packageJson) ? packageJson : {};
	const plan = deployPlan(design, packageJson);
	const hashes: Record<string, string> = {};
	for (const s of plan.services) {
		const links = design.links
			.filter((l) => l.from !== l.to && (l.from === s.nodeId || l.to === s.nodeId))
			.map((l) => `${l.from}>${l.to}:${l.protocol}`)
			.sort();
		hashes[s.nodeId ?? s.name] = sha256(
			stableStringify({
				name: s.name,
				env: s.env,
				links,
				script: scripts[s.script] ?? null
			})
		);
	}
	hashes.dependencies = sha256(
		stableStringify({
			dependencies: pkg.dependencies ?? null,
			devDependencies: pkg.devDependencies ?? null
		})
	);
	return hashes;
}
