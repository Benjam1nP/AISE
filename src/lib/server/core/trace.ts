import type { TestResult } from './docker/parse';
import { clientComponents, PAGE } from './client';
import type { Component, DesignDoc } from './schemas/design';
import type { Requirement } from './schemas/requirements';
import { parseTestName } from './test-state';
import type { Decl } from './tools/code-model';

/** Everything a trace is computed from; all of it as stored, nothing read here. */
export type TraceInput = {
	requirements: Requirement[];
	design: DesignDoc | null;
	/** Code model declarations; only their `@trace` tags, file and line are used. */
	decls: Decl[];
	/** Results of the last stored P5 run. */
	tests: TestResult[];
	/** Text of public/index.html, the code of the client components; null when it does not exist. */
	page: string | null;
};

export type TraceKind =
	'requirement' | 'useCase' | 'sequence' | 'class' | 'component' | 'node' | 'actor';
export type TraceDesign = {
	actors: string[];
	useCases: string[];
	classes: string[];
	components: string[];
	nodes: string[];
	sequences: string[];
};
export type CodeLocation = { file: string; line: number; name: string };
export type TraceTest = {
	file: string;
	line?: number;
	name: string;
	status: TestResult['status'];
};
export type Trace = {
	id: string;
	kind: TraceKind;
	requirements: string[];
	design: TraceDesign;
	code: CodeLocation[];
	tests: TraceTest[];
};
export type MatrixRow = {
	reqId: string;
	title: string;
	/** Design element IDs: use cases, classes, components, nodes, then sequences. */
	design: string[];
	files: string[];
	tests: { name: string; status: TestResult['status'] }[];
	/** No use case, class, component or node names the requirement. */
	noDesign: boolean;
	/** No passed or failed test and no manual todo for any of its criteria. */
	noTest: boolean;
};

const EMPTY: DesignDoc = {
	actors: [],
	useCases: [],
	classes: [],
	components: [],
	nodes: [],
	links: [],
	sequences: []
};

const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort();
const has = (list: string[], id: string) => list.includes(id);
const DSN = /^DSN-\d{3}$/;

const TRACE_TAG = /^@trace(?:\s|$)/;
/** The `<!-- @trace ... -->` comment of the browser page. */
const PAGE_TAG = /<!--\s*@trace\s/;
/** Line of the page's `@trace` comment, else 1. */
const pageLine = (text: string) => text.split('\n').findIndex((l) => PAGE_TAG.test(l)) + 1 || 1;
/** A whole REQ or DSN ID, not part of a longer token such as `XREQ-001` or `REQ-0012`. */
const TAG_ID = /(?<![\w-])(?:REQ|DSN)-\d{3}(?![\w-])/g;

/** IDs in a declaration's `@trace` tags (REQ and DSN alike). */
const tagIds = (d: Decl): string[] =>
	d.tags.filter((t) => TRACE_TAG.test(t)).flatMap((t) => t.match(TAG_ID) ?? []);

/** Use case ID that starts a test's full name, from `describe('UC-001 ...')`. */
const describedUseCase = (t: TestResult) => /^(UC-\d{3})(?:\s|$)/.exec(t.name)?.[1];

/**
 * The seed of a trace: the requirements, design elements and test links that follow from the ID
 * by the rules of the trace table. Null when the ID names nothing.
 */
type Seed = {
	kind: TraceKind;
	requirements: string[];
	design: TraceDesign;
	/** Code: declarations whose tag names one of these IDs. */
	codeIds: string[];
	/** Tests: AC tests of these requirements, scenario tests of these sequences, tests under these use cases. */
	testReqs: string[];
	testSeqs: string[];
	testUcs: string[];
	/** Client components: their code is the page, public/index.html. */
	pages: Component[];
};

const design = (p: Partial<TraceDesign>): TraceDesign => ({
	actors: sorted(p.actors ?? []),
	useCases: sorted(p.useCases ?? []),
	classes: sorted(p.classes ?? []),
	components: sorted(p.components ?? []),
	nodes: sorted(p.nodes ?? []),
	sequences: sorted(p.sequences ?? [])
});

/** Classes that send or receive a message of these sequences. */
const sequenceClasses = (d: DesignDoc, seqs: DesignDoc['sequences']) =>
	seqs
		.flatMap((s) => s.messages.flatMap((m) => [m.fromId, m.toId]))
		.filter((id) => DSN.test(id) && d.classes.some((c) => c.id === id));

