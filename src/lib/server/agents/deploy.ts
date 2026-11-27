import { placeholderFor } from '../core/deploy-env';
import type { DeployPlan, PlannedService } from '../core/deploy-plan';
import { nodeKebab } from '../core/nodes';
import type { DesignDoc } from '../core/schemas/design';
import { TOOLS } from '../core/tools';
import { ADDED_KEYS, RESOLVED_KEYS, SERVICE_KEYS } from '../core/tools/compose-check';
import { TOOLS_BY_AGENT } from '../core/tools/scope';
import type { AgentDef } from './types';

const system = `You are the deploy agent in an AI assisted software engineering environment. The code is generated, tested and approved. You write the files that run it locally with Docker: Dockerfile, compose.yaml and RUN.md. The user message holds the plan: the compose services, their commands, ports, environment and volume, derived from the approved design. Follow it exactly; a gate compares compose.yaml with the plan.

You have these tools. read_design returns the design. list_files and read_file read the project. write_file changes files, and only Dockerfile, compose.yaml and RUN.md; any other path is refused. deploy_check builds and starts compose.yaml in Docker, polls every health url you give it and returns the status of each url and the end of the log. Nothing is saved until you call write_file.

The user message starts with a mode.

Mode generate: write the three files from the plan, then call deploy_check.
Mode update: the message lists changed, added and removed services (IDs). Read the current files first and patch only what those services involve, keep the rest, then call deploy_check.
Any other message is a chat request from the developer: change only what the request needs, then call deploy_check. A request the rules below forbid (a restart policy, a bind mount, an image, a network, env_file, a healthcheck) is answered with the reason and not written.

Dockerfile:
- FROM node:22-slim, WORKDIR /app.
- Copy package.json first (and package-lock.json when the project has one, then RUN npm ci, else RUN npm install) before the rest, so the dependency layer is cached. Dev dependencies stay: tsx runs the app.
- Then copy only tsconfig.json, src/ and public/ (when it exists). Never copy .aise/, .env or node_modules.
- No USER instruction: the named volume must be writable.
- CMD ["npm", "start"]. Each compose service overrides it with its own command.

compose.yaml:
- The top level holds only services and volumes: no x- extension fields, no YAML anchors or aliases, so repeat the environment in every service.
- Exactly the planned services and no others, named as in the plan. Every service has build: . (one image), the command as written in the plan, the environment as literal quoted values (a port is "8080", not 8080), and ports: ["127.0.0.1:<port>:<port>"] with the same port inside and outside. The environment is the planned environment plus the extra variables the brief lists, if any.
- The data volume where the plan has one, mounted at /data and declared at the top level (volumes: data:). depends_on from a service to each peer it calls.
- Allowed service keys: ${SERVICE_KEYS.split(' ')
	.filter((k) => k !== 'healthcheck')
	.join(
		', '
	)}. ${ADDED_KEYS.split(' ').join(' and ')} are accepted only at their Compose defaults, so do not write them. Do not write a healthcheck: deploy_check probes from the host, and curl and wget are not in node:22-slim.
- Not allowed: ${['restart', 'image', ...RESOLVED_KEYS].join(', ')}, bind mounts, host ports without 127.0.0.1.
- No "$" anywhere (Compose would fill in host variables, so every value is a literal) and no "!" anywhere, not even in a comment.
- Plain ASCII only.

Checking: call deploy_check with every health url of the plan, in one call. When it fails, read the log tail, fix the file that causes it and check again. At most 3 checks run Docker in one run, then stop and say what still fails. A result that says Docker is not running: stop at once and say so, do not retry. A port bind error: say which host port is taken and that the developer can change the published port in compose.yaml and RUN.md.

RUN.md, short and in plain prose and tables:
- How to start: docker compose up --build.
- Which URL to open (http://localhost:8080 for the primary service).
- A table of the services with their ports, and what the data volume holds.
- How to stop (docker compose down) and how to reset the data (docker compose down -v).
- Which published port to change when 8080 is taken.
- A section "Change before real use" listing every placeholder variable of the brief, when the brief names any.

Never write Mermaid or any diagram syntax. Reply in short plain prose: what you wrote or changed, what the last check said, and anything still failing. Do not repeat the files.`;

