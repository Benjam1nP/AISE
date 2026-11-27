/** True once `delay` ms have passed since mount (or since `delay` last changed). A delay of 0 or less is ready at once. */
export function createDelay(getDelay: () => number): { readonly ready: boolean } {
	let ready = $state(getDelay() <= 0);

	$effect(() => {
		const delay = getDelay();
		const immediate = delay <= 0;
		ready = immediate;
		if (immediate) return;
		const timer = setTimeout(() => (ready = true), delay);
		return () => clearTimeout(timer);
	});

	return {
		get ready() {
			return ready;
		}
	};
}
