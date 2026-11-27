<script lang="ts">
	import Maximize from '@lucide/svelte/icons/maximize';
	import Minimize from '@lucide/svelte/icons/minimize';
	import Scan from '@lucide/svelte/icons/scan';
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import type { Snippet } from 'svelte';
	import { IconButton } from '#lib/ui/index.ts';

	type Props = { children: Snippet };

	let { children }: Props = $props();

	const MIN = 0.1;
	const MAX = 8;
	const STEP = 1.25;
	/** Pointer travel in px after which a press counts as a drag, not a click. */
	const DRAG = 4;

	let frame: HTMLDivElement | undefined = $state();
	let viewport: HTMLDivElement | undefined = $state();
	let content: HTMLDivElement | undefined = $state();
	let scale = $state(1);
	let x = $state(0);
	let y = $state(0);
	let dragging = $state(false);
	let fullscreen = $state(false);
	/** Set when a drag ends, so the click that follows does not select an element. */
	let swallowClick = false;
	/** Set once the developer zooms or pans; a resize of the space then keeps their view. */
	let touched = false;

	/** Zooms by `factor` keeping the viewport point (px, py) where it is. */
	function zoomAt(factor: number, px: number, py: number) {
		const next = Math.min(MAX, Math.max(MIN, scale * factor));
		const k = next / scale;
		x = px - (px - x) * k;
		y = py - (py - y) * k;
		scale = next;
		touched = true;
	}

	function zoomCentre(factor: number) {
		if (!viewport) return;
		zoomAt(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
	}

	/** Shows the whole diagram, never enlarged above its natural size. */
	export function fit() {
		if (!viewport || !content) return;
		const vw = viewport.clientWidth;
		const vh = viewport.clientHeight;
		const cw = content.offsetWidth;
		const ch = content.offsetHeight;
		if (cw === 0 || ch === 0 || vw === 0 || vh === 0) return;
		scale = Math.max(MIN, Math.min(1, vw / cw, vh / ch));
		x = (vw - cw * scale) / 2;
		y = (vh - ch * scale) / 2;
		touched = false;
	}

	/**
	 * The view a diagram opens with: centred on the element marked `.aiseFocus` (a trace link opened
	 * the diagram for it) at a readable size, else the whole diagram.
	 */
	export function show() {
		const marked = content?.querySelector('.aiseFocus');
		if (!viewport || !content || !marked) return fit();
		const box = marked.getBoundingClientRect();
		const origin = content.getBoundingClientRect();
		if (box.width === 0 || box.height === 0) return fit();
		const vw = viewport.clientWidth;
		const vh = viewport.clientHeight;
		// The box is in screen pixels at the current scale; these are the diagram's own units.
		const w = box.width / scale;
		const h = box.height / scale;
		const cx = (box.left - origin.left) / scale + w / 2;
		const cy = (box.top - origin.top) / scale + h / 2;
		scale = Math.max(MIN, Math.min(1, vw / (w * 1.5), vh / (h * 1.5)));
		x = vw / 2 - cx * scale;
		y = vh / 2 - cy * scale;
		touched = true;
	}

	function onwheel(event: WheelEvent) {
		if (!viewport) return;
		event.preventDefault();
		const box = viewport.getBoundingClientRect();
		zoomAt(Math.exp(-event.deltaY * 0.002), event.clientX - box.left, event.clientY - box.top);
	}

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0) return;
		swallowClick = false;
		const start = { cx: event.clientX, cy: event.clientY, x, y };
		let moved = false;
		const move = (e: PointerEvent) => {
			const dx = e.clientX - start.cx;
			const dy = e.clientY - start.cy;
			if (!moved && Math.hypot(dx, dy) < DRAG) return;
			moved = true;
			dragging = true;
			touched = true;
			x = start.x + dx;
			y = start.y + dy;
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
			dragging = false;
			swallowClick = moved;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', up);
	}

	// Capture phase, so a drag that ends on a diagram node does not count as selecting it.
	function onclickcapture(event: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		event.stopPropagation();
		event.preventDefault();
	}

	function panBy(dx: number, dy: number) {
		x += dx;
		y += dy;
		touched = true;
	}

	function onkeydown(event: KeyboardEvent) {
		// Leave browser shortcuts such as Ctrl or Cmd and plus alone.
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const pan = 40;
		const keys: Record<string, () => void> = {
			'+': () => zoomCentre(STEP),
			'=': () => zoomCentre(STEP),
			'-': () => zoomCentre(1 / STEP),
			'0': fit,
			ArrowLeft: () => panBy(pan, 0),
			ArrowRight: () => panBy(-pan, 0),
			ArrowUp: () => panBy(0, pan),
			ArrowDown: () => panBy(0, -pan)
		};
		const action = keys[event.key];
		if (!action) return;
		event.preventDefault();
		action();
	}

	// Wheel must not be passive, or preventDefault cannot stop the page from scrolling.
	function listen(node: HTMLElement) {
		node.addEventListener('wheel', onwheel, { passive: false });
		node.addEventListener('pointerdown', onpointerdown);
		node.addEventListener('keydown', onkeydown);
		node.addEventListener('click', onclickcapture, { capture: true });
		return () => {
			node.removeEventListener('wheel', onwheel);
			node.removeEventListener('pointerdown', onpointerdown);
			node.removeEventListener('keydown', onkeydown);
			node.removeEventListener('click', onclickcapture, { capture: true });
		};
	}

	async function toggleFullscreen() {
		if (!frame) return;
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await frame.requestFullscreen();
		} catch {
			// Full screen is not allowed here (for example in an iframe); the view stays as it is.
		}
	}

	// A new diagram (content size) always refits (or centres on its marked element); a resized space refits only an untouched view.
	// The transform does not affect layout, so fitting never triggers these observers again.
	$effect(() => {
		if (!viewport || !content || typeof ResizeObserver === 'undefined') return;
		const space = new ResizeObserver(() => {
			if (!touched) fit();
		});
		const diagram = new ResizeObserver(() => show());
		space.observe(viewport);
		diagram.observe(content);
		return () => {
			space.disconnect();
			diagram.disconnect();
		};
	});

	$effect(() => {
		const sync = () => (fullscreen = document.fullscreenElement === frame);
		document.addEventListener('fullscreenchange', sync);
		return () => document.removeEventListener('fullscreenchange', sync);
	});
