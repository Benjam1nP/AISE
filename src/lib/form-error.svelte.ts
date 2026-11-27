export type FormResult = { action?: string; message?: string } | null | undefined;

/**
 * The error message of the page's last form action when it is one of `actions` and not yet
 * dismissed. A new result (a new object) shows again. `initiallyDismissed` treats the result that
 * is there at creation as dismissed: a component that mounts later (the detail of another ticket)
 * must not show an error that an earlier one caused. `actions` may be a function when it changes.
 */
export function createFormError(
	form: () => FormResult,
	actions: string[] | (() => string[]),
	initiallyDismissed = false
) {
	// Raw: a $state proxy of the form object would never equal the form prop.
	let dismissed = $state.raw<unknown>(initiallyDismissed ? form() : undefined);
	const names = () => (typeof actions === 'function' ? actions() : actions);
	return {
		get message(): string | undefined {
			const f = form();
			return f?.message && f.action && names().includes(f.action) && f !== dismissed
				? f.message
				: undefined;
		},
		dismiss(): void {
			dismissed = form();
		}
	};
}
