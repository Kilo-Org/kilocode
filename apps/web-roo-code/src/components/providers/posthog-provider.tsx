"use client"

import { usePathname, useSearchParams } from "next/navigation"
import posthog from "posthog-js"
import { PostHogProvider as OriginalPostHogProvider } from "posthog-js/react"
import { useEffect, Suspense } from "react"
import { hasConsent } from "@/lib/analytics/consent-manager"

function PageViewTracker() {
	const pathname = usePathname()
	const searchParams = useSearchParams()

	// Track page views
	useEffect(() => {
		if (pathname && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
			let url = window.location.origin + pathname
			if (searchParams && searchParams.toString()) {
				url = url + `?${searchParams.toString()}`
			}
			posthog.capture("$pageview", {
				$current_url: url,
			})
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pathname, searchParams.toString()])

	return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
	useEffect(() => {
		// Initialize PostHog immediately on the client side
		if (typeof window !== "undefined" && !posthog.__loaded) {
			const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

			// Check if environment variables are set
			if (!posthogKey) {
				console.warn(
					"PostHog API key is missing. Analytics will be disabled. " +
						"Please set NEXT_PUBLIC_POSTHOG_KEY in your .env file.",
				)
				return
			}

			// Check if user has already consented to cookies
			const userHasConsented = hasConsent()

			// Initialize PostHog with appropriate persistence based on consent
			posthog.init(posthogKey, {
				api_host: "https://ph.roocode.com",
				ui_host: "https://us.posthog.com",
				capture_pageview: false, // We handle pageview tracking manually
				loaded: (posthogInstance) => {
					if (process.env.NODE_ENV === "development") {
						posthogInstance.debug()
					}
				},
				save_referrer: true, // Save referrer information
				save_campaign_params: true, // Save UTM parameters
				respect_dnt: true, // Respect Do Not Track
				persistence: userHasConsented ? "localStorage+cookie" : "memory", // Use localStorage if consented, otherwise memory-only
				opt_out_capturing_by_default: false, // Start tracking immediately
			})
		}
	}, [])

	return (
		<OriginalPostHogProvider client={posthog}>
			<Suspense fallback={null}>
				<PageViewTracker />
			</Suspense>
			{children}
		</OriginalPostHogProvider>
	)
}
