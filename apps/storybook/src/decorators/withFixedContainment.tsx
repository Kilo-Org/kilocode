import type { Decorator } from "@storybook/react-vite"

// Wraps stories with an element that will "contain" any `position: fixed` elements
// the `translate-0` is a noop, but causes any children to be contained in this element.
export const withFixedContainment: Decorator = (Story) => {
	return (
		<div className="overflow-hidden translate-0">
			<Story />
		</div>
	)
}
