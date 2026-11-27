import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: true,
				test: {
					name: 'node',
					include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
					exclude: [
						'**/node_modules/**',
						'src/**/*.svelte.test.ts',
						'test/docker/**',
						// fixture projects with their own tests; they run in the Docker runner, not here
						'test/fixtures/p5/**'
					],
					environment: 'node'
				}
			},
			{
				// Needs Docker and builds the runner image on first use, so it has its own command and CI job.
				extends: true,
				test: {
					name: 'docker',
					include: ['test/docker/**/*.test.ts'],
					environment: 'node',
					testTimeout: 300_000
				}
			},
			{
				// Component tests need a DOM and Svelte's browser build (mount instead of server render).
				extends: true,
				resolve: { conditions: ['browser'] },
				test: {
					name: 'jsdom',
					include: [
						'src/lib/ui/**/*.svelte.test.ts',
						'src/lib/components/**/*.svelte.test.ts',
						'src/routes/**/*.svelte.test.ts'
					],
					environment: 'jsdom',
					setupFiles: ['src/lib/ui/test-setup.ts']
				}
			}
		]
	}
});
