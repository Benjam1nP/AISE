import { describe, expect, it } from 'vitest';
import { appEntries, browserLinks, peerUrl, publicUrl, serviceNodes } from './nodes';
import type { DeploymentNode, DesignDoc, NodeLink } from './schemas/design';

const node = (id: string, name: string, kind: DeploymentNode['kind'] = 'service') => ({
	id,
	name,
	kind,
	reqIds: []
});
const link = (from: string, to: string, protocol: NodeLink['protocol'] = 'http'): NodeLink => ({
	from,
	to,
	protocol
});

const design = (nodes: DeploymentNode[], links: NodeLink[] = []): DesignDoc => ({
	actors: [],
	useCases: [],
	classes: [],
	components: [
		{ id: 'DSN-010', name: 'Api', classIds: ['DSN-001'], nodeId: 'DSN-021', reqIds: [] },
		{ id: 'DSN-011', name: 'Live', classIds: ['DSN-002', 'DSN-003'], nodeId: 'DSN-022', reqIds: [] }
	],
	nodes,
	links,
	sequences: []
});

const live = node('DSN-022', 'Live Update Server');
const api = node('DSN-021', 'API Server');
const worker = node('DSN-023', 'Worker');
const browser = node('DSN-024', 'Browser', 'client');

describe('serviceNodes', () => {
	it('makes the service node the browser links to over http primary, the others extra in design order', () => {
		const d = design(
			[live, api, browser, worker],
			[
				link('DSN-024', 'DSN-022', 'ws'),
				link('DSN-024', 'DSN-021'),
				link('DSN-022', 'DSN-021', 'ws')
			]
		);
		expect(serviceNodes(d)).toEqual([
			{
				node: api,
				primary: true,
				entry: 'src/app/main.ts',
				portVar: 'PORT',
				port: 8080,
				classIds: ['DSN-001'],
				incoming: [link('DSN-024', 'DSN-021'), link('DSN-022', 'DSN-021', 'ws')],
				outgoing: []
			},
			{
				node: live,
				primary: false,
				entry: 'src/app/live-update-server.ts',
				portVar: 'LIVE_UPDATE_SERVER_PORT',
				port: 8081,
				classIds: ['DSN-002', 'DSN-003'],
				incoming: [link('DSN-024', 'DSN-022', 'ws')],
				outgoing: [link('DSN-022', 'DSN-021', 'ws')]
			},
			expect.objectContaining({
				node: worker,
				entry: 'src/app/worker.ts',
				portVar: 'WORKER_PORT',
				port: 8082,
				classIds: []
			})
		]);
	});

	it('takes a client link over https like http for the primary', () => {
		const d = design([live, api, browser], [link('DSN-024', 'DSN-021', 'https')]);
		expect(serviceNodes(d).map((r) => [r.node.id, r.primary])).toEqual([
			['DSN-021', true],
			['DSN-022', false]
		]);
	});

	it('falls back to the first service node without a client http link', () => {
		const roles = (d: DesignDoc) => serviceNodes(d).map((r) => [r.node.id, r.primary, r.port]);
		expect(roles(design([browser, live, api], [link('DSN-024', 'DSN-021', 'ws')]))).toEqual([
			['DSN-022', true, 8080],
			['DSN-021', false, 8081]
		]);
		expect(roles(design([live, api], [link('DSN-022', 'DSN-021')]))).toEqual([
			['DSN-022', true, 8080],
			['DSN-021', false, 8081]
		]);
	});

	it('has one primary node for a single service node and none without one', () => {
		expect(serviceNodes(design([api, browser], [link('DSN-024', 'DSN-021')]))).toHaveLength(1);
		expect(serviceNodes(design([browser]))).toEqual([]);
	});
});

describe('appEntries', () => {
	it('lists main.ts first, then one entry per extra service node', () => {
		expect(appEntries(design([api, live]))).toEqual([
			'src/app/main.ts',
			'src/app/live-update-server.ts'
		]);
		expect(appEntries(design([api]))).toEqual(['src/app/main.ts']);
		expect(appEntries(design([]))).toEqual(['src/app/main.ts']);
		expect(appEntries(design([api, node('DSN-022', '!!!')]))).toEqual([
			'src/app/main.ts',
			'src/app/dsn-022.ts'
		]);
	});
});

describe('peerUrl and publicUrl', () => {
	const d = design([api, live, browser], [link('DSN-022', 'DSN-021', 'ws')]);

	it('names the peer URL variable and a localhost default with the peer port', () => {
		expect(peerUrl(d, link('DSN-022', 'DSN-021', 'ws'))).toEqual({
			variable: 'API_SERVER_URL',
			fallback: 'ws://localhost:8080'
		});
		expect(peerUrl(d, link('DSN-021', 'DSN-022', 'http'))).toEqual({
			variable: 'LIVE_UPDATE_SERVER_URL',
			fallback: 'http://localhost:8081'
		});
		expect(peerUrl(d, link('DSN-021', 'DSN-024', 'http'))).toBeNull();
	});

	it('names the public URL of a node the browser reaches besides the primary', () => {
		const withBrowser = design(
			[api, live, browser],
			[link('DSN-024', 'DSN-021'), link('DSN-024', 'DSN-022', 'wss')]
		);
		expect(browserLinks(withBrowser)).toEqual([link('DSN-024', 'DSN-022', 'wss')]);
		expect(publicUrl(withBrowser, link('DSN-024', 'DSN-022', 'wss'))).toEqual({
			key: 'live-update-server',
			variable: 'LIVE_UPDATE_SERVER_PUBLIC_URL',
			fallback: 'ws://localhost:8081'
		});
	});
});
