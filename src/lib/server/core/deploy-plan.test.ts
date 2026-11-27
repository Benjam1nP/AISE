import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeProblems, deployHashes, deployPlan } from './deploy-plan';
import { DesignDoc } from './schemas/design';

const read = (rel: string): unknown =>
	JSON.parse(readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8'));
const designOf = (rel: string) => DesignDoc.parse(read(rel));
const clone = <T>(v: T): T => structuredClone(v);

const todo = designOf('test/fixtures/todo-design.json');
const todoPkg = read('test/fixtures/p4/package.json');
const booking = designOf('showcases/booking/.aise/design.json');
const bookingPkg = read('showcases/booking/package.json');
const auction = designOf('showcases/auction/.aise/design.json');
const auctionPkg = read('showcases/auction/package.json') as {
	scripts: Record<string, string>;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
};

const byName = (plan: ReturnType<typeof deployPlan>, name: string) =>
	plan.services.find((s) => s.name === name);

describe('deployPlan', () => {
	it('gives the to do design one service on 8080 with the data volume', () => {
		const plan = deployPlan(todo, todoPkg);
		expect(plan.services).toEqual([
			{
				name: 'app-server',
				nodeId: 'DSN-008',
				primary: true,
				script: 'start',
				command: 'npm start',
				portVar: 'PORT',
				port: 8080,
				env: { PORT: '8080', DB_PATH: '/data/app.db' },
				peerVars: [],
				volume: { name: 'data', target: '/data' },
				healthUrl: 'http://localhost:8080/health'
			}
		]);
		expect(plan.volumes).toEqual(['data']);
		expect(plan.missingScripts).toEqual([]);
	});

	it('gives a design without service nodes one service app', () => {
		const empty = { ...clone(todo), nodes: [], components: [], links: [] };
		const plan = deployPlan(empty, todoPkg);
		expect(plan.services.map((s) => [s.name, s.nodeId, s.command, s.port])).toEqual([
			['app', null, 'npm start', 8080]
		]);
		// the to do design stores data, so the app gets the database file and the volume
		expect(plan.services[0].env).toEqual({ PORT: '8080', DB_PATH: '/data/app.db' });
		expect(plan.services[0].volume).toEqual({ name: 'data', target: '/data' });
		expect(plan.volumes).toEqual(['data']);
	});

	it('gives booking one service for the server and none for the browser client', () => {
		const plan = deployPlan(booking, bookingPkg);
		expect(plan.services.map((s) => [s.name, s.port, s.volume?.name])).toEqual([
			['application-server', 8080, 'data']
		]);
		expect(plan.services[0].env).toEqual({ PORT: '8080', DB_PATH: '/data/app.db' });
	});

	it('gives auction one service per service node, wired by service name', () => {
		const plan = deployPlan(auction, auctionPkg);
		expect(plan.services.map((s) => s.name)).toEqual(['api-server', 'live-update-server']);
		expect(byName(plan, 'api-server')).toMatchObject({
			primary: true,
			command: 'npm start',
			port: 8080,
			peerVars: [],
			volume: { name: 'data', target: '/data' },
			healthUrl: 'http://localhost:8080/health',
			env: {
				PORT: '8080',
				DB_PATH: '/data/app.db',
				LIVE_UPDATE_SERVER_PUBLIC_URL: 'ws://localhost:8081'
			}
		});
		expect(byName(plan, 'api-server')!.env).toEqual({
			PORT: '8080',
			DB_PATH: '/data/app.db',
			LIVE_UPDATE_SERVER_PUBLIC_URL: 'ws://localhost:8081'
		});
		expect(byName(plan, 'live-update-server')).toMatchObject({
			primary: false,
			script: 'start:live-update-server',
			command: 'npm run start:live-update-server',
			portVar: 'LIVE_UPDATE_SERVER_PORT',
			port: 8081,
			peerVars: ['API_SERVER_URL'],
			volume: null,
			healthUrl: 'http://localhost:8081/health',
			env: { LIVE_UPDATE_SERVER_PORT: '8081', API_SERVER_URL: 'ws://api-server:8080' }
		});
		// no database file and no public url on the node that stores nothing and serves no page
		expect(byName(plan, 'live-update-server')!.env).toEqual({
			LIVE_UPDATE_SERVER_PORT: '8081',
			API_SERVER_URL: 'ws://api-server:8080'
		});
		expect(plan.volumes).toEqual(['data']);
	});

	it('gives a design without service nodes and without a storing class no volume', () => {
		const empty = { ...clone(todo), nodes: [], components: [], links: [] };
		empty.classes = empty.classes.filter((c) => !/(Repository|Store|Dao)$/.test(c.name));
		const plan = deployPlan(empty, todoPkg);
		expect(plan.services).toHaveLength(1);
		expect(plan.services[0].env).toEqual({ PORT: '8080' });
		expect(plan.services[0].volume).toBeNull();
		expect(plan.volumes).toEqual([]);
	});

	it('lists the peer variables sorted, not in link order', () => {
		const d = clone(auction);
		d.nodes.push({ id: 'DSN-090', name: 'Worker', kind: 'service', reqIds: [] });
		d.links.unshift({ from: 'DSN-002', to: 'DSN-090', protocol: 'http' });
		expect(byName(deployPlan(d, auctionPkg), 'live-update-server')!.peerVars).toEqual([
			'API_SERVER_URL',
			'WORKER_URL'
		]);
	});

	it('shares one data volume between storing nodes and lists no volume without one', () => {
		const two = clone(auction);
		// move a storing class to the live update node, so both nodes store
		two.components.find((c) => c.name === 'LiveUpdates')!.classIds.push('DSN-028');
		const plan = deployPlan(two, auctionPkg);
		expect(plan.services.map((s) => s.volume?.name)).toEqual(['data', 'data']);
		expect(plan.volumes).toEqual(['data']);

		const none = clone(auction);
		none.classes = none.classes.filter((c) => !/(Repository|Store|Dao)$/.test(c.name));
		const plain = deployPlan(none, auctionPkg);
		expect(plain.volumes).toEqual([]);
		expect(plain.services.every((s) => s.volume === null && !('DB_PATH' in s.env))).toBe(true);
	});

	it('names the start scripts the package.json lacks', () => {
		const pkg = clone(auctionPkg);
		delete pkg.scripts['start:live-update-server'];
		expect(deployPlan(auction, pkg).missingScripts).toEqual(['start:live-update-server']);
		expect(deployPlan(auction, auctionPkg).missingScripts).toEqual([]);
	});
});

const auctionCompose = `
services:
  api-server:
    build: .
    command: npm start
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      PORT: "8080"
      DB_PATH: /data/app.db
      LIVE_UPDATE_SERVER_PUBLIC_URL: ws://localhost:8081
    volumes:
      - data:/data
  live-update-server:
    build: .
    command: ["npm", "run", "start:live-update-server"]
    ports:
      - "127.0.0.1:8081:8081"
    environment:
      - LIVE_UPDATE_SERVER_PORT=8081
      - API_SERVER_URL=ws://api-server:8080
volumes:
  data:
`;

describe('composeProblems', () => {
	const plan = deployPlan(auction, auctionPkg);

	it('accepts a correct auction compose, with the command as string or list', () => {
		expect(composeProblems(plan, auctionCompose)).toEqual([]);
	});

	it('names a missing service', () => {
		const text = auctionCompose.replace(/ {2}live-update-server:[\s\S]*?(?=volumes:)/, '');
		expect(composeProblems(plan, text)).toEqual(['service "live-update-server" is missing']);
	});

	it('names an extra service', () => {
		const text = auctionCompose.replace(
			'volumes:\n  data:\n',
			'  cache:\n    image: redis\nvolumes:\n  data:\n'
		);
		expect(composeProblems(plan, text)).toEqual([
			'service "cache" is not a service node of the design'
		]);
	});

	it('names a wrong command, as string and as list, and an absent one', () => {
		const string = auctionCompose.replace('command: npm start', 'command: npm run dev');
		expect(composeProblems(plan, string)).toEqual([
			'service "api-server" runs "npm run dev", expected "npm start"'
		]);
		const list = auctionCompose.replace(
			'["npm", "run", "start:live-update-server"]',
			'["npm", "start"]'
		);
		expect(composeProblems(plan, list)).toEqual([
			'service "live-update-server" runs "npm start", expected "npm run start:live-update-server"'
		]);
		const absent = auctionCompose.replace('    command: npm start\n', '');
		expect(composeProblems(plan, absent)).toEqual([
			'service "api-server" runs "", expected "npm start"'
		]);
	});

	it('reads a folded or padded command as the same command', () => {
		const folded = auctionCompose.replace('command: npm start', 'command: >\n      npm start\n');
		expect(composeProblems(plan, folded)).toEqual([]);
		const padded = auctionCompose.replace('command: npm start', 'command: "  npm   start "');
		expect(composeProblems(plan, padded)).toEqual([]);
		const list = auctionCompose.replace(
			'["npm", "run", "start:live-update-server"]',
			'["npm", " run  start:live-update-server "]'
		);
		expect(composeProblems(plan, list)).toEqual([]);
	});

	it('sees environment variables merged in from an anchor', () => {
		const text = auctionCompose
			.replace('services:\n', 'x-peer: &peer\n  API_SERVER_URL: ws://api-server:8080\nservices:\n')
			.replace(
				'      - LIVE_UPDATE_SERVER_PORT=8081\n      - API_SERVER_URL=ws://api-server:8080',
				'      <<: *peer\n      LIVE_UPDATE_SERVER_PORT: "8081"'
			);
		expect(composeProblems(plan, text)).toEqual([]);
		const without = text.replace('      <<: *peer\n', '');
		expect(composeProblems(plan, without)).toEqual([
			'service "live-update-server" lacks API_SERVER_URL'
		]);
	});

	it('names a missing peer URL variable, in a map and in a list', () => {
		const list = auctionCompose.replace('      - API_SERVER_URL=ws://api-server:8080\n', '');
		expect(composeProblems(plan, list)).toEqual([
			'service "live-update-server" lacks API_SERVER_URL'
		]);
		const noEnv = auctionCompose.replace(
			'    environment:\n      - LIVE_UPDATE_SERVER_PORT=8081\n      - API_SERVER_URL=ws://api-server:8080\n',
			''
		);
		expect(composeProblems(plan, noEnv)).toEqual([
			'service "live-update-server" lacks API_SERVER_URL'
		]);
		const map = auctionCompose.replace(
			'      - LIVE_UPDATE_SERVER_PORT=8081\n      - API_SERVER_URL=ws://api-server:8080',
			'      LIVE_UPDATE_SERVER_PORT: "8081"\n      API_SERVER_URL: ws://api-server:8080'
		);
		const noMap = map.replace('      API_SERVER_URL: ws://api-server:8080\n', '');
		expect(composeProblems(plan, noMap)).toEqual([
			'service "live-update-server" lacks API_SERVER_URL'
		]);
		expect(composeProblems(plan, map)).toEqual([]);
	});

	it('gives one problem for invalid YAML', () => {
		expect(composeProblems(plan, 'services: [unclosed')).toHaveLength(1);
		expect(composeProblems(plan, 'services: [unclosed')[0]).toMatch(
			/^compose.yaml is not valid YAML/
		);
	});

	it('reports problems sorted, not in the order they are found', () => {
		const text = auctionCompose
			.replace('command: npm start', 'command: npm run dev')
			.replace('volumes:\n  data:\n', '  aaa-cache:\n    image: redis\nvolumes:\n  data:\n');
		expect(composeProblems(plan, text)).toEqual([
			'service "aaa-cache" is not a service node of the design',
			'service "api-server" runs "npm run dev", expected "npm start"'
		]);
	});
});

describe('deployHashes', () => {
	const base = deployHashes(auction, auctionPkg);
	const LIVE = 'DSN-002';
	const API = 'DSN-001';

	it('has a key per service node and one for the dependencies, and none without a design', () => {
		expect(Object.keys(base).sort()).toEqual([API, LIVE, 'dependencies']);
		expect(deployHashes(null, auctionPkg)).toEqual({});
		expect(deployHashes(auction, auctionPkg)).toEqual(base);
	});

	it('changes for the nodes a link touches when a link changes', () => {
		const d = clone(auction);
		d.links.find((l) => l.from === LIVE && l.to === API)!.protocol = 'wss';
		const next = deployHashes(d, auctionPkg);
		expect(next[LIVE]).not.toBe(base[LIVE]);
		expect(next[API]).not.toBe(base[API]);
		expect(next.dependencies).toBe(base.dependencies);
	});

	it('changes when a link is added', () => {
		const d = clone(auction);
		d.links.push({ from: API, to: LIVE, protocol: 'http' });
		expect(deployHashes(d, auctionPkg)[LIVE]).not.toBe(base[LIVE]);
	});

	it('changes only the node of a start script that changes', () => {
		const pkg = clone(auctionPkg);
		pkg.scripts['start:live-update-server'] = 'node dist/live.js';
		const next = deployHashes(auction, pkg);
		expect(next[LIVE]).not.toBe(base[LIVE]);
		expect(next[API]).toBe(base[API]);
		expect(next.dependencies).toBe(base.dependencies);
	});

	it('changes only the dependencies hash when a dependency changes', () => {
		const pkg = clone(auctionPkg);
		pkg.dependencies['left-pad'] = '^1.0.0';
		const next = deployHashes(auction, pkg);
		expect(next.dependencies).not.toBe(base.dependencies);
		expect({ ...next, dependencies: '' }).toEqual({ ...base, dependencies: '' });
		const dev = clone(auctionPkg);
		dev.devDependencies['left-pad'] = '^1.0.0';
		expect(deployHashes(auction, dev).dependencies).not.toBe(base.dependencies);
	});

	it('stays equal for a description, a method or a link label change', () => {
		const d = clone(auction);
		const cls = d.classes.find((c) => c.methods.length > 0)!;
		cls.description = `${cls.description} reworded`;
		cls.methods[0].name = 'renamedMethod';
		d.links[0].label = 'a new label';
		d.nodes[0].reqIds = [];
		expect(deployHashes(d, auctionPkg)).toEqual(base);
	});

	it('changes for a node whose port another service node pushes down, and for the page that names it', () => {
		const d = clone(auction);
		d.nodes.splice(1, 0, { id: 'DSN-090', name: 'Worker', kind: 'service', reqIds: [] });
		const next = deployHashes(d, auctionPkg);
		expect(next[LIVE]).not.toBe(base[LIVE]);
		// the primary publishes the live node's url, which carries the new port
		expect(next[API]).not.toBe(base[API]);
		expect(next['DSN-090']).toBeDefined();
	});

	it('keys a design without service nodes by app', () => {
		const empty = { ...clone(todo), nodes: [], components: [], links: [] };
		expect(Object.keys(deployHashes(empty, todoPkg)).sort()).toEqual(['app', 'dependencies']);
	});

	it('stays equal when only the client node changes', () => {
		const d = clone(auction);
		const web = d.components.find((c) => c.id === 'DSN-042')!;
		web.name = 'Renamed Frontend';
		web.classIds.push('DSN-028');
		web.reqIds = [];
		d.components.push({
			id: 'DSN-091',
			name: 'Extra Page',
			classIds: [],
			nodeId: 'DSN-006',
			reqIds: []
		});
		expect(deployHashes(d, auctionPkg)).toEqual(base);
	});

	it('stays equal when the links are listed in another order', () => {
		const d = clone(auction);
		d.links.reverse();
		expect(deployHashes(d, auctionPkg)).toEqual(base);
	});

	it('changes for the node and for the node that serves its public url when a node is renamed', () => {
		const d = clone(auction);
		d.nodes.find((n) => n.id === LIVE)!.name = 'Live Feed';
		const next = deployHashes(d, auctionPkg);
		expect(next[LIVE]).not.toBe(base[LIVE]);
		expect(next[API]).not.toBe(base[API]);
	});

	it('changes for the primary and the nodes that name it when the primary is renamed', () => {
		const d = clone(auction);
		d.nodes.find((n) => n.id === API)!.name = 'Auction Backend';
		const next = deployHashes(d, auctionPkg);
		expect(next[API]).not.toBe(base[API]);
		// the live node reaches the primary by its service name
		expect(next[LIVE]).not.toBe(base[LIVE]);
	});

	it('changes when another service node becomes the primary', () => {
		const d = clone(auction);
		d.links.find((l) => l.from === 'DSN-006' && l.to === API)!.protocol = 'ws';
		d.nodes = [d.nodes.find((n) => n.id === LIVE)!, ...d.nodes.filter((n) => n.id !== LIVE)];
		const next = deployHashes(d, auctionPkg);
		expect(next[LIVE]).not.toBe(base[LIVE]);
		expect(next[API]).not.toBe(base[API]);
	});

	it('ignores a link from a node to itself', () => {
		const d = clone(auction);
		d.links.push({ from: LIVE, to: LIVE, protocol: 'http' });
		expect(deployHashes(d, auctionPkg)).toEqual(base);
		expect(deployPlan(d, auctionPkg)).toEqual(deployPlan(auction, auctionPkg));
	});

	it('changes when a node starts or stops storing data', () => {
		const d = clone(auction);
		d.components.find((c) => c.name === 'LiveUpdates')!.classIds.push('DSN-028');
		expect(deployHashes(d, auctionPkg)[LIVE]).not.toBe(base[LIVE]);
	});
});
