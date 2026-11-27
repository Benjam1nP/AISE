import type { DesignClass, DesignDoc } from './schemas/design';
import type { CodeModel, Decl, Member } from './tools/code-model';
import ts from 'typescript';
import { normaliseCodeType } from './types';
import { clientComponents, PAGE } from './client';
import { traceIds } from '../../trace-ids';

export type DriftItem = {
	kind: 'missing_in_code' | 'missing_in_design' | 'changed';
	id?: string;
	name: string;
	file?: string;
	line?: number;
	details: string[];
};

const list = (items: Iterable<string>) => [...items].join(', ') || 'none';
const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

const traceText = (d: Decl) => d.tags.filter((t) => t.startsWith('@trace')).join(' ');
const traceId = (d: Decl) => traceText(d).match(/DSN-\d{3}/)?.[0];

type Param = { name: string; type: string; optional?: boolean };
/** What a method comparison needs, from a method or a function typed property. */
type Callable = { name: string; params: Param[]; returnType: string };

/** Members of a union at its top level, and whether a `=>` sits at that level. */
function topLevel(type: string): { members: string[]; arrow: boolean } {
	const members: string[] = [];
	let depth = 0;
	let start = 0;
	let arrow = false;
	for (let i = 0; i < type.length; i++) {
		const c = type[i];
		if (c === '=' && type[i + 1] === '>') {
			arrow ||= depth === 0;
			i++;
		} else if ('([{<'.includes(c)) depth++;
		else if (')]}>'.includes(c)) depth--;
		else if (c === '|' && depth === 0) {
			members.push(type.slice(start, i).trim());
			start = i + 1;
		}
	}
	members.push(type.slice(start).trim());
	return { members, arrow };
}

/** A code type as the design would write it: an optional `x?: T` is `T | undefined`. */
function withOptional(type: string, optional: boolean): string {
	if (!optional) return type;
	const { members, arrow } = topLevel(type);
	if (arrow) return `(${type}) | undefined`;
	return members.includes('undefined') ? type : `${type} | undefined`;
}

/** Parameters and return type when `type` is a function type, else undefined. */
function functionParts(type: string): Pick<Callable, 'params' | 'returnType'> | undefined {
	const source = ts.createSourceFile('t.ts', `type T = ${type};`, ts.ScriptTarget.Latest, true);
	const [alias] = source.statements;
	if (!alias || !ts.isTypeAliasDeclaration(alias) || !ts.isFunctionTypeNode(alias.type)) return;
	return {
		params: alias.type.parameters.map((p) => ({
			name: p.name.getText(source),
			type: p.type?.getText(source) ?? 'unknown',
			optional: p.questionToken !== undefined
		})),
		returnType: alias.type.type.getText(source)
	};
}

/** Names of design classes in the `extends` and `implements` of a declaration; generics and qualified names are not bases. */
function baseNames(d: Decl, designNames: Set<string>): Set<string> {
	let text = [d.extends ?? '', ...(d.implements ?? [])].join(' ');
	for (let prev = ''; prev !== text;) {
		prev = text;
		text = text.replace(/<[^<>]*>/g, '');
	}
	text = text.replace(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g, '');
	return new Set((text.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((n) => designNames.has(n)));
}

/** Differences between a design method and one code method. */
function methodDiff(design: Callable, code: Callable, norm: (t: string) => string): string[] {
	const out: string[] = [];
	const same =
		design.params.length === code.params.length &&
		design.params.every((d, i) => {
			const c = code.params[i];
			return (
				d.name === c.name &&
				(norm(d.type) === norm(c.type) ||
					(!!c.optional && norm(d.type) === norm(withOptional(c.type, true))))
			);
		});
	if (!same) {
		const show = (ps: Param[]) =>
			ps.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');
		out.push(
			`method ${design.name}: parameters (${show(design.params)}) in design, (${show(code.params)}) in code`
		);
	}
	if (norm(design.returnType) !== norm(code.returnType)) {
		out.push(
			`method ${design.name}: return type ${design.returnType} in design, ${code.returnType} in code`
		);
	}
	return out;
}

/** Every design base of a class, transitively. */
function ancestors(cls: DesignClass, byId: Map<string, DesignClass>): DesignClass[] {
	const out: DesignClass[] = [];
	const seen = new Set([cls.id]);
	const visit = (c: DesignClass) => {
		for (const r of c.relations) {
			const base = r.kind === 'inheritance' ? byId.get(r.targetId) : undefined;
			if (!base || seen.has(base.id)) continue;
			seen.add(base.id);
			out.push(base);
			visit(base);
		}
	};
	visit(cls);
	return out;
}

/** Names of the attributes and methods of every design base of a class, transitively. */
const inheritedNames = (cls: DesignClass, byId: Map<string, DesignClass>): Set<string> =>
	new Set(ancestors(cls, byId).flatMap((b) => [...b.attributes, ...b.methods].map((m) => m.name)));

/**
 * Design class names in a type, such as `Room` in `Map<string, Room[]>`; qualified names and words
 * in string literal types (`"Mailer" | "Sms"`) are not.
 */
export const namesIn = (type: string, designNames: Set<string>): string[] =>
	(
		type
			.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '')
			.replace(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g, '')
			.match(/[A-Za-z_$][\w$]*/g) ?? []
	).filter((n) => designNames.has(n));

