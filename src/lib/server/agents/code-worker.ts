import path from 'node:path';
import { planCode, type FilePlan } from '../codegen/plan';
import { injectable } from '../core/drift';
import { nodeKebab, peerUrl, serviceNodes } from '../core/nodes';
import type { DeploymentNode, DesignClass, DesignDoc, NodeLink } from '../core/schemas/design';
import type { RequirementsDoc } from '../core/schemas/requirements';
import { STACK_RULES } from './stack-rules';
import type { AgentDef } from './types';

const system = `You are a code worker in an AI assisted software engineering environment. You write one TypeScript file of a generated project: the file for one class of the approved design. The brief names the file, the design class as JSON, the classes it uses with their signatures and import lines, the enum values those signatures use, and the requirements it realises. Those classes are written by other workers at the same time, so their files may not exist yet. Rely on the signatures and enum values in the brief, never on other files, and import them as shown.

write_file writes your one file and refuses every other path. On a retry you also have read_file, to read a file you import. Write the complete file with one write_file call, using the exact path from the brief. When the brief carries errors from an earlier attempt, fix every one of them, and change nothing the errors do not require. The environment checks your file with the TypeScript compiler and against the design after you finish.

Never write Mermaid or any diagram syntax. Reply with one short sentence.

${STACK_RULES}`;

/**
 * Haiku writes first and second attempts; Sonnet is the escalation on the third. A first attempt
 * gets no read_file: the other files are written at the same time, so the brief is the only source.
 */
export function workerDef(
	model: 'claude-haiku-5-5' | 'claude-sonnet-5-5',
	retry: boolean
): AgentDef {
	return {
		name: 'code',
		model,
		// Lowest effort that holds for a single file from exact signatures; Sonnet gets medium, the
		// recommended start for agentic coding on it.
		effort: model === 'claude-haiku-5-5' ? 'low' : 'medium',
		tools: retry ? ['read_file', 'write_file'] : ['write_file'],
		system
	};
}

/** `import` path from one planned file to another: relative, forward slashes, .js extension. */
export function importPath(from: string, to: string): string {
	const rel = path.posix.relative(path.posix.dirname(from), to).replace(/\.ts$/, '.js');
	return rel.startsWith('.') ? rel : `./${rel}`;
}

/** `TaskRepository` becomes `taskRepository`, `HTTPServer` becomes `httpServer`. */
const camel = (name: string): string =>
	name.replace(/^[A-Z]+(?=[A-Z][a-z])|^[A-Z]/, (m) => m.toLowerCase());

/**
 * A class that stores data gets the database: a class named ...Repository, ...Store or ...Dao,
 * unless its component runs on an external node. SQLite runs in the app process, so no database node
 * is needed. A client node holds no classes.
 */
export function storesData(cls: DesignClass, design: DesignDoc): boolean {
	if (cls.kind !== 'class' || !/(Repository|Store|Dao)$/.test(cls.name)) return false;
	const component = design.components.find((c) => c.classIds.includes(cls.id));
	const node = design.nodes.find((n) => n.id === component?.nodeId);
	return node?.kind !== 'external';
}

/**
 * Enums named in the declaration shapes of the given classes, so a worker sees their exact values.
 * The shape includes inherited constructor parameters and implemented interface members.
 */
function enumsUsedBy(classes: DesignClass[], design: DesignDoc): DesignClass[] {
	const names = new Set(
		classes.flatMap((c) => signatureOf(c, design).match(/[A-Za-z_$][\w$]*/g) ?? [])
	);
	return design.classes.filter((e) => e.kind === 'enum' && names.has(e.name));
}

type CtorParam = { name: string; type: string; decl: string };

/** The design class a class extends, when it extends one (not an interface). */
function baseClass(cls: DesignClass, design: DesignDoc): DesignClass | undefined {
	if (cls.kind !== 'class') return undefined;
	for (const r of cls.relations) {
		const base =
			r.kind === 'inheritance' ? design.classes.find((c) => c.id === r.targetId) : undefined;
		if (base?.kind === 'class') return base;
	}
	return undefined;
}

