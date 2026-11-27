import { z } from 'zod';
import { clientComponents, clientNodeIds } from '../client';
import { designHash } from '../code-state';
import { ID_PATTERNS, nextId } from '../ids';
import { DesignDoc } from '../schemas/design';
import { RequirementsDoc } from '../schemas/requirements';
import type { PhaseStatus } from '../state';
import type { ProjectStore } from '../store';
import { DESIGN_PATH } from './design';
import { defineTool, ToolError } from './registry';

export const PROPOSALS_PATH = '.aise/design-proposals.json';
const MAX_PROPOSALS = 5;

const ProposalKind = z.enum([
	'missing_class',
	'missing_method',
	'unclear_responsibility',
	'uncovered_criterion',
	'sequence_mismatch'
]);

const ProposalInput = z.strictObject({
	kind: ProposalKind,
	title: z.string().trim().min(1).describe('A few words naming the improvement'),
	change: z
		.string()
		.trim()
		.min(1)
		.describe('The concrete change to the design in one or two sentences'),
	elementIds: z.array(z.string()).describe('DSN, UC, SEQ or ACT IDs of the elements it touches'),
	reqIds: z.array(z.string()).describe('REQ IDs it concerns')
});

export const Proposal = ProposalInput.extend({
	id: z.string().regex(ID_PATTERNS.PRP),
	status: z.enum(['open', 'accepted', 'rejected']),
	resolvedAt: z.string().optional()
});
export type Proposal = z.infer<typeof Proposal>;

/** What `report_design_proposals` stores: the proposals and the hash of the design they describe. */
export const DesignProposals = z.strictObject({
	designHash: z.string(),
	proposals: z.array(Proposal),
	/** The highest PRP ID handed out, also when its proposal was replaced, so numbers are never reused. */
	lastId: z.string().regex(ID_PATTERNS.PRP).optional()
});
export type DesignProposals = z.infer<typeof DesignProposals>;

/** The stored proposals, or null when there are none (or they no longer parse). */
export const readDesignProposals = (store: ProjectStore): Promise<DesignProposals | null> =>
	store.readJson(PROPOSALS_PATH, DesignProposals).catch(() => null);

/**
 * P3 follows the latest review: not started without one, stale once the design changed since, else
 * awaiting approval while a proposal is open and approved when none is. `running` is the orchestrator's.
 */
export function p3Status(doc: DesignProposals | null, currentDesign: string | null): PhaseStatus {
	if (!doc) return 'not_started';
	if (doc.designHash !== currentDesign) return 'stale';
	return doc.proposals.some((p) => p.status === 'open') ? 'awaiting_approval' : 'approved';
}

/** The document with one proposal set to `status`; resolvedAt is set unless it is open again. */
export function resolveProposal(
	doc: DesignProposals,
	id: string,
	status: Proposal['status'],
	at: string
): DesignProposals {
	const proposals = doc.proposals.map((p) => {
		if (p.id !== id) return p;
		const rest = { ...p, status };
		delete rest.resolvedAt;
		return status === 'open' ? rest : { ...rest, resolvedAt: at };
	});
	return { ...doc, proposals };
}

/** Every problem of the proposals against the design and the requirements, as `path: message` lines. */
function proposalProblems(
	proposals: z.infer<typeof ProposalInput>[],
	design: DesignDoc,
	reqs: RequirementsDoc | null
): string[] {
	const problems: string[] = [];
	if (proposals.length > MAX_PROPOSALS)
		problems.push(`proposals: at most ${MAX_PROPOSALS}, not ${proposals.length}`);
	const elements = new Set(
		[
			design.actors,
			design.useCases,
			design.classes,
			design.components,
			design.nodes,
			design.sequences
		].flatMap((list) => list.map((e) => e.id))
	);
	const reqIds = new Set(reqs?.requirements.map((r) => r.id));
	// the browser holds no classes, so the design save would refuse a class or method there
	const client = new Set([...clientNodeIds(design), ...clientComponents(design).map((c) => c.id)]);
	proposals.forEach((p, i) => {
		const onClient = p.elementIds.filter((id) => client.has(id));
		if ((p.kind === 'missing_class' || p.kind === 'missing_method') && onClient.length > 0)
			problems.push(
				`proposals[${i}]: a ${p.kind} proposal cannot touch the browser (${onClient.join(', ')}), which holds no classes; put the class or method on a service node and name its component or class instead`
			);
		for (const id of p.elementIds)
			if (!elements.has(id))
				problems.push(`proposals[${i}].elementIds: unknown design element "${id}"`);
		for (const id of p.reqIds)
			if (!reqIds.has(id)) problems.push(`proposals[${i}].reqIds: unknown requirement "${id}"`);
	});
	return problems;
}

export const reportDesignProposals = defineTool({
	name: 'report_design_proposals',
	description: `Report your review of the saved design: 0 to ${MAX_PROPOSALS} proposed improvements, each with kind, title, change (the concrete change in one or two sentences), elementIds (DSN, UC, SEQ or ACT) and reqIds it touches. Every ID must exist. Nothing is stored unless every proposal checks out; all problems are returned at once. Replaces the open proposals of the previous review.`,
	input: z.strictObject({ proposals: z.array(ProposalInput) }),
	async run({ store, runId }, { proposals }) {
		// a saved design that no longer parses counts as none
		const design = await store.readJson(DESIGN_PATH, DesignDoc).catch(() => null);
		if (!design) throw new ToolError('There is no saved design to review.');
		const reqs = await store.readJson('.aise/requirements.json', RequirementsDoc).catch(() => null);
		const problems = proposalProblems(proposals, design, reqs);
		if (problems.length > 0) {
			throw new ToolError(
				`The proposals were not saved. Fix these ${problems.length} problems:\n${problems.join('\n')}`
			);
		}
		const prev = await readDesignProposals(store);
		const issued = [
			...(prev?.proposals.map((p) => p.id) ?? []),
			...(prev?.lastId ? [prev.lastId] : [])
		];
		const kept = prev?.proposals.filter((p) => p.status !== 'open') ?? [];
		const added: Proposal[] = [];
		for (const p of proposals) {
			const id = nextId('PRP', [...issued, ...added.map((a) => a.id)]);
			added.push({ id, ...p, status: 'open' });
		}
		// IDs are zero padded, so the highest sorts last
		const lastId = [...issued, ...added.map((a) => a.id)].sort().at(-1);
		const doc: DesignProposals = {
			designHash: designHash(design)!,
			proposals: [...kept, ...added],
			...(lastId ? { lastId } : {})
		};
		await store.writeJson(PROPOSALS_PATH, DesignProposals, doc, runId);
		return { ok: true, proposals: added.map((p) => `${p.id}: ${p.title}`) };
	}
});
