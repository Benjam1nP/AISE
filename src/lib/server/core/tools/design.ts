import { z } from 'zod';
import { designMarkdown } from '../render/markdown';
import { DesignDoc, NodeLink } from '../schemas/design';
import { RequirementsDoc } from '../schemas/requirements';
import { nextFreeIds, validateDesign } from '../validate';
import { defineTool, ToolError } from './registry';

export const DESIGN_PATH = '.aise/design.json';
const MD_PATH = 'docs/design.md';

export const readDesign = defineTool({
	name: 'read_design',
	description: 'Read the current design model. Returns null when none has been written yet.',
	input: z.strictObject({}),
	run: ({ store }) => store.readJson(DESIGN_PATH, DesignDoc)
});

export const updateDesign = defineTool({
	name: 'update_design',
	description:
		'Replace the whole design model. The input is the design itself. Always send the complete design. Every reference is checked and all problems are returned, so nothing is written until the design is consistent. Every result names the next free ID per prefix (counting the saved design too, so deleted IDs are not reused) and, after a save, warnings that do not block it.',
	// links required here, so a model that leaves them out is told instead of losing them
	input: DesignDoc.extend({ links: z.array(NodeLink) }),
	async run({ store, runId, projectName }, design) {
		const reqs = await store.readJson('.aise/requirements.json', RequirementsDoc);
		// a saved design that no longer parses must not block replacing it
		const saved = await store.readJson(DESIGN_PATH, DesignDoc).catch(() => null);
		const nextIds = nextFreeIds(design, saved);
		const { issues, warnings, normalised } = validateDesign(design, reqs);
		if (issues.length > 0) {
			throw new ToolError(
				`The design was not saved. Fix these ${issues.length} issues:\n` +
					issues.map((i) => `${i.path}: ${i.message}`).join('\n') +
					`\nNext free IDs for new elements: ${Object.values(nextIds).join(', ')}`
			);
		}
		await store.writeJson(DESIGN_PATH, DesignDoc, normalised, runId);
		await store.writeFile(MD_PATH, designMarkdown(normalised, projectName), runId);
		return {
			ok: true,
			classes: normalised.classes.length,
			issues: 0,
			warnings: warnings.map((w) => `${w.path}: ${w.message}`),
			nextIds
		};
	}
});
