import type { DesignDoc } from '../core/schemas/design';
import type { RequirementsDoc } from '../core/schemas/requirements';
import type { CodeModel, Decl } from '../core/tools/code-model';
import type { TestFilePlan } from '../testgen/plan';
import { importPath } from './code-worker';
import { TEST_RULES } from './test-rules';
import type { AgentDef } from './types';

const system = `You are a test worker in an AI assisted software engineering environment. You write one Vitest file of a generated project: the tests for one use case, or for one requirement that no use case links. The brief names the file, every test it must contain with its exact title, the use case and its sequences, the signatures of the classes involved with the import line of each, and the HTTP routes. You see signatures and never the implementation, so write the tests from the requirements and the design, and treat the signatures as the API.

You have two tools. write_file writes your one file and refuses every other path. read_file reads project files outside src/, for example the file itself when you retry; a read of src/ is refused. Write the complete file with one write_file call, using the exact path from the brief. When the brief carries problems from an earlier attempt, fix every one of them and change nothing they do not require. The environment checks your file with the TypeScript compiler and runs it after you finish; a test that fails because the code does not meet its criterion is correct and stays as written.

Never write Mermaid or any diagram syntax. Reply with one short sentence.

${TEST_RULES}`;

/** Haiku writes first and second attempts; Sonnet is the escalation on the third. */
export function testWorkerDef(model: 'claude-haiku-5-5' | 'claude-sonnet-5-5'): AgentDef {
	return {
		// scope: agent `test` reads everything but src/ and writes only test/
		name: 'test',
		model,
		// Same efforts as the code workers: low holds for one file from exact signatures, Sonnet
		// gets medium as the recommended start for agentic work on it.
		effort: model === 'claude-haiku-5-5' ? 'low' : 'medium',
		tools: ['read_file', 'write_file'],
		system
	};
}

/** A title as a JavaScript string literal; newlines become spaces so it stays one line. */
const literal = (title: string): string => JSON.stringify(title.replace(/\s*\n\s*/g, ' '));

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join('\n');

/** The declaration of a class, interface, enum, function or const as the code model lists it, without bodies. */
function declarationOf(d: Decl): string {
	if (d.kind === 'function') {
		return (d.signature ?? d.name)
			.split('\n')
			.map((l) => `export function ${l};`)
			.join('\n');
	}
	if (d.kind === 'type') return `export ${d.signature ?? d.name};`;
	if (d.kind === 'const') return `export const ${d.signature ?? d.name};`;
	if (d.kind === 'enum')
		return `export enum ${d.name} { ${d.members.map((m) => m.signature).join(', ')} }`;
	const heads = [
		d.extends ? `extends ${d.extends}` : '',
		d.implements?.length ? `implements ${d.implements.join(', ')}` : ''
	].filter(Boolean);
	const members = d.members
		.filter((m) => m.visibility === 'public')
		.map((m) => `  ${m.static ? 'static ' : ''}${m.signature};`);
	return [`export ${d.kind} ${[d.name, ...heads].join(' ')} {`, ...members, '}'].join('\n');
}

/** Declarations of a design class: those tagged with its DSN ID, else the ones with its name. */
function declsOfClass(model: CodeModel, id: string, name: string): Decl[] {
	const tag = new RegExp(`(^|[^A-Za-z0-9-])${id}(?![0-9])`);
	const tagged = model.decls.filter((d) => d.tags.some((t) => /^@trace\b/.test(t) && tag.test(t)));
	if (tagged.length > 0) return tagged;
	const named = model.decls.find((d) => d.name === name);
	return named ? [named] : [];
}

