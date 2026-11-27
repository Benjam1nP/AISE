import ts from 'typescript';

export const BUILTIN_TYPES: Set<string> = new Set([
	'string',
	'number',
	'boolean',
	'void',
	'null',
	'undefined',
	'unknown',
	'never',
	'bigint',
	'Date',
	'Promise',
	'Array',
	'Record',
	'Map',
	'Set',
	'ReadonlyArray',
	'Partial',
	'Readonly',
	'Required',
	'Pick',
	'Omit',
	'Exclude',
	'Extract',
	'NonNullable',
	'ReturnType',
	'Parameters',
	'Awaited',
	'ReadonlyMap',
	'ReadonlySet',
	'PromiseLike',
	'Uint8Array',
	'Error',
	'Buffer',
	// from ws, a runtime package of generated projects: a gateway holds its sockets
	'WebSocket'
]);

export type NormaliseResult = { ok: true; normal: string } | { ok: false; error: string };

class Rejection extends Error {}

const fail = (message: string): never => {
	throw new Rejection(message);
};

function leftmost(name: ts.EntityName): ts.Identifier {
	return ts.isIdentifier(name) ? name : leftmost(name.left);
}

function unknownTypeMessage(name: string, known: Set<string>): string {
	const lower = name.toLowerCase();
	const hint = [...BUILTIN_TYPES, ...known].find((c) => c.toLowerCase() === lower);
	return `unknown type "${name}"` + (hint ? `, did you mean "${hint}"?` : '');
}

/** Rejects anything outside the allowed vocabulary; `local` holds type parameters declared inside the type. */
function validate(
	node: ts.Node,
	known: Set<string>,
	local: Set<string>,
	anyIdentifier: boolean
): void {
	if (node.kind === ts.SyntaxKind.AnyKeyword) fail('"any" is not allowed, use "unknown"');
	if (ts.isTypeQueryNode(node) || ts.isImportTypeNode(node)) {
		fail('"typeof" and import types are not supported, use a class name');
	}
	if (ts.isTypeReferenceNode(node)) {
		const name = leftmost(node.typeName).text;
		const isQualified = !ts.isIdentifier(node.typeName);
		const allowed = anyIdentifier
			? true
			: isQualified
				? known.has(name) || local.has(name)
				: BUILTIN_TYPES.has(name) || known.has(name) || local.has(name);
		if (!allowed) fail(unknownTypeMessage(name, known));
	}
	ts.forEachChild(node, (child) => validate(child, known, local, anyIdentifier));
}

function collectTypeParameters(node: ts.Node, into: Set<string>): void {
	if (ts.isTypeParameterDeclaration(node)) into.add(node.name.text);
	ts.forEachChild(node, (child) => collectTypeParameters(child, into));
}

/** Literals are rebuilt so the printer does not reuse the original quote style or number text. */
function canonicalise(context: ts.TransformationContext): ts.Transformer<ts.Node> {
	const { factory } = context;
	const visit = (node: ts.Node): ts.Node => {
		if (ts.isStringLiteral(node)) return factory.createStringLiteral(node.text);
		if (ts.isNumericLiteral(node)) return factory.createNumericLiteral(node.text);
		if (
			ts.isTypeReferenceNode(node) &&
			ts.isIdentifier(node.typeName) &&
			node.typeName.text === 'Array' &&
			node.typeArguments?.length === 1
		) {
			return factory.createArrayTypeNode(ts.visitNode(node.typeArguments[0], visit) as ts.TypeNode);
		}
		const visited = ts.visitEachChild(node, visit, context);
		if (
			ts.isTypeLiteralNode(visited) ||
			ts.isMappedTypeNode(visited) ||
			ts.isTupleTypeNode(visited)
		) {
			ts.setEmitFlags(visited, ts.EmitFlags.SingleLine);
		}
		return visited;
	};
	return (root) => ts.visitNode(root, visit)!;
}

export function normaliseType(type: string, known: Set<string>): NormaliseResult {
	return normalise(type, known, false);
}

/**
 * Normal form of a type found in code, to compare with the design's. Like `normaliseType`, but any
 * identifier is allowed (`DatabaseSync`, `Express.Request`); on failure the text with whitespace
 * removed. `classNames` is kept for symmetry with `normaliseType` and only used for hints, which are dropped here.
 */
export function normaliseCodeType(type: string, classNames: Set<string>): string {
	const result = normalise(type, classNames, true);
	return result.ok ? result.normal : type.replace(/\s+/g, '');
}

function normalise(type: string, known: Set<string>, anyIdentifier: boolean): NormaliseResult {
	try {
		const source = ts.createSourceFile(
			'type.ts',
			`type __T = ${type};`,
			ts.ScriptTarget.Latest,
			true
		);
		const diagnostics = (source as unknown as { parseDiagnostics: ts.Diagnostic[] })
			.parseDiagnostics;
		const [alias] = source.statements;
		if (
			diagnostics.length > 0 ||
			source.statements.length !== 1 ||
			!ts.isTypeAliasDeclaration(alias) ||
			alias.typeParameters
		) {
			const detail = diagnostics[0]
				? `: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ')}`
				: '';
			return { ok: false, error: `invalid type syntax${detail}` };
		}

		const local = new Set<string>();
		collectTypeParameters(alias.type, local);
		validate(alias.type, known, local, anyIdentifier);

		const result = ts.transform(alias.type, [canonicalise]);
		const printer = ts.createPrinter({ removeComments: true });
		const normal = printer.printNode(ts.EmitHint.Unspecified, result.transformed[0], source);
		result.dispose();
		if (/[\r\n]/.test(normal)) return { ok: false, error: 'multi-line types are not supported' };
		return { ok: true, normal };
	} catch (e) {
		if (e instanceof Rejection) return { ok: false, error: e.message };
		throw e;
	}
}
