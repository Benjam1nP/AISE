type Target = { currentTarget: EventTarget & { value: string } };

/**
 * Validation timing for one field: check on blur, then live on every input once an error has shown,
 * so the error clears as soon as the value is fixed. Pass `check()` to the submit handler as well.
 *
 * ```svelte
 * const name = createFieldValidation((v) => (v ? undefined : 'Enter a project name.'));
 * <Input bind:value={name.value} error={name.error} success={name.success}
 *   onblur={name.onblur} oninput={name.oninput} />
 * ```
 * `validate` returns the error message, or nothing when the value is fine.
 */
export class FieldValidation {
	value = $state('');
	error = $state<string>();
	/** True once a check passed and until the value is edited into an error. */
	success = $state(false);
	/** Set by the first error; from then on every input re-validates. */
	#live = false;
	#validate: (value: string) => string | undefined;

	constructor(validate: (value: string) => string | undefined, initial = '') {
		this.#validate = validate;
		this.value = initial;
	}

	#run(): boolean {
		this.error = this.#validate(this.value);
		this.success = !this.error;
		if (this.error) this.#live = true;
		return !this.error;
	}

	/** Validates and returns whether the value is valid. Use it on submit. */
	check = (): boolean => this.#run();

	onblur = (event?: Target): void => {
		if (event) this.value = event.currentTarget.value;
		this.#run();
	};

	oninput = (event?: Target): void => {
		if (event) this.value = event.currentTarget.value;
		if (this.#live) this.#run();
		else this.success = false;
	};

	reset(initial = ''): void {
		this.value = initial;
		this.error = undefined;
		this.success = false;
		this.#live = false;
	}
}

export function createFieldValidation(
	validate: (value: string) => string | undefined,
	initial = ''
): FieldValidation {
	return new FieldValidation(validate, initial);
}
