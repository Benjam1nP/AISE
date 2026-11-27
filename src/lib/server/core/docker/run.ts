import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ToolError } from '../tools/registry';
import { ensureRunnerImage } from './image';

export const DOCKER_DOWN = 'Docker is not running. Start Docker Desktop and retry.';

/** Label on every runner container, so `docker ps --filter label=aise=1` finds them. */
export const RUNNER_LABEL = 'aise=1';

export type DockerResult = {
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};

/** Output beyond this is dropped from the front; the end of a log is what matters. */
const MAX_OUTPUT = 5_000_000;
const KILL_TIMEOUT_MS = 10_000;
/** After `docker rm -f`, the CLI normally exits by itself; this is the backstop. */
const CLI_GRACE_MS = 2000;
/** The in container `timeout` fires this long after the host timer, as a backstop if the host dies. */
const INNER_TIMEOUT_SLACK_S = 5;

/** What the docker CLI itself prints, on its first line, when it cannot reach the daemon. */
const DAEMON_DOWN =
	/^(docker: )?(Cannot connect to the Docker daemon|error during connect|failed to connect to the docker API|permission denied while trying to connect to the (docker|Docker) daemon socket)/;

/**
 * The only variables docker and compose see. compose interpolates `${VAR}` from its environment into
 * build args, environment and secrets, so passing process.env (which holds API keys from .env) would
 * hand them to generated code.
 */
const PASS_ENV = [
	'PATH',
	'HOME',
	'DOCKER_HOST',
	'DOCKER_CONFIG',
	'DOCKER_CONTEXT',
	'DOCKER_CERT_PATH',
	'DOCKER_TLS_VERIFY'
];
const PASS_ENV_BY_PLATFORM: Partial<Record<NodeJS.Platform, string[]>> = {
	// Docker Desktop's cli plugins (compose, buildx) live under Program Files.
	win32: [
		'SystemRoot',
		'USERPROFILE',
		'APPDATA',
		'LOCALAPPDATA',
		'ProgramData',
		'ProgramFiles',
		'ProgramW6432',
		'ProgramFiles(x86)',
		'TEMP',
		'TMP'
	],
	// Credential helpers (secret service over D-Bus) and ssh:// contexts. On WSL without Docker
	// Desktop's integration, `docker` is Docker Desktop's shim script, which runs docker.exe only when
	// it knows the distro (WSL_DISTRO_NAME) and reaches Windows through WSL interop (WSL_INTEROP).
	linux: [
		'DBUS_SESSION_BUS_ADDRESS',
		'XDG_RUNTIME_DIR',
		'SSH_AUTH_SOCK',
		'WSL_DISTRO_NAME',
		'WSL_INTEROP'
	]
};

/**
 * The docker CLI's environment: the allowlisted variables that are set and not empty. These reach
 * the CLI only; containers get none of them, since compose files may not interpolate (`$`) or name
 * bare environment variables (see compose-check.ts).
 */
export function dockerEnv(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = {};
	for (const n of [...PASS_ENV, ...(PASS_ENV_BY_PLATFORM[platform] ?? [])])
		if (env[n]) out[n] = env[n];
	return out;
}

const keepEnd = (s: string) => (s.length > MAX_OUTPUT ? s.slice(-MAX_OUTPUT) : s);

const firstLine = (s: string) => s.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';

/**
 * `docker rm -f` with its own timeout and one retry. Unlike `docker kill`, it also removes a container
 * that is created but not started yet, so the CLI cannot start it after the timeout. A container that
 * is already gone counts as removed.
 */
async function removeContainer(name: string): Promise<void> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const r = await exec(['rm', '-f', name], { timeoutMs: KILL_TIMEOUT_MS }).catch(() => null);
		if (r && !r.timedOut && (r.code === 0 || /No such container/i.test(r.stderr))) return;
	}
}

function exec(
	args: string[],
	opts: { timeoutMs: number; killName?: string }
): Promise<DockerResult> {
	return new Promise((resolve, reject) => {
		const child = spawn('docker', args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: dockerEnv()
		});
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		let settled = false;
		let grace: NodeJS.Timeout | undefined;

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (d: string) => (stdout = keepEnd(stdout + d)));
		child.stderr.on('data', (d: string) => (stderr = keepEnd(stderr + d)));

		const timer = setTimeout(() => {
			timedOut = true;
			if (!opts.killName) return void child.kill('SIGKILL');
			// Remove the container first; the CLI then exits by itself, so the result comes back after it.
			void removeContainer(opts.killName).then(() => {
				if (!settled) grace = setTimeout(() => child.kill('SIGKILL'), CLI_GRACE_MS);
			});
		}, opts.timeoutMs);

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(grace);
			fn();
		};

		child.on('error', (err: NodeJS.ErrnoException) =>
			finish(() => reject(err.code === 'ENOENT' ? new ToolError(DOCKER_DOWN) : err))
		);
		child.on('close', (code) => finish(() => resolve({ code, stdout, stderr, timedOut })));
	});
}

