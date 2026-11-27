import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolError } from '../tools/registry';
import { DOCKER_DOWN, buildRunArgs, docker, dockerEnv, hostPathForDocker } from './run';
import { runnerTag } from './image';
import { parseTsc, parseVitestJson, tail } from './parse';

const fixture = (name: string) => readFileSync(path.resolve('test/fixtures/output', name), 'utf8');

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('parseTsc', () => {
	const errors = parseTsc(fixture('tsc-errors.txt'));

	it('reads file, line, column and message of each error', () => {
		expect(errors).toHaveLength(4);
		expect(errors[0]).toEqual({
			file: 'src/cart.ts',
			line: 15,
			col: 37,
			message: "TS2345: Argument of type 'string' is not assignable to parameter of type 'number'."
		});
		expect(errors[2]).toMatchObject({ line: 17, col: 57 });
	});

	it('keeps the indented explanation lines with their error', () => {
		expect(errors[3]?.message).toContain("TS2322: Type '(a: string) => string'");
		expect(errors[3]?.message).toContain("Type 'number' is not assignable to type 'string'.");
	});

	it('returns an empty list for clean output and keeps errors without a location', () => {
		expect(parseTsc('')).toEqual([]);
		expect(parseTsc('error TS18003: No inputs were found in config file.\n')).toEqual([
			{ file: '', line: 0, col: 0, message: 'TS18003: No inputs were found in config file.' }
		]);
	});
});

describe('parseVitestJson', () => {
	const report = parseVitestJson(fixture('vitest-report.json'));

	it('counts passed and failed tests, not skipped ones', () => {
		expect(report.passed).toBe(2);
		expect(report.failed).toBe(1);
		expect(report.tests.map((t) => t.status)).toEqual(['passed', 'failed', 'skipped', 'passed']);
	});

	it('reports project relative files and the assertion message without the stack', () => {
		const failure = report.tests.find((t) => t.status === 'failed');
		expect(failure).toEqual({
			name: 'cart fails on purpose',
			title: 'fails on purpose',
			file: 'test/cart.test.ts',
			status: 'failed',
			error: 'AssertionError: expected +0 to be 1 // Object.is equality'
		});
		expect(report.tests[0]).not.toHaveProperty('error');
	});

	it('counts a test file that failed to load as one failure', () => {
		const json = JSON.stringify({
			testResults: [
				{
					name: '/opt/aise/app/test/broken.test.ts',
					status: 'failed',
					message: 'Failed to resolve import "../src/nope"',
					assertionResults: []
				}
			]
		});
		const r = parseVitestJson(json);
		expect(r.failed).toBe(1);
		expect(r.tests[0]).toMatchObject({
			file: 'test/broken.test.ts',
			status: 'failed',
			suite: true,
			error: 'Failed to resolve import "../src/nope"'
		});
	});

	it('marks only the file level failure entry as suite', () => {
		expect(report.tests.some((t) => 'suite' in t)).toBe(false);
	});

	it('reads the title and the line from the task location', () => {
		const json = JSON.stringify({
			testResults: [
				{
					name: '/opt/aise/app/test/a.test.ts',
					status: 'passed',
					assertionResults: [
						{
							fullName: 'UC-001 REQ-001 AC1: x',
							title: 'REQ-001 AC1: x',
							status: 'passed',
							location: { line: 7, column: 2 }
						},
						{ fullName: 'no location', title: 'no location', status: 'passed' }
					]
				}
			]
		});
		const [a, b] = parseVitestJson(json).tests;
		expect(a).toMatchObject({ title: 'REQ-001 AC1: x', line: 7 });
		expect(b).toMatchObject({ title: 'no location' });
		expect(b).not.toHaveProperty('line');
	});

	it('counts a todo test as neither passed nor failed', () => {
		const json = JSON.stringify({
			testResults: [
				{
					name: '/opt/aise/app/test/a.test.ts',
					status: 'passed',
					assertionResults: [
						{ fullName: 'a', title: 'a', status: 'passed' },
						{ fullName: 'REQ-007 AC2: manual: x', title: 'REQ-007 AC2: manual: x', status: 'todo' }
					]
				}
			]
		});
		const r = parseVitestJson(json);
		expect(r.tests.map((t) => t.status)).toEqual(['passed', 'todo']);
		expect(r).toMatchObject({ passed: 1, failed: 0 });
	});

	it('rejects text that is not a Vitest report', () => {
		expect(() => parseVitestJson('not json')).toThrow(ToolError);
		expect(() => parseVitestJson('{}')).toThrow(ToolError);
	});
});

