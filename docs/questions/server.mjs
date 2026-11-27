#!/usr/bin/env node
// Local answer sheet for docs/project-questions.md. No dependencies.
// Run: node docs/questions/server.mjs   then open http://localhost:4321
// Answers are written to docs/questions/answers.json; commit that file to share them.

import { createServer } from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseQuestions } from './parse.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const QUESTIONS = join(here, '..', 'project-questions.md');
const OVERVIEW = join(here, '..', 'diagrams', 'project-overview.html');
const PAGE = join(here, 'index.html');
const ANSWERS = join(here, 'answers.json');
const PORT = Number(process.env.PORT ?? 4321);
const STATUSES = new Set(['open', 'agreed', 'discuss']);
const MAX_BODY = 64 * 1024;
const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

const loadSections = async () => parseQuestions(await readFile(QUESTIONS, 'utf8'));

async function loadAnswers() {
	try {
		return JSON.parse(await readFile(ANSWERS, 'utf8'));
	} catch (err) {
		if (err.code === 'ENOENT') return {};
		if (err instanceof SyntaxError) throw new Error(`answers.json is not valid JSON, maybe a merge conflict: ${err.message}`);
		throw err;
	}
}

const byId = (a, b) => {
	const [x1, y1] = a.split('.').map(Number);
	const [x2, y2] = b.split('.').map(Number);
	return x1 - x2 || y1 - y2;
};

// Writes are serialised so two quick saves never interleave.
let writes = Promise.resolve();
function saveAnswer(id, entry) {
	writes = writes
		.catch(() => {})
		.then(async () => {
			const all = { ...(await loadAnswers()), [id]: entry };
			const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => byId(a, b)));
			await writeFile(`${ANSWERS}.tmp`, `${JSON.stringify(sorted, null, '\t')}\n`);
			await rename(`${ANSWERS}.tmp`, ANSWERS);
		});
	return writes;
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size <= MAX_BODY) return chunks.push(chunk);
			// Drain the rest without buffering it.
			req.removeAllListeners('data').resume();
			reject(Object.assign(new Error('Body too large'), { status: 413 }));
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
	res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
	res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};

async function handle(req, res) {
	const { pathname } = new URL(req.url, 'http://localhost');
	// Only this machine may talk to us: blocks DNS rebinding and cross site writes.
	if (!LOCAL_HOSTS.has(req.headers.host)) return send(res, 403, { error: 'Forbidden host' });

	if (req.method === 'GET' && pathname === '/') return send(res, 200, await readFile(PAGE), 'text/html; charset=utf-8');
	if (req.method === 'GET' && pathname === '/overview') return send(res, 200, await readFile(OVERVIEW), 'text/html; charset=utf-8');
	if (req.method === 'GET' && pathname === '/api/data') {
		return send(res, 200, { sections: await loadSections(), answers: await loadAnswers() });
	}

	const match = pathname.match(/^\/api\/answers\/(\d+\.\d+)$/);
	if (req.method === 'PUT' && match) {
		const id = match[1];
		const known = (await loadSections()).some((s) => s.questions.some((q) => q.id === id));
		if (!known) return send(res, 404, { error: `No question ${id}` });

		// A JSON content type forces a CORS preflight, which we never answer.
		if (!req.headers['content-type']?.startsWith('application/json')) {
			return send(res, 415, { error: 'Expected application/json' });
		}
		let body;
		try {
			body = JSON.parse(await readBody(req));
		} catch (err) {
			return send(res, err.status ?? 400, { error: err.status ? err.message : 'Expected a JSON body' });
		}
		const { answer = '', status = 'open', by = '' } = body;
		if (typeof answer !== 'string' || typeof by !== 'string' || !STATUSES.has(status)) {
			return send(res, 400, { error: 'answer and by must be strings; status must be open, agreed or discuss' });
		}
		const entry = { answer, status, by: by.slice(0, 40), updatedAt: new Date().toISOString() };
		await saveAnswer(id, entry);
		return send(res, 200, entry);
	}

	send(res, 404, { error: 'Not found' });
}

createServer((req, res) => {
	handle(req, res).catch((err) => {
		console.error(err);
		send(res, 500, { error: err.message });
	});
}).listen(PORT, '127.0.0.1', () => {
	console.log(`Project questions: http://localhost:${PORT}`);
});