/** The user message for a test worker: everything it needs for one test file and nothing else. */
export function testWorkerBrief(
	reqs: RequirementsDoc,
	design: DesignDoc,
	model: CodeModel,
	plan: TestFilePlan,
	retry?: { content: string; problems: string[] }
): string {
	const useCase = design.useCases.find((u) => u.id === plan.id);
	const sequences = plan.sequenceIds.flatMap(
		(id) => design.sequences.find((s) => s.id === id) ?? []
	);
	const out: string[] = [];

	out.push(
		`Write the file ${plan.path}. It has one top level describe(${literal(`${plan.id} ${plan.name}`)}, ...) and contains exactly these tests, with exactly these titles. Each title is a JavaScript string literal: copy it exactly.`
	);

	const titles = [
		...plan.criteria.map((c) => {
			const hint = c.manualHint
				? ' (non functional requirement: write a real test only if one is practical, else it.todo with the manual: form)'
				: '';
			return `it(${literal(`${c.reqId} AC${c.n}: ${c.text}`)}, ...)${hint}`;
		}),
		...sequences.map((s) => `it(${literal(`${s.id} scenario: ${s.name}`)}, ...)`)
	];
	out.push(`Tests to write:\n${titles.length > 0 ? bullets(titles) : 'none'}`);

	const reqIds = [...new Set(plan.criteria.map((c) => c.reqId))];
	const texts = reqIds.map((id) => {
		const r = reqs.requirements.find((x) => x.id === id);
		return r
			? `- ${r.id} ${r.title} (${r.priority}, ${r.type}): ${r.text}`
			: `- ${id}: (not in the requirements)`;
	});
	out.push(`Requirements behind the criteria:\n${texts.length > 0 ? texts.join('\n') : 'none'}`);

	if (useCase) {
		const actors = useCase.actorIds.map((a) => design.actors.find((x) => x.id === a)?.name ?? a);
		out.push(
			`The use case: ${useCase.name} (${useCase.id})${useCase.description ? `. ${useCase.description}` : ''}${actors.length > 0 ? `\nActors: ${actors.join(', ')}` : ''}`
		);
	}
	if (sequences.length > 0) {
		const nameOf = (id: string) => {
			const c = design.classes.find((x) => x.id === id);
			return c ? `${c.name} (${c.id})` : (design.actors.find((a) => a.id === id)?.name ?? id);
		};
		out.push(
			`Sequences that realise it, with their messages in order:\n${sequences
				.map(
					(s) =>
						`${s.name} (${s.id})\n${s.messages
							.map(
								(m, i) =>
									`  ${i + 1}. ${nameOf(m.fromId)} -> ${nameOf(m.toId)}: ${m.method}${m.label ? ` (${m.label})` : ''}`
							)
							.join('\n')}`
				)
				.join('\n')}`
		);
	}

	const shown = new Set<Decl>();
	const classLines = plan.classIds.flatMap((id) => {
		const cls = design.classes.find((c) => c.id === id);
		if (!cls) return [];
		return declsOfClass(model, id, cls.name)
			.filter((d) => !shown.has(d))
			.map((d) => {
				shown.add(d);
				return `- ${d.name} (${cls.id}): import { ${d.name} } from '${importPath(plan.path, d.file)}';\n${declarationOf(
					d
				)
					.split('\n')
					.map((l) => `    ${l}`)
					.join('\n')}`;
			});
	});
	out.push(
		classLines.length > 0
			? `Classes involved, with the import line from the test file. These are signatures only:\n${classLines.join('\n')}`
			: 'No code declarations are known for the classes involved; test through the HTTP routes.'
	);

	const app = model.decls.find((d) => d.name === 'createApp' && d.kind === 'function');
	out.push(
		app
			? `The app factory: import { createApp } from '${importPath(plan.path, app.file)}';\n${declarationOf(app)}`
			: 'There is no createApp declaration yet; do not test through HTTP.'
	);
	out.push(
		model.routes.length > 0
			? `Routes registered in src/app, with the path to request:\n${bullets(
					model.routes.map((r) => `${r.method.toUpperCase()} ${r.path} (${r.file}:${r.line})`)
				)}`
			: 'There are no routes registered yet.'
	);

	if (retry) {
		out.push(
			`This is a retry. The file as it is now:\n\`\`\`ts\n${retry.content}\n\`\`\`\nProblems to fix, all of them:\n${bullets(retry.problems)}\nYou may read_file the files under test/.`
		);
	}
	return out.join('\n\n');
}
