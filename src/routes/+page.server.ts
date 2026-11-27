import { fail, redirect } from '@sveltejs/kit';
import { actionFail } from '#lib/action-errors.server.ts';
import { getOrchestrator } from '#lib/server/index.ts';
import { isValidProjectName } from '#lib/server/core/store.ts';

export async function load() {
	return { projects: await getOrchestrator().listProjects() };
}

export const actions = {
	create: async ({ request }) => {
		const raw = (await request.formData()).get('name');
		const name = typeof raw === 'string' ? raw.trim() : '';
		if (!isValidProjectName(name)) {
			return fail(400, {
				field: 'name' as const,
				name,
				message:
					'Use lowercase letters, digits and hyphens, starting with a letter or digit (up to 41 characters).'
			});
		}
		try {
			await getOrchestrator().createProject(name);
		} catch (e) {
			const failed = actionFail(e, { name });
			if (failed.status === 409) {
				return fail(409, {
					name,
					message: `A project named "${name}" already exists. Open it, or pick another name.`
				});
			}
			return failed;
		}
		redirect(303, `/p/${name}`);
	}
};
