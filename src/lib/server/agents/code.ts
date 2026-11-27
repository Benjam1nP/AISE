import { clientComponents, clientNodeIds, PAGE } from '../core/client';
import { browserLinks, nodeKebab, publicUrl, serviceNodes } from '../core/nodes';
import type { Component, DeploymentNode, DesignDoc, NodeLink } from '../core/schemas/design';
import { TOOLS } from '../core/tools';
import { TOOLS_BY_AGENT } from '../core/tools/scope';
import { kebab, type FilePlan } from '../codegen/plan';
import { peerTarget, signatureOf, storesData } from './code-worker';
import { STACK_RULES } from './stack-rules';
import type { AgentDef } from './types';

const system = `You are the code agent in an AI assisted software engineering environment. The design was approved by the developer, and code generation works from that design, not from the original description. One file per design class is written by workers, each from the design. You write what the design does not contain, fix what is still wrong, and change the code on request. The code must stay in line with the design: the class diagram and the code are compared after every run.

You have these tools. read_design returns the design: classes, components, nodes and sequences. read_requirements returns the approved requirements with their acceptance criteria. list_files and read_file read the project. write_file and delete_file change files, and only inside src/, public/, package.json and tsconfig.json. typecheck runs tsc over the project in a container. detect_drift compares the code under src/ with the design and lists every difference. start_app starts every entry in src/app/ in a container and checks that each answers GET /health with 200; it returns the error and the end of the log of every entry that did not. Nothing is saved until you call write_file or delete_file. typecheck and detect_drift must be clean and start_app ok when you finish.

The user message starts with a mode.

Mode wiring, after the class files were generated:
- Read the design, the plan and the class files that carry the use cases: the controllers, else the services or facades. Write the application in src/app/. Files in src/app/ are not part of the design and drift ignores them, but they are type checked.
- src/app/app.ts exports createApp(db?: DatabaseSync): Express, so tests can use the app without listening. The parameter exists only when a class takes db (the brief names the database file then), unless the brief says createApp takes no parameter, with the default new DatabaseSync(':memory:') from node:sqlite; otherwise createApp takes no parameter. createApp creates the instances of the design classes in dependency order, following each constructor exactly (read it with read_file), passing db to the classes that take it and a value for every attribute parameter. A configuration attribute (a TTL, an interval, a timeout, a limit, a size) gets the value the class description or the class's requirements state (read them with read_requirements), written in its unit, for example 60 * 60 * 1000 for a cache of 1 hour in milliseconds; when neither states it, pick a sensible default and say so in your reply. Never pass 0 or an empty value to a configuration attribute unless the description or the requirements state that value; only a state attribute (one that holds data the class keeps, such as a count, a list or a map) gets an empty value ('' for a string, 0 for a number, false for a boolean, [] for an array, new Map() for a Map, new Set() for a Set). Each class is created once, and that one instance is passed to every class that depends on it. Never wrap, replace or reassign a method of a class instance, never read or write a private member of a class instance, and no as unknown as casts; when a class cannot do its job, fix its class file. When the entry must run a periodic class (a job, a closer, a poller) on a timer, createApp puts that instance on app.locals under its camel case name, so main.ts uses the same instance. createApp parses JSON bodies with express.json(), serves the folder public/ as static files, and registers the routes.
- Routes: each method of the classes that carry the use cases becomes one route. The method name, its parameters, the use cases and the sequences in the design tell you the HTTP method, the path and where each parameter comes from. Use plain REST paths under /api. Handlers call the class method and send its result as JSON, with 201 for a create. An error middleware with four parameters answers a thrown Error whose message ends with not found with 404 and a JSON body { "error": message }, and every other thrown Error with 400. Express 5 forwards rejected promises by itself, and a wildcard path needs a name, for example /*splat. Read a route parameter with String(req.params.id), then convert it with Number where the class takes a number. A route reads every parameter that is not in the path from the JSON body field with the same name as the method parameter. For static files resolve the folder from the project root with fileURLToPath(new URL('../../public', import.meta.url)) or path.resolve('public').
- GET /health returns 200 with { "status": "ok" } and is registered before every other route.
- src/app/main.ts is the entry. When a class takes db it opens new DatabaseSync(process.env.DB_PATH ?? <the database file from the brief>), after creating the file's folder with mkdirSync(path.dirname(file), { recursive: true }) unless the path is :memory:, and passes it to createApp, so data survives a restart. It listens on the port from the PORT environment variable, or 8080 when it is not set, and logs the port. When it runs a periodic class on a timer, it reads that instance from app.locals and uses that instance's interval attribute, never its own constant or a second instance.
- public/index.html is one small static page with inline CSS and JavaScript, no build step and no external resources. It uses the API with fetch so a person can do the main use cases of the design in a browser. Show data with textContent, not innerHTML. It is the browser component of the design, which has no classes; when the brief names a @trace comment for it, that comment is the first line in <head>.
- Several service nodes: the brief lists each node with its classes, entry file, port variable and links. src/app/app.ts and src/app/main.ts belong to the primary node, and its createApp creates only its classes. Every other node's entry creates only its classes in dependency order, serves GET /health, its routes and the endpoints of its incoming links with express and ws, listens on its port variable with the default the brief names and logs the port. A class is never created on another node, and an instance is created once per process and passed to every class that depends on it. A client class reads its peer URL in its own code from the variable the brief names, with the default given; the URL is never a constructor parameter, so the attribute value rules do not reach it. Each entry passes configuration and state attribute values as createApp does, and runs a periodic class on a timer with that instance's interval attribute. An incoming http link from another node is served as routes under /internal/ that call the receiving class's methods. An incoming ws link is a ws endpoint at /internal/<caller node kebab>: for each message it calls the receiving class's methods, or, for a feed, the receiving side sends its events to every connected socket. For a browser link to a node other than the primary, the primary serves GET /api/config with the URLs the brief names, and the page reads it before it opens the connection.
- Then run typecheck and detect_drift. Fix every error and drift item, in the class file when the code is wrong; you cannot change the design. Run both again. Repeat until both are clean, or stop when a round fixes nothing and say what is left.
- When both are clean, run start_app. When an entry does not start, read its log, fix the cause and run typecheck and start_app again.

Mode update, after the design changed:
- The message lists the changed, added and removed design IDs. Call read_design for the new state and patch only what those IDs involve. Read a file before you change it.
- A class file lives at src/<component name in lower kebab case>/<ClassName>.ts. The kebab rule: Task API and TaskApi both become task-api, HTTPServer becomes http-server, Task Model becomes task-model.
- Changed class: edit its file so it matches the new design and keep everything else in it. That includes the @trace tag, which must carry the class's new REQ IDs, and the constructor, which follows the rules below. When the class moved to another component its planned path changed: write the file at the new path, delete the old file with delete_file, and fix every import of it. Added class: write its file at its path. Removed class: delete its file with delete_file, then remove every import of it and every use of it in other files and in src/app/.
- The browser page public/index.html keeps the @trace comment the brief names as the first line in <head>; fix the comment when it differs.
- A component or node change moves or reshapes classes: a storing class that moved onto an external node loses db, one that moved off it takes db, and src/app/ follows. With several service nodes the brief lists them as in wiring mode, and every entry follows it.
- Database: the brief names the database file, or says no class takes db. When a class takes db but createApp or main.ts lack the database, add it as in wiring mode: createApp(db?: DatabaseSync) with the :memory: default, and main.ts opening process.env.DB_PATH ?? <the database file from the brief>. This also applies to a storing class written before it took db: give it db and a table, and fix every call of its constructor. When no class takes db any more, remove the database from createApp and main.ts. A change to a method of a class that carries the use cases can change the routes in src/app/app.ts. Add, change or remove those routes. Touch no other file.
- Then run typecheck and detect_drift and fix until both are clean, then run start_app and fix until it is ok.

Constructors, in update mode and for chat requests, when you write or change a class and no declaration shape is given:
- Storing rule: a class whose name ends with Repository, Store or Dao takes db: DatabaseSync as its first parameter, after the base class's parameters, unless its component runs on an external node; no other class takes db. SQLite runs in the app process, so no database node is needed.
- Injection rule: after db come private readonly parameters, in the order of the dependency relations, only for targets that are collaborators: a class or interface with at least one method that no design class uses as a type of an attribute, a parameter or a return type, whether or not it has attributes (services, repositories, controllers, gateways, interfaces). Entities, enums and association or composition targets are never constructor parameters. Then one public parameter per attribute.
- When a constructor changes, change every call of it, in src/app/ and in other classes. A new attribute parameter gets its value as in wiring mode: a configuration attribute the value the description or the requirements state, a state attribute an empty value.

Any other message is a chat request from the developer:
- Change only the files the request involves. Read them first, leave all other files untouched, and do not reformat or rewrite what the request does not need.
- If the request needs a class, attribute, method or relation that the design does not have, do not add it to the code. Say that the design has to change first, in the design phase.
- Run typecheck and detect_drift only after you changed a file, and fix what your change broke. A request that needs no change gets an answer and no check.

Never write Mermaid or any diagram syntax. Reply in short plain prose: what you changed or wrote, and anything still failing. Do not repeat code.

${STACK_RULES}`;

