import path from 'node:path';

export type AgentName =
	'requirements' | 'design' | 'review' | 'code' | 'test' | 'deploy' | 'maintenance' | 'mcp';

/**
 * Tools per agent, from section 5 of the design spec. Names of tools that are not in TOOLS yet are
 * ignored, so a tool shows up here as soon as it is registered. `mcp` (a human in an MCP client)
 * gets every registered tool. The in process agents use the same rows; toolsFor in mcp/server.ts
 * removes RUN_ONLY_TOOLS from every MCP session.
 */
export const TOOLS_BY_AGENT: Record<AgentName, string[]> = {
	requirements: ['read_requirements', 'write_requirements'],
	design: ['read_requirements', 'read_design', 'update_design', 'report_coverage', 'code_model'],
	review: ['read_requirements', 'read_design', 'report_design_proposals'],
	code: [
		'read_requirements',
		'read_design',
		'list_files',
		'read_file',
		'write_file',
		'delete_file',
		'trace',
		'typecheck',
		'detect_drift',
		'start_app'
	],
	test: [
		'read_requirements',
		'read_design',
		'code_model',
		'list_files',
		'read_file',
		'write_file',
		'delete_file',
		'typecheck',
		'run_tests',
		'report_test_fix',
		'report_code_bug'
	],
	deploy: ['read_design', 'list_files', 'read_file', 'write_file', 'deploy_check'],
	maintenance: [
		'read_requirements',
		'read_design',
		'code_model',
		'list_files',
		'read_file',
		'trace',
		'detect_drift',
		'read_tickets',
		'write_ticket_plan',
		'write_ticket_report'
	],
	mcp: []
};

/** Tools that need an in process run to attach to (the test agent's reports, the code agent's fix result, the ticket plan and report, the design review's proposals); no MCP session is offered them, whatever its agent. */
export const RUN_ONLY_TOOLS = [
	'report_test_fix',
	'report_code_bug',
	'report_fix_result',
	'write_ticket_plan',
	'write_ticket_report',
	'report_design_proposals'
];

/** What the code agent may write and what the P4 code hash covers; a trailing slash is a folder. */
export const CODE_ROOTS = ['src/', 'public/', 'package.json', 'tsconfig.json'];

/** Generated docs the Code tab shows next to the code. Outside `CODE_ROOTS`, so no agent writes them and the code hash ignores them. */
export const DOC_FILES = ['README.md'];

// An entry ending in "/" is a folder and covers everything below it; any other entry is one file.
const AGENT_WRITES: Record<Exclude<AgentName, 'mcp'>, readonly string[]> = {
	requirements: [],
	design: [],
	review: [],
	maintenance: [],
	code: CODE_ROOTS,
	test: ['test/'],
	deploy: ['Dockerfile', 'compose.yaml', 'RUN.md']
};
/** `mcp` (a human through an MCP client) may write whatever any agent may write. */
const WRITES: Record<AgentName, readonly string[]> = {
	...AGENT_WRITES,
	mcp: [...new Set(Object.values(AGENT_WRITES).flat())]
};
/** Everyone reads the whole project except these. */
const READ_DENY: Partial<Record<AgentName, readonly string[]>> = { test: ['src/'] };

export const MAX_PATH_LENGTH = 1024;

/** Project relative path with forward slashes and no `./`; `''` for the root. */
export function normalise(rel: string): string {
	const p = path.posix.normalize(rel.replaceAll('\\', '/')).replace(/\/+$/, '');
	return p === '.' ? '' : p;
}

/**
 * Why a path is refused for every agent, or null. Checked on the raw input, so `src/../.env`
 * fails for its `..` before normalising could hide it.
 */
export function rejectReason(rel: string): string | null {
	if (rel.length > MAX_PATH_LENGTH) return `Paths are limited to ${MAX_PATH_LENGTH} characters.`;
	if (rel.includes('\0')) return 'Paths may not contain NUL bytes.';
	if (path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel))
		return 'Absolute paths are not allowed; use a path relative to the project root.';
	// Lower case: on case insensitive file systems (macOS, Windows) `.ENV` is `.env`.
	const parts = rel.toLowerCase().split(/[/\\]/);
	if (parts.includes('..')) return 'Paths may not contain "..".';
	if (normalise(rel).toLowerCase().split('/')[0] === '.aise')
		return '.aise/ holds the artefacts; use the artefact tools instead.';
	if (parts.some((s) => s.startsWith('.env'))) return '.env files hold secrets and are off limits.';
	if (parts.includes('node_modules')) return 'node_modules/ is off limits.';
	if (parts.includes('.git')) return '.git/ is off limits.';
	return null;
}

const covers = (entry: string, p: string) =>
	entry.endsWith('/') ? p === entry.slice(0, -1) || p.startsWith(entry) : p === entry;

export function canRead(agent: AgentName, rel: string): boolean {
	if (rejectReason(rel) !== null) return false;
	// Deny entries are lower case and compared case insensitively, so `SRC/` is `src/`. Write
	// entries stay case sensitive: a mismatch there only refuses more.
	const p = normalise(rel).toLowerCase();
	return !(READ_DENY[agent] ?? []).some((e) => covers(e, p));
}

export function canWrite(agent: AgentName, rel: string): boolean {
	if (rejectReason(rel) !== null) return false;
	const p = normalise(rel);
	// A folder entry allows files below it, not the folder itself.
	return WRITES[agent].some((e) => (e.endsWith('/') ? p.startsWith(e) : p === e));
}

/** One sentence naming what the agent may read or write, for error messages. */
export function describeScope(agent: AgentName, mode: 'read' | 'write'): string {
	if (mode === 'read') {
		const deny = READ_DENY[agent];
		return deny
			? `The ${agent} agent may read the whole project except ${deny.join(', ')}.`
			: `The ${agent} agent may read the whole project.`;
	}
	const w = WRITES[agent];
	return w.length === 0
		? `The ${agent} agent may not write any files.`
		: `The ${agent} agent may write only ${w.join(', ')}.`;
}