/**
 * The complete constructor of a class, fixed by the design so dependants know how to call it: the
 * base class's parameters first as plain parameters, then db for a storing class, then one private
 * readonly parameter per dependency relation whose target can be injected, then one public
 * parameter per attribute. A base parameter the class declares itself is listed once, as the class
 * declares it. Association and composition never come through the constructor. A dependency whose name an attribute has is
 * suffixed Dep.
 */
function ctorParams(cls: DesignClass, design: DesignDoc, seen: string[] = []): CtorParam[] {
	const byId = new Map(design.classes.map((c) => [c.id, c]));
	const attrNames = new Set(cls.attributes.map((a) => a.name));
	const own: CtorParam[] = [
		...(storesData(cls, design)
			? [{ name: 'db', type: 'DatabaseSync', decl: 'db: DatabaseSync' }]
			: []),
		...[...new Set(cls.relations.filter((r) => r.kind === 'dependency').map((r) => r.targetId))]
			.flatMap((id) => byId.get(id) ?? [])
			.filter((t) => injectable(t, design))
			.map((t) => {
				const name = attrNames.has(camel(t.name)) ? `${camel(t.name)}Dep` : camel(t.name);
				return { name, type: t.name, decl: `private readonly ${name}: ${t.name}` };
			}),
		...cls.attributes.map((a) => ({
			name: a.name,
			type: a.type,
			decl: `public ${a.name}: ${a.type}`
		}))
	];
	const base = baseClass(cls, design);
	const inherited =
		base && !seen.includes(base.id) ? ctorParams(base, design, [...seen, cls.id]) : [];
	const names = new Set(own.map((p) => p.name));
	return [
		...inherited
			.filter((p) => !names.has(p.name))
			.map((p) => ({ ...p, decl: `${p.name}: ${p.type}` })),
		...own
	];
}

/** The constructor line of the declaration shape, with the super call when the class has a base. */
function constructorLine(cls: DesignClass, design: DesignDoc): string {
	const line = `  constructor(${ctorParams(cls, design)
		.map((p) => p.decl)
		.join(', ')});`;
	const base = baseClass(cls, design);
	if (!base) return line;
	const args = ctorParams(base, design, [cls.id]).map((p) => p.name);
	return `${line} // first statement: super(${args.join(', ')})`;
}

/** Members of the design interfaces a class implements, through interfaces that extend interfaces, as `[member line, interface name]`. */
function implementedMembers(cls: DesignClass, byId: Map<string, DesignClass>): [string, string][] {
	const own = new Set([...cls.attributes, ...cls.methods].map((m) => m.name));
	const out: [string, string][] = [];
	const seen = new Set([cls.id]);
	const visit = (c: DesignClass) => {
		for (const r of c.relations) {
			const base = r.kind === 'inheritance' ? byId.get(r.targetId) : undefined;
			if (base?.kind !== 'interface' || seen.has(base.id)) continue;
			seen.add(base.id);
			for (const a of base.attributes) {
				if (!own.has(a.name)) out.push([`  ${a.name}: ${a.type};`, base.name]);
				own.add(a.name);
			}
			for (const m of base.methods) {
				if (!own.has(m.name)) out.push([methodLine(m), base.name]);
				own.add(m.name);
			}
			visit(base);
		}
	};
	visit(cls);
	return out;
}

const methodLine = (m: DesignClass['methods'][number]): string =>
	`  ${m.name}(${m.params.map((p) => `${p.name}: ${p.type}`).join(', ')}): ${m.returnType};`;

