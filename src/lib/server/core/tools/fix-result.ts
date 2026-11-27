import { z } from 'zod';
import { appendRunFixResult } from '../test-state';
import { defineTool, ToolError } from './registry';

export const reportFixResult = defineTool({
	name: 'report_fix_result',
	description:
		'Report the outcome of one finding you were asked to fix: fixed, needs_design_change (the fix needs a class, attribute or method the design lacks) or test_looks_wrong (the test contradicts the requirement). Give the reason in one or two sentences.',
	input: z.strictObject({
		findingId: z
			.string()
			.min(1)
			.max(200)
			.describe('ID of the finding, e.g. "20261126-101500-P5-1"'),
		outcome: z.enum(['fixed', 'needs_design_change', 'test_looks_wrong']),
		reason: z
			.string()
			.min(1)
			.max(300)
			.describe('Why, in one or two sentences (at most 300 characters)')
	}),
	async run(ctx, { findingId, outcome, reason }) {
		if (ctx.agent !== 'code' || ctx.fixLoop !== true)
			throw new ToolError('Only the code agent in a fix loop run can report fix results.');
		if (!ctx.handedOver?.includes(findingId))
			throw new ToolError(
				`${findingId} was not handed to you this round. Handed over: ${ctx.handedOver?.join(', ') || 'none'}.`
			);
		const fixResult = await appendRunFixResult(ctx.store, ctx.runId, {
			findingId,
			outcome,
			reason
		});
		return { recorded: true, fixResult };
	}
});
