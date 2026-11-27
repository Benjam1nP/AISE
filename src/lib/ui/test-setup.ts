import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom has no <dialog>.showModal() or close(): approximate them for component tests.
const dialog: Partial<HTMLDialogElement> = HTMLDialogElement.prototype;
if (!('showModal' in dialog)) {
	dialog.showModal = function showModal(this: HTMLDialogElement) {
		this.setAttribute('open', '');
	};
	dialog.close = function close(this: HTMLDialogElement) {
		if (!this.hasAttribute('open')) return;
		this.removeAttribute('open');
		this.dispatchEvent(new Event('close'));
	};
}

// jsdom has no canvas: getContext logs a "not implemented" error and returns null. Keep test output quiet.
HTMLCanvasElement.prototype.getContext = () => null;
