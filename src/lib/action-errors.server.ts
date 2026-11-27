import { error, fail } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { ConflictError, NotFoundError } from '#lib/server/index.ts';
import { PathError } from '#lib/server/core/store.ts';

const CONFLICT: Record<NonNullable<ConflictError['code']>, string> = {
	run_active: 'The agent is still working on this project. Wait for it to finish, then try again.',
	busy: 'Another action on this project is still running. Try again in a moment.'
};

/** A message as one sentence: a full stop is added unless it already ends with punctuation. */
const sentence = (m: string) => (/[.!?]$/.test(m) ? m : `${m}.`);

function zodMessage(e: ZodError): string {
	const issues = e.issues.map((i) =>
		i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message
	);
	return `${issues.join('; ')}. Fix this and try again.`;
}

/**
 * Turns an orchestrator error into the answer of a form action: 409 for a clash with the project
 * state, 400 for input that is not valid, 404 for an unknown project. Anything else is a bug and
 * is thrown again. `extra` (for example which action failed) is added to the returned data.
 */
export function actionFail<T extends Record<string, unknown> = Record<never, never>>(
	e: unknown,
	extra: T = {} as T
) {
	if (e instanceof ConflictError) {
		return fail(409, { ...extra, message: e.code ? CONFLICT[e.code] : sentence(e.message) });
	}
	if (e instanceof PathError) {
		return fail(400, { ...extra, message: `${e.message}. Check the name and try again.` });
	}
	if (e instanceof ZodError) return fail(400, { ...extra, message: zodMessage(e) });
	if (e instanceof NotFoundError) {
		return fail(404, { ...extra, message: `${e.message}. Go back to the project list.` });
	}
	throw e;
}

/** For load functions: an unknown or invalid project name is a 404 page, other errors stay 500. */
export function loadFail(e: unknown): never {
	if (e instanceof NotFoundError || e instanceof PathError) {
		error(404, `${e.message}. Go back to the project list and pick another project.`);
	}
	throw e;
}
