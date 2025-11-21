"use client"

import { useEffect, useState } from "react"
import Script from "next/script"
import { hasConsent, onConsentChange } from "@/lib/analytics/consent-manager"

// Google Tag Manager Container ID
const GTM_ID = "GTM-M2JZHV8N"

/**
 * Google Tag Manager Provider
 * Loads GTM only after user consent is given, following GDPR requirements
 */
export function GoogleTagManagerProvider({ children }: { children: React.ReactNode }) {
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
					{/* Google Tag Manager Script */}
					<Script
						id="google-tag-manager"
						strategy="afterInteractive"
						dangerouslySetInnerHTML={{
							__html: `
								(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
								new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
								j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
								'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
								})(window,document,'script','dataLayer','${GTM_ID}');
							`,
						}}
					/>
					{/* Google Tag Manager (noscript) */}
					<noscript>
						<iframe
							src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
							height="0"
							width="0"
							style={{ display: "none", visibility: "hidden" }}
						/>
					</noscript>
				</>
			)}
			{children}
		</>
	)
}
