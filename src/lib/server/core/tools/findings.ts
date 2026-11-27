import { z } from 'zod';
import { appendRunFinding, appendRunTestFix } from '../test-state';
import { ID_PATTERNS } from '../ids';
import { defineTool, ToolError, type ToolContext } from './registry';
import { canWrite, MAX_PATH_LENGTH } from './scope';

const text = (what: string) => z.string().min(1).max(4000).describe(what);
const testName = z
	.string()
	.min(1)
	.max(500)
	.describe('Name of the test as the run shows it, e.g. "REQ-003 AC1: Add a task"');
const testFile = z
	.string()
	.max(MAX_PATH_LENGTH)
	.describe('Project relative path of the test file, e.g. "test/UC-001.test.ts"');

/** Only the test agent reports; the findings belong to its run. */
async function requireTestRun(ctx: ToolContext, file: string): Promise<void> {
	if (ctx.agent !== 'test') throw new ToolError('Only the test agent can report findings.');
	if (!canWrite('test', file)) throw new ToolError(`${file} is not a test file under test/.`);
	if (!(await ctx.store.exists(`.aise/runs/${ctx.runId}/run.json`)))
		throw new ToolError(`Unknown run: ${ctx.runId}`);
}

export const reportCodeBug = defineTool({
	name: 'report_code_bug',
	description:
		'Record that a failing test is right and the code is wrong. Do not change the test. Give the test name, its file, the requirement ID if any, what is wrong and what the code should change. A later report for the same test replaces the earlier one.',
	input: z.strictObject({
		test: testName,
		file: testFile,
		reqId: z.string().regex(ID_PATTERNS.REQ).optional(),
		explanation: text('Why the code is wrong, from the failure message and the requirement'),
		proposedFix: text('What the code should do differently')
	}),
	async run(ctx, { test, file, reqId, explanation, proposedFix }) {
		await requireTestRun(ctx, file);
		const finding = await appendRunFinding(ctx.store, ctx.runId, {
			test,
			file,
			...(reqId ? { reqId } : {}),
			explanation,
			proposedFix
		});
		return { recorded: true, finding };
	}
});

export const reportTestFix = defineTool({
	name: 'report_test_fix',
	description:
		'Record that you changed a test because it contradicted the requirements, design or API (wrong import, signature, route or setup). Every test you change needs one. Give the test name, its file and the reason.',
	input: z.strictObject({
		test: testName,
		file: testFile,
		reason: text('Why the test was wrong')
	}),
	async run(ctx, { test, file, reason }) {
		await requireTestRun(ctx, file);
		const testFix = await appendRunTestFix(ctx.store, ctx.runId, { test, file, reason });
		return { recorded: true, testFix };
	}
});
