import { describe, expect, it } from 'vitest';
import type { DockerResult } from '../docker/run';
import type { DesignDoc } from '../schemas/design';
import { ProjectStore } from '../store';
import type { ToolContext } from './registry';
import { parseStart, runStartCheck, startTargets, type StartTarget } from './start';

const main: StartTarget = { entry: 'src/app/main.ts', portVar: 'PORT', port: 8080 };
const live: StartTarget = { entry: 'src/app/live.ts', portVar: 'LIVE_PORT', port: 8081 };
const raw = (t: StartTarget, over: object) => ({
	...t,
	log: '',
	exit: null,
	status: null,
	healthy: false,
	...over
});
const output = (...entries: object[]) => `noise\nAISE_START ${JSON.stringify(entries)}\n`;
const ctx: ToolContext = {
	store: new ProjectStore('/nowhere'),
	runId: '',
	projectName: 'p',
	agent: 'code'
};
const fakeRun =
	(r: Partial<DockerResult>, seen: string[][] = []) =>
	async (_dir: string, cmd: string[]): Promise<DockerResult> => {
		seen.push(cmd);
		return { code: 0, stdout: '', stderr: '', timedOut: false, ...r };
	};

describe('parseStart', () => {
	it('gives every entry that did not answer 200 its reason', () => {
		const entries = parseStart(
			output(
				raw(main, { healthy: true, status: 200 }),
				raw(live, { exit: 1, log: 'Error: boom\n    at /opt/aise/app/src/app/live.ts:1:7' }),
				raw({ ...live, entry: 'a.ts' }, { exit: 'SIGKILL' }),
				raw({ ...live, entry: 'b.ts' }, { status: 503 }),
				raw({ ...live, entry: 'c.ts' }, {})
			),
			30_000
		);
		expect(entries?.map((e) => [e.entry, e.ok, e.error])).toEqual([
			['src/app/main.ts', true, undefined],
			['src/app/live.ts', false, 'exited with code 1 before GET /health answered'],
			['a.ts', false, 'stopped (SIGKILL) before GET /health answered'],
			['b.ts', false, 'GET /health returned 503'],
			['c.ts', false, 'GET /health did not answer within 30 s']
		]);
		expect(entries?.[1]?.log).toBe('Error: boom\n    at src/app/live.ts:1:7');
	});

	it('is null without the result line', () => {
		expect(parseStart('Error: something crashed')).toBeNull();
	});

	it('is null when the result line is cut off', () => {
		expect(parseStart('AISE_START [{"entry":"src/app/ma')).toBeNull();
	});
});

describe('runStartCheck', () => {
	it('runs node -e with the targets and passes only when every entry answered', async () => {
		const seen: string[][] = [];
		const ok = fakeRun(
			{ stdout: output(raw(main, { healthy: true, status: 200, log: 'Listening' })) },
			seen
		);
		expect(await runStartCheck(ctx, [main], { run: ok })).toEqual({
			ok: true,
			timedOut: false,
			entries: [{ ...main, ok: true, log: '' }]
		});
		expect(seen[0]?.slice(0, 2)).toEqual(['node', '-e']);
		expect(JSON.parse(seen[0]![3]!)).toEqual([main]);

		const one = fakeRun({
			stdout: output(raw(main, { healthy: true }), raw(live, { exit: 1 }))
		});
		expect((await runStartCheck(ctx, [main, live], { run: one })).ok).toBe(false);
	});

	it('fails every entry with the container log when the script gave no result', async () => {
		const crash = fakeRun({ code: 137, stderr: 'Killed' });
		const r = await runStartCheck(ctx, [main], { run: crash });
		expect(r).toEqual({
			ok: false,
			timedOut: false,
			entries: [{ ...main, ok: false, error: 'the start check did not finish', log: 'Killed' }]
		});
		const hang = fakeRun({ code: null, timedOut: true });
		expect((await runStartCheck(ctx, [main], { run: hang })).timedOut).toBe(true);
	});
});

describe('startTargets', () => {
	const node = (id: string, name: string) => ({ id, name, kind: 'service' as const, reqIds: [] });

	it('is main.ts on PORT 8080 without a design or service nodes', () => {
		expect(startTargets(null)).toEqual([main]);
	});

	it('lists every service node, primary first, with its port variable', () => {
		const design = {
			nodes: [node('DSN-020', 'Api'), node('DSN-021', 'Live')],
			links: [],
			components: []
		} as unknown as DesignDoc;
		expect(startTargets(design)).toEqual([main, live]);
	});
});
