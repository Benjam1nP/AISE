import { entryError, folderError, nodeKebab } from '../codegen/plan';
import { clientComponents, PAGE } from './client';
import { injectable, namesIn } from './drift';
import { nextId } from './ids';
import type { DesignDoc } from './schemas/design';
import type { RequirementsDoc } from './schemas/requirements';
import { normaliseType } from './types';

export type Issue = { path: string; message: string };

type Named = { id: string; name: string };

const list = (items: string[]) => (items.length > 0 ? items.join(', ') : 'none');
const withNames = (items: Named[]) => list(items.map((i) => `${i.id} ${i.name}`));

/**
 * Checks every reference in the design and normalises its types. The design agent gets the issues
 * back and must fix them, so a rename that breaks a diagram fails until every diagram is updated.
 * Warnings do not block saving: a class without members is legal but usually a leftover.
 */
export function validateDesign(
	design: DesignDoc,
	reqs: RequirementsDoc | null
): { issues: Issue[]; warnings: Issue[]; normalised: DesignDoc } {
	const issues: Issue[] = [];
	const add = (path: string, message: string) => issues.push({ path, message });
	const normalised = structuredClone(design);

	const warnings: Issue[] = design.classes.flatMap((c, i) => {
		const path = `classes[${i}]`;
		const label = `${c.kind} ${c.id} ${c.name}`;
		if (c.kind === 'enum') {
			return c.values.length > 0
				? []
				: [{ path, message: `${label} has no values; add values or remove it` }];
		}
		return c.attributes.length + c.methods.length > 0
			? []
			: [{ path, message: `${label} has no attributes or methods; give it members or remove it` }];
	});

	const seenIds = new Map<string, string>();
	const groups = ['actors', 'useCases', 'classes', 'components', 'nodes', 'sequences'] as const;
	for (const group of groups) {
		design[group].forEach((el, i) => {
			const path = `${group}[${i}].id`;
			const first = seenIds.get(el.id);
			if (first) add(path, `duplicate ID "${el.id}" (already used at ${first})`);
			else seenIds.set(el.id, path);
		});
	}

	const classByName = new Map<string, number>();
	design.classes.forEach((c, i) => {
		const first = classByName.get(c.name);
		if (first !== undefined)
			add(`classes[${i}].name`, `duplicate class name "${c.name}" (also classes[${first}])`);
		else classByName.set(c.name, i);
	});

	const actors = new Map(design.actors.map((a) => [a.id, a]));
	const classes = new Map(design.classes.map((c) => [c.id, c]));
	const nodes = new Map(design.nodes.map((n) => [n.id, n]));
	const useCases = new Map(design.useCases.map((u) => [u.id, u]));
	const reqIds = reqs && new Set(reqs.requirements.map((r) => r.id));
	const classNames = new Set(classByName.keys());

	const checkReqIds = (path: string, ids: string[]) => {
		if (!reqIds) return;
		ids.forEach((id, i) => {
			if (!reqIds.has(id)) {
				add(`${path}.reqIds[${i}]`, `unknown requirement "${id}" (known: ${list([...reqIds])})`);
			}
		});
	};
	const checkType = (path: string, type: string, set: (normal: string) => void) => {
		const result = normaliseType(type, classNames);
		if (result.ok) set(result.normal);
		else add(path, `type "${type}": ${result.error}`);
	};

	design.useCases.forEach((uc, i) => {
		uc.actorIds.forEach((id, j) => {
			if (!actors.has(id)) {
				add(
					`useCases[${i}].actorIds[${j}]`,
					`unknown actor "${id}" (actors: ${withNames(design.actors)})`
				);
			}
		});
		checkReqIds(`useCases[${i}]`, uc.reqIds);
	});

	design.classes.forEach((c, i) => {
		const path = `classes[${i}]`;
		const out = normalised.classes[i];
		c.relations.forEach((r, j) => {
			if (!classes.has(r.targetId)) {
				add(
					`${path}.relations[${j}].targetId`,
					`relation target "${r.targetId}" is not a class (classes: ${withNames(design.classes)})`
				);
			}
		});
		c.attributes.forEach((a, j) => {
			checkType(`${path}.attributes[${j}].type`, a.type, (t) => (out.attributes[j].type = t));
		});
		c.methods.forEach((m, j) => {
			const mPath = `${path}.methods[${j}]`;
			m.params.forEach((p, k) => {
				checkType(`${mPath}.params[${k}].type`, p.type, (t) => (out.methods[j].params[k].type = t));
			});
			checkType(`${mPath}.returnType`, m.returnType, (t) => (out.methods[j].returnType = t));
		});
		checkReqIds(path, c.reqIds);
	});

	const componentOf = new Map<string, Named>();
	design.components.forEach((comp, i) => {
		const path = `components[${i}]`;
		const folder = folderError(comp.name);
		if (folder !== null) add(`${path}.name`, folder);
		comp.classIds.forEach((id, j) => {
			const cls = classes.get(id);
			const owner = componentOf.get(id);
			if (!cls) {
				add(
					`${path}.classIds[${j}]`,
					`"${id}" is not a class (classes: ${withNames(design.classes)})`
				);
			} else if (owner) {
				add(
					`${path}.classIds[${j}]`,
					`class ${id} ${cls.name} is already in component ${owner.id} ${owner.name}; a class belongs to exactly one component`
				);
			} else {
				componentOf.set(id, comp);
			}
		});
		if (!nodes.has(comp.nodeId)) {
			add(
				`${path}.nodeId`,
				`"${comp.nodeId}" is not a deployment node (nodes: ${withNames(design.nodes)})`
			);
		}
		checkReqIds(path, comp.reqIds);
	});

	// P4 writes each class to src/<component>/<Class>.ts, so a class needs a component.
	design.classes.forEach((c, i) => {
		if (!componentOf.has(c.id)) {
			add(
				`classes[${i}]`,
				`class ${c.id} ${c.name} belongs to no component; add it to the classIds of one (components: ${withNames(design.components)})`
			);
		}
	});

	design.nodes.forEach((node, i) => checkReqIds(`nodes[${i}]`, node.reqIds));

	// A service node runs from src/app/<node kebab>.ts with a start script and environment variables
	// named after it, so its name must give a usable entry name that no other service node has.
	// A lone service node keeps src/app/main.ts, so its name needs no check.
	const entryNames = new Map<string, number>();
	const services = design.nodes.filter((n) => n.kind === 'service').length;
	design.nodes.forEach((node, i) => {
		if (node.kind !== 'service' || services < 2) return;
		const problem = entryError(node);
		const entry = nodeKebab(node);
		const first = entryNames.get(entry);
		if (problem !== null) add(`nodes[${i}].name`, problem);
		else if (first !== undefined)
			add(
				`nodes[${i}].name`,
				`service node ${node.id} ${node.name} gives the entry name "${entry}" like nodes[${first}]; rename one`
			);
		else entryNames.set(entry, i);
	});

	const linkKeys = new Map<string, number>();
	design.links.forEach((link, i) => {
		const path = `links[${i}]`;
		for (const end of ['from', 'to'] as const) {
			if (!nodes.has(link[end])) {
				add(
					`${path}.${end}`,
					`"${link[end]}" is not a deployment node (nodes: ${withNames(design.nodes)})`
				);
			}
		}
		if (link.from === link.to) {
			add(`${path}.to`, `link from ${link.from} to itself; a link joins two nodes`);
		}
		const toDb = nodes.get(link.to)?.kind === 'database';
		if ((link.protocol === 'sql') !== toDb && nodes.has(link.to)) {
			add(
				`${path}.protocol`,
				toDb
					? `link to database node ${link.to} uses ${link.protocol}; use sql`
					: `sql link to ${link.to}, which is not a database node; sql is only for a database node`
			);
		}
		const key = `${link.from} ${link.to} ${link.protocol}`;
		const first = linkKeys.get(key);
		if (first !== undefined) {
			add(
				path,
				`duplicate link ${link.from} to ${link.to} over ${link.protocol} (also links[${first}])`
			);
		} else linkKeys.set(key, i);
	});
	design.nodes.forEach((node, i) => {
		if (
			node.kind === 'external' &&
			!design.links.some((l) => l.from === node.id || l.to === node.id)
		) {
			add(
				`nodes[${i}]`,
				`external node ${node.id} ${node.name} has no link; link it to the node that calls it`
			);
		}
	});

	// Our code runs on service and client nodes only; the browser's code is the page in public/.
	const clients = new Set(clientComponents(design));
	design.components.forEach((comp, i) => {
		const node = nodes.get(comp.nodeId);
		if (node && clients.has(comp) && comp.classIds.length > 0) {
			add(
				`components[${i}].classIds`,
				`component ${comp.id} ${comp.name} on client node ${node.id} ${node.name} must hold no classes (has ${comp.classIds.join(', ')}): remove them; server logic goes on a service node, the browser page is ${PAGE}`
			);
		}
		if (node?.kind !== 'database' && node?.kind !== 'external') return;
		warnings.push({
			path: `components[${i}].nodeId`,
			message: `component ${comp.id} ${comp.name} runs on ${node.kind} node ${node.id} ${node.name}, which holds no components; move it to the node that runs the code`
		});
	});

	// A dependency on a collaborator that the design also uses as a type is not injected, so the
	// dependant would build a private copy; holding it as an attribute still passes the shared one.
	// A collaborator here has no attributes or is held as an attribute somewhere; an entity with
	// methods that only appears in signatures (Item, Task) is data and needs no warning.
	const classById = new Map(design.classes.map((c) => [c.id, c]));
	const holds = (c: DesignDoc['classes'][number], name: string) =>
		c.attributes.some((a) => namesIn(a.type, new Set([name])).length > 0);
	design.classes.forEach((c, i) => {
		const reported = new Set<string>();
		const bases = new Set(
			c.relations.filter((r) => r.kind === 'inheritance').map((r) => r.targetId)
		);
		c.relations.forEach((r, j) => {
			const t = classById.get(r.targetId);
			if (r.kind !== 'dependency' || !t || t.id === c.id || bases.has(t.id)) return;
			if (reported.has(t.id) || t.kind === 'enum' || t.methods.length === 0) return;
			if (injectable(t, design) || holds(c, t.name)) return;
			const collaborator =
				t.attributes.length === 0 || design.classes.some((d) => holds(d, t.name));
			if (!collaborator) return;
			reported.add(t.id);
			warnings.push({
				path: `classes[${i}].relations[${j}]`,
				message: `${c.name} depends on ${t.name}, which has methods but is used as the type of an attribute, parameter or return value, so it is not a constructor parameter and ${c.name} would build its own ${t.name} instead of sharing one: stop using ${t.name} as a type, or give ${c.name} an attribute of type ${t.name}`
			});
		});
	});

	// A dependency is a constructor parameter (the generator's injection rule), so it cannot cross
	// nodes: a call to another node goes through a client class on the calling node and a link.
	// Other relation kinds are not calls; entity types and interfaces are shared code.
	const nodeOf = (classId: string) =>
		nodes.get(design.components.find((k) => k.classIds.includes(classId))?.nodeId ?? '');
	design.classes.forEach((c, i) => {
		const from = nodeOf(c.id);
		c.relations.forEach((r, j) => {
			const to = nodeOf(r.targetId);
			// a target without methods (an entity, an enum) is shared code, never called
			if (r.kind !== 'dependency' || !from || !to || from === to) return;
			if ((classes.get(r.targetId)?.methods.length ?? 0) === 0) return;
			add(
				`classes[${i}].relations[${j}]`,
				`class ${c.id} ${c.name} (node ${from.id} ${from.name}) depends on ${r.targetId} ${classes.get(r.targetId)?.name} (node ${to.id} ${to.name}), so the call crosses nodes; model it as a client class on the calling node (as FrankfurterClient does) and a link between the nodes`
			);
		});
	});

	for (const cycle of dependencyCycles(design)) {
		const names = cycle.map((id) => `${id} ${classes.get(id)?.name}`);
		add(
			`classes[${design.classes.findIndex((c) => c.id === cycle[0])}]`,
			`dependency cycle ${names.join(', ')}, back to ${names[0]}: no constructor can come first; remove one of these dependencies`
		);
	}

	design.sequences.forEach((seq, i) => {
		const path = `sequences[${i}]`;
		if (!useCases.has(seq.useCaseId)) {
			add(
				`${path}.useCaseId`,
				`unknown use case "${seq.useCaseId}" (use cases: ${withNames(design.useCases)})`
			);
		}
		seq.messages.forEach((msg, j) => {
			const mPath = `${path}.messages[${j}]`;
			if (!actors.has(msg.fromId) && !classes.has(msg.fromId)) {
				add(`${mPath}.fromId`, `sender "${msg.fromId}" is not an actor or class`);
			}
			const target = classes.get(msg.toId);
			if (!target) {
				add(
					`${mPath}.toId`,
					`receiver "${msg.toId}" is not a class (classes: ${withNames(design.classes)})`
				);
			} else if (!target.methods.some((m) => m.name === msg.method)) {
				add(
					`${mPath}.method`,
					`method "${msg.method}" not found on ${target.name} (has: ${list(target.methods.map((m) => m.name))})`
				);
			}
		});
	});

	return { issues, warnings, normalised };
}