/**
 * Runs the docker CLI. Never rejects for a non zero exit; throws ToolError(DOCKER_DOWN) when the CLI
 * is missing or cannot reach the daemon. On timeout the container is removed when `killName` is given
 * (killing the CLI alone leaves the container running), once before and once after the CLI exits.
 *
 * The daemon check only looks at the first stderr line. For a container run (`killName`) that line
 * could be the program's own output, so it is confirmed with a `docker version` probe.
 */
export async function docker(
	args: string[],
	opts: { timeoutMs: number; killName?: string }
): Promise<DockerResult> {
	const r = await exec(args, opts);
	// The timeout can fire before the daemon has created the container, so the first removal finds
	// nothing. Once the CLI is gone nobody starts it, but the daemon may still finish creating it.
	if (r.timedOut && opts.killName) await removeContainer(opts.killName);
	if (r.code !== 0 && !r.timedOut && DAEMON_DOWN.test(firstLine(r.stderr))) {
		if (!opts.killName) throw new ToolError(DOCKER_DOWN);
		const probe = await exec(['version', '--format', '{{.Server.Version}}'], {
			timeoutMs: KILL_TIMEOUT_MS
		});
		if (probe.code !== 0) throw new ToolError(DOCKER_DOWN);
	}
	return r;
}

/** Windows host paths use forward slashes for `docker --mount`; POSIX and WSL paths stay as they are. */
export function hostPathForDocker(p: string): string {
	return /^[A-Za-z]:[\\/]/.test(p) ? p.replace(/\\/g, '/') : p;
}

/**
 * Runner containers never get a network and always mount the project read only. `outDir` is a host
 * folder mounted writable at /opt/aise/out, for results the container must hand back.
 */
export type RunnerOpts = { timeoutMs: number; outDir?: string };

/** `--mount` is a CSV, so a field holding a comma or quote is quoted; a path cannot add options. */
const csv = (field: string) => (/[",]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field);

const bindMount = (source: string, target: string, readOnly: boolean) => [
	'--mount',
	`type=bind,${csv(`source=${source}`)},target=${target}${readOnly ? ',readonly' : ''}`
];

/**
 * Arguments for `docker run`. `hostUser` is set on Linux only: there a bind mount keeps the host
 * owner, so the container must run as that user to write into it (Docker Desktop maps ownership).
 * Root (uid 0) is never passed on; the container then runs as the image's `node` user.
 */
export function buildRunArgs(
	name: string,
	tag: string,
	hostDir: string,
	cmd: string[],
	opts: RunnerOpts,
	hostUser: { uid: number; gid: number } | undefined
): string[] {
	const user = hostUser && hostUser.uid !== 0 ? hostUser : undefined;
	const innerSeconds = Math.ceil(opts.timeoutMs / 1000) + INNER_TIMEOUT_SLACK_S;
	return [
		'run',
		'--rm',
		'--name',
		name,
		'--label',
		RUNNER_LABEL,
		'--network',
		'none',
		'--cpus',
		'1',
		'--memory',
		'1g',
		'--memory-swap',
		'1g',
		'--pids-limit',
		'256',
		'--cap-drop',
		'ALL',
		'--security-opt',
		'no-new-privileges',
		'--log-driver',
		'none',
		'--read-only',
		'--tmpfs',
		'/tmp',
		...(user ? ['--user', `${user.uid}:${user.gid || user.uid}`] : []),
		...bindMount(hostDir, '/opt/aise/app', true),
		...(opts.outDir ? bindMount(opts.outDir, '/opt/aise/out', false) : []),
		tag,
		'timeout',
		'-s',
		'KILL',
		String(innerSeconds),
		...cmd
	];
}

/** Runs `cmd` in the runner image with the project mounted at /opt/aise/app (the working dir). */
export async function runInRunner(
	projectDir: string,
	cmd: string[],
	opts: RunnerOpts
): Promise<DockerResult> {
	const tag = await ensureRunnerImage();
	const name = `aise-${randomBytes(6).toString('hex')}`;
	const hostUser =
		process.platform === 'linux' && process.getuid && process.getgid
			? { uid: process.getuid(), gid: process.getgid() }
			: undefined;
	const args = buildRunArgs(
		name,
		tag,
		hostPathForDocker(path.resolve(projectDir)),
		cmd,
		opts.outDir ? { ...opts, outDir: hostPathForDocker(path.resolve(opts.outDir)) } : opts,
		hostUser
	);
	return docker(args, { timeoutMs: opts.timeoutMs, killName: name });
}
