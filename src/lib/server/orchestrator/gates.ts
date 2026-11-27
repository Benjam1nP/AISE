import { designHash, type CodeChecks } from '../core/code-state';
import { DEPLOY_FILES, type DeployCheck } from '../core/deploy-state';
import { MAIN_ENTRY } from '../core/nodes';
import type { DesignDoc } from '../core/schemas/design';
import type { RequirementsDoc } from '../core/schemas/requirements';
import { uncoveredCriteria, type DesignReview } from '../core/tools/coverage';
import { coverage, type TestChecks } from '../core/test-state';
import { uncoveredMustReqs, validateDesign } from '../core/validate';

/** An `advisory` check shows as a warning when it fails: it never affects `passed` and blocks no approval. */
export type GateCheck = { label: string; ok: boolean; detail?: string; advisory?: true };
export type GateResult = { passed: boolean; checks: GateCheck[] };

/** The checks that block approval; failing advisory checks are not among them. */
export const failedChecks = (g: GateResult) =>
	g.checks.filter((c) => !c.ok && !c.advisory).map((c) => c.label);

const check = (label: string, ok: boolean, detail?: string): GateCheck =>
	ok || detail === undefined ? { label, ok } : { label, ok, detail };

/** Acceptance criteria covered, from the stored review; advisory, so a gap is a review point and never a block. */
function coverageCheck(
	reqs: RequirementsDoc | null,
	design: DesignDoc | null,
	review: DesignReview | null
): GateCheck {
	const label = 'Acceptance criteria covered';
	const advisory = (ok: boolean, detail?: string): GateCheck => ({
		...check(label, ok, detail),
		advisory: true
	});
	if (review === null) return advisory(false, 'not run yet');
	if (review.designHash !== designHash(design)) return advisory(false, 'out of date');
	const gaps = reqs ? uncoveredCriteria(review.rows, reqs).map((u) => `${u.reqId} AC${u.n}`) : [];
	return advisory(gaps.length === 0, gaps.join(', '));
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * P4 reads the stored checks; it never runs them. Checks taken at another code hash or another
 * design than the current ones (a hand edit, a discard, a design change) fail as out of date
 * instead of showing an old result.
 */
function codeChecks(
	checks: CodeChecks | null,
	currentHash: string | null,
	design: DesignDoc | null,
	missingEntries: string[]
): GateCheck[] {
	// The wiring step may stop on its turn limit and still end the run done; a missing entry shows here.
	const exists = [
		check('Code exists', currentHash !== null),
		check('App entry exists', missingEntries.length === 0, missingEntries.join(', '))
	];
	if (
		checks === null ||
		checks.codeHash !== currentHash ||
		checks.designHash !== designHash(design)
	) {
		const detail = checks === null ? 'not run yet' : 'out of date';
		return [
			...exists,
			check('Typecheck passes', false, detail),
			check('Code matches the design', false, detail),
			check('App starts', false, detail)
		];
	}
	const tc = checks.typecheck;
	return [
		...exists,
		check(
			'Typecheck passes',
			tc?.ok === true,
			tc === null
				? 'no package.json'
				: tc.timedOut
					? 'timed out'
					: count(tc.errors.length, 'error', 'errors')
		),
		check(
			'Code matches the design',
			checks.drift.length === 0,
			count(checks.drift.length, 'difference', 'differences')
		),
		startCheck(checks)
	];
}

/** Every app entry answers GET /health; not run without a passing typecheck or an entry. */
function startCheck(checks: CodeChecks): GateCheck {
	const label = 'App starts';
	const { start, typecheck: tc } = checks;
	if (start === undefined) return check(label, false, 'not run yet');
	if (start === null)
		return check(
			label,
			false,
			tc === null ? 'no package.json' : !tc.ok ? 'not run, typecheck fails' : 'no app entry'
		);
	const failed = start.entries.filter((e) => !e.ok).map((e) => `${e.entry} ${e.error ?? 'failed'}`);
	return check(label, start.ok, start.timedOut ? 'timed out' : failed.join(', '));
}

/** What the P5 gate reads: the stored checks, the current hashes and the files under `test/`. */
export type TestGateInput = {
	checks: TestChecks | null;
	codeHash: string | null;
	testHash: string | null;
	testFiles: string[];
};

/** tsc errors that belong to the tests: a file under `test/`, or a global error without a file. */
export const isTestError = (file: string) =>
	file === '' || file.replaceAll('\\', '/').replace(/^\.\//, '').startsWith('test/');

/**
 * P5 reads the stored checks; it never runs them. Coverage counts the stored result; coverage,
 * typecheck and tests fail as out of date when the code or the tests changed since the checks (spec section 8).
 */
function testChecks(reqs: RequirementsDoc | null, t: TestGateInput): GateCheck[] {
	const { checks } = t;
	if (checks === null || checks.codeHash !== t.codeHash || checks.testHash !== t.testHash) {
		// Stored coverage says nothing about the tests that exist now, so it is not shown as green.
		const detail = checks === null ? 'not run yet' : 'out of date';
		return [
			check('Tests exist', t.testFiles.length > 0),
			check('Every must criterion has a test', false, detail),
			check('Tests type check', false, detail),
			check('All tests pass', false, detail)
		];
	}
	const must = (reqs?.requirements ?? []).filter((r) => r.priority === 'must');
	const missing = coverage(must, checks.result?.tests ?? [])
		.filter((row) => row.status === 'missing')
		.map((row) => `${row.reqId} AC${row.n}`);
	const head = [
		check('Tests exist', t.testFiles.length > 0),
		check('Every must criterion has a test', missing.length === 0, missing.join(', '))
	];
	const tc = checks.typecheck;
	const errors = tc?.errors.filter((e) => isTestError(e.file)).length ?? 0;
	const r = checks.result;
	return [
		...head,
		check(
			'Tests type check',
			tc !== null && !tc.timedOut && errors === 0,
			tc === null ? 'no package.json' : tc.timedOut ? 'timed out' : count(errors, 'error', 'errors')
		),
		check(
			'All tests pass',
			r?.ok === true,
			r === null
				? 'no package.json'
				: r.timedOut
					? 'timed out'
					: r.noTests
						? 'no tests ran'
						: `${r.failed} failed`
		)
	];
}

/** The P5 checks shown next to the Approve button (P5 spec section 8); a pure read of `t`. */
export function checkTestGate(reqs: RequirementsDoc | null, t: TestGateInput): GateResult {
	const checks = testChecks(reqs, t);
	return { passed: checks.every((c) => c.ok), checks };
}

/**
 * What the P6 gate reads: the files that exist, the consistency problems (null when the plan
 * cannot be made), the stored deploy check and the current check hash. `services` names the
 * health urls of the plan, so a failing url shows as its service.
 */
export type DeployGateInput = {
	files: string[];
	problems: string[] | null;
	check: DeployCheck | null;
	checkHash: string | null;
	services?: { name: string; healthUrl: string }[];
};

/**
 * The urls without a 2xx status, named by service, a url that gave no answer with the first log
 * line (a refused check or Docker down stores its message there); else the first log line.
 */
function deployFailure(c: DeployCheck, services: DeployGateInput['services']): string {
	const first =
		c.logTail
			.split('\n')
			.find((l) => l.trim() !== '')
			?.trim() ?? '';
	const bad = c.services
		.filter((s) => s.status === null || s.status < 200 || s.status > 299)
		.map((s) => {
			const name = services?.find((p) => p.healthUrl === s.url)?.name ?? s.url;
			if (s.status !== null) return `${name} ${s.status}`;
			return first === '' ? `${name} no answer` : `${name} no answer (${first})`;
		});
	return bad.length > 0 ? bad.join(', ') : first || 'failed';
}

/**
 * A current stored check: failed as stored, or failed when it did not probe a planned health url
 * with a 2xx answer (a call with fewer urls than the plan), naming those services.
 */
function deployResult(stored: DeployCheck, services: DeployGateInput['services']): GateCheck {
	if (!stored.passed) return check('Deploy check passed', false, deployFailure(stored, services));
	const ok = (url: string) =>
		stored.services.some(
			(s) => s.url === url && s.status !== null && s.status >= 200 && s.status <= 299
		);
	const missing = (services ?? []).filter((s) => !ok(s.healthUrl)).map((s) => s.name);
	return missing.length > 0
		? check('Deploy check passed', false, `not probed: ${missing.join(', ')}`)
		: check('Deploy check passed', true);
}

/**
 * The P6 checks next to the Approve button; a pure read of `t`. The deploy check is stored, never
 * run here, and fails as out of date when the files it ran against changed.
 */
export function checkDeployGate(t: DeployGateInput): GateResult {
	const missing = DEPLOY_FILES.filter((f) => !t.files.includes(f));
	const { check: stored } = t;
	const deploy =
		stored === null
			? check('Deploy check passed', false, 'not run yet')
			: t.checkHash === null || stored.filesHash !== t.checkHash
				? check('Deploy check passed', false, 'out of date')
				: deployResult(stored, t.services);
	const checks = [
		check('Deployment files exist', missing.length === 0, missing.join(', ')),
		check(
			'Consistent with the design',
			t.problems !== null && t.problems.length === 0,
			t.problems === null ? 'no design or package.json' : t.problems.join('; ')
		),
		deploy
	];
	return { passed: checks.every((c) => c.ok), checks };
}

/** The checks shown next to the Approve button (spec section 8; P4 reads `stored`, `currentHash` and `missingEntries`, the entry files that do not exist; P2 reads `review`, the stored acceptance criteria coverage). */
export function checkGate(
	phase: 'P1' | 'P2' | 'P4',
	reqs: RequirementsDoc | null,
	design: DesignDoc | null,
	stored: CodeChecks | null = null,
	currentHash: string | null = null,
	missingEntries: string[] = [MAIN_ENTRY],
	review: DesignReview | null = null
): GateResult {
	const checks: GateCheck[] = [];
	if (phase === 'P4') {
		checks.push(...codeChecks(stored, currentHash, design, missingEntries));
	} else if (phase === 'P1') {
		const open = reqs?.openQuestions.map((q) => q.id) ?? [];
		checks.push(
			check('At least one requirement', (reqs?.requirements.length ?? 0) > 0),
			check('No open questions', open.length === 0, open.join(', '))
		);
	} else {
		const issues = design ? validateDesign(design, reqs).issues.length : 0;
		const uncovered = design && reqs ? uncoveredMustReqs(design, reqs) : [];
		checks.push(
			check('Design exists', design !== null),
			check(
				'Schema and references valid',
				design !== null && issues === 0,
				design ? `${issues} ${issues === 1 ? 'issue' : 'issues'}` : undefined
			),
			check(
				'Every must requirement linked',
				design !== null && uncovered.length === 0,
				design ? uncovered.join(', ') : undefined
			),
			coverageCheck(reqs, design, review)
		);
	}
	return { passed: checks.every((c) => c.ok || c.advisory), checks };
}
