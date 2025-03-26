/**
 * Utility to fix the Radix UI DismissableLayer issue where body.style.pointerEvents = 'none'
 * is not properly restored when dialogs are closed, particularly when switching to the MCP tab.
 *
 * The root cause is a race condition in the Radix UI DismissableLayer component:
 * When multiple layers are closing at the same time, they might both check
 * context.layersWithOutsidePointerEventsDisabled.size > 1 before either has been removed,
 * causing both to skip restoring the pointer events.
 *
 * More info (not confirmed which is the root cause):
 * https://github.com/radix-ui/primitives/issues?q=pointer%20Events%20
 */

/**
 * Ensures that the body's pointer-events style is restored to its default value.
 * This should be called after dialog interactions, especially when switching tabs.
 */
export function ensureBodyPointerEventsRestored(): void {
	if (document.body.style.pointerEvents === "none") {
		document.body.style.pointerEvents = ""
	}
}
