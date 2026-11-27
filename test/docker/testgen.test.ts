import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ensureRunnerImage } from '../../src/lib/server/core/docker/image';
import { RequirementsDoc } from '../../src/lib/server/core/schemas/requirements';
import { ProjectStore } from '../../src/lib/server/core/store';
import { coverage, runTestChecks } from '../../src/lib/server/core/test-state';
import { REQUIREMENTS_PATH } from '../../src/lib/server/core/tools/requirements';
import type { ToolContext } from '../../src/lib/server/core/tools/registry';

const dirs: string[] = [];

/**
 * Temp project: the P4 fixture code plus the P5 fixture (requirements and the hand written
 * `test/UC-001.test.ts`), so the repo checkout is never written to.
 */
async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), 'aise-p5-'));
	dirs.push(root);
	await cp(path.resolve('test/fixtures/p4'), root, { recursive: true });
	await cp(path.resolve('test/fixtures/p5'), root, { recursive: true });
	const store = new ProjectStore(root);
	const ctx: ToolContext = { store, runId: 'run-1', projectName: 'p5-fixture', agent: 'test' };
	const reqs = (await store.readJson(REQUIREMENTS_PATH, RequirementsDoc))!;
	return { ctx, reqs, dir: root };
}

beforeAll(async () => {
	await ensureRunnerImage(); // the first build installs the packages and takes minutes
}, 600_000);

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('P5 checks on the fixture project', () => {
	it('runs the hand written tests green and covers every must criterion', async () => {
		const { ctx, reqs } = await fixture();
		const checks = await runTestChecks(ctx);

		expect(checks.typecheck).toEqual({ ok: true, errors: [], timedOut: false });
		expect(checks.result).toMatchObject({ ok: true, passed: 2, failed: 0, timedOut: false });
		expect(checks.testHash).not.toBeNull();

		const rows = coverage(reqs.requirements, checks.result!.tests);
		expect(rows.map((r) => `${r.reqId} AC${r.n} ${r.status}`)).toEqual([
			'REQ-001 AC1 passed',
			'REQ-001 AC2 passed'
		]);
		expect(rows.filter((r) => r.priority === 'must' && r.status === 'missing')).toEqual([]);
	});

	it('shows one failing test with a message when a method is broken', async () => {
		const { ctx, reqs, dir } = await fixture();
		const file = path.join(dir, 'src/service/TaskService.ts');
		const source = await readFile(file, 'utf8');
		const edited = source.replace(
			"if (title.trim() === '') throw new Error('The title is empty');",
			''
		);
		expect(edited).not.toBe(source);
		await writeFile(file, edited);

		const checks = await runTestChecks(ctx);
		expect(checks.typecheck?.ok).toBe(true);
		expect(checks.result?.ok).toBe(false);
		const failed = checks.result!.tests.filter((t) => t.status === 'failed');
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({
			file: 'test/UC-001.test.ts',
			title: expect.stringMatching(/^REQ-001 AC2: /)
		});
		expect(failed[0]!.line).toBeGreaterThan(0);
		expect(failed[0]!.error).toContain('expected 201 to be 400');

		const rows = coverage(reqs.requirements, checks.result!.tests);
		expect(rows.map((r) => `${r.reqId} AC${r.n} ${r.status}`)).toEqual([
			'REQ-001 AC1 passed',
			'REQ-001 AC2 failed'
		]);
	});
});