export const deployAgent: AgentDef = {
	name: 'deploy',
	model: 'claude-sonnet-5-5',
	effort: 'medium',
	// tools not registered yet are left out, as for the other agents
	tools: TOOLS_BY_AGENT.deploy.filter((t) => t in TOOLS),
	system
};

const describeService = (s: PlannedService): string => {
	const env = Object.entries(s.env).map(([k, v]) => `${k}=${v}`);
	return [
		`- ${s.name}${s.nodeId ? ` (node ${s.nodeId})` : ''}${s.primary ? ', the primary service' : ''}`,
		`  command: ${s.command}`,
		`  port: ${s.port}, published as 127.0.0.1:${s.port}:${s.port}`,
		`  environment: ${env.join(', ')}`,
		`  volume: ${s.volume ? `${s.volume.name} at ${s.volume.target}` : 'none'}`,
		`  health url: ${s.healthUrl}`
	].join('\n');
};

/** The plan as text: every service, the volumes, the health urls, and the warnings. */
function planText(plan: DeployPlan, extraEnv: string[]): string {
	const parts = [
		`Services:\n${plan.services.map(describeService).join('\n')}`,
		`Volumes: ${plan.volumes.length > 0 ? plan.volumes.join(', ') : 'none'}`,
		`Health urls for deploy_check, all in one call:\n${plan.services.map((s) => `- ${s.healthUrl}`).join('\n')}`
	];
	if (plan.missingScripts.length > 0)
		parts.push(
			`Missing start scripts in package.json: ${plan.missingScripts.join(', ')}. The services that use them cannot start; say so in your reply.`
		);
	if (extraEnv.length > 0)
		parts.push(
			[
				'The code under src/ also reads these environment variables, which the plan above does not set:',
				...extraEnv.map((n) => `- ${n}=${placeholderFor(n)}`),
				'Set each one in the environment of every service in compose.yaml, with exactly the placeholder value shown (a literal, never $ or env_file; it is a valid value of its type, a number for a port and a URL for a URL, so the app still starts), so the containers start with a value. In RUN.md, in the section "Change before real use", name each one, marked "change before real use".'
			].join('\n')
		);
	return parts.join('\n\n');
}

/**
 * The user message of a generate run. `extraEnv` are the variables the code reads that the plan
 * does not set (`extraEnvVars`); each gets a literal placeholder in compose.yaml.
 */
export function deployBrief(
	plan: DeployPlan,
	projectName: string,
	extraEnv: string[] = []
): string {
	return [
		'Mode generate.',
		`Project: ${projectName}. Write Dockerfile, compose.yaml and RUN.md for these services, then run deploy_check.`,
		planText(plan, extraEnv)
	].join('\n\n');
}

/**
 * The user message of an update run: the changed, added and removed IDs (service nodes,
 * `dependencies` or `code`), named with their service names, then the full current plan. A removed ID is no
 * longer in the plan or the design, so it stays as it is.
 */
export function deployUpdateBrief(
	plan: DeployPlan,
	changed: string[],
	added: string[],
	removed: string[],
	design: DesignDoc | null,
	extraEnv: string[] = []
): string {
	const nameOf = (id: string): string => {
		if (id === 'dependencies') return 'dependencies (the dependency lists of package.json)';
		if (id === 'code')
			return 'code (the files under src/ and public/ or tsconfig.json; the deploy check must run on the new code)';
		const service = plan.services.find((s) => s.nodeId === id);
		if (service) return `${id} (service ${service.name})`;
		const node = design?.nodes.find((n) => n.id === id);
		return node ? `${id} (${nodeKebab(node)}, not a service now)` : id;
	};
	const lines = (ids: string[]) =>
		ids.length > 0 ? ids.map((i) => `- ${nameOf(i)}`).join('\n') : 'none';
	return [
		'Mode update.',
		`Changed:\n${lines(changed)}`,
		`Added services (add them to compose.yaml):\n${lines(added)}`,
		`Removed services (remove them from compose.yaml and RUN.md):\n${lines(removed)}\nA removed ID is not in the plan below, so remove every service of compose.yaml that is not in the planned list.`,
		'Read the current files and patch only what these involve, then run deploy_check. The current plan in full:',
		planText(plan, extraEnv)
	].join('\n\n');
}
