// The errors a fix loop run ends with when it leaves problems behind. The server sets them
// (`testgen/fix-loop.ts`) and the chat reads them, so they live outside `server/`.

/** The loop left typecheck errors outside test/ or drift that were not there before it. */
export const FIX_LOOP_BROKEN_CODE = 'The fix loop left the code with typecheck errors or drift';

/** A step left a test file that no longer loads or has new typecheck errors under test/. */
export const FIX_LOOP_BROKEN_TESTS =
	'The fix loop left test files that no longer load or type check';