/** The declaration a class has in code, as the design states it, without bodies. */
export function signatureOf(cls: DesignClass, design: DesignDoc): string {
	const byId = new Map(design.classes.map((c) => [c.id, c]));
	if (cls.kind === 'enum') {
		return `export enum ${cls.name} { ${cls.values.map((v) => `${v} = '${v}'`).join(', ')} }`;
	}
	const bases = cls.relations
		.filter((r) => r.kind === 'inheritance')
		.flatMap((r) => byId.get(r.targetId) ?? []);
	const extend = bases.filter((b) => cls.kind === 'interface' || b.kind !== 'interface');
	const implement = cls.kind === 'class' ? bases.filter((b) => b.kind === 'interface') : [];
	const heads = [
		extend.length > 0 ? `extends ${extend.map((b) => b.name).join(', ')}` : '',
		implement.length > 0 ? `implements ${implement.map((b) => b.name).join(', ')}` : ''
	].filter(Boolean);
	const members = [
		// a class declares its attributes as public constructor parameters
		...(cls.kind === 'class'
			? [constructorLine(cls, design)]
			: cls.attributes.map((a) => `  ${a.name}: ${a.type};`)),
		...cls.methods.map(methodLine),
		// what the class must implement from its interfaces, so the worker writes it
		...(cls.kind === 'class'
			? implementedMembers(cls, byId).map(([line, from]) => `${line} // implements ${from}`)
			: [])
	];
	const head = `export ${cls.kind} ${cls.name} ${heads.join(' ')}`.replace(/ +/g, ' ').trim();
	return [`${head} {`, ...members, '}'].join('\n');
}

/**
 * Where a client class on `self` finds the service node a link goes to: the URL variable with its
 * default and the ws path or the /internal/ routes; null when the link does not end at a service node.
 */
export function peerTarget(design: DesignDoc, link: NodeLink, self: DeploymentNode): string | null {
	const url = peerUrl(design, link);
	if (!url) return null;
	const at = link.protocol.startsWith('ws')
		? `path /internal/${nodeKebab(self)}`
		: 'routes under /internal/';
	return `process.env.${url.variable} ?? '${url.fallback}', ${at}`;
}

/** The links from a class's node to other service nodes, for the worker that may write their client class. */
function clientLinkLines(design: DesignDoc, cls: DesignClass): string | null {
	const role = serviceNodes(design).find((r) => r.classIds.includes(cls.id));
	if (!role) return null;
	const nodes = new Map(design.nodes.map((n) => [n.id, n]));
	const links = role.outgoing.flatMap((l) => {
		const target = peerTarget(design, l, role.node);
		const to = nodes.get(l.to);
		return target ? [`- to ${to?.name ?? l.to} (${l.to}) over ${l.protocol}: ${target}`] : [];
	});
	if (links.length === 0) return null;
	return `This class runs on node ${role.node.name} (${role.node.id}). If it is the client class of one of the node's links below, it reads the URL in its own code from the variable shown, with that default; the URL is never a constructor parameter:\n${links.join('\n')}`;
}

/**
 * The calls a class makes in the design sequences, grouped by the method of the class that the
 * sequence called last before them, so a worker makes the checks the design shows (a bid calls
 * `Item.isOpen`). Only calls the class can make are listed: to a dependency target or to data (an
 * entity, which it holds or loads), not over a link or to a collaborator it does not take. Known
 * limit: a callback into the class becomes the handler of the calls after it. Null when the class
 * makes no call.
 */
function sequenceCallLines(design: DesignDoc, cls: DesignClass): string | null {
	const byId = new Map(design.classes.map((c) => [c.id, c]));
	const deps = new Set(cls.relations.filter((r) => r.kind === 'dependency').map((r) => r.targetId));
	const reachable = (id: string) => {
		const t = byId.get(id);
		return !!t && id !== cls.id && (deps.has(id) || !injectable(t, design));
	};
	const lines: string[] = [];
	for (const s of design.sequences) {
		let handler: string | undefined;
		const groups: { handler?: string; calls: string[] }[] = [];
		for (const m of s.messages) {
			if (m.toId === cls.id && m.fromId !== cls.id) handler = m.method;
			if (m.fromId !== cls.id || !reachable(m.toId)) continue;
			const call = `${byId.get(m.toId)?.name}.${m.method}${m.label ? ` (${m.label})` : ''}`;
			const last = groups.at(-1);
			if (last && last.handler === handler) last.calls.push(call);
			else groups.push({ handler, calls: [call] });
		}
		for (const g of groups) {
			lines.push(
				`- ${s.id} ${s.name}${g.handler ? `, in ${g.handler}` : ''}: ${g.calls.join(', ')}`
			);
		}
	}
	if (lines.length === 0) return null;
	return `Calls this class makes in the design sequences, in order; make them in the method that handles the sequence. They are the minimum, not the whole method: before a call that saves an entity, also set every attribute of it that the acceptance criteria change (a new highest value, a status, a winner), even when no call here shows it. List only calls to classes in the constructor shape or to entities the class holds:\n${lines.join('\n')}`;
}

