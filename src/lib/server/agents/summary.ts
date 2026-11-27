import type { PhaseId } from '../core/state';
import { responseCostUsd } from './cost';
import { callModel, type CallModel } from './llm';
import { textOf, usageOf } from './loop';
import type { AgentEvent, Usage } from './types';

const PHASE_NAMES: Record<PhaseId, string> = {
	P1: 'requirements',
	P2: 'design',
	P3: 'design refinement',
	P4: 'code generation',
	P5: 'testing',
	P6: 'deployment',
	P7: 'maintenance'
};

const system = `You write the short summary a developer reads at a review gate, before they approve a phase or ask for changes. You get the phase, the agent's final reply and a list of the tools it called with their outcome. Say in at most 3 sentences, in plain prose, what the agent did and what the developer should decide or check next. Mention failed tool calls if there were any. Do not use lists, headings or markdown, and do not add details that are not in the input.`;

/** One cheap Haiku call that condenses a finished run for the gate card. */
export async function summariseRun(
	phase: PhaseId,
	finalText: string,
	toolEvents: AgentEvent[],
	call: CallModel = callModel
): Promise<{ text: string; usage: Usage; costUsd: number }> {
	const tools = toolEvents.flatMap((e) =>
		e.type === 'tool' ? [`- ${e.name}: ${e.isError ? 'error' : 'ok'}`] : []
	);
	const content = [
		`Phase: ${phase} (${PHASE_NAMES[phase]})`,
		`Tool calls:\n${tools.length > 0 ? tools.join('\n') : '(none)'}`,
		`Final reply:\n${finalText || '(empty)'}`
	].join('\n\n');

	const response = await call({
		model: 'claude-haiku-5-5',
		system,
		messages: [{ role: 'user', content }],
		tools: [],
		effort: 'low',
		maxTokens: 1000,
		cacheTail: false
	});
	const text = textOf(response.content).trim();
	if (!text) throw new Error('gate summary came back empty');
	const usage = usageOf(response.usage);
	return { text, usage, costUsd: responseCostUsd('claude-haiku-5-5', response.usage) };
}
