import React, { useEffect, useState } from "react"

interface IconProps {
	src: string
	srcDark?: string
	alt?: string
	size?: string
}

export function Icon({ src, srcDark, alt = "icon", size = "1.2em" }: IconProps) {
	const [isDark, setIsDark] = useState(false)

	useEffect(() => {
		// Check initial dark mode state
		const checkDarkMode = () => {
			setIsDark(document.documentElement.classList.contains("dark"))
		}

		checkDarkMode()

		// Watch for dark mode changes
		const observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				if (mutation.attributeName === "class") {
					checkDarkMode()
				}
			})
		})

		observer.observe(document.documentElement, { attributes: true })

		return () => observer.disconnect()
	}, [])

	const imageSrc = isDark && srcDark ? srcDark : src

	return (
		<img
			src={imageSrc}
			alt={alt}
			style={{
				height: size,
				width: "auto",
				verticalAlign: "middle",
				display: "inline",
			}}
		/>
	)
}
