import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DesignDoc } from '../schemas/design';
import { RequirementsDoc } from '../schemas/requirements';
import { GENERATED_HEADER, designMarkdown, readmeMarkdown, requirementsMarkdown } from './markdown';
import { renderAll, renderClass, renderDeployment, renderSequence, renderUseCase } from './mermaid';

const fixture = (name: string): unknown =>
	JSON.parse(
		readFileSync(new URL(`../../../../../test/fixtures/${name}`, import.meta.url), 'utf8')
	);
const design = () => DesignDoc.parse(fixture('todo-design.json'));
const reqs = () => RequirementsDoc.parse(fixture('todo-requirements.json'));
/** The fixture plus an external node that the app server calls over HTTPS. */
const linked = () => {
	const d = design();
	d.nodes.push({ id: 'DSN-020', name: 'Rates', kind: 'external', reqIds: [] });
	d.links.push({ from: 'DSN-008', to: 'DSN-020', protocol: 'https' });
	return d;
};

describe('renderUseCase', () => {
	it('renders actors, use cases, edges and click handlers', () => {
		const out = renderUseCase(design(), 'To-do app');
		expect(out.startsWith('flowchart LR')).toBe(true);
		expect(out).toContain('ACT_001["User"]');
		expect(out).toContain('subgraph system["To-do app"]');
		expect(out).toContain('UC_001(["Add task"])');
		expect(out).toContain('ACT_001 --- UC_001');
		expect(out).toContain('click UC_001 call aiseSelect("UC-001")');
		expect(out).toContain('click ACT_001 call aiseSelect("ACT-001")');
	});

	it('escapes double quotes in labels', () => {
		const d = design();
		d.actors[0].name = 'The "admin"';
		const out = renderUseCase(d, 'A "big" app');
		expect(out).toContain('ACT_001["The #quot;admin#quot;"]');
		expect(out).toContain('subgraph system["A #quot;big#quot; app"]');
		expect(out).not.toMatch(/The "admin"/);
	});
});

describe('renderClass', () => {
	it('renders generics, interfaces, inheritance and click handlers', () => {
		const out = renderClass(design());
		expect(out.startsWith('classDiagram')).toBe(true);
		expect(out).toContain('+findAll() Promise~Task[]~');
		expect(out).toContain('+findById(id: number) Promise~Task | null~');
		expect(out).toContain('+getTasks() Promise~Array~Task~~');
		expect(out).toContain('<<interface>>');
		expect(out).not.toMatch(/\w<\w/);
		expect(out).toContain('TaskRepository <|.. SqliteTaskRepository');
		expect(out).toContain('TaskService --> "1" TaskRepository : stores tasks in');
		expect(out).toContain('TaskController ..> TaskService : uses');
		expect(out).toContain('click Task call aiseSelect("DSN-001")');
	});

	it('renders Record generics with the tilde form', () => {
		const d = design();
		d.classes[0].attributes.push({ name: 'counts', type: 'Record<string, number>' });
		expect(renderClass(d)).toContain('+counts : Record~string, number~');
	});

	it('keeps a string literal union attribute on one line without raw angle brackets', () => {
		const d = design();
		d.classes[0].attributes = [{ name: 'status', type: '"open" | "done"' }];
		const out = renderClass(d);
		expect(out).toContain('+status : #quot;open#quot; | #quot;done#quot;');
	});

	it('keeps braces and function arrows of member types from breaking the class body', () => {
		const d = design();
		d.classes[0].attributes = [
			{ name: 'meta', type: '{ a: string }' },
			{ name: 'cb', type: '(x: number) => void' }
		];
		const body = renderClass(d).split('class TaskController')[0];
		expect(body).toContain('+meta : #123; a: string #125;');
		expect(body).toContain('+cb : (x: number) #8594; void');
		expect(body).not.toMatch(/\+\w+ : .*[{}]/);
	});

	it('escapes a quote in a relation label', () => {
		const d = design();
		d.classes[2].relations[0].label = 'stores "tasks"';
		expect(renderClass(d)).toContain('stores #quot;tasks#quot;');
	});

	it('renders enums and uses the plain class form for empty classes', () => {
		const d = design();
		d.classes.push({
			id: 'DSN-010',
			name: 'Status',
			kind: 'enum',
			description: '',
			attributes: [],
			methods: [],
			values: ['OPEN', 'DONE'],
			relations: [{ kind: 'composition', targetId: 'DSN-001', multiplicity: '1' }],
			reqIds: []
		});
		const out = renderClass(d);
		expect(out).toMatch(/<<enumeration>>\n\s+OPEN\n\s+DONE/);
		expect(out).toContain('Status *-- "1" Task');
	});
});

