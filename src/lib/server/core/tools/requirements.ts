import { z } from 'zod';
import { requirementsMarkdown } from '../render/markdown';
import { RequirementsDoc } from '../schemas/requirements';
import type { ProjectStore } from '../store';
import { defineTool } from './registry';

export const REQUIREMENTS_PATH = '.aise/requirements.json';
const MD_PATH = 'docs/requirements.md';

/** Writes the requirements JSON and its Markdown view; with runId, backs both up for discard. */
export async function saveRequirements(
	store: ProjectStore,
	doc: RequirementsDoc,
	runId?: string
): Promise<void> {
	await store.writeJson(REQUIREMENTS_PATH, RequirementsDoc, doc, runId);
	await store.writeFile(MD_PATH, requirementsMarkdown(doc), runId);
}

export const readRequirements = defineTool({
	name: 'read_requirements',
	description:
		'Read the current requirements document. Returns null when none has been written yet.',
	input: z.strictObject({}),
	run: ({ store }) => store.readJson(REQUIREMENTS_PATH, RequirementsDoc)
});

export const writeRequirements = defineTool({
	name: 'write_requirements',
	description:
		'Replace the whole requirements document. The input is the document itself. Always send the complete document, including every requirement you keep.',
	input: RequirementsDoc,
	async run({ store, runId }, requirements) {
		await saveRequirements(store, requirements, runId);
		return {
			ok: true,
			requirements: requirements.requirements.length,
			openQuestions: requirements.openQuestions.length
		};
	}
});
