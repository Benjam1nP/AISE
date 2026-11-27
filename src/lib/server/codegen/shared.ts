import { readFile } from 'node:fs/promises';
import type { ToolContext } from '../core/tools/index';

/** Runs `fn` over `items` with at most `limit` in flight; `fn` must not throw. */
export async function pool<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	const lane = async () => {
		while (next < items.length) await fn(items[next++]!);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** A project relative path with forward slashes and no leading `./`, as tsc and Vitest may print it. */
export const normPath = (p: string) => p.replaceAll('\\', '/').replace(/^\.\//, '');

/** A project file's text, or null when it cannot be read (missing). */
export const readOrNull = (ctx: ToolContext, rel: string) =>
	readFile(ctx.store.resolve(rel), 'utf8').catch(() => null);