/** The user message for a worker: everything it needs for one class file and nothing else. */
export function workerBrief(
	design: DesignDoc,
	reqs: RequirementsDoc,
	plan: FilePlan,
	retry?: { content: string; errors: string[] }
): string {
	const cls = design.classes.find((c) => c.id === plan.classId);
	if (!cls) throw new Error(`Class ${plan.classId} is not in the design.`);
	const plans = new Map(planCode(design).map((p) => [p.classId, p]));
	const out: string[] = [];

	out.push(
		`Write the file ${plan.path} for ${cls.kind} ${cls.name} (${cls.id}), component "${plan.component}".`
	);
	out.push(
		`Start its declaration with a JSDoc comment containing the tag: @trace ${[cls.id, ...cls.reqIds].join(' ')}`
	);
	// members are in the declaration shape; the JSON keeps the rest
	const json = JSON.stringify({ ...cls, attributes: undefined, methods: undefined }, null, 2);
	out.push(`The design class as JSON, without its members:\n${json}`);
	out.push(
		`Its declaration shape, to match exactly. The constructor parameters are fixed and declare the attributes, so do not declare them again:\n${signatureOf(cls, design)}`
	);

	const used = plan.uses.flatMap((id) => design.classes.find((c) => c.id === id) ?? []);
	if (used.length > 0) {
		const lines = used.map((u) => {
			const target = plans.get(u.id);
			const from = target
				? `import { ${u.name} } from '${importPath(plan.path, target.path)}';`
				: `(no file planned for ${u.name})`;
			return `- ${u.name} (${u.id}): ${from}\n${signatureOf(u, design)
				.split('\n')
				.map((l) => `    ${l}`)
				.join('\n')}`;
		});
		out.push(`Classes this file uses, with the import line for each:\n${lines.join('\n')}`);
	} else {
		out.push('This file uses no other design class.');
	}

	// enums the used classes' members name, so a status is written exactly as its enum value
	const enums = enumsUsedBy([cls, ...used], design).filter(
		(e) => e.id !== cls.id && !plan.uses.includes(e.id)
	);
	if (enums.length > 0) {
		const lines = enums.map((e) => {
			const target = plans.get(e.id);
			const from = target
				? ` Import it with import { ${e.name} } from '${importPath(plan.path, target.path)}'; when you use it.`
				: '';
			return `- ${signatureOf(e, design)}${from}`;
		});
		out.push(
			`Enums the members of those classes use. Compare and store only these exact values:\n${lines.join('\n')}`
		);
	}

	const client = clientLinkLines(design, cls);
	if (client) out.push(client);
	const calls = sequenceCallLines(design, cls);
	if (calls) out.push(calls);

	const texts = cls.reqIds.map((id) => {
		const r = reqs.requirements.find((x) => x.id === id);
		if (!r) return `- ${id}: (not in the requirements)`;
		const criteria = r.acceptanceCriteria.map((c) => `    * ${c}`).join('\n');
		return `- ${r.id} ${r.title}: ${r.text}\n  Acceptance criteria:\n${criteria}`;
	});
	out.push(
		texts.length > 0
			? `Requirements this class realises:\n${texts.join('\n')}`
			: 'This class links to no requirement.'
	);

	if (retry) {
		out.push(
			`This is a retry. The file as it is now:\n\`\`\`ts\n${retry.content}\n\`\`\`\nProblems to fix, all of them:\n${retry.errors.map((e) => `- ${e}`).join('\n')}\nYou may read_file the files this one imports.`
		);
	}
	return out.join('\n\n');
}
