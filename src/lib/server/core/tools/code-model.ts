import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
	ClassDeclaration,
	EnumDeclaration,
	FunctionDeclaration,
	InterfaceDeclaration,
	Node,
	Project,
	TypeAliasDeclaration,
	VariableDeclaration,
	type ExportedDeclarations,
	type ParameterDeclaration,
	type ReturnTypedNode,
	type SourceFile
} from 'ts-morph';
import { z } from 'zod';
import { defineTool } from './registry';

export type Member = {
	name: string;
	kind: 'constructor' | 'method' | 'property';
	signature: string;
	static: boolean;
	visibility: 'public' | 'protected' | 'private';
	/** Properties and getters: the type as written (inferred when not written). */
	type?: string;
	/** Properties: declared with `?`. */
	optional?: boolean;
	/** Methods and constructors: parameters in order; `optional` for `?` and defaults. */
	params?: { name: string; type: string; optional: boolean }[];
	/** Methods: declared return type; inferred (`Promise<...>` for async) when not written. */
	returnType?: string;
};
export type Decl = {
	name: string;
	kind: 'class' | 'interface' | 'function' | 'type' | 'enum' | 'const';
	file: string;
	/** 1 based line of the declaration name. */
	line: number;
	/** Functions: one line per overload. Consts: `name: type`. Types: `type X = ...`. */
	signature?: string;
	/** Classes and interfaces: the extended type(s), comma separated for interfaces. */
	extends?: string;
	/** Classes only. */
	implements?: string[];
	tags: string[];
	members: Member[];
};
export type Route = {
	method: 'get' | 'post' | 'put' | 'patch' | 'delete';
	path: string;
	file: string;
	/** 1 based line of the call. */
	line: number;
};
export type CodeModel = {
	decls: Decl[];
	/** Calls `<x>.<method>('/literal', ...)` in files under `src/app/`; other paths and files are ignored. */
	routes: Route[];
	/** Set when more than MAX_DECLS declarations exist; the rest are left out. */
	truncated?: boolean;
	/** Files that were skipped because they do not parse. */
	parseErrors?: { file: string; message: string }[];
};

export const MAX_DECLS = 2000;

const SOURCE_FILE = /\.m?ts$/;
const SKIPPED_FILE = /\.(test|spec|d)\.m?ts$/;

/** True when `src` is a real folder inside the project (not a symlink, not resolving elsewhere). */
function srcIsInside(dir: string): boolean {
	const src = path.join(dir, 'src');
	try {
		if (!lstatSync(src).isDirectory()) return false; // false for a symlink
		const rel = path.relative(realpathSync(dir), realpathSync(src));
		return !rel.startsWith('..') && !path.isAbsolute(rel);
	} catch {
		return false; // no src folder
	}
}

/** Source files under `src`, without tests or declaration files. Symlinks are skipped, never followed. */
function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	const walk = (abs: string) => {
		let entries;
		try {
			entries = readdirSync(abs, { withFileTypes: true });
		} catch {
			return; // unreadable
		}
		for (const e of entries) {
			const p = path.join(abs, e.name);
			if (e.isDirectory()) {
				if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p);
			} else if (e.isFile() && SOURCE_FILE.test(e.name) && !SKIPPED_FILE.test(e.name)) {
				out.push(p);
			}
		}
	};
	walk(path.join(dir, 'src'));
	return out.sort();
}

const ROUTE_METHODS: ReadonlySet<string> = new Set(['get', 'post', 'put', 'patch', 'delete']);

/** The text of a string or no substitution template literal, else null. */
const literal = (n: Node | undefined): string | null =>
	n && (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n))
		? n.getLiteralText()
		: null;

/** The path of `x.route('/p')` behind a chain like `x.route('/p').get(h).post(h)`, else null. */
function chainedRoutePath(obj: Node): string | null {
	while (Node.isCallExpression(obj)) {
		const callee = obj.getExpression();
		if (!Node.isPropertyAccessExpression(callee)) return null;
		if (callee.getName() === 'route') return literal(obj.getArguments()[0]);
		if (!ROUTE_METHODS.has(callee.getName())) return null;
		obj = callee.getExpression();
	}
	return null;
}

/**
 * Express style route registrations with a literal path in a file under `src/app/`, including
 * `app.route('/p').get(...)` chains. Paths are as written: a router's mount prefix is not added.
 */
