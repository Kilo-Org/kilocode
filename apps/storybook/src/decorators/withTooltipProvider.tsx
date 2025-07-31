import type { Decorator } from "@storybook/react-vite"
import { TooltipProvider } from "@/components/ui/tooltip"

export const withTooltipProvider: Decorator = (Story) => {
	return (
		<TooltipProvider>
			<Story />
		</TooltipProvider>
	)
}
