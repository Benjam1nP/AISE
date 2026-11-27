import { describe, expect, it } from 'vitest';
import { addUsage, costUsd, responseCostUsd } from './cost';

describe('costUsd', () => {
	it('prices sonnet input and output per million tokens', () => {
		const u = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 };
		expect(costUsd('claude-sonnet-5-5', u)).toBeCloseTo(3, 10);
	});

	it('prices cache reads and writes', () => {
		const u = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
		expect(costUsd('claude-opus-5-5', u)).toBeCloseTo(0.2 + 5, 10);
		expect(costUsd('claude-haiku-5-5', u)).toBeCloseTo(0.01 + 0.125, 10);
	});
});

describe('addUsage', () => {
	it('adds field by field', () => {
		const a = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 };
		expect(addUsage(a, a)).toEqual({ input: 2, output: 4, cacheRead: 6, cacheWrite: 8 });
	});

	it('prices sonnet cache reads at 0.10 per million', () => {
		const u = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 };
		expect(costUsd('claude-sonnet-5-5', u)).toBeCloseTo(0.1, 10);
	});

	it('prices 1 hour cache writes at 2x input and the rest at 1.25x', () => {
		const u = {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 2_000_000,
			cache_creation: { ephemeral_1h_input_tokens: 1_000_000 }
		};
		expect(responseCostUsd('claude-sonnet-5-5', u)).toBeCloseTo(4 + 2.5, 10);
	});
});
