/**
 * Whether a project has code: some file under `src/`. The scaffold (`package.json`,
 * `tsconfig.json`) alone is not code. The same rule as `hasCode` in `core/code-state.ts`.
 */
export const hasCodeFiles = (files: string[]): boolean => files.some((f) => f.startsWith('src/'));

/** Whether a project has tests: some file under `test/`. The same rule as `listTestFiles` in `core/test-state.ts`. */
export const hasTestFiles = (files: string[]): boolean => files.some((f) => f.startsWith('test/'));

/** What the deploy agent writes, at the project root. The same list as `DEPLOY_FILES` in `core/deploy-state.ts`. */
export const DEPLOY_FILES = ['Dockerfile', 'compose.yaml', 'RUN.md'];

/** Whether a project has deploy files: one of `DEPLOY_FILES` at the root. The same rule as `hasDeployFiles` in `core/deploy-state.ts`. */
export const hasDeployFiles = (files: string[]): boolean =>
	files.some((f) => DEPLOY_FILES.includes(f));
