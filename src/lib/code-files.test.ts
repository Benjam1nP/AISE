import { describe, expect, it } from 'vitest';
import { hasCodeFiles, hasDeployFiles } from './code-files';

describe('hasCodeFiles', () => {
	it('needs a file under src/, not just the scaffold', () => {
		expect(hasCodeFiles([])).toBe(false);
		expect(hasCodeFiles(['package.json', 'tsconfig.json', 'public/index.html'])).toBe(false);
		expect(hasCodeFiles(['package.json', 'src/a/A.ts'])).toBe(true);
	});
});

describe('hasDeployFiles', () => {
	it('needs one of Dockerfile, compose.yaml or RUN.md at the project root', () => {
		expect(hasDeployFiles([])).toBe(false);
		expect(hasDeployFiles(['package.json', 'src/Dockerfile', 'docs/RUN.md'])).toBe(false);
		expect(hasDeployFiles(['package.json', 'compose.yaml'])).toBe(true);
		expect(hasDeployFiles(['Dockerfile'])).toBe(true);
		expect(hasDeployFiles(['RUN.md'])).toBe(true);
	});
});