describe('renderSequence', () => {
	it('declares participants in order of first appearance before the messages', () => {
		const out = renderSequence(design(), 'SEQ-001');
		const lines = out.split('\n');
		expect(lines[0]).toBe('sequenceDiagram');
		expect(lines[1]).toBe('  participant ACT_001 as User');
		expect(lines[2]).toBe('  participant DSN_002 as TaskController');
		expect(lines[3]).toBe('  participant DSN_003 as TaskService');
		expect(lines[4]).toBe('  participant DSN_004 as TaskRepository');
		expect(lines[5]).toBe('  ACT_001->>DSN_002: postTask(title)');
		expect(lines[7]).toBe('  DSN_003->>DSN_004: create(title)');
	});

	it('throws on an unknown sequence', () => {
		expect(() => renderSequence(design(), 'SEQ-099')).toThrow('SEQ-099');
	});
});

describe('renderDeployment', () => {
	it('renders nodes with their components and edges from links only', () => {
		const out = renderDeployment(design());
		expect(out.startsWith('flowchart TB')).toBe(true);
		expect(out).toContain('subgraph DSN_008["App server"]');
		expect(out).toContain('DSN_006["Task API"]');
		expect(out).toContain('DSN_007["Persistence"]');
		// the relation DSN-005 to DSN-004 across components gives no edge
		expect(out).not.toContain('-->');
		const withLink = renderDeployment(linked());
		expect(withLink.match(/-->/g)).toHaveLength(1);
		expect(withLink).toContain('DSN_008 -->|"HTTPS"| DSN_020');
	});

	it('labels a link with its protocol and text', () => {
		const d = linked();
		d.links[0] = { ...d.links[0], protocol: 'wss', label: 'rows "all"' };
		expect(renderDeployment(d)).toContain('DSN_008 -->|"WSS: rows #quot;all#quot;"| DSN_020');
	});

	it('renders empty database, external and client nodes as their own shapes', () => {
		const d = design();
		d.nodes.push(
			{ id: 'DSN-021', name: 'Cache', kind: 'database', reqIds: [] },
			{ id: 'DSN-022', name: 'Mail "SMTP"', kind: 'external', reqIds: [] },
			{ id: 'DSN-023', name: 'Browser', kind: 'client', reqIds: [] }
		);
		const out = renderDeployment(d);
		expect(out).toContain('DSN_021[("Cache")]');
		expect(out).toContain('DSN_022{{"Mail #quot;SMTP#quot;"}}');
		expect(out).toContain('DSN_023(["Browser"])');
		expect(out).not.toContain('class DSN_023 client');
	});

	it('draws a client node with components as a dashed subgraph', () => {
		const d = linked();
		d.nodes[0].kind = 'client';
		const out = renderDeployment(d);
		expect(out).toContain('classDef client stroke-dasharray:4 2');
		expect(out).toContain('subgraph DSN_008["App server"]');
		expect(out).toContain('class DSN_008 client');
		expect(out).not.toContain('class DSN_020 client');
	});
});

describe('renderAll', () => {
	it('returns every diagram and one entry per sequence', () => {
		const all = renderAll(design(), 'To-do app');
		expect(all.sequences.map((s) => [s.id, s.name])).toEqual([['SEQ-001', 'Add task']]);
		expect(all.sequences[0].mermaid).toBe(renderSequence(design(), 'SEQ-001'));
		expect(all.useCase).toBe(renderUseCase(design(), 'To-do app'));
		expect(all.class).toBe(renderClass(design()));
		expect(all.deployment).toBe(renderDeployment(design()));
	});
});

