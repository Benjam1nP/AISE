import { describe, expect, it } from 'vitest';
import { createFieldValidation } from './validation.svelte.ts';

const required = (value: string) => (value.trim() ? undefined : 'Enter a project name.');
const typed = (value: string) => ({ currentTarget: { value } }) as never;

describe('createFieldValidation', () => {
	it('shows no error while typing before the first blur', () => {
		const field = createFieldValidation(required);
		field.oninput(typed(''));
		field.oninput(typed('a'));
		expect(field.error).toBeUndefined();
		expect(field.success).toBe(false);
	});

	it('validates on blur', () => {
		const field = createFieldValidation(required);
		field.onblur();
		expect(field.error).toBe('Enter a project name.');
		expect(field.success).toBe(false);
	});

	it('marks a valid field as success on blur', () => {
		const field = createFieldValidation(required, 'todo');
		field.onblur();
		expect(field.error).toBeUndefined();
		expect(field.success).toBe(true);
	});

	it('re-validates live after the first error so it clears as soon as it is fixed', () => {
		const field = createFieldValidation(required);
		field.onblur();
		expect(field.error).toBeDefined();
		field.oninput(typed('t'));
		expect(field.error).toBeUndefined();
		expect(field.success).toBe(true);
		field.oninput(typed(''));
		expect(field.error).toBe('Enter a project name.');
	});

	it('drops the success mark when a valid field is edited, without showing an error', () => {
		const field = createFieldValidation((v) => (v.length >= 3 ? undefined : 'Too short.'), 'abc');
		field.onblur();
		expect(field.success).toBe(true);
		field.oninput(typed('ab'));
		expect(field.error).toBeUndefined();
		expect(field.success).toBe(false);
		field.onblur();
		expect(field.error).toBe('Too short.');
	});

	it('check() validates on submit and returns validity', () => {
		const field = createFieldValidation(required);
		expect(field.check()).toBe(false);
		expect(field.error).toBe('Enter a project name.');
		field.value = 'x';
		expect(field.check()).toBe(true);
		expect(field.error).toBeUndefined();
	});

	it('reset clears the state', () => {
		const field = createFieldValidation(required);
		field.onblur();
		field.reset();
		expect(field.error).toBeUndefined();
		expect(field.value).toBe('');
	});
});
