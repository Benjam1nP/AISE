import { describe, expect, it } from 'vitest';
import { traceIds } from './trace-ids.ts';

describe('traceIds', () => {
	it('reads the class and requirement IDs of the @trace tag', () => {
		const source = `import { A } from './A';\n\n/**\n * A task.\n * @trace DSN-004 REQ-001 REQ-003\n */\nexport class Task {}\n`;
		expect(traceIds(source)).toEqual(['DSN-004', 'REQ-001', 'REQ-003']);
	});

	it('ignores IDs outside a @trace line and repeats', () => {
		const source = `// see REQ-009\n/** @trace DSN-001 REQ-002 */\n/** @trace DSN-001 REQ-002 */\n`;
		expect(traceIds(source)).toEqual(['DSN-001', 'REQ-002']);
	});

	it('returns nothing for a file without the tag', () => {
		expect(traceIds('export const x = 1;')).toEqual([]);
	});
});
