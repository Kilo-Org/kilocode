import type { Decorator } from "@storybook/react-vite"
import { ExtensionStateContext } from "../../../../webview-ui/src/context/ExtensionStateContext"
import { createExtensionStateMock } from "../utils/createExtensionStateMock"

const mockExtensionState = createExtensionStateMock()

// Decorator to provide ExtensionStateContext for all stories
//
// To override specific properties in a story, use the parameters:
// export const MyStory = {
//   parameters: {
//     extensionState: {
//       showTaskTimeline: false,
//       clineMessages: [/* custom messages */]
//     }
//   }
// }
export const withExtensionState: Decorator = (Story, context) => {
	const storyOverrides = context.parameters?.extensionState || {}
	const contextValue = { ...mockExtensionState, ...storyOverrides }

	return (
		<ExtensionStateContext.Provider value={contextValue}>
			<Story />
		</ExtensionStateContext.Provider>
	)
}