function routesOf(sf: SourceFile, file: string): Route[] {
	if (!file.startsWith('src/app/')) return [];
	const out: Route[] = [];
	sf.forEachDescendant((n) => {
		if (!Node.isCallExpression(n)) return;
		const callee = n.getExpression();
		if (!Node.isPropertyAccessExpression(callee)) return;
		const method = callee.getName();
		if (!ROUTE_METHODS.has(method)) return;
		const p = literal(n.getArguments()[0]) ?? chainedRoutePath(callee.getExpression());
		// `cache.get('key')` is not a route
		if (p === null || !p.startsWith('/')) return;
		// The name's line, not the chain's start: `app\n\t.route('/x')\n\t.get(...)` reports `.get`.
		const line = callee.getNameNode().getStartLineNumber();
		out.push({ method: method as Route['method'], path: p, file, line });
	});
	// A chain visits its outer (later) call first; report in source order.
	return out.sort((a, b) => a.line - b.line);
}

const stripImports = (t: string) => t.replace(/import\("[^"]*"\)\./g, '');

/** Checker type text, with `import("/abs/path").` qualifiers removed. */
const inferred = (n: Node): string => stripImports(n.getType().getText(n));

/** The written type, else the inferred one. */
const typeText = (n: Node & { getTypeNode(): Node | undefined }): string =>
	n.getTypeNode()?.getText() ?? inferred(n);

/** `a?: A` without modifiers and initialisers. */
const paramText = (p: ParameterDeclaration): string =>
	`${p.isRestParameter() ? '...' : ''}${p.getName()}${
		p.hasQuestionToken() || p.hasInitializer() ? '?' : ''
	}: ${typeText(p)}`;

/** Declared return type, else the inferred one. */
const returnTypeOf = (n: ReturnTypedNode & Node) =>
	n.getReturnTypeNode()?.getText() ?? stripImports(n.getReturnType().getText(n));

/** Parameters of a callable as structured data. */
const paramList = (n: Node): NonNullable<Member['params']> =>
	Node.isParametered(n)
		? n.getParameters().map((p) => ({
				name: p.getName(),
				type: typeText(p),
				optional: p.hasQuestionToken() || p.hasInitializer()
			}))
		: [];

/** `params` and `returnType` of a method or method signature. */
const callableParts = (n: Node): Pick<Member, 'params' | 'returnType'> => ({
	params: paramList(n),
	...(Node.isReturnTyped(n) ? { returnType: returnTypeOf(n) } : {})
});

/** `name<T>(a: A): R` from the declaration, never the body. */
function callableSignature(name: string, n: Node): string {
	const tps = Node.isTypeParametered(n) ? n.getTypeParameters().map((t) => t.getText()) : [];
	const params = Node.isParametered(n) ? n.getParameters().map(paramText) : [];
	const ret =
		Node.isReturnTyped(n) && !Node.isConstructorDeclaration(n) ? returnTypeOf(n) : undefined;
	return `${name}${tps.length ? `<${tps.join(', ')}>` : ''}(${params.join(', ')})${ret ? `: ${ret}` : ''}`;
}

const visibilityOf = (n: Node): Member['visibility'] => {
	// parameter properties (`constructor(private x: number)`) are not Scoped nodes in ts-morph
	const s = Node.isScoped(n) || Node.isParameterDeclaration(n) ? n.getScope() : undefined;
	return s === 'private' || s === 'protected' ? s : 'public';
};

/** `name?: type`, without initialiser. */
const propertySignature = (name: string, optional: boolean, type: string): string =>
	`${name}${optional ? '?' : ''}: ${type}`;

/** The overload signatures when there are any, else the declaration itself (never the implementation). */
const overloadsOf = <T extends Node & { getOverloads(): T[] }>(n: T): T[] => {
	const o = n.getOverloads();
	return o.length ? o : [n];
};

function classMembers(c: ClassDeclaration, includePrivate: boolean): Member[] {
	const out: Member[] = [];
	for (const ctor of c.getConstructors()) {
		for (const o of overloadsOf(ctor)) {
			out.push({
				name: 'constructor',
				kind: 'constructor',
				signature: callableSignature('constructor', o),
				static: false,
				visibility: visibilityOf(o),
				params: paramList(o)
			});
		}
		for (const p of ctor.getParameters()) {
			if (!p.isParameterProperty()) continue;
			out.push({
				name: p.getName(),
				kind: 'property',
				signature: propertySignature(p.getName(), p.hasQuestionToken(), typeText(p)),
				static: false,
				visibility: visibilityOf(p),
				type: typeText(p),
				optional: p.hasQuestionToken()
			});
		}
	}
	for (const m of c.getMembers()) {
		if (Node.isMethodDeclaration(m)) {
			for (const o of overloadsOf(m)) {
				out.push({
					name: m.getName(),
					kind: 'method',
					signature: callableSignature(m.getName(), o),
					static: m.isStatic(),
					visibility: visibilityOf(m),
					...callableParts(o)
				});
			}
		} else if (Node.isPropertyDeclaration(m)) {
			out.push({
				name: m.getName(),
				kind: 'property',
				signature: propertySignature(m.getName(), m.hasQuestionToken(), typeText(m)),
				static: m.isStatic(),
				visibility: visibilityOf(m),
				type: typeText(m),
				optional: m.hasQuestionToken()
			});
		} else if (Node.isGetAccessorDeclaration(m)) {
			const type = m.getReturnTypeNode()?.getText() ?? inferred(m);
			out.push({
				name: m.getName(),
				kind: 'property',
				signature: propertySignature(m.getName(), false, type),
				static: m.isStatic(),
				visibility: visibilityOf(m),
				type,
				optional: false
			});
		}
	}
	// `#name` members are private at runtime; TypeScript reports them as public
	return out.filter(
		(m) => (includePrivate || m.visibility !== 'private') && !m.name.startsWith('#')
	);
}

/** A signature node as written, without the trailing separator. */
const written = (n: Node) => n.getText().replace(/[;,]\s*$/, '');

function interfaceMembers(i: InterfaceDeclaration): Member[] {
	const out: Member[] = [];
	for (const m of i.getMembers()) {
		if (Node.isMethodSignature(m)) {
			out.push({
				name: m.getName(),
				kind: 'method',
				signature: callableSignature(m.getName(), m),
				static: false,
				visibility: 'public',
				...callableParts(m)
			});
		} else if (Node.isPropertySignature(m)) {
			out.push({
				name: m.getName(),
				kind: 'property',
				signature: propertySignature(m.getName(), m.hasQuestionToken(), typeText(m)),
				static: false,
				visibility: 'public',
				type: typeText(m),
				optional: m.hasQuestionToken()
			});
		} else if (Node.isCallSignatureDeclaration(m)) {
			out.push({
				name: '()',
				kind: 'method',
				signature: callableSignature('', m),
				static: false,
				visibility: 'public'
			});
		} else if (Node.isIndexSignatureDeclaration(m)) {
			out.push({
				name: '[]',
				kind: 'property',
				signature: written(m),
				static: false,
				visibility: 'public'
			});
		}
	}
	return out;
}

const enumMembers = (e: EnumDeclaration): Member[] =>
	e.getMembers().map((m) => ({
		name: m.getName(),
		kind: 'property',
		signature: m.getText(),
		static: true,
		visibility: 'public'
	}));

/** JSDoc tags as written, e.g. `@trace REQ-3`, on one line each. */
function jsDocTags(n: Node): string[] {
	if (!Node.isJSDocable(n)) return [];
	return n
		.getJsDocs()
		.flatMap((d) => d.getTags())
		.map((t) =>
			t
				.getText()
				.replace(/\s*\n\s*\*?\s*/g, ' ')
				.trim()
		);
}

/**
 * One export as a Decl. Not listed on purpose: namespaces and `export default <expression>`.
 * `nodes` are all declarations behind one export name (overloads arrive as several function nodes).
 */
function describe(
	exportName: string,
	nodes: ExportedDeclarations[],
	file: string,
	includePrivate: boolean
): Decl | undefined {
	const node = nodes.find((n) => !(n instanceof FunctionDeclaration) || n.hasBody()) ?? nodes[0];
	const declared = Node.hasName(node) ? node.getName() : undefined;
	const name = exportName === 'default' && declared ? declared : exportName;
	const line = ((Node.hasName(node) ? node.getNameNode() : undefined) ?? node).getStartLineNumber();
	if (node instanceof ClassDeclaration) {
		const ext = node.getExtends()?.getText();
		const impl = node.getImplements().map((t) => t.getText());
		return {
			name,
			kind: 'class',
			file,
			line,
			...(ext ? { extends: ext } : {}),
			...(impl.length ? { implements: impl } : {}),
			tags: jsDocTags(node),
			members: classMembers(node, includePrivate)
		};
	}
	if (node instanceof InterfaceDeclaration) {
		const ext = node
			.getExtends()
			.map((t) => t.getText())
			.join(', ');
		return {
			name,
			kind: 'interface',
			file,
			line,
			...(ext ? { extends: ext } : {}),
			tags: jsDocTags(node),
			members: interfaceMembers(node)
		};
	}
	if (node instanceof EnumDeclaration) {
		return { name, kind: 'enum', file, line, tags: jsDocTags(node), members: enumMembers(node) };
	}
	if (node instanceof TypeAliasDeclaration) {
		return {
			name,
			kind: 'type',
			file,
			line,
			signature: `type ${name} = ${node.getTypeNodeOrThrow().getText()}`,
			tags: jsDocTags(node),
			members: []
		};
	}
	if (node instanceof FunctionDeclaration) {
		const sigs = nodes.filter((n): n is FunctionDeclaration => n instanceof FunctionDeclaration);
		// overloads when present, else the single declaration
		const shown = sigs.some((n) => !n.hasBody()) ? sigs.filter((n) => !n.hasBody()) : sigs;
		return {
			name,
			kind: 'function',
			file,
			line,
			signature: shown.map((n) => callableSignature(name, n)).join('\n'),
			tags: jsDocTags(shown[0]),
			members: []
		};
	}
	if (node instanceof VariableDeclaration) {
		const init = node.getInitializer();
		// JSDoc sits on the variable statement, not on the declaration
		const tags = jsDocTags(node.getVariableStatement() ?? node);
		if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
			return {
				name,
				kind: 'function',
				file,
				line,
				signature: callableSignature(name, init),
				tags,
				members: []
			};
		}
		return {
			name,
			kind: 'const',
			file,
			line,
			signature: `${name}: ${typeText(node)}`,
			tags,
			members: []
		};
	}
	return undefined;
}

