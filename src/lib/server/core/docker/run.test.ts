import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolError } from '../tools/registry';
import { ensureRunnerImage } from './image';
import { DOCKER_DOWN, docker, runInRunner } from './run';

// A fake `docker` on PATH, so the process handling is tested without Docker. POSIX only.
// docker gets a minimal env, so the fake knows its folder from the script text and reads its
// switches from files in that folder (see flag).
const fake = (dir: string) => `#!/bin/sh
D='${dir}'
echo "$@" >> "$D/log"
case "$1" in
  env) env; exit 0 ;;
  sleep-cli) exec sleep 30 ;;
  image) [ -f "$D/built" ] && exit 0; exit 1 ;;
  build)
    sleep 0.3
    if [ -f "$D/build-fail" ]; then echo "build step failed" >&2; exit 1; fi
    touch "$D/built"; exit 0 ;;
  version)
    if [ -f "$D/daemon-down" ]; then
      echo "Cannot connect to the Docker daemon at x. Is the docker daemon running?" >&2; exit 1
    fi
    echo 29; exit 0 ;;
  run)
    echo $$ > "$D/pid"
    if [ -f "$D/run-stderr" ]; then cat "$D/run-stderr" >&2; exit 1; fi
    if [ -f "$D/run-quick" ]; then exit 0; fi
    exec sleep 30 ;;
  rm)
    n=$(cat "$D/kills" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$D/kills"
    if [ -f "$D/kill-fail-first" ] && [ "$n" -eq 1 ]; then exit 1; fi
    if [ -f "$D/pid" ]; then kill $(cat "$D/pid") 2>/dev/null; rm -f "$D/pid"; exit 0; fi
    echo "Error response from daemon: No such container: $3" >&2; exit 1 ;;
esac
`;

let dir: string;
const log = async () => (await readFile(path.join(dir, 'log'), 'utf8').catch(() => '')).split('\n');
const calls = async (verb: string) => (await log()).filter((l) => l.startsWith(verb + ' '));
/** Turns a fake switch on (with optional content) or off (null). */
const flag = (name: string, content: string | null = '') =>
	content === null
		? rm(path.join(dir, name), { force: true })
		: writeFile(path.join(dir, name), content);

