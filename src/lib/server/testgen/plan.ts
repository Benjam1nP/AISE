import type { DesignDoc, Sequence } from '../core/schemas/design';
import type { Requirement, RequirementsDoc } from '../core/schemas/requirements';

/** One acceptance criterion as a test to write, e.g. REQ-003 AC2 is the second criterion of REQ-003. */
export type Criterion = {
	reqId: string;
	n: number;
	text: string;
	/** True for non-functional requirements, which may only fit a manual todo. */
	manualHint: boolean;
};

/** One planned test file: a use case (UC ID) or a requirement that no use case links (REQ ID). */
export type TestFilePlan = {
	id: string;
	name: string;
	path: string;
	criteria: Criterion[];
	/** Sequences that realise the use case, sorted. Empty for a requirement file. */
	sequenceIds: string[];
	/** Classes linked to the plan's requirements or receiving its sequence calls, sorted and unique. */
	classIds: string[];
};

function criteriaOf(req: Requirement): Criterion[] {
	return req.acceptanceCriteria.map((text, i) => ({
		reqId: req.id,
		n: i + 1,
		// the title `REQ-001 AC1: <text>` must parse, and `parseTestName` wants a non space after the colon
		text: text.trim(),
		manualHint: req.type === 'non-functional'
	}));
}

/** Classes whose reqIds meet `reqIds`, plus the receivers of `sequences` that are classes. */
function classIdsFor(design: DesignDoc, reqIds: Set<string>, sequences: Sequence[]): string[] {
	const knownClass = new Set(design.classes.map((c) => c.id));
	const linked = design.classes
		.filter((c) => c.reqIds.some((id) => reqIds.has(id)))
		.map((c) => c.id);
	const receivers = sequences
		.flatMap((s) => s.messages.map((m) => m.toId))
		.filter((id) => knownClass.has(id));
	return [...new Set([...linked, ...receivers])].sort();
}

/**
 * One test file per use case, then one per requirement that no use case links. A requirement linked
 * to several use cases is tested only in the one with the lowest ID. Sorted by ID.
 */
export function planTests(reqs: RequirementsDoc, design: DesignDoc): TestFilePlan[] {
	const reqById = new Map(reqs.requirements.map((r) => [r.id, r]));
	const owner = new Map<string, string>();
	for (const uc of design.useCases) {
		for (const reqId of uc.reqIds) {
			const current = owner.get(reqId);
			if (current === undefined || uc.id < current) owner.set(reqId, uc.id);
		}
	}

	const useCasePlans = design.useCases.map((uc): TestFilePlan => {
		const reqIds = [...new Set(uc.reqIds)];
		const criteria = reqIds
			.filter((id) => owner.get(id) === uc.id)
			.flatMap((id) => {
				const req = reqById.get(id);
				return req ? criteriaOf(req) : [];
			});
		const sequences = design.sequences.filter((s) => s.useCaseId === uc.id);
		return {
			id: uc.id,
			name: uc.name,
			path: `test/${uc.id}.test.ts`,
			criteria,
			sequenceIds: sequences.map((s) => s.id).sort(),
			classIds: classIdsFor(design, new Set(reqIds), sequences)
		};
	});

	const requirementPlans = reqs.requirements
		.filter((req) => !owner.has(req.id))
		.map((req): TestFilePlan => ({
			id: req.id,
			name: req.title,
			path: `test/${req.id}.test.ts`,
			criteria: criteriaOf(req),
			sequenceIds: [],
			classIds: classIdsFor(design, new Set([req.id]), [])
		}));

	return [...useCasePlans, ...requirementPlans].sort((a, b) => {
		if (a.id === b.id) return 0;
		return a.id < b.id ? -1 : 1;
	});
}
