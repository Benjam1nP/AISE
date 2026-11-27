/**
 * Animated icons from the line-md set (MIT, https://github.com/cyberalien/line-md),
 * found through the Aria Icons MCP and copied from the Iconify API. 24 x 24, stroke 2,
 * `currentColor`: the same grid as Lucide. Every animation draws a stroke
 * (`stroke-dashoffset` to 0, `fill="freeze"`), so dropping the animations gives the final frame.
 */
export const ANIMATED_ICONS = {
	check:
		'<path fill="none" stroke="currentColor" stroke-dasharray="26" stroke-dashoffset="26" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 11l6 6l10 -10"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="26;0"/></path>',
	'circle-check':
		'<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke-dasharray="60" stroke-dashoffset="60" d="M3 12c0 -4.97 4.03 -9 9 -9c4.97 0 9 4.03 9 9c0 4.97 -4.03 9 -9 9c-4.97 0 -9 -4.03 -9 -9Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="60;0"/></path><path stroke-dasharray="14" stroke-dashoffset="14" d="M8 12l3 3l5 -5"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.6s" dur="0.2s" to="0"/></path></g>',
	'circle-alert':
		'<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke-dasharray="60" stroke-dashoffset="60" d="M12 3c4.97 0 9 4.03 9 9c0 4.97 -4.03 9 -9 9c-4.97 0 -9 -4.03 -9 -9c0 -4.97 4.03 -9 9 -9Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="60;0"/></path><path stroke-dasharray="8" stroke-dashoffset="8" d="M12 7v6"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.2s" to="0"/></path><path stroke-dasharray="4" stroke-dashoffset="4" d="M12 17v0.01"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.2s" to="0"/></path></g>',
	clipboard:
		'<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path stroke-width="2" d="M12 3h7v18h-14v-18h7Z"/><path d="M14.5 3.5v3h-5v-3"/></g>',
	'clipboard-check':
		'<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path stroke-width="2" d="M12 3h7v18h-14v-18h7Z"/><path d="M14.5 3.5v3h-5v-3"/><path stroke-dasharray="12" stroke-dashoffset="12" stroke-width="2" d="M9 13l2 2l4 -4"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.2s" values="12;0"/></path></g>'
} as const;

export type AnimatedIconName = keyof typeof ANIMATED_ICONS;

/** Every SMIL animation element, self closing or not. */
export const ANIMATION = /<(animate\w*|set)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g;

/** The final frame: the animations and the start offsets they draw from removed. */
export function finalFrame(body: string): string {
	return body.replace(ANIMATION, '').replace(/\sstroke-dashoffset="[^"]*"/g, '');
}