</script>

<div class={['frame', { fullscreen }]} bind:this={frame}>
	<div class="tools" role="toolbar" aria-label="Diagram view">
		<IconButton size="sm" icon={ZoomIn} label="Zoom in" onclick={() => zoomCentre(STEP)} />
		<IconButton size="sm" icon={ZoomOut} label="Zoom out" onclick={() => zoomCentre(1 / STEP)} />
		<IconButton size="sm" icon={Scan} label="Fit to view" onclick={fit} />
		<IconButton
			size="sm"
			icon={fullscreen ? Minimize : Maximize}
			label={fullscreen ? 'Exit full screen' : 'Full screen'}
			onclick={toggleFullscreen}
		/>
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class={['viewport', { dragging }]}
		role="region"
		aria-label="Diagram canvas. Drag or use the arrow keys to move, scroll or plus and minus to zoom."
		tabindex="0"
		bind:this={viewport}
		{@attach listen}
	>
		<div
			class="content"
			data-testid="panzoom-content"
			bind:this={content}
			style:transform="translate({x}px, {y}px) scale({scale})"
		>
			{@render children()}
		</div>
	</div>
</div>

<style>
	.frame {
		position: relative;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.frame.fullscreen {
		border: none;
		border-radius: 0;
	}

	.tools {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		z-index: 1;
		display: flex;
		gap: var(--space-1);
		padding: var(--space-1);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
	}

	.viewport {
		height: 60dvh;
		overflow: hidden;
		cursor: grab;
		touch-action: none;
		user-select: none;
	}

	.fullscreen .viewport {
		height: 100dvh;
	}

	.viewport.dragging {
		cursor: grabbing;
	}

	.content {
		width: max-content;
		transform-origin: 0 0;
	}
</style>
