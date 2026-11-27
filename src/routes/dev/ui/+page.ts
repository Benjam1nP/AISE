import { dev } from '$app/env';
import { error } from '@sveltejs/kit';

// The design system showcase is a development tool: production builds answer 404.
export function load() {
	if (!dev) error(404, 'Not found');
}
