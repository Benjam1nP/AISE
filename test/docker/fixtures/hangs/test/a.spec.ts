import { it } from 'vitest';

it('never finishes', () => {
	while (true) {
		// busy loop: Vitest cannot interrupt it, only killing the container can
	}
});