describe('parseVitestJson with a throwing afterAll', () => {
	it('is not green when every test passed but the file failed', () => {
		const r = parseVitestJson(fixture('vitest-report-afterall.json'));
		expect(r.passed).toBe(1);
		expect(r.failed).toBe(1);
		expect(r.tests.at(-1)).toMatchObject({
			file: 'test/cleanup.test.ts',
			status: 'failed'
		});
		expect(r.tests.at(-1)?.error).toMatch(/failed outside a test/);
	});

	it('does not add a second failure when a test in the file already failed', () => {
		const json = JSON.stringify({
			testResults: [
				{
					name: '/opt/aise/app/test/a.test.ts',
					status: 'failed',
					message: '',
					assertionResults: [{ fullName: 'a', status: 'failed', failureMessages: ['boom'] }]
				}
			]
		});
		expect(parseVitestJson(json).failed).toBe(1);
	});
});

describe('tail', () => {
	const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);

	it('keeps the last 200 of 500 lines by default', () => {
		const out = tail(lines.join('\n') + '\n').split('\n');
		expect(out).toHaveLength(200);
		expect(out[0]).toBe('line 301');
		expect(out.at(-1)).toBe('line 500');
	});

	it('caps characters and returns nothing for zero lines', () => {
		const long = 'x'.repeat(50_000);
		expect(tail(long)).toHaveLength(20_000);
		expect(tail(long, 200, 10)).toBe('x'.repeat(10));
		expect(tail('a\nb', 0)).toBe('');
	});

	it('returns short text unchanged and honours a custom limit', () => {
		expect(tail('a\nb')).toBe('a\nb');
		expect(tail(lines.join('\n'), 2)).toBe('line 499\nline 500');
	});
});

describe('hostPathForDocker', () => {
	it('turns Windows paths into forward slash paths', () => {
		expect(hostPathForDocker('C:\\Users\\a\\p')).toBe('C:/Users/a/p');
		expect(hostPathForDocker('d:\\x')).toBe('d:/x');
	});

	it('leaves POSIX and WSL paths unchanged', () => {
		expect(hostPathForDocker('/home/a/p')).toBe('/home/a/p');
		expect(hostPathForDocker('/mnt/c/Users/a/p')).toBe('/mnt/c/Users/a/p');
		expect(hostPathForDocker('/odd\\name')).toBe('/odd\\name');
	});
});

describe('dockerEnv', () => {
	const host = {
		PATH: '/bin',
		HOME: '/h',
		ANTHROPIC_API_KEY: 'sk-secret',
		DOCKER_HOST: '',
		SSH_AUTH_SOCK: '/s',
		XDG_RUNTIME_DIR: '/run/u',
		DBUS_SESSION_BUS_ADDRESS: 'unix:path=/b',
		WSL_DISTRO_NAME: 'Ubuntu',
		WSL_INTEROP: '/run/WSL/1_interop',
		ProgramFiles: 'C:\\PF',
		ProgramW6432: 'C:\\PF',
		'ProgramFiles(x86)': 'C:\\PF86',
		SystemRoot: 'C:\\Windows'
	};
	const names = (platform: NodeJS.Platform) => Object.keys(dockerEnv(host, platform)).sort();

	it('passes PATH and HOME everywhere, never secrets or empty values', () => {
		expect(names('darwin')).toEqual(['HOME', 'PATH']);
	});

	it('adds credential helper, ssh and WSL interop variables on Linux', () => {
		expect(names('linux')).toEqual([
			'DBUS_SESSION_BUS_ADDRESS',
			'HOME',
			'PATH',
			'SSH_AUTH_SOCK',
			'WSL_DISTRO_NAME',
			'WSL_INTEROP',
			'XDG_RUNTIME_DIR'
		]);
	});

	it('adds system folders and Program Files (cli plugins) on Windows', () => {
		expect(names('win32')).toEqual([
			'HOME',
			'PATH',
			'ProgramFiles',
			'ProgramFiles(x86)',
			'ProgramW6432',
			'SystemRoot'
		]);
	});
});

