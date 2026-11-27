import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deployPlan } from '../core/deploy-plan';
import { createRun } from '../core/runs';
import { DesignDoc } from '../core/schemas/design';
import { ProjectStore } from '../core/store';
import { executeTool, TOOLS } from '../core/tools';
import { ADDED_KEYS, RESOLVED_KEYS, SERVICE_KEYS } from '../core/tools/compose-check';
import { TOOLS_BY_AGENT } from '../core/tools/scope';
import { AGENTS, deployAgent, deployBrief, deployUpdateBrief } from './index';

const read = (rel: string): unknown =>
	JSON.parse(readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8'));
const auction = DesignDoc.parse(read('showcases/auction/.aise/design.json'));
const auctionPkg = read('showcases/auction/package.json');
const plan = deployPlan(auction, auctionPkg);

describe('deployBrief', () => {
	const brief = deployBrief(plan, 'auction');

	it('starts with the mode and lists every service with command, port, env, volume', () => {
		expect(brief.startsWith('Mode generate.')).toBe(true);
		expect(brief).toContain('command: npm run start:live-update-server');
		expect(brief).toContain('API_SERVER_URL=ws://api-server:8080');
		expect(brief).toContain('LIVE_UPDATE_SERVER_PORT=8081');
		expect(brief).toContain('DB_PATH=/data/app.db');
		expect(brief).toContain('volume: data at /data');
	});

	it('lists every health url for deploy_check', () => {
		const urls = brief.split('Health urls for deploy_check')[1];
		expect(urls).toContain('http://localhost:8080/health');
		expect(urls).toContain('http://localhost:8081/health');
	});

	it('warns about a missing start script only when there is one', () => {
		expect(brief).not.toContain('Missing start scripts');
		const missing = deployBrief({ ...plan, missingScripts: ['start:live-update-server'] }, 'x');
		expect(missing).toContain('Missing start scripts');
		expect(missing).toContain('start:live-update-server');
	});

	it('names no extra variable when src reads none', () => {
		expect(brief).not.toContain('change-me');
		expect(brief).not.toContain('change before real use');
	});

	it('gives a placeholder that is valid for the type of the variable', () => {
		const b = deployBrief(plan, 'x', ['METRICS_PORT', 'PORT_OFFSET', 'WEBHOOK_URL', 'API_KEY']);
		expect(b).toContain('METRICS_PORT=3000');
		expect(b).toContain('WEBHOOK_URL=http://change-me.invalid');
		// a name that only contains PORT or URL is text
		expect(b).toContain('PORT_OFFSET=change-me-port-offset');
		expect(b).toContain('API_KEY=change-me-api-key');
		expect(b).toContain('valid value of its type');
	});

	it('lists each extra variable with a literal placeholder and asks for RUN.md', () => {
		const b = deployBrief(plan, 'booking', ['ADMIN_PASSWORD', 'SMTP_HOST']);
		expect(b).toContain('ADMIN_PASSWORD=change-me-admin-password');
		expect(b).toContain('SMTP_HOST=change-me-smtp-host');
		expect(b).toContain('every service');
		expect(b).toContain('change before real use');
		expect(b).toContain('RUN.md');
		expect(
			b
				.split('\n')
				.filter((l) => l.includes('=change-me'))
				.join('')
		).not.toContain('$');
	});
});

describe('deployUpdateBrief', () => {
	it('names an added and a removed service, changed ones by service name', () => {
		const b = deployUpdateBrief(
			plan,
			['DSN-002'],
			['DSN-009'],
			['DSN-007', 'dependencies'],
			auction
		);
		expect(b.startsWith('Mode update.')).toBe(true);
		expect(b).toContain('DSN-009');
		expect(b).toContain('DSN-007');
		expect(b).toContain('dependencies');
		const changed = b.split('Added')[0];
		expect(changed).not.toContain('not a service now');
		expect(changed).toContain(plan.services.find((s) => s.nodeId === 'DSN-002')?.name ?? 'MISSING');
		// a removed ID is not in the plan, so the agent is told to drop every service the plan lacks
		expect(b).toContain('remove every service of compose.yaml that is not in the planned list');
		// the full current plan follows
		expect(b).toContain('npm run start:live-update-server');
	});

	it('names a code change as changed, never as a service', () => {
		const b = deployUpdateBrief(plan, ['code'], [], [], auction);
		expect(b.split('Added')[0]).toContain('code (the files under src/');
		expect(b.split('Added')[0]).not.toContain('not a service now');
	});

	it('repeats the extra variables', () => {
		expect(deployUpdateBrief(plan, [], [], [], auction, ['ADMIN_PASSWORD'])).toContain(
			'ADMIN_PASSWORD=change-me-admin-password'
		);
	});
});

describe('deploy agent definition', () => {
	it('uses Sonnet at medium effort and only the deploy tools', () => {
		expect(deployAgent).toMatchObject({
			name: 'deploy',
			model: 'claude-sonnet-5-5',
			effort: 'medium'
		});
		expect(AGENTS.deploy).toBe(deployAgent);
		expect(deployAgent.tools).toEqual(TOOLS_BY_AGENT.deploy.filter((t) => t in TOOLS));
		expect(deployAgent.tools).toContain('deploy_check');
		expect(deployAgent.tools).not.toContain('delete_file');
	});

	it('lists the allowed service keys the compose checker accepts', () => {
		const line = deployAgent.system
			.split('\n')
			.find((l) => l.startsWith('- Allowed service keys:'))!;
		const listed = line
			.slice('- Allowed service keys:'.length)
			.split('.')[0]
			.split(',')
			.map((k) => k.trim())
			.sort();
		// healthcheck is allowed by the checker, but the prompt forbids it (no curl in node:22-slim).
		expect(listed).toEqual(
			SERVICE_KEYS.split(' ')
				.filter((k) => k !== 'healthcheck')
				.sort()
		);
		expect(SERVICE_KEYS.split(' ')).toContain('healthcheck');
		expect(deployAgent.system).toContain('Do not write a healthcheck');
		// accepted only at their Compose defaults, so the prompt says not to write them
		for (const key of ADDED_KEYS.split(' ')) expect(deployAgent.system).toContain(key);
		// restart and image are refused by the config check; the rest are the keys the text check refuses
		const refused = deployAgent.system
			.split('\n')
			.find((l) => l.startsWith('- Not allowed:'))!
			.slice('- Not allowed:'.length)
			.split(',')
			.map((k) => k.trim());
		expect(refused.slice(0, 2 + RESOLVED_KEYS.size).sort()).toEqual(
			['restart', 'image', ...RESOLVED_KEYS].sort()
		);
	});

	it('forbids what the compose text check refuses', () => {
		const s = deployAgent.system;
		for (const part of [
			'The top level holds only services and volumes',
			'no YAML anchors or aliases',
			'no "!" anywhere, not even in a comment',
			'label_file, include, extends',
			'Do not write a healthcheck',
			'curl and wget are not in node:22-slim',
			'the planned environment plus the extra variables the brief lists',
			'Docker is not running',
			'Change before real use'
		])
			expect(s, part).toContain(part);
	});

	it('states the rules the gate and the allowlist depend on', () => {
		const s = deployAgent.system;
		for (const part of [
			'FROM node:22-slim',
			'npm ci',
			'CMD ["npm", "start"]',
			'ports: ["127.0.0.1:<port>:<port>"]',
			'At most 3',
			'docker compose down -v'
		])
			expect(s).toContain(part);
	});
});

describe('deploy scope through real tool execution', () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp('/tmp/p6-task4-scope-');
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('refuses a write outside Dockerfile, compose.yaml and RUN.md', async () => {
		const store = new ProjectStore(path.join(root, 'proj'));
		const meta = await createRun(store, 'P6', 'deploy');
		const ctx = { store, runId: meta.id, projectName: 'x', agent: deployAgent.name };
		const bad = await executeTool(
			ctx,
			'write_file',
			{ path: 'src/app/main.ts', content: 'x' },
			deployAgent.tools
		);
		expect(bad.isError).toBe(true);
		const ok = await executeTool(
			ctx,
			'write_file',
			{ path: 'RUN.md', content: 'x' },
			deployAgent.tools
		);
		expect(ok.isError).toBe(false);
	});
});