/** Client components naming one of these requirements. */
const clientsServing = (d: DesignDoc, reqIds: string[]) =>
	clientComponents(d).filter((k) => k.reqIds.some((r) => has(reqIds, r)));

function seed(id: string, reqs: Requirement[], d: DesignDoc): Seed | null {
	const r = reqs.find((x) => x.id === id);
	if (r) {
		const ucs = d.useCases.filter((u) => has(u.reqIds, id));
		const classes = d.classes.filter((c) => has(c.reqIds, id)).map((c) => c.id);
		return {
			kind: 'requirement',
			requirements: [id],
			design: design({
				useCases: ucs.map((u) => u.id),
				classes,
				components: d.components.filter((c) => has(c.reqIds, id)).map((c) => c.id),
				nodes: d.nodes.filter((n) => has(n.reqIds, id)).map((n) => n.id),
				sequences: d.sequences.filter((s) => ucs.some((u) => u.id === s.useCaseId)).map((s) => s.id)
			}),
			codeIds: [id, ...classes],
			testReqs: [id],
			testSeqs: [],
			testUcs: [],
			pages: clientsServing(d, [id])
		};
	}
	const uc = d.useCases.find((x) => x.id === id);
	if (uc) {
		const seqs = d.sequences.filter((s) => s.useCaseId === id);
		const classes = sequenceClasses(d, seqs);
		return {
			kind: 'useCase',
			requirements: uc.reqIds,
			design: design({
				actors: uc.actorIds,
				useCases: [id],
				classes,
				sequences: seqs.map((s) => s.id)
			}),
			codeIds: classes,
			testReqs: uc.reqIds,
			testSeqs: seqs.map((s) => s.id),
			testUcs: [id],
			pages: clientsServing(d, uc.reqIds)
		};
	}
	const seq = d.sequences.find((x) => x.id === id);
	if (seq) {
		const ucReqs = d.useCases.find((u) => u.id === seq.useCaseId)?.reqIds ?? [];
		const classes = sequenceClasses(d, [seq]);
		return {
			kind: 'sequence',
			requirements: ucReqs,
			design: design({ useCases: [seq.useCaseId], classes, sequences: [id] }),
			codeIds: classes,
			testReqs: [],
			testSeqs: [id],
			testUcs: [],
			pages: []
		};
	}
	const c = d.classes.find((x) => x.id === id);
	if (c) {
		const comps = d.components.filter((k) => has(k.classIds, id));
		return {
			kind: 'class',
			requirements: c.reqIds,
			design: design({
				classes: [id],
				components: comps.map((k) => k.id),
				nodes: comps.map((k) => k.nodeId),
				sequences: d.sequences
					.filter((s) => s.messages.some((m) => m.fromId === id || m.toId === id))
					.map((s) => s.id)
			}),
			codeIds: [id],
			testReqs: c.reqIds,
			testSeqs: [],
			testUcs: [],
			pages: []
		};
	}
	const comp = d.components.find((x) => x.id === id);
	if (comp) {
		return {
			kind: 'component',
			requirements: comp.reqIds,
			design: design({ classes: comp.classIds, components: [id], nodes: [comp.nodeId] }),
			codeIds: comp.classIds,
			testReqs: comp.reqIds,
			testSeqs: [],
			testUcs: [],
			pages: clientComponents(d).filter((k) => k.id === id)
		};
	}
	const node = d.nodes.find((x) => x.id === id);
	if (node) {
		const comps = d.components.filter((k) => k.nodeId === id);
		const classes = comps.flatMap((k) => k.classIds);
		return {
			kind: 'node',
			requirements: node.reqIds,
			design: design({ classes, components: comps.map((k) => k.id), nodes: [id] }),
			codeIds: classes,
			testReqs: node.reqIds,
			testSeqs: [],
			testUcs: [],
			pages: clientComponents(d).filter((k) => k.nodeId === id)
		};
	}
	const actor = d.actors.find((x) => x.id === id);
	if (actor) {
		const ucs = d.useCases.filter((u) => has(u.actorIds, id));
		return {
			kind: 'actor',
			requirements: ucs.flatMap((u) => u.reqIds),
			design: design({ actors: [id], useCases: ucs.map((u) => u.id) }),
			codeIds: [],
			testReqs: [],
			testSeqs: [],
			testUcs: [],
			pages: []
		};
	}
	return null;
}

