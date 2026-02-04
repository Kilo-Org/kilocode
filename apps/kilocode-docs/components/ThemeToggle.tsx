import React, { useEffect, useState } from "react"

type Theme = "light" | "dark" | "system"

export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>("system")
	const [mounted, setMounted] = useState(false)

	// On mount, read the preference from localStorage or default to 'system'
	useEffect(() => {
		setMounted(true)
		const storedTheme = localStorage.getItem("theme") as Theme | null
		if (storedTheme) {
			setTheme(storedTheme)
		}
	}, [])

	// Apply the theme to the document
	useEffect(() => {
		if (!mounted) return

		const root = document.documentElement

		if (theme === "system") {
			localStorage.removeItem("theme")
			const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
			root.classList.toggle("dark", systemDark)
		} else {
			localStorage.setItem("theme", theme)
			root.classList.toggle("dark", theme === "dark")
		}
	}, [theme, mounted])

	// Listen for system preference changes
	useEffect(() => {
		if (!mounted) return

		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

		const handleChange = (e: MediaQueryListEvent) => {
			if (theme === "system") {
				document.documentElement.classList.toggle("dark", e.matches)
			}
		}

		mediaQuery.addEventListener("change", handleChange)
		return () => mediaQuery.removeEventListener("change", handleChange)
	}, [theme, mounted])

	const cycleTheme = () => {
		const themes: Theme[] = ["system", "light", "dark"]
		const currentIndex = themes.indexOf(theme)
		const nextIndex = (currentIndex + 1) % themes.length
		setTheme(themes[nextIndex])
	}

	// Avoid hydration mismatch by not rendering until mounted
	if (!mounted) {
		return (
			<button className="theme-toggle" aria-label="Toggle theme" style={{ width: "32px", height: "32px" }}>
				<span style={{ opacity: 0 }}>🌙</span>
			</button>
		)
	}

	const getIcon = () => {
		if (theme === "system") {
			return "💻"
		}
		if (theme === "dark") {
			return "🌙"
		}
		return "☀️"
	}

	const getLabel = () => {
		if (theme === "system") {
			return "Using system theme"
		}
		if (theme === "dark") {
			return "Dark mode"
		}
		return "Light mode"
	}

	return (
		<>
			<button onClick={cycleTheme} className="theme-toggle" aria-label={getLabel()} title={getLabel()}>
				<span>{getIcon()}</span>
			</button>
			<style jsx>{`
				.theme-toggle {
					display: flex;
					align-items: center;
					justify-content: center;
					width: 32px;
					height: 32px;
					padding: 0;
					border: 1px solid var(--border-color);
					border-radius: 6px;
					background: var(--bg-secondary);
					cursor: pointer;
					font-size: 16px;
					transition:
						background-color 0.2s ease,
						border-color 0.2s ease;
				}
				.theme-toggle:hover {
					background: var(--border-color);
				}
				.theme-toggle span {
					line-height: 1;
				}
			`}</style>
		</>
	)
}
