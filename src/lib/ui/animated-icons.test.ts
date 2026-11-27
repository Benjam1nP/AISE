import { describe, expect, it } from 'vitest';
import { ANIMATED_ICONS, ANIMATION, finalFrame } from './animated-icons.ts';

describe('animated icons', () => {
	it.each(Object.entries(ANIMATED_ICONS))('%s only draws strokes to offset 0', (_, body) => {
		// finalFrame relies on this: dropping a stroke-dashoffset animation that ends at 0 is its end.
		const tags = [...body.matchAll(ANIMATION)].map((m) => m[0]);
		const strays = tags.filter(
			(tag) =>
				!tag.includes('attributeName="stroke-dashoffset"') ||
				!tag.includes('fill="freeze"') ||
				!/(?:to="0"|values="[\d.]+;0")/.test(tag)
		);
		expect(strays).toEqual([]);
	});

	it('finalFrame drops every kind of animation element', () => {
		const body =
			'<path d="M0 0"><set attributeName="opacity" to="1"/><animate attributeName="x" to="0"></animate><animateTransform type="scale"/></path>';
		expect(finalFrame(body)).toBe('<path d="M0 0"></path>');
	});

	it.each(Object.entries(ANIMATED_ICONS))(
		'%s paths start undrawn before the timeline runs',
		(_, body) => {
			const undrawn = (body.match(/<path\b[^>]*>(?=<animate)/g) ?? []).filter(
				(path) => !/stroke-dashoffset="[\d.]+"/.test(path)
			);
			expect(undrawn).toEqual([]);
		}
	);

	it.each(Object.entries(ANIMATED_ICONS))(
		'finalFrame of %s drops the animations and the start offsets but keeps the paths',
		(_, body) => {
			const frame = finalFrame(body);
			expect(frame).not.toMatch(/<(animate|set)\b/);
			expect(frame).not.toContain('stroke-dashoffset');
			expect(frame.match(/<path\b/g)).toHaveLength(body.match(/<path\b/g)!.length);
		}
	);
});
