import { ReactNode } from "react"
import type { Decorator } from "@storybook/react-vite"
import { cn } from "@/lib/utils"
import isChromatic from "chromatic/isChromatic"

type LayoutMode = "row" | "column"

// Decorator that renders both the light and dark theme of children for Chromatic screenshot testing
export const withChromaticDecorator: Decorator = (Story, context) => {
	const theme = context.globals.theme || "dark"
	const layout = context.parameters?.chromaticLayout || "row"
	const disableChromaticDualThemeSnapshot = context.parameters?.disableChromaticDualThemeSnapshot || false
	return (
		<ChromaticDecorator
			theme={theme}
			layout={layout}
			disableChromaticDualThemeSnapshot={disableChromaticDualThemeSnapshot}>
			<Story />
		</ChromaticDecorator>
	)
}

const baseStyles = cn("flex flex-col items-stretch justify-stretch")
const chromaticStyles = cn("absolute size-full top-0 left-0 right-0 bottom-0")

/**
 * When rendering screenshots in Chromatic, we capture both the light/dark mode themed Stories at the same time.
 * Story components are rendered on the page twice- each wrapped in their own StorybookThemeProvider.
 */
function ChromaticDecorator({
	children,
	theme,
	layout = "row",
	disableChromaticDualThemeSnapshot = false,
}: {
	children: ReactNode
	theme: string
	layout?: LayoutMode
	disableChromaticDualThemeSnapshot?: boolean
}) {
	const styles = cn(baseStyles, isChromatic() && chromaticStyles)
	const themeContainerStyles = cn("flex w-full", layout === "column" ? "flex-col" : "flex-row")

	// If disableChromaticDualThemeSnapshot is set, render only the current theme
	const shouldRenderBothThemes = (isChromatic() && !disableChromaticDualThemeSnapshot) || theme === "both"

	return (
		<div className={styles} data-chromatic={isChromatic() ? "true" : "false"}>
			{shouldRenderBothThemes ? (
				<div className={themeContainerStyles}>
					<ThemeModeContainer theme="dark">{children}</ThemeModeContainer>
					<ThemeModeContainer theme="light">{children}</ThemeModeContainer>
				</div>
			) : (
				<ThemeModeContainer theme={theme}>{children}</ThemeModeContainer>
			)}
		</div>
	)
}

function ThemeModeContainer({ children, theme }: { children: ReactNode; theme: string }) {
	return (
		<div data-theme={theme} className="flex relative w-full h-full contained overflow-hidden">
			<div className="bg-background text-vscode-foreground/80 p-8 w-full">
				<div className="text-[11px] font-bold bg-lime-300 text-slate-800 absolute top-0 left-0 p-1">
					{theme}
				</div>

				{children}
			</div>
		</div>
	)
}
