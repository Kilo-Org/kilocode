import type { Decorator } from "@storybook/react"
import { TooltipProvider } from "@/components/ui/tooltip"

export const withTooltipProvider: Decorator = (Story) => {
	return (
		<TooltipProvider>
			<Story />
		</TooltipProvider>
	)
}