/**
 * Cycles of dependency relations between classes, found by a depth first walk in design order: at
 * least one per group of classes that depend on each other, each starting at the class reached first.
 */
function dependencyCycles(design: DesignDoc): string[][] {
	const order = new Map(design.classes.map((c, i) => [c.id, i]));
	const deps = new Map(
		design.classes.map((c) => [
			c.id,
			[
				...new Set(
					c.relations
						.filter((r) => r.kind === 'dependency' && order.has(r.targetId))
						.map((r) => r.targetId)
				)
			]
		])
	);
	const cycles: string[][] = [];
	const done = new Set<string>();
	const stack: string[] = [];
	const visit = (id: string) => {
		stack.push(id);
		for (const next of deps.get(id) ?? []) {
			const at = stack.indexOf(next);
			if (at >= 0) {
				cycles.push(stack.slice(at));
			} else if (!done.has(next)) visit(next);
		}
		stack.pop();
		done.add(id);
	};
	for (const c of design.classes) if (!done.has(c.id)) visit(c.id);
	return cycles;
}

export type NextIds = Record<'ACT' | 'UC' | 'SEQ' | 'DSN', string>;

/**
 * The next free ID per prefix over all given designs, typically the one being saved and the saved
 * one, so an ID that a deletion freed is not handed out again (code and tests may still carry it).
 */
export function nextFreeIds(...designs: (DesignDoc | null)[]): NextIds {
	const ds = designs.filter((d): d is DesignDoc => d !== null);
	// a full prefix is reported, not thrown, so the agent still gets the design's issues
	const free = (prefix: keyof NextIds, pick: (d: DesignDoc) => { id: string }[]) => {
		try {
			return nextId(
				prefix,
				ds.flatMap(pick).map((e) => e.id)
			);
		} catch {
			return `no ${prefix} IDs left`;
		}
	};
	return {
		ACT: free('ACT', (d) => d.actors),
		UC: free('UC', (d) => d.useCases),
		SEQ: free('SEQ', (d) => d.sequences),
		DSN: free('DSN', (d) => [...d.classes, ...d.components, ...d.nodes])
	};
}

/** IDs of must requirements that no use case, class, component or node links to. */
export function uncoveredMustReqs(design: DesignDoc, reqs: RequirementsDoc): string[] {
	const linked = new Set(
		[...design.useCases, ...design.classes, ...design.components, ...design.nodes].flatMap(
			(el) => el.reqIds
		)
	);
	return reqs.requirements
		.filter((r) => r.priority === 'must' && !linked.has(r.id))
		.map((r) => r.id);
}
