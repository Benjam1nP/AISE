import ts from 'typescript';
import { clientComponents } from '../core/client';
import type { DeploymentNode, DesignClass, DesignDoc } from '../core/schemas/design';

/** One generated class file: where it goes and which design classes its code refers to. */
export type FilePlan = {
	classId: string;
	name: string;
	path: string;
	component: string;
	/** Class IDs this class depends on (relation targets and classes named in its types), sorted. */
	uses: string[];
};

/** `Task API`, `TaskApi` and `TASK API` all become `task-api`; `HTTPServer` becomes `http-server`. */
export function kebab(name: string): string {
	return name
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((w) => w.toLowerCase())
		.join('-');
}

/**
 * Why a component name cannot name its folder under src/, or null when it can. The folder must not
 * be empty, and `app` is reserved for the wiring in src/app/.
 */
export function folderError(name: string): string | null {
	const folder = kebab(name);
	if (folder !== '' && folder !== 'app') return null;
	return `the component name must give a folder name that is not empty and not "app"; "${name}" gives "${folder}", so rename it`;
}

/**
 * The name a service node's entry file, start script and environment variables take: `Live Update
 * Server` gives `live-update-server`. Notes in parentheses are dropped (`API Server (owns SQLite)`
 * gives `api-server`) unless nothing else is left; a name without letters or digits gives the ID.
 */
export function nodeKebab(node: Pick<DeploymentNode, 'id' | 'name'>): string {
	return kebab(node.name.replace(/\([^)]*\)/g, ' ')) || kebab(node.name) || node.id.toLowerCase();
}

/**
 * Why a service node's name cannot name its entry `src/app/<name>.ts`, or null when it can: the
 * entry name starts with a letter (it also names environment variables), and `main` and `app` are
 * taken by the primary node's files.
 */
export function entryError(node: Pick<DeploymentNode, 'id' | 'name'>): string | null {
	const entry = nodeKebab(node);
	if (/^[a-z]/.test(entry) && entry !== 'main' && entry !== 'app') return null;
	return `the node name must give an entry file name that starts with a letter and is not "main" or "app"; "${node.name}" gives "${entry}", so rename it`;
}

/** Leftmost name of every type reference in a type, so `Promise<Task[]>` gives Promise and Task. */
function typeNames(type: string): string[] {
	const source = ts.createSourceFile(
		'type.ts',
		`type __T = ${type};`,
		ts.ScriptTarget.Latest,
		true
	);
	const [alias] = source.statements;
	if (!alias || !ts.isTypeAliasDeclaration(alias)) return [];
	const names: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isTypeReferenceNode(node)) {
			let name = node.typeName;
			while (ts.isQualifiedName(name)) name = name.left;
			names.push(name.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(alias.type);
	return names;
}

function usesOf(cls: DesignClass, classIdByName: Map<string, string>): string[] {
	const types = [
		...cls.attributes.map((a) => a.type),
		...cls.methods.flatMap((m) => [...m.params.map((p) => p.type), m.returnType])
	];
	const ids = new Set(cls.relations.map((r) => r.targetId));
	for (const type of types) {
		for (const name of typeNames(type)) {
			const id = classIdByName.get(name);
			if (id !== undefined) ids.add(id);
		}
	}
	ids.delete(cls.id);
	return [...ids].sort();
}

/**
 * One planned file per design class, in design order. A class outside every component gets no
 * file; validateDesign rejects such designs before P4 runs. Neither does a class on a client node:
 * the browser's code is public/index.html, and validateDesign rejects such classes too, so this only
 * meets a design saved before that rule. Throws for a service component name that gives
 * no usable folder (a client component gets no folder), and when two paths are the same file (names compared case insensitively).
 */
export function planCode(design: DesignDoc): FilePlan[] {
	const clients = new Set(clientComponents(design));
	for (const comp of design.components) {
		if (clients.has(comp)) continue;
		const problem = folderError(comp.name);
		if (problem !== null) throw new Error(`Cannot plan component "${comp.name}": ${problem}.`);
	}
	const classIdByName = new Map(design.classes.map((c): [string, string] => [c.name, c.id]));
	const plans: FilePlan[] = [];
	const pathByKey = new Map<string, string>();
	for (const cls of design.classes) {
		const comp = design.components.find((c) => c.classIds.includes(cls.id));
		if (!comp || clients.has(comp)) continue;
		const path = `src/${kebab(comp.name)}/${cls.name}.ts`;
		const first = pathByKey.get(path.toLowerCase());
		if (first !== undefined)
			throw new Error(`Two classes would share one file: ${first} and ${path}.`);
		pathByKey.set(path.toLowerCase(), path);
		plans.push({
			classId: cls.id,
			name: cls.name,
			path,
			component: comp.name,
			uses: usesOf(cls, classIdByName)
		});
	}
	return plans;
}

/** Planned file per class ID, the view the drift check compares code against. */
export function planPaths(design: DesignDoc): Record<string, string> {
	return Object.fromEntries(planCode(design).map((p) => [p.classId, p.path]));
}
