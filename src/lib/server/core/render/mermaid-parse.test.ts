// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { DesignDoc } from '../schemas/design';
import { RequirementsDoc } from '../schemas/requirements';
import { validateDesign } from '../validate';
import { renderAll } from './mermaid';

// jsdom replaces the global URL, so the fixture path is built with node:path.
const fixture = (name: string): unknown =>
	JSON.parse(
		readFileSync(path.join(import.meta.dirname, '../../../../../test/fixtures', name), 'utf8')
	);
const design = () => DesignDoc.parse(fixture('todo-design.json'));
const reqs = () => RequirementsDoc.parse(fixture('todo-requirements.json'));

/** Every diagram renderAll produces, labelled for the failure message. */
const sources = (d: DesignDoc, title: string): [string, string][] => {
	const all = renderAll(d, title);
	return [
		['use case', all.useCase],
		['class', all.class],
		['deployment', all.deployment],
		...all.sequences.map((s): [string, string] => [s.id, s.mermaid])
	];
};

/** Free text and member types that once broke a diagram or could. */
function tricky(): DesignDoc {
	const d = design();
	d.actors[0].name = 'The "admin"; C# user';
	d.actors[0].description = 'Uses; everything #1';
	d.useCases[0].name = 'Add; a "task" #now';
	const task = d.classes[0];
	task.attributes.push(
		{ name: 'index', type: 'Record<string, Promise<Task[]>>' },
		{ name: 'state', type: "'open' | 'done'" },
		{ name: 'onChange', type: '(t: Task) => void' },
		{ name: 'meta', type: '{ id: string; done: boolean }' },
		{ name: 'pair', type: '[string, number]' }
	);
	task.methods.push({
		name: 'apply',
		params: [{ name: 'fn', type: '(t: Task) => Promise<void>' }],
		returnType: '{ ok: boolean; at: Date }'
	});
	d.classes[2].relations[0].label = 'stores; "all" #tasks';
	d.components[0].name = 'Task API; "v1" #main';
	d.nodes[0].name = 'Node; "x" #1';
	// a client node draws as a dashed subgraph; its component holds no classes
	d.nodes.push({ id: 'DSN-021', name: 'Browser; "x" #1', kind: 'client', reqIds: [] });
	d.components.push({
		id: 'DSN-022',
		name: 'Page; "x" #1',
		classIds: [],
		nodeId: 'DSN-021',
		reqIds: []
	});
	d.links.push({ from: 'DSN-021', to: 'DSN-008', protocol: 'http' });
	d.nodes.push({ id: 'DSN-020', name: 'Rates; "x" #1', kind: 'external', reqIds: [] });
	d.links.push({ from: 'DSN-008', to: 'DSN-020', protocol: 'https', label: 'rows; "all" #1' });
	d.sequences[0].name = 'Flow; "x" #1';
	return d;
}

describe('rendered diagrams parse with Mermaid (Review Focus 3)', () => {
	it('parses every diagram of the fixture', async () => {
		for (const [label, source] of sources(design(), 'To-do app')) {
			await expect(mermaid.parse(source), label).resolves.toBeTruthy();
		}
	});

	it('parses diagrams with quotes, semicolons, hashes and complex member types', async () => {
		const d = tricky();
		const { issues, normalised } = validateDesign(d, reqs());
		expect(issues).toEqual([]);
		for (const [label, source] of sources(normalised, 'To-do; "app" #1')) {
			await expect(mermaid.parse(source), `${label}:\n${source}`).resolves.toBeTruthy();
		}
	});
});
