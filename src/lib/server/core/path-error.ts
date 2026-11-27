/** A path or ID that would leave its folder. Own module so runs.ts and store.ts share it without a cycle. */
export class PathError extends Error {
	override name = 'PathError';
}
