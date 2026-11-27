import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { AgentName } from '../core/tools';
import { AGENT_NAMES, createMcpServer } from './server';

// stdout carries the protocol; log to stderr only.
const { values } = parseArgs({
	options: { project: { type: 'string' }, agent: { type: 'string', default: 'mcp' } }
});

function fail(message: string): never {
	console.error(`aise-mcp: ${message}`);
	console.error('Usage: npm run mcp -- --project <dir> [--agent <name>]');
	process.exit(2);
}

if (!values.project) fail('--project <dir> is required');
if (!AGENT_NAMES.includes(values.agent as AgentName))
	fail(`unknown agent "${values.agent}"; use one of ${AGENT_NAMES.join(', ')}`);

const projectDir = values.project;
if (!statSync(projectDir, { throwIfNoEntry: false })?.isDirectory())
	fail(`--project ${projectDir} is not an existing directory`);
const agent = values.agent as AgentName;
serveStdio(() => createMcpServer({ projectDir, agent }));
console.error(`aise-mcp: serving ${projectDir} as agent ${agent} on stdio`);
