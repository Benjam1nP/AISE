import { expect, it } from 'vitest';
import { a } from '../src/a.js';

it('passes', () => {
	expect(a).toBe(1);
});

it('fails', () => {
	expect(1).toBe(2);
});