/**
 * A collaborator is injected through the constructor, whether or not it holds state: a class or
 * interface with methods that no design class, itself included, uses as a type of an attribute, a
 * parameter or a return type. Such a type is data that is passed around, like an entity. A service
 * with a method returning its own type therefore counts as data and is not injected.
 */
export const injectable = (c: DesignClass, design: Pick<DesignDoc, 'classes'>): boolean => {
	if (c.kind === 'enum' || c.methods.length === 0) return false;
	const name = new Set([c.name]);
	return !design.classes.some((d) =>
		[
			...d.attributes.map((a) => a.type),
			...d.methods.flatMap((m) => [m.returnType, ...m.params.map((p) => p.type)])
		].some((t) => namesIn(t, name).length > 0)
	);
};

/**
 * Relations against the code. A dependency on an injectable class needs its target type somewhere
 * in the members (field, constructor or method parameter, return type), and as a constructor
 * parameter, so the class shares the one instance the wiring creates. A dependency on an entity
 * shows up only in method signatures, which the method comparison covers, and associations and
 * compositions between entities are ID attributes (`sellerId: string`), so neither is checked here.
 * A constructor parameter of a design class type needs a relation of any kind in either direction,
 * or an attribute of that type in the class or a base.
 */
function relationDiffs(
	cls: DesignClass,
	decl: Decl,
	byId: Map<string, DesignClass>,
	designNames: Set<string>,
	design: DesignDoc
): string[] {
	const out: string[] = [];
	const typesOf = (m: Member) => [
		m.type ?? '',
		m.returnType ?? '',
		...(m.params ?? []).map((p) => p.type)
	];
	const used = new Set(decl.members.flatMap(typesOf).flatMap((t) => namesIn(t, designNames)));
	const ctorTypes = new Set(
		decl.members
			.filter((m) => m.kind === 'constructor')
			.flatMap((m) => m.params ?? [])
			.flatMap((p) => namesIn(p.type, designNames))
	);
	for (const r of cls.relations) {
		const target = byId.get(r.targetId);
		if (r.kind !== 'dependency' || !target || !injectable(target, design)) continue;
		if (!used.has(target.name)) {
			out.push(
				`dependency on ${target.name}: in design, not in code (no field, parameter or return type of ${target.name}); inject ${target.name} into ${cls.name}, or remove the relation from the design`
			);
		} else if (!ctorTypes.has(target.name)) {
			out.push(
				`constructor parameter of type ${target.name}: in design, not in code; take ${target.name} as a constructor parameter of ${cls.name} so it shares the one instance the wiring creates, or remove the relation from the design`
			);
		}
	}

	const related = new Set(cls.relations.flatMap((r) => byId.get(r.targetId)?.name ?? []));
	for (const c of byId.values()) {
		if (c.relations.some((r) => r.targetId === cls.id)) related.add(c.name);
	}
	const attributeTypes = new Set(
		[cls, ...ancestors(cls, byId)].flatMap((c) =>
			c.attributes.flatMap((a) => namesIn(a.type, designNames))
		)
	);
	const reported = new Set<string>();
	for (const ctor of decl.members.filter((m) => m.kind === 'constructor')) {
		for (const p of ctor.params ?? []) {
			for (const n of namesIn(p.type, designNames)) {
				if (n === cls.name || related.has(n) || attributeTypes.has(n) || reported.has(n)) continue;
				reported.add(n);
				out.push(
					`constructor parameter ${p.name}: ${p.type}: in code, no relation to ${n} in design; add a dependency on ${n} to the design, or remove the parameter from the code`
				);
			}
		}
	}
	return out;
}

