import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CodePanel from './CodePanel.svelte';
import { snapshotOf } from './fixtures.ts';

const TASK = '/** @trace DSN-001 REQ-001 REQ-002 */\nexport class Task {}\n';
const files = ['package.json', 'src/app/main.ts', 'src/tasks/Task.ts', 'src/tasks/TaskList.ts'];

function serve(contents: Record<string, string>) {
	const fetchMock = vi.fn(async (url: string) => {
		const path = new URL(url, 'http://x').searchParams.get('path') ?? '';
		return path in contents
			? new Response(contents[path], { status: 200 })
			: new Response('not found', { status: 404 });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('CodePanel', () => {
	it('copies the whole open file and confirms it', async () => {
		serve({ 'src/tasks/Task.ts': TASK });
		const user = userEvent.setup();
		render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts' }
		});
		await user.click(await screen.findByRole('button', { name: 'Copy file' }));
		expect(await navigator.clipboard.readText()).toBe(TASK);
		expect(screen.getByRole('status').textContent).toBe('Copied to the clipboard');
	});

	it('says so when the clipboard refuses', async () => {
		serve({ 'src/tasks/Task.ts': TASK });
		const user = userEvent.setup();
		render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts' }
		});
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
		const button = await screen.findByRole('button', { name: 'Copy file' });
		await user.click(button);
		expect(button.title).toBe('Copy did not work');
		expect(screen.getByRole('status').textContent).toBe('Copy did not work');
	});

	it('asks the browser to show the code panel full screen', async () => {
		serve({ 'src/tasks/Task.ts': TASK });
		const { container } = render(CodePanel, { snapshot: snapshotOf({ name: 'todo', files }) });
		const panel = container.querySelector<HTMLElement>('.code')!;
		const request = vi.fn(async () => {});
		panel.requestFullscreen = request;
		await userEvent.click(screen.getByRole('button', { name: 'Full screen' }));
		expect(request).toHaveBeenCalled();
	});

	it('lists the files and loads one on click', async () => {
		const fetchMock = serve({ 'src/tasks/Task.ts': TASK, 'src/tasks/TaskList.ts': 'export {}' });
		const snapshot = snapshotOf({ name: 'todo', files });
		render(CodePanel, { snapshot });
		await userEvent.click(screen.getByRole('button', { name: 'Task.ts' }));
		expect(fetchMock).toHaveBeenCalledWith('/p/todo/file?path=src%2Ftasks%2FTask.ts');
		await waitFor(() => expect(document.body.textContent).toContain('export class Task'));
	});

	it('keeps the shown file in place while the next one loads, so the page does not jump', async () => {
		serve({ 'src/tasks/Task.ts': TASK });
		const { container } = render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts' }
		});
		await waitFor(() => expect(container.querySelector('.cm-editor')).toBeTruthy());
		const editor = container.querySelector('.cm-editor');
		vi.stubGlobal('fetch', () => new Promise(() => {}));
		await userEvent.click(screen.getByRole('button', { name: 'TaskList.ts' }));
		expect(document.body.textContent).toContain('export class Task');
		expect(container.querySelector('.cm-editor')).toBe(editor);
	});

	it('describes one file in header, trace badges and code label while the next one loads', async () => {
		serve({ 'src/tasks/Task.ts': TASK });
		const { container } = render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts' }
		});
		await waitFor(() => expect(container.querySelector('.cm-editor')).toBeTruthy());
		vi.stubGlobal('fetch', () => new Promise(() => {}));
		await userEvent.click(screen.getByRole('button', { name: 'TaskList.ts' }));
		expect(screen.getByText('src/tasks/Task.ts')).toBeTruthy();
		expect(screen.queryByText('src/tasks/TaskList.ts')).toBeNull();
		expect(screen.getByLabelText('Trace').textContent).toContain('DSN-001');
		expect(container.querySelector('[aria-label="src/tasks/Task.ts"]')).toBeTruthy();
	});

	it('marks the old file busy while the next one loads, and clears it when it has loaded', async () => {
		serve({ 'src/tasks/Task.ts': TASK });
		const { container } = render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts' }
		});
		await screen.findByLabelText('Trace');
		expect(container.querySelector('[aria-busy="true"]')).toBeNull();
		let release: (r: Response) => void = () => {};
		vi.stubGlobal('fetch', () => new Promise<Response>((r) => (release = r)));
		await userEvent.click(screen.getByRole('button', { name: 'TaskList.ts' }));
		expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
		release(new Response('export class TaskList {}', { status: 200 }));
		await waitFor(() => expect(screen.getByText('src/tasks/TaskList.ts')).toBeTruthy());
		expect(container.querySelector('[aria-busy="true"]')).toBeNull();
		expect(screen.queryByLabelText('Trace')).toBeNull();
	});

	it('keeps the marked line of the old file until the next one has loaded', async () => {
		serve({ 'src/tasks/Task.ts': 'a\nb\nc\n' });
		const { container } = render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts', line: 2 }
		});
		await waitFor(() => expect(container.querySelector('.cm-marked-line')?.textContent).toBe('b'));
		const editor = container.querySelector('.cm-editor');
		vi.stubGlobal('fetch', () => new Promise(() => {}));
		await userEvent.click(screen.getByRole('button', { name: 'TaskList.ts' }));
		expect(container.querySelector('.cm-editor')).toBe(editor);
		expect(container.querySelector('.cm-marked-line')?.textContent).toBe('b');
		expect(screen.getByText('src/tasks/Task.ts:2')).toBeTruthy();
	});

	it('drops the shown file of another project when the project changes', async () => {
		serve({ 'src/tasks/Task.ts': TASK });
		const { rerender } = render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts' }
		});
		await waitFor(() => expect(document.body.textContent).toContain('export class Task'));
		const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
		vi.stubGlobal('fetch', fetchMock);
		await rerender({ snapshot: snapshotOf({ name: 'other', files }) });
		expect(fetchMock).toHaveBeenCalledWith('/p/other/file?path=src%2Ftasks%2FTask.ts');
		expect(document.body.textContent).not.toContain('export class Task');
	});

	it('shows the trace IDs of a class file above the code', async () => {
		serve({ 'src/tasks/Task.ts': TASK });
		render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts' }
		});
		const trace = await screen.findByLabelText('Trace');
		expect(trace.textContent).toContain('DSN-001');
		expect(trace.textContent).toContain('REQ-002');
	});

	it('opens the requested file at the requested line', async () => {
		serve({ 'src/tasks/Task.ts': 'a\nb\nc\n' });
		const { container } = render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts', line: 2 }
		});
		await waitFor(() => expect(container.querySelector('.cm-marked-line')?.textContent).toBe('b'));
	});

	it('says so when a file cannot be loaded', async () => {
		serve({});
		render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts' }
		});
		expect((await screen.findByRole('alert')).textContent).toContain('Task.ts');
	});

	it('keeps the clicked file when the snapshot refreshes with the same files', async () => {
		const fetchMock = serve({
			'src/tasks/Task.ts': TASK,
			'src/tasks/TaskList.ts': 'export class TaskList {}'
		});
		const { rerender } = render(CodePanel, { snapshot: snapshotOf({ name: 'todo', files }) });
		await userEvent.click(screen.getByRole('button', { name: 'TaskList.ts' }));
		await waitFor(() => expect(document.body.textContent).toContain('export class TaskList'));
		const calls = fetchMock.mock.calls.length;
		await rerender({ snapshot: snapshotOf({ name: 'todo', files: [...files] }) });
		await waitFor(() => expect(document.body.textContent).toContain('export class TaskList'));
		expect(screen.getByText('src/tasks/TaskList.ts')).toBeTruthy();
		expect(fetchMock.mock.calls.length).toBe(calls);
	});

	it('reads the open file again when the same run finishes', async () => {
		const fetchMock = serve({ 'src/tasks/Task.ts': TASK });
		const run = (status: string, finishedAt?: string) => ({ id: 'run-1', status, finishedAt });
		const { rerender } = render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files, lastRun: run('running') }),
			open: { path: 'src/tasks/Task.ts' }
		});
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		await rerender({
			snapshot: snapshotOf({
				name: 'todo',
				files,
				lastRun: run('done', '2026-11-20T10:00:00.000Z')
			}),
			open: { path: 'src/tasks/Task.ts' }
		});
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
	});

	it('falls back to the first class file when the selected file is gone', async () => {
		serve({ 'src/tasks/Task.ts': TASK, 'src/tasks/TaskList.ts': 'export class TaskList {}' });
		const { rerender } = render(CodePanel, { snapshot: snapshotOf({ name: 'todo', files }) });
		await userEvent.click(screen.getByRole('button', { name: 'TaskList.ts' }));
		await rerender({
			snapshot: snapshotOf({ name: 'todo', files: files.filter((f) => !f.endsWith('TaskList.ts')) })
		});
		await waitFor(() => expect(screen.getByText('src/tasks/Task.ts')).toBeTruthy());
	});

	it('moves focus to the path header when a file is opened from outside, each time', async () => {
		serve({ 'src/tasks/Task.ts': 'a\nb\nc\n' });
		const snapshot = snapshotOf({ name: 'todo', files });
		const { rerender } = render(CodePanel, {
			snapshot,
			open: { path: 'src/tasks/Task.ts', line: 2 }
		});
		const header = await screen.findByText('src/tasks/Task.ts:2');
		await waitFor(() => expect(document.activeElement).toBe(header));
		(document.activeElement as HTMLElement).blur();
		await rerender({ snapshot, open: { path: 'src/tasks/Task.ts', line: 3 } });
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByText('src/tasks/Task.ts:3'))
		);
	});

	it('does not take focus when the panel opens without a request', async () => {
		serve({ 'src/tasks/Task.ts': TASK });
		render(CodePanel, { snapshot: snapshotOf({ name: 'todo', files }) });
		await screen.findByLabelText('Trace');
		expect(document.activeElement).toBe(document.body);
	});

	it('makes the trace IDs of a file links when it can show them', async () => {
		serve({ 'src/tasks/Task.ts': TASK });
		const onopenid = vi.fn();
		render(CodePanel, {
			snapshot: snapshotOf({ name: 'todo', files }),
			open: { path: 'src/tasks/Task.ts' },
			onopenid
		});
		await userEvent.click(await screen.findByRole('button', { name: 'Show REQ-002' }));
		expect(onopenid).toHaveBeenCalledWith('REQ-002');
		expect(screen.getByRole('button', { name: 'Show DSN-001' })).toBeTruthy();
	});
});
