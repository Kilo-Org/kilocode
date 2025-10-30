import type { Decorator } from "@storybook/react-vite"

// Mimics the VSCode sidebar appearance: background, width,
// and uses scale-100 to "contain" position:fixed elements
export const withSidebarContainer = (width: number = 400): Decorator => {
	return (Story) => (
		<div className={`w-[${width}px] min-h-[600px] bg-vscode-sideBar-background scale-100`}>
			<Story />
		</div>
	)
}