/**
 * Attributes and methods; code members that are private or protected and not in the design are
 * ignored, and so are public ones that implement or override a member of a design base.
 */
function memberDiffs(
	cls: DesignClass,
	decl: Decl,
	norm: (t: string) => string,
	inherited: Set<string>
): string[] {
	const out: string[] = [];
	const members = decl.members.filter((m) => /^[A-Za-z_$]/.test(m.name)); // not `[]` or `()`

	// a property of a function type is a method, in code and in the design
	const props: Member[] = [];
	const methods: (Callable & Pick<Member, 'visibility' | 'static'>)[] = [];
	for (const m of members) {
		// decided on the effective type: `cb?: () => void` is `(() => void) | undefined`, an attribute
		const fn =
			m.kind === 'property'
				? functionParts(withOptional(m.type ?? '', m.optional ?? false))
				: undefined;
		if (m.kind === 'method') {
			methods.push({ ...m, params: m.params ?? [], returnType: m.returnType ?? 'void' });
		} else if (fn) methods.push({ ...m, ...fn });
		else if (m.kind === 'property') props.push(m);
	}
	const designAttributes: { name: string; type: string }[] = [];
	const designMethods: Callable[] = [...cls.methods];
	for (const a of cls.attributes) {
		const fn = functionParts(a.type);
		if (fn) designMethods.push({ name: a.name, ...fn });
		else designAttributes.push(a);
	}

	for (const a of designAttributes) {
		const code = props.find((p) => p.name === a.name);
		if (!code) {
			out.push(`attribute ${a.name}: in design, not in code`);
			continue;
		}
		const codeType = withOptional(code.type ?? '', code.optional ?? false);
		if (norm(a.type) !== norm(codeType)) {
			out.push(`attribute ${a.name}: type ${a.type} in design, ${codeType} in code`);
		}
	}
	// private, protected and static members (factories) may be extra
	const extra = (m: Pick<Member, 'visibility' | 'static'>) =>
		m.visibility === 'public' && !m.static;
	for (const p of props) {
		if (extra(p) && !inherited.has(p.name) && !designAttributes.some((a) => a.name === p.name)) {
			out.push(`attribute ${p.name}: in code, not in design`);
		}
	}

	for (const m of designMethods) {
		const candidates = methods.filter((c) => c.name === m.name);
		if (candidates.length === 0) {
			out.push(`method ${m.name}: in design, not in code`);
			continue;
		}
		const diffs = candidates.map((c) => methodDiff(m, c, norm)); // overloads: any match is enough
		if (diffs.every((d) => d.length > 0)) out.push(...diffs[0]);
	}
	for (const m of methods) {
		if (extra(m) && !inherited.has(m.name) && !designMethods.some((d) => d.name === m.name)) {
			out.push(`method ${m.name}: in code, not in design`);
		}
	}
	return out;
}

/** Everything that differs between a design class and the code declaration matched to it. */
function compare(
	cls: DesignClass,
	decl: Decl,
	path: string | undefined,
	byId: Map<string, DesignClass>,
	design: DesignDoc
): string[] {
	const out: string[] = [];
	const nameById = new Map([...byId].map(([id, c]) => [id, c.name]));
	const designNames = new Set(nameById.values());
	const norm = (t: string) => normaliseCodeType(t, designNames);

	if (decl.name !== cls.name) out.push(`name: "${cls.name}" in design, "${decl.name}" in code`);
	if (path && decl.file !== path) out.push(`file: expected ${path}, found ${decl.file}`);

	const codeReqs = new Set(traceText(decl).match(/REQ-\d{3}/g) ?? []);
	if (!same(codeReqs, new Set(cls.reqIds))) {
		out.push(`REQ IDs: ${list(cls.reqIds)} in design, ${list(codeReqs)} in the @trace tag`);
	}

	if (decl.kind !== cls.kind) {
		out.push(`kind: ${cls.kind} in design, ${decl.kind} in code`);
		return out; // members of another kind are not comparable
	}

	if (cls.kind === 'enum') {
		const design = new Set(cls.values);
		const code = new Set(decl.members.map((m) => m.name));
		if (!same(design, code))
			out.push(`enum values: ${list(design)} in design, ${list(code)} in code`);
	} else {
		out.push(...memberDiffs(cls, decl, norm, inheritedNames(cls, byId)));
		out.push(...relationDiffs(cls, decl, byId, designNames, design));
	}

	const designBases = new Set(
		cls.relations
			.filter((r) => r.kind === 'inheritance')
			.flatMap((r) => nameById.get(r.targetId) ?? [])
	);
	const codeBases = baseNames(decl, designNames);
	if (!same(designBases, codeBases)) {
		out.push(`extends or implements: ${list(designBases)} in design, ${list(codeBases)} in code`);
	}
	return out;
}

