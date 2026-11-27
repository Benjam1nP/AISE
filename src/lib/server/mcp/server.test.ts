import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { designAgent } from '../agents/design';
import { requirementsAgent } from '../agents/requirements';
import { createRun, listRuns } from '../core/runs';
import { ProjectStore } from '../core/store';
import { TOOLS, type AgentName } from '../core/tools';
import { TOOLS_BY_AGENT } from '../core/tools/scope';
import { createMcpServer } from './server';

const fixture = (name: string): Record<string, unknown> =>
	JSON.parse(readFileSync(new URL(`../../../../test/fixtures/${name}`, import.meta.url), 'utf8'));

let dir: string;
let clients: Client[];

/** A client connected to a fresh server for the agent, over the in memory transport. */
async function connect(agent: AgentName) {
	const [a, b] = InMemoryTransport.createLinkedPair();
	await createMcpServer({ projectDir: dir, agent }).connect(b);
	const client = new Client({ name: 'test', version: '0' });
	await client.connect(a);
	clients.push(client);
	return {
		names: async () => (await client.listTools()).tools.map((t) => t.name).sort(),
		call: async (name: string, args: Record<string, unknown> = {}) => {
			const r = await client.callTool({ name, arguments: args });
			const content = r.content as { type: string; text: string }[];
			return { isError: r.isError === true, text: content.map((c) => c.text).join('\n') };
		}
	};
}

const runs = () => listRuns(new ProjectStore(dir));

beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'aise-mcp-'));
	clients = [];
});

afterEach(async () => {
	await Promise.all(clients.map((c) => c.close()));
	await rm(dir, { recursive: true, force: true });
});

describe('tool listing', () => {
	it('gives the mcp agent every registered tool except the run bound ones', async () => {
		const mcp = await connect('mcp');
		expect(await mcp.names()).toEqual([
			'code_model',
			'delete_file',
			'deploy_check',
			'detect_drift',
			'list_files',
			'read_design',
			'read_file',
			'read_requirements',
			'read_tickets',
			'report_coverage',
			'run_tests',
			'start_app',
			'trace',
			'typecheck',
			'update_design',
			'write_file',
			'write_requirements'
		]);
	});

	it.each<[AgentName, string[]]>([
		['requirements', ['read_requirements', 'write_requirements']],
		[
			'design',
			['code_model', 'read_design', 'read_requirements', 'report_coverage', 'update_design']
		],
		[
			'code',
			[
				'delete_file',
				'detect_drift',
				'list_files',
				'read_design',
				'read_file',
				'read_requirements',
				'start_app',
				'trace',
				'typecheck',
				'write_file'
			]
		],
		[
			'test',
			[
				'code_model',
				'delete_file',
				'list_files',
				'read_design',
				'read_file',
				'read_requirements',
				'run_tests',
				'typecheck',
				'write_file'
			]
		],
		['deploy', ['deploy_check', 'list_files', 'read_design', 'read_file', 'write_file']],
		[
			'maintenance',
			[
				'code_model',
				'detect_drift',
				'list_files',
				'read_design',
				'read_file',
				'read_requirements',
				'read_tickets',
				'trace'
			]
		]
	])('gives the %s agent only the registered tools of its row', async (agent, expected) => {
		expect(await (await connect(agent)).names()).toEqual(expected);
	});

	it('gives the in process agents their row of the same table, with every tool registered', () => {
		for (const agent of [requirementsAgent, designAgent]) {
			expect(agent.tools).toBe(TOOLS_BY_AGENT[agent.name as AgentName]);
			expect(agent.tools.filter((t) => !(t in TOOLS))).toEqual([]);
		}
	});

	it('advertises the input schema of the tool', async () => {
		await connect('mcp');
		const tool = (await clients[0].listTools()).tools.find((t) => t.name === 'read_file')!;
		expect(tool.inputSchema.properties).toHaveProperty('path');
	});

	it('marks only tools that neither write nor run containers as read only', async () => {
		await connect('mcp');
		const hints = Object.fromEntries(
			(await clients[0].listTools()).tools.map((t) => [t.name, t.annotations?.readOnlyHint])
		);
		for (const name of ['typecheck', 'run_tests', 'deploy_check', 'write_file', 'delete_file'])
			expect(hints[name], name).toBe(false);
		expect(hints.read_file).toBe(true);
		expect(hints.trace).toBe(true);
	});
});

describe('calls', () => {
	it('applies the path scope of the agent', async () => {
		await mkdir(path.join(dir, 'src'), { recursive: true });
		await writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
		const test = await connect('test');
		const denied = await test.call('read_file', { path: 'src/a.ts' });
		expect(denied.isError).toBe(true);
		expect(denied.text).toContain('src/');
		const mcp = await connect('mcp');
		const ok = await mcp.call('read_file', { path: 'src/a.ts' });
		expect(ok.isError).toBe(false);
		expect(ok.text).toContain('export const a = 1;');
	});

	it('returns the validation text of a rejected design as an error result', async () => {
		const mcp = await connect('mcp');
		const design = fixture('todo-design.json') as {
			classes: { name: string; methods: { name: string }[] }[];
		};
		design.classes
			.find((c) => c.name === 'TaskService')!
			.methods.find((m) => m.name === 'addTask')!.name = 'createTask';
		const r = await mcp.call('update_design', design);
		expect(r.isError).toBe(true);
		expect(r.text).toContain('sequences[0].messages[1].method');
		await expect(readFile(path.join(dir, '.aise/design.json'))).rejects.toThrow();
	});

	it('writes requirements and reads them back through the same server', async () => {
		const mcp = await connect('mcp');
		const doc = fixture('todo-requirements.json');
		expect((await mcp.call('write_requirements', doc)).isError).toBe(false);
		expect(JSON.parse((await mcp.call('read_requirements')).text)).toEqual(doc);
	});
});

