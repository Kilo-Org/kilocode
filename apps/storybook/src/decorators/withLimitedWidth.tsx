import type { Decorator } from "@storybook/react-vite"

// Function that creates a decorator with a limited width container
// Provides consistent centering and configurable max-width constraint
export const withLimitedWidth = (maxWidth: number = 600): Decorator => {
	return (Story) => (
		<div style={{ maxWidth: `${maxWidth}px`, margin: "0 auto" }}>
			<Story />
		</div>
	)
}
