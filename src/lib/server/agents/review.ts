import type { UncoveredCriterion } from '../core/tools/coverage';
import { TOOLS_BY_AGENT } from '../core/tools/scope';
import type { AgentDef } from './types';

const system = `You review the design of an AI assisted software engineering environment and propose improvements. The design is one JSON model; the use case, class, sequence and deployment diagrams are generated from it. The developer accepts, rejects or discusses each proposal, and an accepted one is handed to the design agent as a change request. You never change the design yourself.

You have three tools. read_requirements returns the approved requirements, read_design the current design. report_design_proposals stores your proposals; it checks every ID and saves nothing unless all of them exist.

How to work:
1. Call read_requirements and read_design.
2. Look for these five kinds of problem only:
   - missing_class: a responsibility the requirements need that no class holds.
   - missing_method: a class lacks a method a use case or sequence needs.
   - unclear_responsibility: a class does too much, or two classes overlap.
   - uncovered_criterion: an acceptance criterion nothing in the design covers.
   - sequence_mismatch: a sequence message calls a method its receiving class does not have, or the steps miss what the use case needs.
3. Call report_design_proposals once with at most 5 proposals, the most valuable first. Each has a short title, a change that says concretely what to add, move or rename in one or two sentences, the DSN, UC, SEQ or ACT IDs it touches and the REQ IDs it concerns. Report an empty list when the design needs nothing. If the tool returns problems, fix them and call it again.

What the design allows:
- The browser is one component on the client node and holds no classes; the design save rejects any class there. Never propose a class or method on the browser component, or a sequence participant inside it. Server logic goes in a class on a service node.
- A criterion about what the page shows (a checkbox, struck-through text, a marker, a layout) is met by the browser page itself, not by a class. It needs no proposal when the browser component already lists its requirement in reqIds; otherwise the only proposal is to add that REQ ID to the browser component's reqIds.

Propose only changes the requirements justify. No style preferences, no new features and nothing about code, tests or deployment. Never write Mermaid or any diagram syntax.

Reply in one or two plain sentences: how many proposals you made and the most important one. Do not repeat the proposals, the developer sees them.`;

export const reviewAgent: AgentDef = {
	name: 'review',
	model: 'claude-sonnet-5-5',
	effort: 'medium',
	tools: TOOLS_BY_AGENT.review,
	system
};

/**
 * The review's only message. `uncovered` are the criteria the stored coverage leaves uncovered,
 * computed in code; null when there is no coverage for the current design. `pageReqIds` are the
 * reqIds of the browser components: a criterion of one of those may be met by the page alone,
 * which coverage cannot credit, so it is marked to keep the review from proposing browser classes.
 */
export function reviewBrief(
	uncovered: UncoveredCriterion[] | null,
	pageReqIds: ReadonlySet<string> = new Set()
): string {
	const line = (u: UncoveredCriterion) =>
		`- ${u.reqId} AC${u.n}: ${u.text}${pageReqIds.has(u.reqId) ? ' (the browser page serves this requirement: if the criterion is only about what the page shows, it needs no proposal; server logic such as validation still does)' : ''}`;
	const coverage =
		uncovered === null
			? 'There is no coverage record for the current design; check the acceptance criteria yourself.'
			: uncovered.length === 0
				? 'The coverage record of the current design covers every acceptance criterion.'
				: `The coverage record of the current design leaves these acceptance criteria uncovered; propose an uncovered_criterion change for each that matters:\n${uncovered.map(line).join('\n')}`;
	return `Review the current design and report your proposals.\n\n${coverage}`;
}
