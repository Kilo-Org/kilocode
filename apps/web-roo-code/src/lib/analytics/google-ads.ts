/**
 * Google Ads conversion tracking utilities
 */

/**
 * Track a Google Ads conversion event
 * This should only be called after user consent has been given
 */
export function trackGoogleAdsConversion() {
	if (typeof window !== "undefined" && window.gtag) {
		window.gtag("event", "conversion", {
			send_to: "AW-17391954825/VtOZCJe_77MbEInXkOVA",
			value: 10.0,
			currency: "USD",
		})
	}
}