describe('runs', () => {
	it('records one done P7 run for all writes of a session', async () => {
		const mcp = await connect('mcp');
		await mcp.call('write_file', { path: 'src/a.ts', content: 'export const a = 1;\n' });
		await mcp.call('write_file', { path: 'src/b.ts', content: 'export const b = 2;\n' });
		await mcp.call('write_requirements', fixture('todo-requirements.json'));
		const all = await runs();
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({ phase: 'P7', agent: 'mcp', status: 'done' });
		expect(all[0].finishedAt).toBeDefined();
	});

	it('backs files up into the run so Discard can restore them', async () => {
		await mkdir(path.join(dir, 'src'), { recursive: true });
		await writeFile(path.join(dir, 'src/a.ts'), 'old\n');
		const mcp = await connect('mcp');
		await mcp.call('write_file', { path: 'src/a.ts', content: 'new\n' });
		const [run] = await runs();
		expect(await readFile(path.join(dir, `.aise/runs/${run.id}/backup/src/a.ts`), 'utf8')).toBe(
			'old\n'
		);
	});

	it('creates no run for a session that only reads', async () => {
		const mcp = await connect('mcp');
		await mcp.call('read_requirements');
		await mcp.call('list_files', {});
		await mcp.call('read_file', { path: 'src/none.ts' });
		expect(await runs()).toEqual([]);
	});

	it('keeps no run for a first write that was refused', async () => {
		const code = await connect('code');
		const r = await code.call('write_file', { path: 'test/a.test.ts', content: 'x' });
		expect(r.isError).toBe(true);
		expect((await runs()).filter((x) => x.status !== 'discarded')).toEqual([]);
		// The next accepted write still gets a run.
		await code.call('write_file', { path: 'src/a.ts', content: 'export const a = 1;\n' });
		expect((await runs()).filter((x) => x.status === 'done')).toHaveLength(1);
	});

	it('keeps the run with its files when a later write is refused', async () => {
		const code = await connect('code');
		await code.call('write_file', { path: 'src/a.ts', content: 'export const a = 1;\n' });
		const refused = await code.call('write_file', { path: 'test/a.test.ts', content: 'x' });
		expect(refused.isError).toBe(true);
		const kept = (await runs()).filter((x) => x.status === 'done');
		expect(kept).toHaveLength(1);
		const created = await readFile(
			path.join(dir, `.aise/runs/${kept[0].id}/backup/created.json`),
			'utf8'
		);
		expect(JSON.parse(created)).toEqual(['src/a.ts']);
	});

	it('keeps no run when the first write fails before touching any file', async () => {
		await mkdir(path.join(dir, '.aise'), { recursive: true });
		await writeFile(path.join(dir, '.aise/requirements.json'), '{not json');
		const mcp = await connect('mcp');
		const r = await mcp.call('update_design', fixture('todo-design.json'));
		expect(r.isError).toBe(true);
		expect((await runs()).filter((x) => x.status !== 'discarded')).toEqual([]);
	});

	it('starts a new P7 run when another run came after the session run', async () => {
		const mcp = await connect('mcp');
		await mcp.call('write_file', { path: 'src/a.ts', content: 'export const a = 1;\n' });
		const [first] = await runs();
		await createRun(new ProjectStore(dir), 'P1', 'requirements');
		await mcp.call('write_file', { path: 'src/b.ts', content: 'export const b = 1;\n' });
		const own = (await runs()).filter((r) => r.agent === 'mcp');
		expect(own).toHaveLength(2);
		const second = own.find((r) => r.id !== first.id)!;
		const created = await readFile(
			path.join(dir, `.aise/runs/${second.id}/backup/created.json`),
			'utf8'
		);
		expect(JSON.parse(created)).toEqual(['src/b.ts']);
	});

	it('creates one run when writes arrive at the same time', async () => {
		const mcp = await connect('mcp');
		await Promise.all(
			['a', 'b', 'c'].map((n) =>
				mcp.call('write_file', { path: `src/${n}.ts`, content: `export const ${n} = 1;\n` })
			)
		);
		expect(await runs()).toHaveLength(1);
	});
});

describe('main', () => {
	it('exits with code 2 when --project is not an existing directory', () => {
		const run = (project: string) =>
			spawnSync(
				process.execPath,
				['--import', 'tsx', 'src/lib/server/mcp/main.ts', '--project', project],
				{ encoding: 'utf8', input: '' }
			);
		const missing = run(path.join(dir, 'nope'));
		expect(missing.status).toBe(2);
		expect(missing.stderr).toContain('not an existing directory');
		expect(run('package.json').status).toBe(2);
	}, 30_000); // two cold tsx starts; the 5 s default is too tight while the full suite runs in parallel
});
