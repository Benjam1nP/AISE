<script lang="ts">
	import { resolve } from '$app/paths';

	// The wordmark links home. Its glyph echoes the phase rail: a track with stations.
</script>

<a class="brand" href={resolve('/')} aria-label="AISE home">
	<svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
		<path d="M4 12h16" stroke="currentColor" stroke-width="2" />
		<circle cx="4" cy="12" r="3" fill="currentColor" />
		<circle cx="12" cy="12" r="3" fill="currentColor" />
		<circle
			cx="20"
			cy="12"
			r="2.75"
			fill="var(--color-surface)"
			stroke="var(--color-brand)"
			stroke-width="2"
		/>
	</svg>
	<span class="word">AISE</span>
</a>

<style>
	.brand {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit-area);
		color: var(--color-text);
		text-decoration: none;
	}

	.mark {
		width: var(--icon-24);
		height: var(--icon-24);
	}

	.word {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-stretch: var(--display-stretch);
		font-weight: var(--weight-bold);
		letter-spacing: var(--display-tracking);
	}
</style>
