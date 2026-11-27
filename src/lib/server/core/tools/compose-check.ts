import { parse } from 'yaml';

/**
 * compose.yaml is written by an LLM agent and run by the host's Docker daemon. deploy_check checks
 * it twice, both pure (no Docker, no file access), each returning one line per problem:
 *
 * 1. checkComposeText on the file as written: plain ASCII only, no `$`, no YAML tags, and nothing
 *    Compose resolves out of sight of its output (`env_file`, `include`, `extends`, host values).
 * 2. validateCompose on Compose's own `config --format json` output, a short allowlist. That JSON,
 *    not compose.yaml, is what deploy_check then runs, so what runs is what was checked.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const DOLLAR = '"$" is not allowed: Compose would fill in host variables';
/** Keys Compose resolves while reading (other files, host variables), so its output hides them. */
export const RESOLVED_KEYS = new Set(['env_file', 'label_file', 'include', 'extends']);

/** Every string and mapping key in a parsed document. */
function* strings(v: unknown, keysOnly = false): Generator<string> {
	if (typeof v === 'string' && !keysOnly) yield v;
	else if (Array.isArray(v)) for (const x of v) yield* strings(x, keysOnly);
	else if (isObj(v))
		for (const [k, x] of Object.entries(v)) {
			yield k;
			yield* strings(x, keysOnly);
		}
}

/**
 * Checks on the file as written, before Compose reads it. Only tab, LF, CRLF and printable ASCII
 * pass, so this parser and Compose's cannot disagree on line breaks (U+2028, U+0085, a bare CR).
 * Also refused: `$` (raw or escaped), YAML tags, and what Compose resolves out of sight of its own
 * `config` output: `env_file`, `include`, `extends` and environment values taken from the host.
 */
