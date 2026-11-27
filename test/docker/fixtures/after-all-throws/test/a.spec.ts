import { afterAll, expect, it } from 'vitest';
import { a } from '../src/a.js';

afterAll(() => {
	throw new Error('teardown failed');
});

it('passes', () => {
	expect(a).toBe(1);
});
