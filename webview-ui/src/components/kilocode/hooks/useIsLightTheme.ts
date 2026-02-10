import { useEffect, useState } from "react"

const getIsLightThemeFromEditor = () =>
	document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")

export function useIsLightTheme() {
	const [isLightTheme, setIsLightTheme] = useState(() => {
		if (typeof document === "undefined") return false
		return getIsLightThemeFromEditor()
	})

	useEffect(() => {
		if (typeof document === "undefined") return

		const observer = new MutationObserver(() => {
			setIsLightTheme(getIsLightThemeFromEditor())
		})
		observer.observe(document.body, { attributes: true, attributeFilter: ["class"] })

		return () => observer.disconnect()
	}, [])

	return isLightTheme
}
