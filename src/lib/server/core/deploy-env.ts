import { readFile } from 'node:fs/promises';
import { listCodeFiles, orMissing } from './code-state';
import type { DeployPlan } from './deploy-plan';
import type { ProjectStore } from './store';

/** Read by many programs and set by the platform, so a compose placeholder would only do harm. */
const STANDARD = new Set(['NODE_ENV', 'TZ', 'HOME', 'PATH']);

/** `process.env.X` and `process.env['X']` in `text`, sorted and once. A computed key has no name. */
export function envReads(text: string): string[] {
	const names = new Set<string>();
	for (const m of text.matchAll(
		/process\.env\.([A-Za-z_]\w*)|process\.env\[\s*(['"])(\w+)\2\s*\]/g
	))
		names.add(m[1] ?? m[3]);
	return [...names].sort();
}

/**
 * The literal compose value for a variable the plan does not set, valid for the type its name
 * suggests so the app still starts: a number for `PORT` or `..._PORT`, a URL for `..._URL`, else
 * text that says to change it (`ADMIN_PASSWORD` gives `change-me-admin-password`).
 */
export function placeholderFor(name: string): string {
	if (/(^|_)PORT$/.test(name)) return '3000';
	if (/(^|_)URL$/.test(name)) return 'http://change-me.invalid';
	return `change-me-${name.toLowerCase().replace(/_/g, '-')}`;
}

/**
 * Variables the code under `src/` reads (not its tests) that no service of the plan sets, sorted.
 * Plain text scan, no LLM. Every one needs a literal value in compose.yaml, else the container
 * starts without it. A service is not matched to the files it runs, so one variable counts as set
 * when any service sets it.
 */
export async function extraEnvVars(store: ProjectStore, plan: DeployPlan): Promise<string[]> {
	const set = new Set(plan.services.flatMap((s) => Object.keys(s.env)));
	const found = new Set<string>();
	for (const file of await listCodeFiles(store)) {
		if (!file.startsWith('src/') || !file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
		const text = await readFile(store.resolve(file), 'utf8').catch((e) => orMissing(e, ''));
		for (const name of envReads(text)) found.add(name);
	}
	return [...found].filter((n) => !set.has(n) && !STANDARD.has(n)).sort();
}
