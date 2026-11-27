import { ToolError } from '../tools/registry';

export type TscError = { file: string; line: number; col: number; message: string };

export type TestResult = {
	/** Full name: describe titles and the `it` title. */
	name: string;
	/** The `it` title (last segment of the name). */
	title: string;
	file: string;
	/** `todo` is an `it.todo`; it counts as neither passed nor failed. */
	status: 'passed' | 'failed' | 'skipped' | 'todo';
	/** 1 based line of the `it` call (needs `--includeTaskLocation`). */
	line?: number;
	/** Set on the synthetic entry for a file level failure (load error, throwing hook). */
	suite?: true;
	error?: string;
};

/** Where the runner mounts the project; stripped from file names so agents see project relative paths. */
const APP_DIR = '/opt/aise/app/';

const TSC_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const TSC_GLOBAL = /^error (TS\d+): (.*)$/;

/** Parses `tsc --noEmit` output (plain, not pretty). Indented lines belong to the error above them. */
export function parseTsc(out: string): TscError[] {
	const errors: TscError[] = [];
	for (const line of out.split(/\r?\n/)) {
		const m = TSC_LINE.exec(line);
		if (m) {
			errors.push({
				file: m[1]!,
				line: Number(m[2]),
				col: Number(m[3]),
				message: `${m[4]}: ${m[5]}`
			});
			continue;
		}
		const g = TSC_GLOBAL.exec(line);
		if (g) {
			errors.push({ file: '', line: 0, col: 0, message: `${g[1]}: ${g[2]}` });
			continue;
		}
		const last = errors.at(-1);
		if (last && /^\s+\S/.test(line)) last.message += '\n' + line;
	}
	return errors;
}

type VitestJson = {
	testResults?: {
		name: string;
		status?: string;
		message?: string;
		assertionResults?: {
			fullName: string;
			title?: string;
			status: string;
			failureMessages?: string[];
			location?: { line?: number };
		}[];
	}[];
};

const relFile = (name: string) => (name.startsWith(APP_DIR) ? name.slice(APP_DIR.length) : name);

/** The assertion text of a failure, without the stack trace. */
const firstMessage = (msg: string) => {
	const lines = msg.split('\n');
	const stack = lines.findIndex((l) => /^\s+at /.test(l));
	return (stack === -1 ? lines : lines.slice(0, stack)).join('\n').trim();
};

/** Parses `vitest run --reporter=json` output. A file that fails to load counts as one failed test. */
export function parseVitestJson(json: string): {
	passed: number;
	failed: number;
	tests: TestResult[];
} {
	let data: VitestJson;
	try {
		data = JSON.parse(json) as VitestJson;
	} catch {
		throw new ToolError('The Vitest report is not valid JSON.');
	}
	if (!data || !Array.isArray(data.testResults))
		throw new ToolError('The Vitest report has no testResults.');

	const tests: TestResult[] = [];
	for (const file of data.testResults) {
		const rel = relFile(file.name);
		let anyFailed = false;
		for (const a of file.assertionResults ?? []) {
			const status =
				a.status === 'passed' || a.status === 'failed' || a.status === 'todo'
					? a.status
					: 'skipped';
			const t: TestResult = { name: a.fullName, title: a.title ?? a.fullName, file: rel, status };
			if (typeof a.location?.line === 'number') t.line = a.location.line;
			if (status === 'failed') {
				anyFailed = true;
				t.error = firstMessage(a.failureMessages?.[0] ?? '');
			}
			tests.push(t);
		}
		// A file can fail without a failed test (load error, a throwing afterAll). Never report that as green.
		if (file.status === 'failed' && !anyFailed)
			tests.push({
				name: rel,
				title: rel,
				file: rel,
				status: 'failed',
				suite: true,
				error: firstMessage(
					file.message || 'The test file failed outside a test (for example in a hook or at load).'
				)
			});
	}
	return {
		passed: tests.filter((t) => t.status === 'passed').length,
		failed: tests.filter((t) => t.status === 'failed').length,
		tests
	};
}

/** The last `lines` lines (default 200) and at most `maxChars` characters (default 20 000) of `text`. */
export function tail(text: string, lines = 200, maxChars = 20_000): string {
	if (lines <= 0 || maxChars <= 0) return '';
	const all = text.replace(/\r?\n$/, '').split(/\r?\n/);
	const out = all.length <= lines ? text : all.slice(-lines).join('\n');
	return out.length > maxChars ? out.slice(-maxChars) : out;
}