describe('markdown', () => {
	it('designMarkdown starts with the header and holds 3 + sequences diagrams', () => {
		const d = linked();
		const md = designMarkdown(d, 'To-do app');
		expect(md.startsWith(`${GENERATED_HEADER}\n`)).toBe(true);
		expect(md.match(/```mermaid/g)).toHaveLength(3 + d.sequences.length);
		expect(md).toContain('DSN-001 Task (class) (REQ-001, REQ-004)');
		expect(md).toContain('- DSN-008 App server to DSN-020 Rates (HTTPS)\n');
		d.links[0].label = 'rows';
		expect(designMarkdown(d, 'To-do app')).toContain('DSN-020 Rates (HTTPS: rows)');
	});

	it('requirementsMarkdown lists requirements and the trailing sections', () => {
		const md = requirementsMarkdown(reqs());
		expect(md.startsWith(`${GENERATED_HEADER}\n`)).toBe(true);
		expect(md).toContain('## REQ-001 Add task');
		expect(md).toContain('functional, must');
		expect(md).toContain('- Adding a task with an empty title is rejected with an error message.');
		expect(md).toContain('## Assumptions');
		expect(md).toContain('- A single user; no login is needed.');
		expect(md).toContain('## Out of scope');
		expect(md).not.toContain('## Open questions');
	});

	it('requirementsMarkdown lists open questions with their requirement links', () => {
		const r = reqs();
		r.openQuestions = [{ id: 'Q-001', text: 'Who may delete tasks?', reqIds: ['REQ-004'] }];
		expect(requirementsMarkdown(r)).toContain('- Q-001: Who may delete tasks? (REQ-004)');
	});
});

describe('readmeMarkdown', () => {
	const paths = {
		'DSN-001': 'src/task-api/Task.ts',
		'DSN-005': 'src/persistence/SqliteTaskRepository.ts'
	};

	it('says how to run the project and maps every component and class to its files', () => {
		const out = readmeMarkdown(design(), 'To-do app', paths, null);
		expect(out.startsWith(GENERATED_HEADER)).toBe(true);
		expect(out).toContain('npm start');
		expect(out).toContain('## Task API (DSN-006)');
		expect(out).toContain(
			'| Task | `src/task-api/Task.ts` | DSN-001 | REQ-001, REQ-004 | A single to-do item. |'
		);
		expect(out).not.toContain('DB_PATH');
	});

	it('gives one run line per service node, and the single node line otherwise', () => {
		const one = readmeMarkdown(design(), 'To-do app', paths, null);
		expect(one).toContain('npm start          # http://localhost:8080, PORT changes the port');
		expect(one).not.toContain('npm run start:');
		const d = design();
		d.nodes.push({ id: 'DSN-020', name: 'Live Updates', kind: 'service', reqIds: [] });
		const two = readmeMarkdown(d, 'To-do app', paths, null);
		expect(two).toContain('npm start          # http://localhost:8080, PORT changes the port');
		expect(two).toContain(
			'npm run start:live-updates   # Live Updates, http://localhost:8081, LIVE_UPDATES_PORT changes the port'
		);
	});

	it('links RUN.md only when the run doc exists', () => {
		const link = 'Run it with Docker: see [RUN.md](RUN.md).';
		expect(readmeMarkdown(design(), 'To-do app', paths, null, true)).toContain(link);
		expect(readmeMarkdown(design(), 'To-do app', paths, null)).not.toContain('RUN.md');
		expect(readmeMarkdown(design(), 'To-do app', paths, null, false)).not.toContain('RUN.md');
	});

	it('names the database file only when the app has one', () => {
		const out = readmeMarkdown(design(), 'To-do app', paths, './data/to-do-app.db');
		expect(out).toContain('`./data/to-do-app.db`');
		expect(out).toContain('DB_PATH');
	});
});
