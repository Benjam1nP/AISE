<script lang="ts">
	import { MODE_FRAMES, paintFrame, resolvePreset, type OrbState } from 'thinking-orbs/engine';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getTheme } from './theme.ts';

	type Props = Omit<HTMLAttributes<HTMLCanvasElement>, 'class'> & {
		/** What the agent is doing: working (waiting for the model), searching (tool calls), composing (text streams). */
		state?: OrbState;
		/** 20 sits inline with text, 64 is for empty and start states. */
		size?: 20 | 64;
		/** Accessible name. Defaults to a short text for the state. */
		label?: string;
		/** Freezes the current frame. */
		paused?: boolean;
		class?: string;
	};

	const LABELS: Record<OrbState, string> = {
		working: 'Working',
		searching: 'Searching',
		solving: 'Solving',
		listening: 'Listening',
		connecting: 'Connecting',
		weaving: 'Weaving',
		composing: 'Composing',
		breathing: 'Thinking',
		shaping: 'Shaping'
	};

	let {
		state: orbState = 'working',
		size = 20,
		label,
		paused = false,
		class: className,
		...rest
	}: Props = $props();

	let dark = $state(false);
	let reduced = $state(false);

	// Theme follows <html data-theme> (and the system setting while it is unset); motion follows the OS.
	$effect(() => {
		const root = document.documentElement;
		const sync = () => (dark = getTheme() === 'dark');
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

		const query = (q: string) => (typeof matchMedia === 'function' ? matchMedia(q) : undefined);
		const scheme = query('(prefers-color-scheme: dark)');
		const motion = query('(prefers-reduced-motion: reduce)');
		const syncMotion = () => (reduced = Boolean(motion?.matches));
		syncMotion();
		scheme?.addEventListener('change', sync);
		motion?.addEventListener('change', syncMotion);

		return () => {
			observer.disconnect();
			scheme?.removeEventListener('change', sync);
			motion?.removeEventListener('change', syncMotion);
		};
	});

	// Reruns when state, size, paused, theme or motion preference change; the cleanup stops the loop.
	function animate(target: HTMLCanvasElement) {
		const ctx = target.getContext('2d');
		if (!ctx) return;

		const dpr = Math.min(2, window.devicePixelRatio || 1);
		target.width = Math.round(size * dpr);
		target.height = Math.round(size * dpr);
		const { mode, speed, opts } = resolvePreset(orbState, size);
		const makeFrame = MODE_FRAMES[mode];
		const isDark = dark;

		const draw = (seconds: number) => {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, size, size);
			paintFrame(ctx, makeFrame(size, seconds, opts), isDark);
		};
		const now = () => (performance.now() / 1000) * speed;

		if (reduced) {
			draw(0.6);
			return;
		}
		draw(now());
		if (paused) return;

		let raf = 0;
		let running = false;
		let visible = true;
		const loop = () => {
			draw(now());
			if (running) raf = requestAnimationFrame(loop);
		};
		const start = () => {
			if (running) return;
			running = true;
			raf = requestAnimationFrame(loop);
		};
		const stop = () => {
			running = false;
			cancelAnimationFrame(raf);
		};
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') stop();
			else if (visible) start();
		};

		// Pause while scrolled offscreen or in a hidden tab.
		const io =
			typeof IntersectionObserver === 'undefined'
				? undefined
				: new IntersectionObserver(([entry]) => {
						visible = entry.isIntersecting;
						if (visible && document.visibilityState !== 'hidden') start();
						else stop();
					});
		io?.observe(target);
		document.addEventListener('visibilitychange', onVisibility);
		if (!io) start();

		return () => {
			stop();
			io?.disconnect();
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}
</script>

<canvas
	{...rest}
	{@attach animate}
	class={['orb', className]}
	role="img"
	aria-label={label ?? LABELS[orbState]}
	style:width="{size}px"
	style:height="{size}px"
></canvas>

<style>
	.orb {
		display: block;
		flex: none;
	}
</style>
