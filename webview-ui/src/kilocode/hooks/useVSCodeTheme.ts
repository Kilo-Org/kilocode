import { useState, useEffect } from "react"

export const useVSCodeTheme = () => {
	const [theme, setTheme] = useState<string | null>(document.body.getAttribute("data-vscode-theme-kind"))

	const getTheme = () => document.body.getAttribute("data-vscode-theme-kind")

	useEffect(() => {
		setTheme(getTheme())

		const observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				if (mutation.type === "attributes" && mutation.attributeName === "data-vscode-theme-kind") {
					setTheme(getTheme())
				}
			})
		})

		observer.observe(document.body, { attributes: true, attributeFilter: ["data-vscode-theme-kind"] })

		return () => observer.disconnect()
	}, [])

	return theme
}
