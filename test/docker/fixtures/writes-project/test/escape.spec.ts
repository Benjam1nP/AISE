import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Test code is generated code. Each of these must fail, because the project is mounted read only.
it('cannot plant .aise/state.json', () => {
	expect(() => mkdirSync('.aise')).toThrow();
	expect(() => writeFileSync('.aise/state.json', '{}')).toThrow();
});

it('cannot write compose.yaml', () => {
	expect(() => writeFileSync('compose.yaml', 'services: {}')).toThrow();
});

it('cannot plant a symlink', () => {
	expect(() => symlinkSync('/etc/hosts', 'src/evil.ts')).toThrow();
});

it('cannot overwrite source', () => {
	expect(() => writeFileSync('src/counter.ts', 'export {}')).toThrow();
});