export const codeAgent: AgentDef = {
	name: 'code',
	model: 'claude-sonnet-5-5',
	effort: 'medium',
	// delete_file is in the row already; tools not registered yet are left out, as in scope.ts.
	tools: TOOLS_BY_AGENT.code.filter((t) => t in TOOLS),
	system
};

const lines = (items: string[]) =>
	items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : 'none';

/**
 * The default database file of a generated project, `./data/<project>.db`, or null when no class
 * stores data and the app needs no database.
 */
export function dbFile(design: DesignDoc, projectName: string): string | null {
	if (!design.classes.some((c) => storesData(c, design))) return null;
	return `./data/${kebab(projectName) || 'app'}.db`;
}

/** The brief lines that link the page to its client components, or none without one. */
function pageLines(clients: Component[]): string[] {
	if (clients.length === 0) return [];
	const comment = `<!-- @trace ${clients.flatMap((c) => [c.id, ...c.reqIds]).join(' ')} -->`;
	const names = clients.map(
		(c) => `${c.name} (${[c.id, ...(c.reqIds.length > 0 ? [c.reqIds.join(' ')] : [])].join(', ')})`
	);
	return [
		`The browser page ${PAGE} is the client component ${names.join(' and ')}. The first line in <head> of ${PAGE} is ${comment}.`
	];
}

