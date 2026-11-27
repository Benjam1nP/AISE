import { describe, expect, it } from 'vitest';
import { nextReqId, parseSaveErrors, toLines, toRequirement } from './requirements-edit.ts';

describe('requirements edit helpers', () => {
	it('numbers the next requirement after the highest ID', () => {
		expect(nextReqId([])).toBe('REQ-001');
		expect(nextReqId([{ id: 'REQ-002' }, { id: 'REQ-007' }] as never)).toBe('REQ-008');
	});

	it('trims lines and drops empty ones', () => {
		expect(toLines(' a \n\n b\n  ')).toEqual(['a', 'b']);
		expect(
			toRequirement({
				id: 'REQ-001',
				title: ' T ',
				text: ' X ',
				type: 'functional',
				priority: 'must',
				criteria: 'one\n\ntwo '
			}).acceptanceCriteria
		).toEqual(['one', 'two']);
	});

	it('puts server issues next to the field of the saved requirement', () => {
		const e = parseSaveErrors(
			'requirements.1.acceptanceCriteria: Too small: expected array to have >=1 items. Fix this and try again.',
			1
		);
		expect(e.fields.acceptanceCriteria).toBe('Add at least one acceptance criterion.');
		expect(e.general).toEqual([]);
	});

	it('keeps other issues as one general message', () => {
		const message = 'requirements.0.id: Invalid string. Fix this and try again.';
		expect(parseSaveErrors(message, 1)).toEqual({ fields: {}, general: [message] });
		const busy =
			'The agent is still working on this project. Wait for it to finish, then try again.';
		expect(parseSaveErrors(busy, 0).general).toEqual([busy]);
	});
});
