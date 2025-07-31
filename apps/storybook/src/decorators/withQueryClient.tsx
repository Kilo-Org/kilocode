import type { Decorator } from "@storybook/react-vite"
import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// Create a QueryClient instance for Storybook
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			staleTime: Infinity,
		},
	},
})

// Decorator to provide QueryClient for all stories
export const withQueryClient: Decorator = (Story) => {
	return (
		<QueryClientProvider client={queryClient}>
			<Story />
		</QueryClientProvider>
	)
}
