import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runCodeChecks } from '../../src/lib/server/core/code-state';
import { ensureRunnerImage } from '../../src/lib/server/core/docker/image';
import { ProjectStore } from '../../src/lib/server/core/store';
import type { ToolContext } from '../../src/lib/server/core/tools/registry';
import { DesignDoc } from '../../src/lib/server/core/schemas/design';
import { failedChecks } from '../../src/lib/server/orchestrator/gates';
import { codeGate } from '../../src/lib/server/orchestrator/p4';

const dirs: string[] = [];

/** Copy of the P4 fixture in a temp folder, so the repo checkout is never written to. */
async function fixture(): Promise<ToolContext> {
	const root = await mkdtemp(path.join(tmpdir(), 'aise-p4-'));
	dirs.push(root);
	await cp(path.resolve('test/fixtures/p4'), root, { recursive: true });
	return { store: new ProjectStore(root), runId: '', projectName: 'p4-fixture', agent: 'code' };
}

beforeAll(async () => {
	await ensureRunnerImage(); // the first build installs the packages and takes minutes
}, 600_000);

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('P4 checks on the fixture project', () => {
	it('type checks in the runner image and has no drift', async () => {
		const checks = await runCodeChecks(await fixture());
		expect(checks.typecheck).toEqual({ ok: true, errors: [], timedOut: false });
		expect(checks.drift).toEqual([]);
		expect(checks.codeHash).not.toBeNull();
		expect(checks.start?.ok).toBe(true);
	});

	it('fails the gate with the error when main.ts throws at startup', async () => {
		const ctx = await fixture();
		const main = path.join(ctx.store.dir, 'src/app/main.ts');
		await writeFile(main, `throw new Error('boom at startup');\n${await readFile(main, 'utf8')}`);

		const checks = await runCodeChecks(ctx);
		expect(checks.typecheck?.ok).toBe(true);
		expect(checks.start?.ok).toBe(false);
		expect(checks.start?.entries[0]?.log).toContain('boom at startup');
		const design = await ctx.store.readJson('.aise/design.json', DesignDoc);
		const gate = await codeGate(ctx.store, null, design);
		expect(failedChecks(gate)).toEqual(['App starts']);
		expect(gate.checks.find((c) => c.label === 'App starts')?.detail).toBe(
			'src/app/main.ts exited with code 1 before GET /health answered'
		);
	});

	it('gives every entry an existing folder for its DB_PATH', async () => {
		const ctx = await fixture();
		const main = path.join(ctx.store.dir, 'src/app/main.ts');
		const write = `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.DB_PATH ?? '', '');\n`;
		await writeFile(main, write + (await readFile(main, 'utf8')));

		const checks = await runCodeChecks(ctx);
		expect(checks.start?.entries[0]?.log).toBe('');
		expect(checks.start?.ok).toBe(true);
	});

	it('reports one changed item for a class whose method signature changed', async () => {
		const ctx = await fixture();
		const file = path.join(ctx.store.dir, 'src/service/TaskService.ts');
		const source = await readFile(file, 'utf8');
		const edited = source.replace('addTask(title: string): Task', 'addTask(label: string): Task');
		expect(edited).not.toBe(source);
		await writeFile(file, edited);

		const { drift } = await runCodeChecks(ctx);
		expect(drift).toHaveLength(1);
		expect(drift[0]).toMatchObject({
			kind: 'changed',
			id: 'DSN-003',
			name: 'TaskService',
			file: 'src/service/TaskService.ts'
		});
		expect(drift[0]!.details.join(' ')).toContain('method addTask: parameters');
	});
});