/**
 * Differences between the design and the code. `paths` maps a class ID to its planned file. Only
 * exported classes, interfaces and enums outside `src/app/` take part. Matching is by the DSN ID in
 * the `@trace` tag, then by name.
 */
export function detectDrift(
	design: DesignDoc,
	code: CodeModel,
	paths: Record<string, string>
): DriftItem[] {
	const decls = code.decls.filter(
		(d) =>
			(d.kind === 'class' || d.kind === 'interface' || d.kind === 'enum') &&
			!d.file.startsWith('src/app/')
	);
	const byId = new Map(design.classes.map((c) => [c.id, c]));
	const nameById = new Map(design.classes.map((c) => [c.id, c.name]));
	const matched = new Map<string, Decl>();
	const taken = new Set<Decl>();
	const claim = (id: string, d: Decl) => {
		matched.set(id, d);
		taken.add(d);
	};
	for (const cls of design.classes) {
		const d = decls.find((x) => !taken.has(x) && traceId(x) === cls.id);
		if (d) claim(cls.id, d);
	}
	for (const cls of design.classes) {
		if (matched.has(cls.id)) continue;
		// a declaration traced to another design class is that class's, whatever its name
		const d = decls.find(
			(x) => !taken.has(x) && x.name === cls.name && !nameById.has(traceId(x) ?? '')
		);
		if (d) claim(cls.id, d);
	}

	const items: DriftItem[] = [];
	for (const cls of design.classes) {
		const decl = matched.get(cls.id);
		if (!decl) {
			const where = paths[cls.id] ? ` (expected ${paths[cls.id]})` : '';
			items.push({
				kind: 'missing_in_code',
				id: cls.id,
				name: cls.name,
				details: [`${cls.kind} ${cls.name} is in the design but not in code${where}`]
			});
			continue;
		}
		const details = compare(cls, decl, paths[cls.id], byId, design);
		if (details.length > 0) {
			items.push({
				kind: 'changed',
				id: cls.id,
				name: cls.name,
				file: decl.file,
				line: decl.line,
				details
			});
		}
	}
	for (const d of decls) {
		if (taken.has(d)) continue;
		items.push({
			kind: 'missing_in_design',
			name: d.name,
			file: d.file,
			line: d.line,
			details: [`${d.kind} ${d.name} is in code but not in the design`]
		});
	}
	return items;
}

/**
 * Differences between the client components and the `@trace` comment of the browser page, whose
 * IDs must be the components' `[id, ...reqIds]`. `page` is the page text, null when it is missing.
 */
export function pageDrift(design: DesignDoc, page: string | null): DriftItem[] {
	const clients = clientComponents(design);
	if (clients.length === 0) return [];
	const base = { id: clients[0].id, name: clients.map((c) => c.name).join(', ') };
	if (page === null) {
		return [
			{
				kind: 'missing_in_code',
				...base,
				details: [`client component ${base.name} is in the design but ${PAGE} does not exist`]
			}
		];
	}
	const expected = [...new Set(clients.flatMap((c) => [c.id, ...c.reqIds]))];
	const lines = page.split('\n');
	const at = lines.findIndex((l) => /<!--\s*@trace\b/.test(l));
	const actual = at < 0 ? [] : traceIds(lines[at]);
	if (actual.length === 0) {
		const comment = `<!-- @trace ${expected.join(' ')} -->`;
		return [
			{
				kind: 'changed',
				...base,
				file: PAGE,
				details: [`${PAGE} has no @trace comment; add ${comment} as the first line in <head>`]
			}
		];
	}
	const want = new Set(expected);
	const have = new Set(actual);
	if (same(want, have)) return [];
	const missing = expected.filter((id) => !have.has(id));
	const extra = actual.filter((id) => !want.has(id));
	const diff = [
		...(missing.length > 0 ? [`missing ${missing.join(', ')}`] : []),
		...(extra.length > 0 ? [`extra ${extra.join(', ')}`] : [])
	].join('; ');
	const line = at + 1;
	return [
		{
			kind: 'changed',
			...base,
			file: PAGE,
			line,
			details: [
				`@trace IDs: ${expected.join(' ')} in design, ${actual.join(' ')} in ${PAGE} (${diff})`
			]
		}
	];
}