describe('buildRunArgs', () => {
	const base = { timeoutMs: 1000 };

	it('isolates, limits and mounts the project at /opt/aise/app', () => {
		const args = buildRunArgs('aise-x', 'aise-runner:abc', '/p', ['tsc'], base, undefined);
		expect(args.join(' ')).toBe(
			[
				'run --rm --name aise-x --label aise=1 --network none',
				'--cpus 1 --memory 1g --memory-swap 1g --pids-limit 256',
				'--cap-drop ALL --security-opt no-new-privileges --log-driver none',
				'--read-only --tmpfs /tmp',
				'--mount type=bind,source=/p,target=/opt/aise/app,readonly aise-runner:abc',
				'timeout -s KILL 6 tsc'
			].join(' ')
		);
	});

	it('wraps the command in an in container timeout slightly longer than the host one', () => {
		const args = buildRunArgs('n', 't', '/p', ['x'], { ...base, timeoutMs: 120_000 }, undefined);
		expect(args.slice(args.indexOf('t') + 1, args.indexOf('x'))).toEqual([
			'timeout',
			'-s',
			'KILL',
			'125'
		]);
	});

	it('mounts an output folder writable at /opt/aise/out when outDir is set', () => {
		const args = buildRunArgs('aise-x', 't', '/p', ['a'], { ...base, outDir: '/tmp/o' }, undefined);
		expect(args).toContain('type=bind,source=/tmp/o,target=/opt/aise/out');
		expect(args).toContain('type=bind,source=/p,target=/opt/aise/app,readonly');
	});

	it('quotes a mount field with a comma or quote so the path cannot add options', () => {
		const args = buildRunArgs('aise-x', 't', '/a,b/"c"', ['a'], base, undefined);
		expect(args).toContain('type=bind,"source=/a,b/""c""",target=/opt/aise/app,readonly');
	});

	it('runs as the host user on Linux so a bind mount stays writable', () => {
		const args = buildRunArgs('aise-x', 't', '/p', ['a'], base, { uid: 1001, gid: 1002 });
		expect(args.join(' ')).toContain('--user 1001:1002');
	});

	it('never runs as root: uid 0 leaves the image user in place', () => {
		const args = buildRunArgs('aise-x', 't', '/p', ['a'], base, { uid: 0, gid: 0 });
		expect(args).not.toContain('--user');
		expect(buildRunArgs('n', 't', '/p', ['a'], base, { uid: 1001, gid: 0 })).toContain('1001:1001');
	});
});

describe('runnerTag', () => {
	it('hashes Dockerfile, package.json and lockfile into a 12 hex tag', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'runner-'));
		try {
			for (const f of ['Dockerfile', 'package.json', 'package-lock.json'])
				await writeFile(path.join(dir, f), f);
			const a = await runnerTag(dir);
			expect(a).toMatch(/^aise-runner:[0-9a-f]{12}$/);
			expect(await runnerTag(dir)).toBe(a);
			await writeFile(path.join(dir, 'package-lock.json'), 'changed');
			expect(await runnerTag(dir)).not.toBe(a);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('docker', () => {
	it('throws a ToolError with the start Docker message when the CLI is missing', async () => {
		// An empty PATH falls back to /bin:/usr/bin on Linux, where Docker may exist; use an empty folder.
		const empty = await mkdtemp(path.join(tmpdir(), 'aise-nopath-'));
		vi.stubEnv('PATH', empty);
		try {
			const err = await docker(['ps'], { timeoutMs: 5000 }).catch((e: unknown) => e);
			expect(err).toBeInstanceOf(ToolError);
			expect((err as ToolError).message).toBe(DOCKER_DOWN);
		} finally {
			await rm(empty, { recursive: true, force: true });
		}
	});
});
