import type { Decorator } from "@storybook/react-vite"
import React from "react"

type PostMessage = Record<string, unknown>

/**
 * Decorator to mock VSCode postMessage for components that listen to messages.
 *
 * To override in a story, use parameters.postMessages:
 * ```tsx
 * export const MyStory: Story = {
 *   parameters: {
 *     postMessages: [
 *       { type: "kilocodeNotificationsResponse", notifications: [...] },
 *     ],
 *   },
 * }
 * ```
 *
 * Multiple messages are sent sequentially
 */
export const withPostMessageMock: Decorator = (Story, context) => {
	const messages = context.parameters?.postMessages as PostMessage[] | undefined

	React.useEffect(() => {
		if (!messages || messages.length === 0) {
			return
		}

		const timers: NodeJS.Timeout[] = []
		messages.forEach((message, index) => {
			const event = new MessageEvent("message", { data: message })
			const timer = setTimeout(() => {
				window.dispatchEvent(event)
			})
			timers.push(timer)
		})

		return () => timers.forEach(clearTimeout)
	}, [messages])

	return <Story />
}
