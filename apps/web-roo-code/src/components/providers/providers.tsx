"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"

import { GoogleTagManagerProvider } from "./google-tag-manager-provider"
import { HubSpotProvider } from "./hubspot-provider"
import { PostHogProvider } from "./posthog-provider"

const queryClient = new QueryClient()

export const Providers = ({ children }: { children: React.ReactNode }) => {
	return (
		<QueryClientProvider client={queryClient}>
			<GoogleTagManagerProvider>
				<HubSpotProvider>
					<PostHogProvider>
						<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
							{children}
						</ThemeProvider>
					</PostHogProvider>
				</HubSpotProvider>
			</GoogleTagManagerProvider>
		</QueryClientProvider>
	)
}