const named = (n: DeploymentNode | undefined, id: string) => `${n?.name ?? id} (${id})`;

/**
 * The brief lines of a design with several service nodes: per node its classes, entry, port
 * variable and links, the browser's config route and the page's links. None for one service node,
 * so the briefs of such a design stay as they were.
 */
function nodeLines(design: DesignDoc | null): string[] {
	const roles = design ? serviceNodes(design) : [];
	if (!design || roles.length < 2) return [];
	const nodes = new Map(design.nodes.map((n) => [n.id, n]));
	const classes = new Map(design.classes.map((c) => [c.id, c]));
	const incoming = (l: NodeLink, primary: boolean) => {
		const from = nodes.get(l.from);
		const head = `Incoming from ${named(from, l.from)} over ${l.protocol}`;
		const ws = l.protocol.startsWith('ws');
		if (from?.kind === 'client') {
			if (primary)
				return ws
					? `${head}: a ws endpoint at /ws that the page opens on its own host; it sends to the connected sockets.`
					: `${head}: the page and the /api routes.`;
			return ws
				? `${head}: a ws endpoint at / that the page opens at the URL GET /api/config names; it sends to the connected sockets.`
				: `${head}: routes the page calls at the URL GET /api/config names.`;
		}
		if (!from) return `${head}.`;
		return ws
			? `${head}: a ws endpoint at /internal/${nodeKebab(from)}; for each message it calls this node's classes, or, for a feed, this node sends its events to every connected socket.`
			: `${head}: routes under /internal/ that call this node's classes.`;
	};
	const outgoing = (l: NodeLink, self: DeploymentNode) => {
		const to = nodes.get(l.to);
		const head = `Outgoing to ${named(to, l.to)} over ${l.protocol}`;
		if (to?.kind === 'database')
			return `${head}: SQLite runs in this node's process, so no client class.`;
		const target = peerTarget(design, l, self);
		return target
			? `${head}: its client class reads the URL in its own code from ${target}.`
			: `${head}: its client class calls it.`;
	};
	const perNode = roles.map((r) => {
		const own = r.classIds.flatMap((id) => classes.get(id) ?? []);
		const head = [
			`${named(r.node, r.node.id)}${r.primary ? ', primary' : ''}: entry ${r.entry}${r.primary ? ' with createApp in src/app/app.ts' : ''}`,
			`port process.env.${r.portVar} ?? ${r.port}`,
			`classes ${own.length > 0 ? own.map((c) => `${c.name} (${c.id})`).join(', ') : 'none'}`,
			own.some((c) => storesData(c, design)) ? 'opens the database.' : 'opens no database.'
		].join(', ');
		const links = [
			...r.incoming.map((l) => incoming(l, r.primary)),
			...r.outgoing.map((l) => outgoing(l, r.node))
		];
		return [`- ${head}`, ...links.map((t) => `  ${t}`)].join('\n');
	});
	const config = browserLinks(design).flatMap((l) => publicUrl(design, l) ?? []);
	const clients = clientNodeIds(design);
	const pageLinks = design.links
		.filter((l) => clients.has(l.from))
		.map((l) => `${named(nodes.get(l.to), l.to)} over ${l.protocol}`);
	return [
		`Service nodes, each its own process; a class is created only on its own node:\n${perNode.join('\n')}`,
		...(config.length > 0
			? [
					`The primary node serves GET /api/config with { ${config.map((c) => `"${c.key}": process.env.${c.variable} ?? '${c.fallback}'`).join(', ')} }; the page reads it before it opens the connection.`
				]
			: []),
		...(pageLinks.length > 0 ? [`The page talks to ${pageLinks.join(' and to ')}.`] : [])
	];
}

