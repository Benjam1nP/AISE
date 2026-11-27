import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { placeholderFor } from '../deploy-env';
import { ProjectStore } from '../store';
import { executeTool, TOOLS } from './index';
import { checkComposeText, validateCompose } from './compose-check';
import { publishedPorts } from './deploy';

/** One service named web with extra lines (already indented by 4 spaces) appended. */
const svc = (extra: string) => `services:\n  web:\n    build: .\n${extra}\n`;

describe('validateCompose (on Compose config output)', () => {
	const DIR = '/p/hello';
	const project = { name: 'aise-hello', dir: DIR };
	const port = {
		mode: 'ingress',
		host_ip: '127.0.0.1',
		target: 3000,
		published: '3917',
		protocol: 'tcp'
	};
	/** `docker compose config --format json` of the hello fixture, recorded; `web` overrides its service. */
	const config = (web: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({
		name: 'aise-hello',
		networks: { default: { name: 'aise-hello_default', ipam: {} } },
		services: {
			web: {
				build: { context: DIR, dockerfile: 'Dockerfile' },
				command: null,
				entrypoint: null,
				networks: { default: null },
				ports: [port],
				...web
			}
		},
		...top
	});
	const check = (doc: unknown) => validateCompose(doc, project);
	const bind = (source: string, target: string) => ({ type: 'bind', source, target, bind: {} });

	it('refuses characters outside printable ASCII in the parsed output', () => {
		// "\x85" in a quoted YAML string survives as U+0085, which Compose folds when it reads the JSON again.
		expect(check(config({ environment: { A: 'x\u0085y' } }))[0]).toContain('ASCII');
	});

	it('accepts the hello fixture, also with every allowed key', () => {
		expect(check(config())).toEqual([]);
		const all = config(
			{
				environment: { NODE_ENV: 'production' },
				volumes: [
					{ type: 'volume', source: 'data', target: '/data', read_only: true, volume: {} },
					{ type: 'tmpfs', target: '/tmp' }
				],
				healthcheck: { test: ['CMD', 'true'] },
				command: ['node', 'server.js'],
				depends_on: { db: { condition: 'service_started', required: true } },
				init: true
			},
			{ volumes: { data: { name: 'aise-hello_data' } } }
		);
		expect(check(all)).toEqual([]);
	});

	it.each([
		['$ Compose would interpolate again', config({ command: ['echo', '${HOME}'] }), '"$"'],
		['privileged (the U+2028 payload)', config({ privileged: true }), '"privileged"'],
		['pid host', config({ pid: 'host' }), '"pid"'],
		['image could replace the runner image', config({ image: 'aise-runner:latest' }), '"image"'],
		['restart', config({ restart: 'always' }), '"restart"'],
		['an entrypoint', config({ entrypoint: ['sh'] }), '"entrypoint"'],
		['a second network', config({ networks: { default: null, host: null } }), 'networks'],
		['a top level key', config({}, { secrets: {} }), '"secrets"'],
		['another project name', { ...config(), name: 'other' }, 'name'],
		[
			'a network definition',
			config({}, { networks: { default: { name: 'x', driver: 'host' } } }),
			'networks'
		],
		[
			'volume driver_opts',
			config({}, { volumes: { v: { name: 'aise-hello_v', driver_opts: { device: '/' } } } }),
			'volumes.v'
		],
		[
			'an external volume',
			config({}, { volumes: { v: { name: 'other', external: true } } }),
			'volumes.v'
		],
		['build.network', config({ build: { context: DIR, network: 'host' } }), 'build.network'],
		[
			'build.entitlements',
			config({ build: { context: DIR, entitlements: ['network.host'] } }),
			'build.entitlements'
		],
		['build context other than the project', config({ build: { context: '/p' } }), 'build.context'],
		[
			'dockerfile outside',
			config({ build: { context: DIR, dockerfile: '../Dockerfile' } }),
			'dockerfile'
		],
		[
			'port on every interface',
			config({ ports: [{ mode: 'ingress', target: 3000, published: '3917', protocol: 'tcp' }] }),
			'ports'
		],
		['environment from the host', config({ environment: { API_KEY: null } }), 'environment'],
		['bind /:/host', config({ volumes: [bind('/', '/host')] }), 'volumes'],
		['bind ~/.ssh:/x', config({ volumes: [bind('/Users/a/.ssh', '/x')] }), 'volumes'],
		['bind C:\\x:/u', config({ volumes: [bind('C:\\x', '/u')] }), 'volumes'],
		[
			'a named volume with a path as source',
			config({ volumes: [{ type: 'volume', source: '/etc', target: '/e' }] }),
			'volumes'
		]
	])('refuses %s', (_name, doc, key) => {
		const problems = check(doc);
		expect(problems, problems.join(' | ')).toHaveLength(1);
		expect(problems[0]).toContain(key);
	});

	it.each([
		['not a mapping', []],
		['no services', { name: 'aise-hello', services: {} }],
		['service not a mapping', { name: 'aise-hello', services: { web: 'nope' } }]
	])('refuses a malformed document: %s', (_name, doc) => {
		expect(check(doc)).toHaveLength(1);
	});
});

describe('checkComposeText (before Compose reads the file)', () => {
	it('accepts the hello fixture', () => {
		const hello = readFileSync(
			new URL('../../../../../test/docker/fixtures/hello-deploy/compose.yaml', import.meta.url),
			'utf8'
		);
		expect(checkComposeText(hello)).toEqual([]);
		expect(checkComposeText(hello.replaceAll('\n', '\r\n'))).toEqual([]);
	});

	it.each([
		['U+2028', ' ', 'U+2028'],
		['U+2029', ' ', 'U+2029'],
		['U+0085', '\u0085', 'U+0085'],
		['a bare CR', '\r', 'U+000D']
	])('refuses %s, which Compose may read as a line break', (_name, ch, code) => {
		const problems = checkComposeText(svc(`    # note${ch}    privileged: true`));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(code);
	});

	it.each([
		['raw', svc('    command: echo ${HOME}')],
		['\\x24 escape', svc('    command: "echo \\x24{HOME}"')],
		['\\u0024 escape', svc('    command: "echo \\u0024{HOME}"')]
	])('refuses $ (%s), Compose would fill in host variables', (_name, text) => {
		const problems = checkComposeText(text);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('"$"');
	});

	it.each([
		['env_file', svc('    env_file: /etc/passwd'), 'env_file'],
		['label_file', svc('    label_file: /etc/hosts'), 'label_file'],
		['include', `include:\n  - ../x.yaml\n${svc('')}`, 'include'],
		['extends', svc('    extends:\n      file: ../x.yaml\n      service: s'), 'extends'],
		['a yaml tag', svc('    command: !!binary ZWNobw=='), '!'],
		['a bare environment name', svc('    environment:\n      - HOME'), 'environment'],
		['an empty environment value', svc('    environment:\n      API_KEY:'), 'environment']
	])('refuses %s, which Compose would resolve out of sight', (_name, text, key) => {
		const problems = checkComposeText(text);
		expect(problems, problems.join(' | ')).toHaveLength(1);
		expect(problems[0]).toContain(key);
	});
});

describe('deploy_check input', () => {
	it('takes no url (the tool then uses http://localhost:8080/health) and caps the timeout at 180 s', () => {
		const input = TOOLS.deploy_check.input;
		expect(input.parse({})).toEqual({ timeoutMs: 180_000 });
		expect(input.safeParse({ timeoutMs: 180_001 }).success).toBe(false);
	});
});

describe('publishedPorts', () => {
	it('collects the host ports of every service from Compose JSON', () => {
		const doc = {
			services: {
				web: { ports: [{ host_ip: '127.0.0.1', target: 3000, published: '3917' }] },
				api: { ports: [{ host_ip: '127.0.0.1', target: 4000, published: 8080 }] },
				db: {}
			}
		};
		expect([...publishedPorts(doc)].sort()).toEqual(['3917', '8080']);
	});

	it('is empty when nothing is published', () => {
		expect(publishedPorts({ services: { web: { ports: [] } } }).size).toBe(0);
		expect(publishedPorts({}).size).toBe(0);
	});
});

describe('deploy_check refuses an unsafe compose.yaml before touching Docker', () => {
	let root: string;
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('returns every problem as an error result', async () => {
		root = await mkdtemp(path.join(tmpdir(), 'aise-compose-'));
		// No Dockerfile: if validation were skipped, `up` would fail quickly instead of starting anything.
		await writeFile(
			path.join(root, 'compose.yaml'),
			'services:\n  web:\n    build: .\n    env_file: /etc/passwd\n    environment:\n      - HOME\n'
		);
		const ctx = {
			store: new ProjectStore(root),
			runId: 'r1',
			projectName: 'x',
			agent: 'deploy' as const
		};
		const r = await executeTool(ctx, 'deploy_check', {}, Object.keys(TOOLS));
		expect(r.isError).toBe(true);
		expect(r.content).toContain('compose.yaml is not allowed');
		expect(r.content).toContain('env_file');
		expect(r.content).toContain('environment');
	});
});

describe('checkComposeText on the deploy placeholders', () => {
	it.each(['PORT', 'METRICS_PORT', 'WEBHOOK_URL', 'API_KEY'])(
		'accepts the placeholder for %s as a quoted environment value',
		(name) => {
			const text = svc(`    environment:\n      ${name}: "${placeholderFor(name)}"`);
			expect(checkComposeText(text)).toEqual([]);
		}
	);
});
