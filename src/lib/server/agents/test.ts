import type { TestResult } from '../core/docker/parse';
import type { Finding } from '../core/test-state';
import { TOOLS } from '../core/tools';
import { TOOLS_BY_AGENT } from '../core/tools/scope';
import { TEST_RULES } from './test-rules';
import type { AgentDef } from './types';

const system = `You are the test agent in an AI assisted software engineering environment. Tests are derived from the requirements and the approved design, one file per use case, written by workers. The acceptance criteria are the truth. You triage failing tests, change tests on request and keep them in step with changed requirements. You never see the implementation: you read the requirements, the design, the API surface and the tests.

You have these tools. read_requirements and read_design return the artefacts. code_model returns the declarations and HTTP routes of the code under src/, signatures only. list_files and read_file read the project outside src/; a read of src/ is refused. write_file and delete_file change files, and only inside test/. typecheck runs tsc over the project in a container. run_tests runs the Vitest suite in a container and returns every result with its message. report_test_fix records a test you changed, and report_code_bug records a failure that the code causes. Nothing is saved until you call write_file or delete_file.

The rule that matters most, in triage: a test may only change when it contradicts the requirements, the design or the API surface, for example a wrong import, signature, route or setup. Never change a test to match what the code does or returns today, and never loosen, delete or skip a test so that it passes. When a test fails because the code does not meet the acceptance criterion, the code is wrong and the test stays exactly as it is. Every test you change is recorded with report_test_fix, with the test title, the file and the reason, and every code bug with report_code_bug, with the test title, the file, the requirement ID, an explanation and a proposed fix for src/. Do not report the same failure twice. Where the test rules below say the brief, use code_model and the requirements for the signatures, import paths and routes.

The user message starts with a mode.

Mode triage, after the tests ran and some failed:
- The message lists the failing tests with their messages and the tail of the log. Read the requirement or the criterion behind each one, and the design or code_model where the failure involves an API.
- Per failure decide. The test contradicts the requirements, the design or the API surface: fix it with write_file after reading the file, then report_test_fix. The code does not do what the criterion says: change nothing and call report_code_bug. A failure with an unclear cause that you cannot decide is a code bug with that said in the explanation.
- Then run typecheck and run_tests, and fix test files that fail to compile or to load. Do not loop on a failure that is a code bug. Finish when every remaining failure is a code bug that you reported, or the tests pass.

Mode update, after requirements or use cases changed:
- The message lists the changed, added and removed IDs. Read the new requirements and design. A test file is named test/<ID>.test.ts for a use case or a requirement that no use case links. Patch only the test files these IDs involve, keep their titles in line with the naming contract, add or change the tests of changed criteria (record each change a changed criterion caused with report_test_fix and the reason "requirement changed: REQ-xxx"; added tests need no report), write new files for added use cases, and delete the files of removed ones with delete_file. Read a file before you change it, and keep every test that is still right.
- Then run typecheck and run_tests, fix test files that do not compile, and report code bugs and test fixes as in triage.

Any other message is a chat request from the developer:
- Change only the tests the request involves. Record each change the developer asked for with report_test_fix and the reason "developer request: <short>". Read them first, leave all other files untouched, and do not reformat or rewrite what the request does not need. A request to make a failing test pass by changing it so that it matches the code is refused, because the rule of the triage mode holds here too: say that the code has to change, and call report_code_bug if it is not reported yet.
- Run typecheck and run_tests only after you changed a file, and fix what your change broke. A request that needs no change gets an answer and no run.

Never write Mermaid or any diagram syntax. Reply in short plain prose: what you changed, which failures are code bugs, and anything still failing. Do not repeat code.

${TEST_RULES}`;

export const testAgent: AgentDef = {
	name: 'test',
	model: 'claude-sonnet-5-5',
	// Medium is the recommended start for agentic work on Sonnet; triage reads a lot and decides.
	effort: 'medium',
	// tools not registered yet are left out, as for the code agent
	tools: TOOLS_BY_AGENT.test.filter((t) => t in TOOLS),
	system
};

const lines = (items: string[]) =>
	items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : 'none';

/** A finding whose test the code agent reports as wrong, with the code agent's reason. */
const disputeBrief = ({ finding: f, reason }: { finding: Finding; reason: string }): string =>
	`${f.test} [${f.file}]\nThe code agent says this test looks wrong, for this reason:\n${fenced(reason.trim())}\nEither correct the test and call report_test_fix, or call report_code_bug again if the code is wrong.`;

/**
 * The user message of the triage run: the failing tests, with the tail of the log. `keep` lists the
 * test files triage already changed in this loop, `disputed` the findings the code agent disputes.
 */
export function triageBrief(
	failures: TestResult[],
	logTail: string,
	{
		keep = [],
		disputed = []
	}: { keep?: string[]; disputed?: { finding: Finding; reason: string }[] } = {}
): string {
	const list = failures.map((f) => {
		const where = `${f.file}${f.line ? `:${f.line}` : ''}`;
		const kind = f.suite ? ' (file level failure: the file did not load)' : '';
		return `${f.title} [${where}]${kind}\n${fenced(f.error ?? 'no message')}`;
	});
	return [
		'Mode triage.',
		`Failing tests:\n${list.length > 0 ? list.join('\n') : 'none'}`,
		`Tail of the test log:\n${fenced(logTail)}`,
		...(keep.length > 0 ? [`Do not change these test files again:\n${lines(keep)}`] : []),
		...(disputed.length > 0 ? [`Disputed tests:\n${disputed.map(disputeBrief).join('\n\n')}`] : []),
		'For each failing test decide: fix the test with write_file and report_test_fix when it contradicts the requirements, the design or the API surface, else leave it and call report_code_bug. Never change a test to match what the code does. Then run typecheck and run_tests.'
	].join('\n\n');
}