const byFileLine = <T extends { file: string; line?: number; name: string }>(a: T, b: T) =>
	a.file !== b.file
		? a.file < b.file
			? -1
			: 1
		: (a.line ?? 0) !== (b.line ?? 0)
			? (a.line ?? 0) - (b.line ?? 0)
			: a.name < b.name
				? -1
				: a.name > b.name
					? 1
					: 0;

/** Whether an AC test names a criterion that exists, like `coverage`. */
const criterionExists = (reqs: Requirement[], reqId: string, n: number) =>
	n <= (reqs.find((r) => r.id === reqId)?.acceptanceCriteria.length ?? 0);

function linkedTests(s: Seed, input: TraceInput): TraceTest[] {
	return input.tests
		.filter((t) => t.status !== 'skipped')
		.filter((t) => {
			const p = parseTestName(t.title);
			if (p?.kind === 'ac')
				return has(s.testReqs, p.reqId) && criterionExists(input.requirements, p.reqId, p.n);
			if (p?.kind === 'scenario' && has(s.testSeqs, p.seqId)) return true;
			const uc = describedUseCase(t);
			return uc !== undefined && has(s.testUcs, uc);
		})
		.map((t) => ({
			file: t.file,
			...(t.line === undefined ? {} : { line: t.line }),
			name: t.name,
			status: t.status
		}))
		.sort(byFileLine);
}

/**
 * Trace query (design spec section 7): from a REQ, UC, SEQ, DSN or ACT ID to the linked
 * requirements, design elements, code locations (`@trace` tags) and tests with their last status.
 * Deterministic and pure. Null when the ID names nothing in the requirements or the design.
 */
export function traceId(id: string, input: TraceInput): Trace | null {
	const s = seed(id, input.requirements, input.design ?? EMPTY);
	if (!s) return null;
	const page = input.page;
	const pages =
		page === null ? [] : s.pages.map((k) => ({ file: PAGE, line: pageLine(page), name: k.name }));
	const code = input.decls
		.filter((d) => tagIds(d).some((t) => has(s.codeIds, t)))
		.map((d) => ({ file: d.file, line: d.line, name: d.name }))
		.concat(pages)
		.sort(byFileLine);
	return {
		id,
		kind: s.kind,
		requirements: sorted(s.requirements),
		design: s.design,
		code,
		tests: linkedTests(s, input)
	};
}

/** Every REQ, UC, SEQ, DSN and ACT ID of the project with its trace, for the UI's links. */
export function traceAll(input: TraceInput): Record<string, Trace> {
	const d = input.design ?? EMPTY;
	const ids = [
		...input.requirements.map((r) => r.id),
		...[d.actors, d.useCases, d.classes, d.components, d.nodes, d.sequences].flatMap((l) =>
			l.map((x) => x.id)
		)
	];
	const out: Record<string, Trace> = {};
	for (const id of ids) {
		const t = traceId(id, input);
		if (t) out[id] = t;
	}
	return out;
}

/** Whether a stored result tests a criterion of `reqId`: run (passed or failed) or a manual todo, like `coverage`. */
const testsReq = (t: TestResult, r: Requirement) => {
	const p = parseTestName(t.title);
	if (p?.kind !== 'ac' || p.reqId !== r.id || p.n > r.acceptanceCriteria.length) return false;
	return t.status === 'passed' || t.status === 'failed' || (t.status === 'todo' && p.manual);
};

/** One row per requirement, in requirements order, with the flags for missing design and tests. */
export function traceMatrix(input: TraceInput): MatrixRow[] {
	return input.requirements.map((r) => {
		const t = traceId(r.id, input)!;
		const d = t.design;
		return {
			reqId: r.id,
			title: r.title,
			design: [...d.useCases, ...d.classes, ...d.components, ...d.nodes, ...d.sequences],
			files: sorted(t.code.map((c) => c.file)),
			tests: t.tests.map((x) => ({ name: x.name, status: x.status })),
			noDesign: d.useCases.length + d.classes.length + d.components.length + d.nodes.length === 0,
			noTest: !input.tests.some((x) => testsReq(x, r))
		};
	});
}
