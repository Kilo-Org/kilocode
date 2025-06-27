// import posthog from "posthog-js" // kilocode_change

import { TelemetrySetting } from "@roo/TelemetrySetting"

class TelemetryClient {
	private static instance: TelemetryClient
	private static telemetryEnabled: boolean = false

	public updateTelemetryState(telemetrySetting: TelemetrySetting, apiKey?: string, distinctId?: string) {
		// posthog.reset() // kilocode_change

		if (telemetrySetting === "enabled" && apiKey && distinctId) {
			TelemetryClient.telemetryEnabled = true

			// kilocode_change
			// posthog.init(apiKey, {
			// 	api_host: "https://us.i.posthog.com",
			// 	persistence: "localStorage",
			// 	loaded: () => posthog.identify(distinctId),
			// 	capture_pageview: false,
			// 	capture_pageleave: false,
			// 	autocapture: false,
			// })
		} else {
			TelemetryClient.telemetryEnabled = false
		}
	}

	public static getInstance(): TelemetryClient {
		if (!TelemetryClient.instance) {
			TelemetryClient.instance = new TelemetryClient()
		}

		return TelemetryClient.instance
	}

	// kilocode_change start: no posthog interaction
	public capture(_eventName: string, _properties?: Record<string, any>) {
		if (TelemetryClient.telemetryEnabled) {
			try {
				// posthog.capture(eventName, properties)
			} catch (_error) {
				// Silently fail if there's an error capturing an event.
			}
		}
	}
	// kilocode_change end
}

export const telemetryClient = TelemetryClient.getInstance()