describe.skipIf(process.platform === 'win32')('docker CLI handling (fake docker)', () => {
	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'fake-docker-'));
		await writeFile(path.join(dir, 'docker'), fake(dir));
		await chmod(path.join(dir, 'docker'), 0o755);
		for (const f of ['Dockerfile', 'package.json', 'package-lock.json'])
			await writeFile(path.join(dir, f), f);
		vi.stubEnv('PATH', `${dir}${path.delimiter}${process.env.PATH}`);
		vi.stubEnv('AISE_RUNNER_DIR', dir);
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await rm(dir, { recursive: true, force: true });
	});

	const markBuilt = () => writeFile(path.join(dir, 'built'), '');
	const runOpts = { timeoutMs: 300 };

	describe('timeouts', () => {
		it('removes the container by name and reports timedOut', async () => {
			await markBuilt();
			const r = await runInRunner(dir, ['sleep', '30'], runOpts);
			expect(r.timedOut).toBe(true);
			const [run] = await calls('run');
			const name = /--name (aise-[0-9a-f]+)/.exec(run!)?.[1];
			expect(name).toBeDefined();
			// Once to stop it, once after the CLI exited in case the daemon created it late.
			expect(await calls('rm')).toEqual([`rm -f ${name}`, `rm -f ${name}`]);
		});

		it('removes a container the daemon creates after the timeout', async () => {
			// The CLI is killed before the container exists: the first removal finds nothing.
			const r = await docker(['sleep-cli'], { timeoutMs: 200, killName: 'aise-late' });
			expect(r.timedOut).toBe(true);
			expect(await calls('rm')).toEqual(['rm -f aise-late', 'rm -f aise-late']);
		});

		it('retries a failed docker rm once', async () => {
			await flag('kill-fail-first');
			const r = await docker(['run', '--name', 'aise-x', 'img'], {
				timeoutMs: 200,
				killName: 'aise-x'
			});
			expect(r.timedOut).toBe(true);
			expect((await calls('rm')).length).toBeGreaterThanOrEqual(2);
		});
	});

	it('passes docker only PATH, HOME and DOCKER_* settings, never secrets from .env', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'sk-secret');
		vi.stubEnv('DOCKER_HOST', 'unix:///tmp/d.sock');
		vi.stubEnv('DOCKER_CONTEXT', '');
		// Passed through when set (Linux credential helpers); cleared so the result is the same on every host.
		for (const k of [
			'XDG_RUNTIME_DIR',
			'DBUS_SESSION_BUS_ADDRESS',
			'SSH_AUTH_SOCK',
			'WSL_DISTRO_NAME',
			'WSL_INTEROP'
		])
			vi.stubEnv(k, '');
		const r = await docker(['env'], { timeoutMs: 5000 });
		const names = r.stdout
			.split('\n')
			.map((l) => l.split('=')[0])
			.filter((n) => n && n !== 'PWD' && n !== 'SHLVL' && n !== '_');
		expect(r.stdout).not.toContain('sk-secret');
		expect(names.sort()).toEqual(['DOCKER_HOST', 'HOME', 'PATH']);
	});

	describe('daemon detection', () => {
		it('does not treat container output as Docker being down', async () => {
			await flag('run-stderr', 'error during connect: the program said so\n');
			const r = await docker(['run', 'img'], { timeoutMs: 5000, killName: 'aise-x' });
			expect(r.code).toBe(1);
			expect(r.stderr).toContain('error during connect');
		});

		it('reports Docker down when the daemon message is real', async () => {
			await flag('run-stderr', 'docker: Cannot connect to the Docker daemon at x.\n');
			await flag('daemon-down');
			const err = await docker(['run', 'img'], { timeoutMs: 5000, killName: 'aise-x' }).catch(
				(e: unknown) => e
			);
			expect(err).toBeInstanceOf(ToolError);
			expect((err as ToolError).message).toBe(DOCKER_DOWN);
		});

		it('reports Docker down on a socket permission error from the CLI', async () => {
			await flag(
				'run-stderr',
				'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock\n'
			);
			await expect(docker(['run', 'img'], { timeoutMs: 5000 })).rejects.toThrow(DOCKER_DOWN);
		});

		it('only looks at the first stderr line', async () => {
			await flag('run-stderr', 'starting\nCannot connect to the Docker daemon\n');
			const r = await docker(['run', 'img'], { timeoutMs: 5000 });
			expect(r.code).toBe(1);
		});
	});

	describe('runInRunner', () => {
		it('uses a fresh random container name per run', async () => {
			await markBuilt();
			await flag('run-quick');
			await runInRunner(dir, ['true'], runOpts);
			await runInRunner(dir, ['true'], runOpts);
			const names = (await calls('run')).map((l) => /--name (\S+)/.exec(l)?.[1]);
			expect(names).toHaveLength(2);
			expect(names[0]).toMatch(/^aise-[0-9a-f]{12}$/);
			expect(names[0]).not.toBe(names[1]);
		});
	});

	describe('ensureRunnerImage', () => {
		it('builds once for concurrent callers and tags latest', async () => {
			const [a, b] = await Promise.all([ensureRunnerImage(), ensureRunnerImage()]);
			expect(a).toBe(b);
			const builds = await calls('build');
			expect(builds).toHaveLength(1);
			expect(builds[0]).toContain(`-t ${a} -t aise-runner:latest`);
		});

		it('skips the build when the image exists', async () => {
			await markBuilt();
			await ensureRunnerImage();
			expect(await calls('build')).toHaveLength(0);
		});

		it('rejects with the build log, and a later call builds again', async () => {
			await flag('build-fail');
			await expect(ensureRunnerImage()).rejects.toThrow(
				/Building the runner image failed[\s\S]*build step failed/
			);
			await flag('build-fail', null);
			await expect(ensureRunnerImage()).resolves.toMatch(/^aise-runner:/);
			expect(await calls('build')).toHaveLength(2);
		});
	});
});
