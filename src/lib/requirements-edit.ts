import type { Requirement } from '#lib/server/core/schemas/requirements.ts';

export type EditableField = 'title' | 'text' | 'acceptanceCriteria';
export type SaveErrors = { fields: Partial<Record<EditableField, string>>; general: string[] };

export type Draft = {
	id: string;
	title: string;
	text: string;
	type: Requirement['type'];
	priority: Requirement['priority'];
	/** One criterion per line. */
	criteria: string;
};

export const toLines = (text: string): string[] =>
	text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

export const toDraft = (r: Requirement): Draft => ({
	id: r.id,
	title: r.title,
	text: r.text,
	type: r.type,
	priority: r.priority,
	criteria: r.acceptanceCriteria.join('\n')
});

export const toRequirement = (d: Draft): Requirement => ({
	id: d.id,
	title: d.title.trim(),
	text: d.text.trim(),
	type: d.type,
	priority: d.priority,
	acceptanceCriteria: toLines(d.criteria)
});

/** The next free REQ ID after the highest one in use. */
export function nextReqId(reqs: Requirement[]): string {
	const max = Math.max(0, ...reqs.map((r) => Number(r.id.slice(4)) || 0));
	return `REQ-${String(max + 1).padStart(3, '0')}`;
}

const FIELD_PATH = /^requirements\.(\d+)\.(title|text|acceptanceCriteria)\b[^:]*: (.*)$/;

/**
 * Sorts a server message for a saved document: issues on a field of the requirement at `index` go
 * next to that field, everything else stays a general message. The message is the zod issue list
 * joined with "; " (see action-errors.server.ts).
 */
export function parseSaveErrors(message: string, index: number): SaveErrors {
	const result: SaveErrors = { fields: {}, general: [] };
	const body = message.replace(/\.? Fix this and try again\.$/, '');
	for (const part of body.split('; ')) {
		const m = FIELD_PATH.exec(part);
		if (m && Number(m[1]) === index) {
			const field = m[2] as EditableField;
			result.fields[field] =
				field === 'acceptanceCriteria' && /too small/i.test(m[3])
					? 'Add at least one acceptance criterion.'
					: `${m[3]}. Fix this and try again.`;
		} else result.general.push(part);
	}
	if (result.general.length > 0) result.general = [message];
	return result;
}
