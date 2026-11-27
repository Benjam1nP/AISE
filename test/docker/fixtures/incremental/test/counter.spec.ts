import { expect, it } from 'vitest';
import { Counter } from '../src/counter.js';

it('counts up', () => {
	expect(new Counter().increment()).toBe(1);
});
