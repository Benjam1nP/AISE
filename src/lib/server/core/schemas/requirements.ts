import { z } from 'zod';
import { ID_PATTERNS } from '../ids';

const reqIds = z
	.array(z.string().regex(ID_PATTERNS.REQ))
	.describe('IDs of the requirements this refers to, e.g. ["REQ-001"]');

export const Requirement = z.strictObject({
	id: z.string().regex(ID_PATTERNS.REQ).describe('Stable ID, e.g. "REQ-001"'),
	title: z.string().min(1).describe('Short name, a few words'),
	text: z.string().min(1).describe('One testable statement of what the system must do or be'),
	type: z.enum(['functional', 'non-functional']),
	priority: z.enum(['must', 'should', 'could']).describe('MoSCoW priority'),
	acceptanceCriteria: z
		.array(z.string().min(1))
		.min(1)
		.describe('Checkable conditions that show the requirement is met')
});
export type Requirement = z.infer<typeof Requirement>;

export const OpenQuestion = z.strictObject({
	id: z.string().regex(ID_PATTERNS.Q).describe('Stable ID, e.g. "Q-001"'),
	text: z.string().min(1).describe('Clarifying question for the developer'),
	reqIds
});
export type OpenQuestion = z.infer<typeof OpenQuestion>;

/** Reports every ID after its first use; `path` is the list the items come from. */
function checkUnique(ctx: z.RefinementCtx, path: string, ids: string[]): void {
	const seen = new Set<string>();
	ids.forEach((id, i) => {
		if (seen.has(id))
			ctx.addIssue({ code: 'custom', path: [path, i, 'id'], message: `duplicate ID "${id}"` });
		seen.add(id);
	});
}

export const RequirementsDoc = z
	.strictObject({
		requirements: z.array(Requirement),
		openQuestions: z.array(OpenQuestion).describe('Questions still unanswered'),
		assumptions: z.array(z.string().min(1)).describe('Assumptions made instead of asking'),
		outOfScope: z.array(z.string().min(1)).describe('Things the system explicitly will not do')
	})
	.superRefine((doc, ctx) => {
		const ids = doc.requirements.map((r) => r.id);
		checkUnique(ctx, 'requirements', ids);
		checkUnique(
			ctx,
			'openQuestions',
			doc.openQuestions.map((q) => q.id)
		);
		const known = new Set(ids);
		doc.openQuestions.forEach((q, i) => {
			q.reqIds.forEach((id, j) => {
				if (known.has(id)) return;
				ctx.addIssue({
					code: 'custom',
					path: ['openQuestions', i, 'reqIds', j],
					message: `unknown requirement "${id}" (known: ${ids.join(', ') || 'none'})`
				});
			});
		});
	});
export type RequirementsDoc = z.infer<typeof RequirementsDoc>;
