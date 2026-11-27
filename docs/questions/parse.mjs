// Parses docs/project-questions.md into sections and questions.
// Sections are "## N. Title"; questions start with "**N.N ...**"; "> " lines are the proposal.

const SECTION = /^## (\d+)\. (.+)$/;
const QUESTION = /^\*\*(\d+\.\d+)\s*(.*?)\*\*\s*(.*)$/;
const BLOCKS = /\[blocks design\]/i;

export function parseQuestions(md) {
	const sections = [];
	let section = null;
	let question = null;

	for (const raw of md.split('\n')) {
		const line = raw.trim();

		const s = line.match(SECTION);
		if (s) {
			section = { id: s[1], title: s[2], intro: '', questions: [] };
			sections.push(section);
			question = null;
			continue;
		}
		if (!section || line === '' || line === '---') continue;

		const q = line.match(QUESTION);
		if (q) {
			question = {
				id: q[1],
				lead: q[2].replace(BLOCKS, '').trim().replace(/\.$/, ''),
				blocksDesign: BLOCKS.test(q[2]),
				text: q[3],
				proposal: ''
			};
			section.questions.push(question);
			continue;
		}

		if (line.startsWith('>')) {
			if (question) question.proposal = join(question.proposal, line.replace(/^>\s?(Proposal:\s*)?/, ''));
		} else if (question) {
			if (!question.proposal) question.text = join(question.text, line);
		} else {
			section.intro = join(section.intro, line);
		}
	}
	return sections;
}

const join = (a, b) => (a ? `${a} ${b}` : b);
