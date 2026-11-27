import { z } from 'zod';
import { planPaths } from '../../codegen/plan';
import { PAGE } from '../client';
import { detectDrift, pageDrift, type DriftItem } from '../drift';
import type { ProjectStore } from '../store';
import { DesignDoc } from '../schemas/design';
import { buildCodeModel } from './code-model';
import { DESIGN_PATH } from './design';
import { defineTool, ToolError } from './registry';

/**
 * Design against the code under src/, private members included, and the client components against
 * the `@trace` comment of the browser page. Shared with the P4 checks.
 */
export async function checkDrift(store: ProjectStore): Promise<DriftItem[]> {
	const design = await store.readJson(DESIGN_PATH, DesignDoc);
	if (!design) throw new ToolError('There is no design yet, so there is nothing to compare with.');
	const code = buildCodeModel(store.dir, { includePrivate: true });
	let paths: Record<string, string>;
	try {
		paths = planPaths(design);
	} catch (e) {
		throw new ToolError((e as Error).message);
	}
	return [...detectDrift(design, code, paths), ...pageDrift(design, await store.readText(PAGE))];
}

export const detectDriftTool = defineTool({
	name: 'detect_drift',
	description:
		'Compare the design with the code under src/ (outside src/app/). Reports classes missing in code, exported classes missing in the design, and changed names, files, REQ IDs, attributes, methods, enum values, inheritance, dependencies on injectable classes the code does not use or the constructor does not take, constructor parameters of a design class type with no relation in the design, and a @trace comment in public/index.html whose IDs differ from the client components. Takes no input.',
	input: z.strictObject({}),
	async run({ store }) {
		const items = await checkDrift(store);
		return { clean: items.length === 0, items };
	}
});