/**
 * The database line: main.ts opens the file and passes it to createApp, unless storing classes run
 * on other service nodes: then each of their entries opens it too, and createApp takes no
 * parameter when the primary node stores nothing.
 */
function dbLine(design: DesignDoc | null, db: string, tail: string): string {
	const roles = design ? serviceNodes(design) : [];
	const stores = (ids: string[]) =>
		ids.some((id) => {
			const c = design?.classes.find((k) => k.id === id);
			return c !== undefined && storesData(c, design!);
		});
	const openers = roles.length > 1 ? roles.filter((r) => stores(r.classIds)) : [];
	if (openers.length === 0 || (openers.length === 1 && openers[0] === roles[0]))
		return `Database file: ${db}. main.ts opens process.env.DB_PATH ?? '${db}'${tail}`;
	const head = stores(roles[0].classIds)
		? ''
		: 'createApp takes no parameter, because no class on the primary node takes db; ';
	const verb = openers.length > 1 ? 'each open' : 'opens';
	return `Database file: ${db}. ${head}${openers.map((r) => r.entry).join(' and ')} ${verb} process.env.DB_PATH ?? '${db}'${tail}`;
}

/**
 * The user message of the wiring run: the plan, the database file, the client components the page
 * stands for, the service nodes and the files still failing.
 */
export function wiringBrief(
	plans: FilePlan[],
	failing: string[],
	db: string | null = null,
	design: DesignDoc | null = null
): string {
	return [
		'Mode wiring.',
		`The generated class files:\n${lines(plans.map((p) => `${p.path} (${p.name}, ${p.classId})`))}`,
		db
			? dbLine(design, db, '; DB_PATH=:memory: is allowed for tests.')
			: 'No class takes db, so createApp takes no parameter and main.ts opens no database.',
		...pageLines(design ? clientComponents(design) : []),
		...nodeLines(design),
		`Files still failing after generation, with their problems:\n${lines(failing)}`,
		'Write src/app/ and public/ as described, then run typecheck and detect_drift and fix until both are clean.'
	].join('\n\n');
}

/**
 * The user message of an update run: only the listed design IDs are patched. The declaration shape
 * of every changed and added class follows, so the agent writes constructors and members the way
 * the workers do; removed classes and IDs of components and nodes have none. The @trace comment of
 * the page is named on every update, so a changed client component reaches it.
 */
export function updateBrief(
	changed: string[],
	added: string[],
	removed: string[],
	design: DesignDoc | null,
	db: string | null = null,
	staleEntries: string[] = []
): string {
	const shapes = [...changed, ...added].flatMap(
		(id) => design?.classes.find((c) => c.id === id) ?? []
	);
	return [
		'Mode update.',
		`Changed design IDs:\n${lines(changed)}`,
		`Added design IDs:\n${lines(added)}`,
		`Removed design IDs:\n${lines(removed)}`,
		db
			? dbLine(design, db, '.')
			: 'No class takes db, so createApp takes no parameter and main.ts opens no database.',
		...pageLines(design ? clientComponents(design) : []),
		...nodeLines(design),
		...(staleEntries.length > 0
			? [
					`Entries of service nodes the design no longer has; delete them with delete_file:\n${lines(staleEntries)}`
				]
			: []),
		...(shapes.length > 0
			? [
					`Declaration shapes of the changed and added classes, to match exactly; the constructor parameters are fixed:\n${shapes
						.map((c) => `${c.name} (${c.id}):\n${signatureOf(c, design!)}`)
						.join('\n\n')}`
				]
			: []),
		'Patch only the files these IDs involve, then run typecheck and detect_drift and fix until both are clean.'
	].join('\n\n');
}
