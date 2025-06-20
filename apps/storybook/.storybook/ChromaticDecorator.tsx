import { ReactNode } from "react"
import type { Decorator } from "@storybook/react"
import { cn } from "@/lib/utils"
import isChromatic from "chromatic/isChromatic"

// Decorator that renders both the light and dark theme of children for Chromatic screenshot testing
export const withChromaticDecorator: Decorator = (Story, context) => {
	const theme = context.globals.theme || "dark"
	return (
		<ChromaticDecorator theme={theme}>
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
function ChromaticDecorator({ children, theme }: { children: ReactNode; theme: string }) {
	const styles = cn(baseStyles, isChromatic() && chromaticStyles)
	return (
		<div className={styles} data-chromatic={isChromatic() ? "true" : "false"}>
			{isChromatic() || theme === "both" ? (
				<div className="flex w-full">
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
		<div data-theme={theme} className="flex relative w-full contained overflow-hidden">
			<div className="bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] p-8 w-full">
				<div className="text-[12px] font-bold bg-lime-300 text-slate-800 absolute top-0 left-0 p-1">
					{theme}
				</div>

				{children}
			</div>
		</div>
	)
}
