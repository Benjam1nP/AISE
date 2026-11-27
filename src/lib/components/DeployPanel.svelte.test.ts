import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeployPanel from './DeployPanel.svelte';
import { deployCheckOf, snapshotOf } from './fixtures.ts';

const files = ['Dockerfile', 'RUN.md', 'compose.yaml', 'src/A.ts', 'test/UC-001.test.ts'];
const gate = (detail: string, ok = false) => ({
	P6: { passed: ok, checks: [{ label: 'Deploy check passed', ok, detail }] }
});

function snapshot(over: Record<string, unknown> = {}) {
	return snapshotOf({
		name: 'todo',
		files,
		deployCheck: deployCheckOf(),
		gates: gate('', true),
		...over
	});
}

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

afterEach(() => vi.unstubAllGlobals());

describe('DeployPanel', () => {
	it('lists the three deploy files only and shows the chosen one read only', async () => {
		const fetchMock = serve({ Dockerfile: 'FROM node:22', 'compose.yaml': 'services: {}' });
		render(DeployPanel, { snapshot: snapshot() });
		const tree = screen.getByRole('navigation', { name: 'Files' });
		expect(tree.textContent).toContain('Dockerfile');
		expect(tree.textContent).toContain('compose.yaml');
		expect(tree.textContent).toContain('RUN.md');
		expect(tree.textContent).not.toContain('A.ts');
		await waitFor(() =>
			expect(fetchMock.mock.calls.map((c) => c[0] as string)).toContain(
				'/p/todo/file?path=Dockerfile'
			)
		);
		await userEvent.click(screen.getByRole('button', { name: /compose\.yaml/ }));
		await waitFor(() =>
			expect(fetchMock.mock.calls.map((c) => c[0] as string)).toContain(
				'/p/todo/file?path=compose.yaml'
			)
		);
	});

	it('shows a passed check with its duration and one row per url', () => {
		serve({});
		render(DeployPanel, {
			snapshot: snapshot({
				deployCheck: deployCheckOf({
					services: [
						{ url: 'http://localhost:8080/health', status: 200 },
						{ url: 'http://localhost:8081/health', status: 200 }
					]
				})
			})
		});
		expect(screen.getByText('Passed').getAttribute('data-tone')).toBe('success');
		expect(screen.getByText('Took 12.4 s')).toBeTruthy();
		const rows = screen.getAllByRole('row').slice(1);
		expect(rows).toHaveLength(2);
		expect(rows[1].textContent).toContain('http://localhost:8081/health');
		expect(rows[1].textContent).toContain('200');
		expect(screen.getAllByText('200').map((b) => b.getAttribute('data-tone'))).toEqual([
			'success',
			'success'
		]);
	});

	it('shows a failed check with the failing url and its answer', () => {
		serve({});
		render(DeployPanel, {
			snapshot: snapshot({
				deployCheck: deployCheckOf({
					passed: false,
					services: [
						{ url: 'http://localhost:8080/health', status: 200 },
						{ url: 'http://localhost:8081/health', status: null },
						{ url: 'http://localhost:8082/health', status: 503 }
					]
				}),
				gates: gate('live-update-server no answer')
			})
		});
		expect(screen.getByText('Failed').getAttribute('data-tone')).toBe('error');
		expect(screen.getByText('200').getAttribute('data-tone')).toBe('success');
		expect(screen.getByText('no answer').getAttribute('data-tone')).toBe('error');
		expect(screen.getByText('503').getAttribute('data-tone')).toBe('error');
		const rows = screen.getAllByRole('row').slice(1);
		expect(rows[0].textContent).toContain('200');
		expect(rows[1].textContent).toContain('http://localhost:8081/health');
		expect(rows[1].textContent).toContain('no answer');
	});

	it('names each url by its planned service in a Service, Status and URL table', () => {
		serve({});
		render(DeployPanel, {
			snapshot: snapshot({
				deployServices: [
					{ name: 'api-server', healthUrl: 'http://localhost:8080/health' },
					{ name: 'live-update-server', healthUrl: 'http://localhost:8081/health' }
				],
				deployCheck: deployCheckOf({
					passed: false,
					services: [
						{ url: 'http://localhost:8080/health', status: 200 },
						{ url: 'http://localhost:8081/health', status: null }
					]
				})
			})
		});
		const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
		expect(heads).toEqual(['Service', 'Status', 'URL']);
		const rows = screen.getAllByRole('row').slice(1);
		const cells = (row: HTMLElement) =>
			[...row.querySelectorAll('td')].map((c) => c.textContent?.trim());
		expect(cells(rows[0])).toEqual(['api-server', '200', 'http://localhost:8080/health']);
		// The url is set in the mono font by this class (jsdom has no scoped styles to read).
		expect(rows[0].querySelectorAll('td')[2].querySelector('.url')).not.toBeNull();
		expect(cells(rows[1])).toEqual([
			'live-update-server',
			'no answer',
			'http://localhost:8081/health'
		]);
	});

	it('leaves the service name empty for a url the plan does not know', () => {
		serve({});
		render(DeployPanel, { snapshot: snapshot({ deployServices: [] }) });
		const row = screen.getAllByRole('row')[1];
		expect([...row.querySelectorAll('td')].map((c) => c.textContent?.trim())).toEqual([
			'',
			'200',
			'http://localhost:8080/health'
		]);
	});

	it('keeps the log tail in a closed block that holds the log', () => {
		serve({});
		render(DeployPanel, { snapshot: snapshot() });
		const details = screen.getByText('Log tail').closest('details')!;
		expect(details.open).toBe(false);
		expect(details.textContent).toContain('api-1  | listening on 8080');
	});

	it('shows no log block when the log is empty', () => {
		serve({});
		render(DeployPanel, {
			snapshot: snapshot({ deployCheck: deployCheckOf({ logTail: ' \n' }) })
		});
		expect(screen.queryByText('Log tail')).toBeNull();
	});

	it('says the result is out of date when the gate says so', () => {
		serve({});
		render(DeployPanel, { snapshot: snapshot({ gates: gate('out of date') }) });
		expect(screen.getByText('out of date')).toBeTruthy();
		expect(screen.getByText(/describes older files/)).toBeTruthy();
	});

	it('shows no out of date note while the result is current', () => {
		serve({});
		render(DeployPanel, { snapshot: snapshot() });
		expect(screen.queryByText('out of date')).toBeNull();
	});

	it('says the files have not been checked yet before the first check', () => {
		serve({});
		render(DeployPanel, {
			snapshot: snapshot({ deployCheck: null, gates: gate('not run yet') })
		});
		expect(screen.getByText(/has not been checked yet/)).toBeTruthy();
		expect(screen.queryByText('Passed')).toBeNull();
		expect(screen.queryByText('out of date')).toBeNull();
	});

	it('has a Run deploy check button that submits checkDeploy', () => {
		serve({});
		render(DeployPanel, { snapshot: snapshot() });
		const run = screen.getByRole('button', { name: 'Run deploy check' });
		expect(run.closest('form')?.getAttribute('action')).toBe('?/checkDeploy');
		expect(run.getAttribute('aria-busy')).toBeNull();
	});

	it('says under the button that the check builds and starts the stack', () => {
		serve({});
		render(DeployPanel, { snapshot: snapshot() });
		expect(
			screen.getByText('Builds and starts the stack; this can take a few minutes.')
		).toBeTruthy();
	});

	it('shows busy while a deploy check started elsewhere is running', () => {
		serve({});
		render(DeployPanel, { snapshot: snapshot({ deployCheckRunning: true }) });
		const run = screen.getByRole('button', { name: 'Run deploy check' });
		expect(run.getAttribute('aria-busy')).toBe('true');
	});

	it('shows busy, not disabled, while an agent run is active', () => {
		serve({});
		render(DeployPanel, {
			snapshot: snapshot({ activeRun: { runId: 'r', phase: 'P6' } })
		});
		const run = screen.getByRole('button', { name: 'Run deploy check' });
		expect(run.getAttribute('aria-busy')).toBe('true');
		expect((run as HTMLButtonElement).disabled).toBe(false);
	});

	it('says there are no deployment files and offers no check without them', () => {
		render(DeployPanel, {
			snapshot: snapshot({ files: ['src/A.ts'], deployCheck: null })
		});
		expect(screen.getByText(/no deployment files yet/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Run deploy check' })).toBeNull();
	});
});
