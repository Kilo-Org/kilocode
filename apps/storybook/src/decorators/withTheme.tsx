import type { Decorator } from "@storybook/react-vite"
import { useEffect } from "react"

// Decorator to handle theme switching by applying the data-theme attribute to the body
export const withTheme: Decorator = (Story, context) => {
	const theme = context.globals.theme || "dark"

	useEffect(() => {
		document.body.setAttribute("data-theme", theme)
		return () => {
			document.body.removeAttribute("data-theme")
		}
	}, [theme])

	return <Story />
}
