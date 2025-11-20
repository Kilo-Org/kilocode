"use client"

import { useEffect, useState } from "react"
import Script from "next/script"
import { hasConsent, onConsentChange } from "@/lib/analytics/consent-manager"

// Google Tag Manager ID
const GTM_ID = "AW-17391954825"

/**
 * Google Analytics Provider with Consent Mode v2
 * Implements cookieless pings and advanced consent management
 */
export function GoogleAnalyticsProvider({ children }: { children: React.ReactNode }) {
	const [shouldLoad, setShouldLoad] = useState(false)

	useEffect(() => {
		// Initialize consent defaults BEFORE loading gtag.js (required for Consent Mode v2)
		initializeConsentDefaults()

		// Check initial consent status
		if (hasConsent()) {
			setShouldLoad(true)
			updateConsentGranted()
		}

		// Listen for consent changes
		const unsubscribe = onConsentChange((consented) => {
			if (consented) {
				if (!shouldLoad) {
					setShouldLoad(true)
				}
				updateConsentGranted()
			} else {
				updateConsentDenied()
			}
		})

		return unsubscribe
		// eslint-disable-next-line react-hooks/exhaustive-deps -- shouldLoad intentionally omitted to prevent re-initialization loop
	}, [])

	const initializeConsentDefaults = () => {
		// Set up consent defaults before gtag loads (Consent Mode v2 requirement)
		if (typeof window !== "undefined") {
			window.dataLayer = window.dataLayer || []
			window.gtag = function (...args: GtagArgs) {
				window.dataLayer.push(args)
			}

			// Set default consent state to 'denied' with cookieless pings enabled
			window.gtag("consent", "default", {
				ad_storage: "denied",
				ad_user_data: "denied",
				ad_personalization: "denied",
				analytics_storage: "denied",
				functionality_storage: "denied",
				personalization_storage: "denied",
				security_storage: "granted", // Always granted for security
				wait_for_update: 500, // Wait 500ms for consent before sending data
			})

			// Enable cookieless pings for Google Ads
			window.gtag("set", "url_passthrough", true)
		}
	}

	const updateConsentGranted = () => {
		// User accepted cookies - update consent to granted
		if (typeof window !== "undefined" && window.gtag) {
			window.gtag("consent", "update", {
				ad_storage: "granted",
				ad_user_data: "granted",
				ad_personalization: "granted",
				analytics_storage: "granted",
				functionality_storage: "granted",
				personalization_storage: "granted",
			})
		}
	}

	const updateConsentDenied = () => {
		// User declined cookies - keep consent denied (cookieless pings still work)
		if (typeof window !== "undefined" && window.gtag) {
			window.gtag("consent", "update", {
				ad_storage: "denied",
				ad_user_data: "denied",
				ad_personalization: "denied",
				analytics_storage: "denied",
				functionality_storage: "denied",
				personalization_storage: "denied",
			})
		}
	}

	// Always render scripts (Consent Mode v2 needs gtag loaded even without consent)
	// Cookieless pings will work with denied consent

	return (
		<>
			{/* Google tag (gtag.js) - Loads immediately for Consent Mode v2 */}
			<Script
				src={`https://www.googletagmanager.com/gtag/js?id=${GTM_ID}`}
				strategy="afterInteractive"
				onLoad={() => {
					// Initialize gtag config after script loads
					if (typeof window !== "undefined" && window.gtag) {
						window.gtag("js", new Date())
						window.gtag("config", GTM_ID)
					}
				}}
			/>
			{children}
		</>
	)
}

// Type definitions for Google Analytics with Consent Mode v2
type ConsentState = "granted" | "denied"

interface ConsentParams {
	ad_storage?: ConsentState
	ad_user_data?: ConsentState
	ad_personalization?: ConsentState
	analytics_storage?: ConsentState
	functionality_storage?: ConsentState
	personalization_storage?: ConsentState
	security_storage?: ConsentState
	wait_for_update?: number
}

type GtagArgs =
	| ["js", Date]
	| ["config", string, GtagConfig?]
	| ["event", string, GtagEventParameters?]
	| ["consent", "default" | "update", ConsentParams]
	| ["set", string, unknown]

interface GtagConfig {
	[key: string]: unknown
}

interface GtagEventParameters {
	[key: string]: unknown
}

// Declare global types for TypeScript
declare global {
	interface Window {
		dataLayer: GtagArgs[]
		gtag: (...args: GtagArgs) => void
	}
}
