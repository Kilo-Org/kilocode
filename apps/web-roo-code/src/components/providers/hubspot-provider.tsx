"use client"

import { useEffect, useState } from "react"
import Script from "next/script"
import { hasConsent, onConsentChange } from "@/lib/analytics/consent-manager"

// HubSpot Account ID
const HUBSPOT_ID = "243714031"

/**
 * HubSpot Tracking Provider
 * Loads HubSpot tracking script only after user consent is given, following GDPR requirements
 */
export function HubSpotProvider({ children }: { children: React.ReactNode }) {
	const [shouldLoad, setShouldLoad] = useState(false)

	useEffect(() => {
		// Check initial consent status
		if (hasConsent()) {
			setShouldLoad(true)
		}

		// Listen for consent changes
		const unsubscribe = onConsentChange((consented) => {
			if (consented) {
				setShouldLoad(true)
			}
		})

		return unsubscribe
	}, [])

	return (
		<>
			{shouldLoad && (
				<>
					{/* HubSpot Embed Code */}
					<Script
						id="hs-script-loader"
						src={`//js-na2.hs-scripts.com/${HUBSPOT_ID}.js`}
						strategy="afterInteractive"
						async
						defer
					/>
				</>
			)}
			{children}
		</>
	)
}