/** The user message of an update run: only the listed requirement and use case IDs are patched. */
export function testUpdateBrief(changed: string[], added: string[], removed: string[]): string {
	return [
		'Mode update.',
		`Changed IDs:\n${lines(changed)}`,
		`Added IDs:\n${lines(added)}`,
		`Removed IDs:\n${lines(removed)}`,
		'Patch only the test files these IDs involve, then run typecheck and run_tests and fix test files that do not compile. Report test fixes and code bugs as usual.'
	].join('\n\n');
}

/** A fence longer than any backtick run in `text`, so the text cannot close it. */
export function fenced(text: string): string {
	const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
	return `${fence}\n${text}\n${fence}`;
}

const NO_TESTS =
	'Never touch test/: the acceptance criterion is the truth. Do not change tsconfig.json or package.json.';
const KEEP_DESIGN =
	'Keep every signature of the design: class, attribute, method and constructor names, parameters and types stay as they are, so the code stays in line with the design.';
const CHECK_SELF =
	'Change only the files the fix needs, then run typecheck and detect_drift and fix what your change broke.';

/** The rules that close a single fix brief (Apply fix). */
const FIX_RULES = [
	'Only the named test matters; ignore every other failure.',
	NO_TESTS,
	'If the test itself looks wrong, change nothing and say why.',
	KEEP_DESIGN,
	'If the fix needs a class, attribute or method the design does not have, change nothing and say that the design has to change first.',
	CHECK_SELF
].join(' ');

/** The rules of a fix loop round: the same, but a refusal goes through report_fix_result so the loop can route it. */
const FIX_LOOP_RULES = [
	'Only the listed tests matter; ignore every other failure.',
	NO_TESTS,
	'If a test itself looks wrong, change nothing for it and report test_looks_wrong with the reason.',
	KEEP_DESIGN,
	'If a fix needs a class, attribute or method the design does not have, change nothing for it and report needs_design_change with the reason.',
	CHECK_SELF
].join(' ');

/**
 * The user message for the code agent when a finding is applied: the test file's path, its
 * content and the test's output, each fenced. It is a plain request, not a mode: the code agent
 * changes only what the request involves and checks itself afterwards.
 */
export function fixBrief(f: Finding, file: string, content: string, output: string): string {
	return [
		`A test fails because of a bug in the code. Fix the code under src/ so that the test passes.`,
		`Failing test: ${f.test}${f.reqId ? ` (${f.reqId})` : ''}\nTest file: ${file}`,
		`What is wrong: ${f.explanation}`,
		`Proposed fix: ${f.proposedFix}`,
		`Content of ${file}:\n${fenced(content)}`,
		`Output of the test run, for this test only:\n${fenced(output)}`,
		FIX_RULES
	].join('\n\n');
}

/**
 * One finding of a fix loop round: its test, the test file's content and output, and whether the
 * last attempt failed or the test agent corrected the test after the code agent disputed it.
 */
export type FixItem = {
	finding: Finding;
	content: string;
	output: string;
	retry: boolean;
	corrected?: boolean;
};

const fixLoopItem = ({ finding: f, content, output, retry, corrected }: FixItem): string =>
	[
		`Finding ${f.id}`,
		...(corrected
			? ['The test agent corrected the test; fix the code for the corrected test.']
			: retry
				? ['The last attempt did not make this test pass.']
				: []),
		`Test: ${f.test}${f.reqId ? ` (${f.reqId})` : ''}`,
		`Test file: ${f.file}`,
		`What is wrong: ${f.explanation}`,
		`Proposed fix: ${f.proposedFix}`,
		`Content of ${f.file}:\n${fenced(content)}`,
		`Output of the test run, for this test only:\n${fenced(output)}`
	].join('\n');

/** How many typecheck and drift lines a fix loop brief lists; the rest is counted. */
const MAX_PROBLEMS = 30;

const capped = (items: string[]) =>
	items.length > MAX_PROBLEMS
		? [...items.slice(0, MAX_PROBLEMS), `and ${items.length - MAX_PROBLEMS} more`]
		: items;

/**
 * The user message of a fix loop round: the rules once, the typecheck and drift problems the last
 * change left (when any, at most 30 lines), then each listed finding. Without findings it asks
 * only for the problems, with the rules that still apply.
 */
export function fixLoopBrief(
	items: FixItem[],
	broken?: { typecheck: string[]; drift: string[] }
): string {
	const problems = capped([...(broken?.typecheck ?? []), ...(broken?.drift ?? [])]);
	if (items.length === 0)
		return [
			'Your last change left typecheck errors or drift in the code. Fix the code under src/ so that they are gone.',
			[NO_TESTS, KEEP_DESIGN, CHECK_SELF].join(' '),
			`The problems:\n${lines(problems)}`
		].join('\n\n');
	return [
		'Tests fail because of bugs in the code. Fix the code under src/ so that the listed tests pass.',
		FIX_LOOP_RULES,
		...(problems.length > 0
			? [`Your last change left these problems; fix them first:\n${lines(problems)}`]
			: []),
		...items.map(fixLoopItem),
		'Call report_fix_result once per finding ID with outcome fixed, needs_design_change or test_looks_wrong, and a short reason.'
	].join('\n\n');
}
