import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import PanZoom from './PanZoom.svelte';

const node = createRawSnippet(() => ({ render: () => '<button type="button">UC-001</button>' }));

function setup() {
	const onselect = vi.fn();
	render(PanZoom, { children: node });
	const target = screen.getByRole('button', { name: 'UC-001' });
	target.addEventListener('click', onselect);
	const content = screen.getByTestId('panzoom-content');
	return { onselect, target, content, transform: () => content.style.transform };
}

describe('PanZoom', () => {
	it('zoom in and zoom out change the scale', async () => {
		const { transform } = setup();
		await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
		expect(transform()).toContain('scale(1.25)');
		await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
		expect(transform()).toContain('scale(1)');
	});

	it('a click without moving still reaches the diagram element', async () => {
		const { onselect, target } = setup();
		await userEvent.click(target);
		expect(onselect).toHaveBeenCalledOnce();
	});

	it('a drag moves the diagram and does not select the element it ends on', async () => {
		const { onselect, target, transform } = setup();
		await fireEvent.pointerDown(target, { button: 0, clientX: 10, clientY: 10 });
		await fireEvent.pointerMove(window, { clientX: 60, clientY: 30 });
		await fireEvent.pointerUp(window, { clientX: 60, clientY: 30 });
		await fireEvent.click(target);
		expect(transform()).toContain('translate(50px, 20px)');
		expect(onselect).not.toHaveBeenCalled();
		await fireEvent.click(target);
		expect(onselect).toHaveBeenCalledOnce();
	});

	it('keyboard pans and zooms the canvas', async () => {
		const { transform } = setup();
		const canvas = screen.getByRole('region', { name: /Diagram canvas/ });
		await fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
		expect(transform()).toContain('translate(40px, 0px)');
		await fireEvent.keyDown(canvas, { key: '+' });
		expect(transform()).toContain('scale(1.25)');
	});

	it('a cancelled drag stops following the pointer', async () => {
		const { target, transform } = setup();
		await fireEvent.pointerDown(target, { button: 0, clientX: 0, clientY: 0 });
		await fireEvent.pointerMove(window, { clientX: 20, clientY: 0 });
		await fireEvent.pointerCancel(window);
		await fireEvent.pointerMove(window, { clientX: 90, clientY: 0 });
		expect(transform()).toContain('translate(20px, 0px)');
	});

	it('a drag released off the canvas does not swallow the next click', async () => {
		const { onselect, target } = setup();
		await fireEvent.pointerDown(target, { button: 0, clientX: 0, clientY: 0 });
		await fireEvent.pointerMove(window, { clientX: 30, clientY: 0 });
		await fireEvent.pointerUp(window);
		await userEvent.click(target);
		expect(onselect).toHaveBeenCalledOnce();
	});

	it('leaves Ctrl or Cmd shortcuts to the browser', async () => {
		const { transform } = setup();
		const canvas = screen.getByRole('region', { name: /Diagram canvas/ });
		await fireEvent.keyDown(canvas, { key: '-', ctrlKey: true });
		await fireEvent.keyDown(canvas, { key: '-', metaKey: true });
		expect(transform()).toContain('scale(1)');
	});
});
