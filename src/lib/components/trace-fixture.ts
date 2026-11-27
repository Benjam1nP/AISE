import type { Trace } from '#lib/server/core/trace.ts';

/** The trace of REQ-001 in the to do example: one use case, two classes, code and two tests. */
export const REQ_TRACE: Trace = {
	id: 'REQ-001',
	kind: 'requirement',
	requirements: ['REQ-001'],
	design: {
		actors: [],
		useCases: ['UC-001'],
		classes: ['DSN-001', 'DSN-002'],
		components: [],
		nodes: [],
		sequences: ['SEQ-001']
	},
	code: [
		{ file: 'src/tasks/Task.ts', line: 3, name: 'Task' },
		{ file: 'src/tasks/util.ts', line: 9, name: 'helper' }
	],
	tests: [
		{
			file: 'test/UC-001.test.ts',
			line: 5,
			name: 'UC-001 Add task REQ-001 AC1: works',
			status: 'passed'
		},
		{
			file: 'test/UC-001.test.ts',
			line: 9,
			name: 'UC-001 Add task REQ-001 AC2: rejects',
			status: 'failed'
		}
	]
};

export const NAMES = { 'REQ-001': 'Add a task', 'UC-001': 'Add task', 'DSN-001': 'TaskService' };
