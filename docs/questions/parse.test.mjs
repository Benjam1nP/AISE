import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseQuestions } from './parse.mjs';

const md = await readFile(new URL('../project-questions.md', import.meta.url), 'utf8');
const sections = parseQuestions(md);
const questions = sections.flatMap((s) => s.questions);

test('parses all nine sections and every question', () => {
	assert.equal(sections.length, 9);
	assert.equal(sections[0].title, 'Us and how we work');
	assert.equal(questions.length, 35);
	assert.equal(new Set(questions.map((q) => q.id)).size, questions.length);
});

test('flags the questions that block the design', () => {
	const blocking = questions.filter((q) => q.blocksDesign).map((q) => q.id);
	assert.deepEqual(blocking, ['1.1', '3.1', '7.1']);
	assert.ok(!questions.find((q) => q.id === '1.1').text.includes('[blocks design]'));
});

test('joins multi line question text and proposals', () => {
	const q = questions.find((q) => q.id === '2.2');
	assert.match(q.text, /^What is out of scope\? Things that would cost time/);
	assert.match(q.proposal, /^no auth, .* no WYSIWYG diagram editor\.$/);
});

test('keeps bold leads and section intros', () => {
	const phases = sections.find((s) => s.id === '4');
	assert.match(phases.intro, /^For each phase, both of us/);
	const p1 = phases.questions[0];
	assert.equal(p1.lead, 'P1 Requirements');
	assert.match(p1.text, /^How does the agent decide/);
});

test('questions without a proposal have an empty one', () => {
	assert.equal(questions.find((q) => q.id === '3.1').proposal, '');
});
