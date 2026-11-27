import { toMermaidId } from '../ids';
import type { DeploymentNode, DesignClass, DesignDoc, NodeLink, Relation } from '../schemas/design';

const ENTITY: Record<string, string> = {
	'#': '#35;',
	';': '#59;',
	'"': '#quot;',
	'<': '#lt;',
	'>': '#gt;'
};

/**
 * Newlines become spaces, and `#`, `;` and `"` become Mermaid entities in one pass (`;` ends a
 * statement, `#` would start an entity, `"` ends a label).
 */
const escapeSyntax = (text: string): string =>
	text.replace(/\s*[\r\n]+\s*/g, ' ').replace(/[#;"]/g, (c) => ENTITY[c]);

/**
 * Every label goes through here: Mermaid syntax as above, and `<` and `>` as entities, so a name
 * the model wrote can never become HTML in the rendered SVG.
 */
function escapeText(text: string): string {
	return escapeSyntax(text).replace(/[<>]/g, (c) => ENTITY[c]);
}

const quoted = (text: string): string => `"${escapeText(text)}"`;

/**
 * Class members are free text to Mermaid: generics use `~` instead of `<>`, and braces and the
 * arrow of function types would end the member or the class body, so they become entity codes.
 */
const mermaidType = (type: string): string =>
	escapeSyntax(type)
		.replaceAll('=>', '#8594;')
		.replace(/[<>]/g, '~')
		.replaceAll('{', '#123;')
		.replaceAll('}', '#125;');

const clickLine = (id: string): string => `click ${toMermaidId(id)} call aiseSelect("${id}")`;

export function renderUseCase(d: DesignDoc, title: string): string {
	const lines = ['flowchart LR', '  classDef actor fill:none,stroke-dasharray:4 2'];
	for (const a of d.actors) lines.push(`  ${toMermaidId(a.id)}[${quoted(a.name)}]:::actor`);
	lines.push(`  subgraph system[${quoted(title)}]`);
	for (const uc of d.useCases) lines.push(`    ${toMermaidId(uc.id)}([${quoted(uc.name)}])`);
	lines.push('  end');
	for (const uc of d.useCases) {
		for (const actorId of uc.actorIds) {
			lines.push(`  ${toMermaidId(actorId)} --- ${toMermaidId(uc.id)}`);
		}
	}
	for (const a of d.actors) lines.push(`  ${clickLine(a.id)}`);
	for (const uc of d.useCases) lines.push(`  ${clickLine(uc.id)}`);
	return lines.join('\n');
}

function classBlock(c: DesignClass): string[] {
	const body: string[] = [];
	if (c.kind === 'interface') body.push('    <<interface>>');
	if (c.kind === 'enum') {
		body.push('    <<enumeration>>');
		for (const v of c.values) body.push(`    ${escapeText(v)}`);
	}
	for (const a of c.attributes) body.push(`    +${escapeText(a.name)} : ${mermaidType(a.type)}`);
	for (const m of c.methods) {
		const params = m.params.map((p) => `${escapeText(p.name)}: ${mermaidType(p.type)}`).join(', ');
		body.push(`    +${escapeText(m.name)}(${params}) ${mermaidType(m.returnType)}`);
	}
	return body.length === 0 ? [`  class ${c.name}`] : [`  class ${c.name} {`, ...body, '  }'];
}

function relationLine(source: DesignClass, target: DesignClass, r: Relation): string {
	const label = r.label ? ` : ${escapeText(r.label)}` : '';
	if (r.kind === 'inheritance') {
		return `  ${target.name} ${target.kind === 'interface' ? '<|..' : '<|--'} ${source.name}${label}`;
	}
	const arrow = { composition: '*--', association: '-->', dependency: '..>' }[r.kind];
	const multiplicity = r.multiplicity ? ` ${quoted(r.multiplicity)}` : '';
	return `  ${source.name} ${arrow}${multiplicity} ${target.name}${label}`;
}

export function renderClass(d: DesignDoc): string {
	const lines = ['classDiagram'];
	for (const c of d.classes) lines.push(...classBlock(c));
	for (const c of d.classes) {
		for (const r of c.relations) {
			const target = d.classes.find((t) => t.id === r.targetId);
			if (target) lines.push(relationLine(c, target, r));
		}
	}
	for (const c of d.classes) lines.push(`  click ${c.name} call aiseSelect("${c.id}")`);
	return lines.join('\n');
}

export function renderSequence(d: DesignDoc, seqId: string): string {
	const seq = d.sequences.find((s) => s.id === seqId);
	if (!seq) throw new Error(`Unknown sequence "${seqId}"`);
	const nameOf = (id: string): string =>
		d.actors.find((a) => a.id === id)?.name ?? d.classes.find((c) => c.id === id)?.name ?? id;

	const lines = ['sequenceDiagram'];
	const seen = new Set<string>();
	for (const m of seq.messages) {
		for (const id of [m.fromId, m.toId]) {
			if (seen.has(id)) continue;
			seen.add(id);
			lines.push(`  participant ${toMermaidId(id)} as ${escapeText(nameOf(id))}`);
		}
	}
	for (const m of seq.messages) {
		const method = d.classes.find((c) => c.id === m.toId)?.methods.find((x) => x.name === m.method);
		const params = method ? method.params.map((p) => p.name).join(', ') : '';
		lines.push(
			`  ${toMermaidId(m.fromId)}->>${toMermaidId(m.toId)}: ${escapeText(m.method)}(${escapeText(params)})`
		);
	}
	return lines.join('\n');
}

/** Edge label of a link: the protocol, then its text if any, e.g. `HTTPS: rates`. */
export const linkLabel = (l: NodeLink): string =>
	l.protocol.toUpperCase() + (l.label ? `: ${l.label}` : '');

const NODE_SHAPE: Record<DeploymentNode['kind'], [string, string]> = {
	service: ['[', ']'],
	database: ['[(', ')]'],
	external: ['{{', '}}'],
	client: ['([', '])']
};

/** Nodes with their components; edges come only from the design's links, never from relations. */
export function renderDeployment(d: DesignDoc): string {
	const lines = ['flowchart TB', '  classDef client stroke-dasharray:4 2'];
	for (const node of d.nodes) {
		const id = toMermaidId(node.id);
		const components = d.components.filter((c) => c.nodeId === node.id);
		if (components.length > 0) {
			lines.push(`  subgraph ${id}[${quoted(node.name)}]`);
			for (const c of components) lines.push(`    ${toMermaidId(c.id)}[${quoted(c.name)}]`);
			lines.push('  end');
			if (node.kind === 'client') lines.push(`  class ${id} client`);
		} else {
			const [open, close] = NODE_SHAPE[node.kind];
			lines.push(`  ${id}${open}${quoted(node.name)}${close}`);
		}
	}
	for (const l of d.links) {
		lines.push(`  ${toMermaidId(l.from)} -->|${quoted(linkLabel(l))}| ${toMermaidId(l.to)}`);
	}
	// Components and the nodes drawn as boxes take a click; Mermaid gives a subgraph none.
	const boxed = d.nodes.filter((n) => !d.components.some((c) => c.nodeId === n.id));
	for (const x of [...d.components, ...boxed]) lines.push(`  ${clickLine(x.id)}`);
	return lines.join('\n');
}

export function renderAll(
	d: DesignDoc,
	title: string
): {
	useCase: string;
	class: string;
	deployment: string;
	sequences: { id: string; name: string; mermaid: string }[];
} {
	return {
		useCase: renderUseCase(d, title),
		class: renderClass(d),
		deployment: renderDeployment(d),
		sequences: d.sequences.map((s) => ({
			id: s.id,
			name: s.name,
			mermaid: renderSequence(d, s.id)
		}))
	};
}