export function checkComposeText(text: string): string[] {
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		const ok =
			c === 9 || c === 10 || (c >= 0x20 && c <= 0x7e) || (c === 13 && text[i + 1] === '\n');
		if (!ok) {
			const line = text.slice(0, i).split('\n').length;
			const code = `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
			return [`character ${code} on line ${line} is not allowed, use plain ASCII`];
		}
	}
	if (text.includes('$')) return [DOLLAR];
	if (text.includes('!')) return ['"!" (a YAML tag) is not allowed'];
	let doc: unknown;
	try {
		doc = parse(text, { merge: true });
	} catch (e) {
		return [`not valid YAML: ${(e as Error).message.split('\n')[0]}`];
	}
	if ([...strings(doc)].some((x) => x.includes('$'))) return [DOLLAR];
	const out = [...new Set(strings(doc, true))]
		.filter((k) => RESOLVED_KEYS.has(k))
		.map((k) => `"${k}" is not allowed, put everything in compose.yaml`);
	const services = isObj(doc) && isObj(doc.services) ? doc.services : {};
	for (const [name, svc] of Object.entries(services)) {
		const env = isObj(svc) ? svc.environment : undefined;
		const literal = (v: unknown) => ['string', 'number', 'boolean'].includes(typeof v);
		const ok = isObj(env)
			? Object.values(env).every(literal)
			: !Array.isArray(env) || env.every((e) => typeof e === 'string' && e.includes('='));
		if (!ok)
			out.push(`service "${name}": environment must hold literal values (KEY: value or KEY=value)`);
	}
	return out;
}

export const SERVICE_KEYS = 'build ports environment volumes healthcheck command depends_on init';
/** Compose adds these to every service; only their default values pass. */
export const ADDED_KEYS = 'networks entrypoint';
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const isRelativeFile = (s: unknown) =>
	typeof s === 'string' && /^[\w.-]+(\/[\w.-]+)*$/.test(s) && !s.split('/').includes('..');
const keysIn = (o: Obj, allowed: string) =>
	Object.keys(o).every((k) => allowed.split(' ').includes(k));

/** Deep equality of JSON values, ignoring key order. */
const same = (a: unknown, b: unknown): boolean =>
	isObj(a) && isObj(b)
		? Object.keys(a).length === Object.keys(b).length &&
			Object.keys(a).every((k) => k in b && same(a[k], b[k]))
		: Array.isArray(a) && Array.isArray(b)
			? a.length === b.length && a.every((x, i) => same(x, b[i]))
			: a === b;

function checkService(svc: Obj, dir: string, bad: (msg: string) => void) {
	for (const key of Object.keys(svc))
		if (!`${SERVICE_KEYS} ${ADDED_KEYS}`.split(' ').includes(key)) bad(`"${key}" is not allowed`);
	if (svc.networks !== undefined && !same(svc.networks, { default: null }))
		bad('networks are not allowed');
	if (svc.entrypoint !== undefined && svc.entrypoint !== null) bad('"entrypoint" is not allowed');

	const b = svc.build;
	if (b !== undefined) {
		if (!isObj(b)) bad('build must be the project folder');
		else {
			for (const k of Object.keys(b))
				if (k !== 'context' && k !== 'dockerfile') bad(`build.${k} is not allowed`);
			if (b.context !== dir) bad('build.context must be the project folder (".")');
			if (b.dockerfile !== undefined && !isRelativeFile(b.dockerfile))
				bad('build.dockerfile must be a relative file inside the project');
		}
	}

	for (const p of Array.isArray(svc.ports) ? svc.ports : [])
		if (
			!isObj(p) ||
			!keysIn(p, 'mode host_ip target published protocol') ||
			p.host_ip !== '127.0.0.1'
		)
			bad(`ports entry ${JSON.stringify(p)} must bind 127.0.0.1, like "127.0.0.1:3917:3000"`);

	const env = svc.environment;
	if (env !== undefined && !(isObj(env) && Object.values(env).every((v) => typeof v === 'string')))
		bad('environment must hold literal values');

	for (const v of Array.isArray(svc.volumes) ? svc.volumes : []) {
		const named =
			isObj(v) &&
			v.type === 'volume' &&
			keysIn(v, 'type source target read_only volume') &&
			typeof v.source === 'string' &&
			NAME.test(v.source) &&
			(v.volume === undefined || same(v.volume, {}));
		const tmpfs = isObj(v) && v.type === 'tmpfs' && keysIn(v, 'type target');
		if (!named && !tmpfs) bad(`volumes entry ${JSON.stringify(v)} must be a named volume or tmpfs`);
	}
	for (const key of ['ports', 'volumes'])
		if (svc[key] !== undefined && !Array.isArray(svc[key])) bad(`${key} must be a list`);
}

/**
 * The allowlist, over Compose's normalised `config --format json` output for project `name` in the
 * folder `dir` (as passed to `--project-directory`):
 * - No `$` in any string: Compose would fill in host variables again when it runs the JSON.
 * - Top level: `name`, `services`, `volumes` (plain named volumes), and only the default network.
 * - Service keys: SERVICE_KEYS. `image` is refused too, it could replace the runner image.
 * - `build` is the project folder, optionally with a Dockerfile inside it.
 * - Ports bind 127.0.0.1 explicitly; `3917:3000` alone binds every interface.
 * - Service volumes are named volumes or tmpfs; bind mounts are refused, also inside the project.
 */
export function validateCompose(doc: unknown, project: { name: string; dir: string }): string[] {
	if ([...strings(doc)].some((x) => x.includes('$'))) return [DOLLAR];
	// Compose reads this JSON again at `up`; non ASCII (U+0085) can change on that second read.
	if ([...strings(doc)].some((x) => /[^\t\n\x20-\x7e]/.test(x)))
		return ['only printable ASCII is allowed in compose values'];
	if (!isObj(doc)) return ['the file must be a mapping with a "services" section'];
	const { name, dir } = project;
	const out: string[] = [];

	for (const key of Object.keys(doc))
		if (!['name', 'services', 'volumes', 'networks'].includes(key))
			out.push(`"${key}" is not allowed at the top level`);
	if (doc.name !== name) out.push(`name must be "${name}"`);
	if (
		doc.networks !== undefined &&
		!same(doc.networks, { default: { name: `${name}_default`, ipam: {} } })
	)
		out.push('networks are not allowed');

	if (!isObj(doc.services) || Object.keys(doc.services).length === 0)
		out.push('"services" must be a mapping with at least one service');
	else
		for (const [svcName, svc] of Object.entries(doc.services)) {
			const bad = (msg: string) => out.push(`service "${svcName}": ${msg}`);
			if (isObj(svc)) checkService(svc, dir, bad);
			else bad('must be a mapping');
		}

	const volumes = doc.volumes ?? {};
	if (!isObj(volumes)) out.push('"volumes" must be a mapping');
	else
		for (const [vol, def] of Object.entries(volumes))
			if (!same(def, { name: `${name}_${vol}` }))
				out.push(
					`volumes.${vol}: only a plain named volume is allowed (no name, driver, driver_opts or external)`
				);
	return out;
}