/** The first syntax error of a file as `message (line N)`, or undefined when it parses. */
function syntaxError(project: Project, sf: SourceFile): string | undefined {
	const d = project.getProgram().getSyntacticDiagnostics(sf)[0];
	if (!d) return undefined;
	const m = d.getMessageText();
	return `${typeof m === 'string' ? m : m.getMessageText()} (line ${d.getLineNumber() ?? '?'})`;
}

const byFileThenName = (a: Decl, b: Decl) =>
	a.file === b.file ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.file < b.file ? -1 : 1;

/**
 * Exported declarations under `<dir>/src` as signatures and JSDoc tags, never bodies. Sorted by file, then name.
 * Private class members are left out unless `includePrivate` (detect_drift needs them).
 */
export function buildCodeModel(
	dir: string,
	{ includePrivate = false }: { includePrivate?: boolean } = {}
): CodeModel {
	if (!srcIsInside(dir)) return { decls: [], routes: [] };
	// Only the files under src are read. skipFileDependencyResolution keeps ts-morph from adding
	// imported files; noResolve and types: [] keep the type checker from reading them (or @types)
	// itself, so an import from outside the project types as any instead of leaking its content.
	const project = new Project({
		skipAddingFilesFromTsConfig: true,
		skipFileDependencyResolution: true,
		compilerOptions: { allowJs: false, noResolve: true, types: [] }
	});
	const files = sourceFiles(dir).map((abs) => ({ abs, sf: project.addSourceFileAtPath(abs) }));
	const decls: Decl[] = [];
	const routes: Route[] = [];
	const parseErrors: { file: string; message: string }[] = [];
	for (const { abs, sf } of files) {
		const file = path.relative(dir, abs).split(path.sep).join('/');
		const error = syntaxError(project, sf);
		if (error) {
			parseErrors.push({ file, message: error });
			continue;
		}
		routes.push(...routesOf(sf, file));
		for (const [name, all] of sf.getExportedDeclarations()) {
			// re-exports are listed where they are declared
			const nodes = all.filter((n) => n.getSourceFile() === sf);
			if (!nodes.length) continue;
			const d = describe(name, nodes, file, includePrivate);
			if (d) decls.push(d);
		}
	}
	decls.sort(byFileThenName);
	const truncated = decls.length > MAX_DECLS;
	return {
		decls: (truncated ? decls.slice(0, MAX_DECLS) : decls).map(clipDecl),
		routes,
		...(truncated ? { truncated } : {}),
		...(parseErrors.length ? { parseErrors } : {})
	};
}

/** Longest signature kept; longer ones (huge inferred or written types) end in an ellipsis. */
export const MAX_SIGNATURE = 300;

const clip = (s: string) => (s.length > MAX_SIGNATURE ? `${s.slice(0, MAX_SIGNATURE)}…` : s);

const clipDecl = (d: Decl): Decl => ({
	...d,
	...(d.signature === undefined ? {} : { signature: clip(d.signature) }),
	members: d.members.map((m) => ({ ...m, signature: clip(m.signature) }))
});

export const codeModel = defineTool({
	name: 'code_model',
	description:
		'List the exported classes, interfaces, functions, types, enums and consts under src/ with signatures, extends/implements and JSDoc tags (for example @trace REQ-3). Also lists the routes (method, path, file, line) registered under src/app/. Never returns function bodies. Takes no input.',
	input: z.strictObject({}),
	async run({ store }) {
		return buildCodeModel(store.dir);
	}
});
