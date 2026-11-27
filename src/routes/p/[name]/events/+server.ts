import { error } from '@sveltejs/kit';
import { getOrchestrator, subscribe } from '#lib/server/index.ts';
import type { RequestHandler } from './$types';

const PING_MS = 15_000;

/** Server sent events of one project: one `data: <json>` message per workspace event. */
export const GET: RequestHandler = async ({ params, request }) => {
	const { name } = params;
	if (!(await getOrchestrator().listProjects()).includes(name)) {
		error(404, `No project named "${name}"`);
	}

	const encoder = new TextEncoder();
	let stop = () => {};
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const send = (chunk: string) => {
				if (!closed) controller.enqueue(encoder.encode(chunk));
			};
			const off = subscribe(name, (e) => send(`data: ${JSON.stringify(e)}\n\n`));
			const timer = setInterval(() => send(': ping\n\n'), PING_MS);
			stop = () => {
				if (closed) return;
				closed = true;
				off();
				clearInterval(timer);
				try {
					controller.close();
				} catch {
					// already closed by the client
				}
			};
			request.signal.addEventListener('abort', stop, { once: true });
			if (request.signal.aborted) stop();
			else send(': connected\n\n');
		},
		cancel() {
			stop();
		}
	});

	return new Response(body, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			'x-accel-buffering': 'no'
		}
	});
};
