/**
 * Energy tracking types, parsing, and formatting utilities.
 *
 * Supports two provider formats:
 * 1. Neuralwatt: SSE comments like `: energy {"energy_joules":1632,...}`
 * 2. GreenPT: `impact` field in response chunks
 */

/**
 * Normalized energy measurement from an LLM inference request.
 */
export interface Energy {
	wh?: number
	kwh?: number
	joules?: number
	gCO2e?: number
	source: "measured" | "estimated"
	provider?: string
	method?: string
	raw?: Record<string, unknown>
}

/**
 * Parse Neuralwatt energy SSE comment data into normalized Energy format.
 *
 * Input: {"energy_joules":1632,"energy_kwh":0.000453,"avg_power_watts":379.1,...}
 */
export function parseNeuralwatt(data: Record<string, unknown>): Energy {
	const joules = typeof data.energy_joules === "number" ? data.energy_joules : undefined
	const kwh = typeof data.energy_kwh === "number" ? data.energy_kwh : undefined
	return {
		joules,
		kwh,
		wh: kwh !== undefined ? kwh * 1000 : joules !== undefined ? joules / 3600 : undefined,
		source: "measured",
		provider: "neuralwatt",
		method: typeof data.attribution_method === "string" ? data.attribution_method : undefined,
		raw: data,
	}
}

/**
 * Parse GreenPT impact data into normalized Energy format.
 *
 * Input: {"version":"20250922","energy":{"total":40433,"unit":"Wms"},
 *         "emissions":{"total":1,"unit":"ugCO2e"}}
 */
export function parseGreenPT(impact: Record<string, unknown>): Energy {
	const energy: Energy = {
		source: "measured",
		provider: "greenpt",
		raw: impact,
	}

	const impactEnergy = impact.energy as { total?: number; unit?: string } | undefined
	if (impactEnergy?.total !== undefined) {
		if (impactEnergy.unit === "Wms") {
			// Watt-milliseconds
			const wms = impactEnergy.total
			energy.wh = wms / 3_600_000
			energy.kwh = wms / 3_600_000_000
			energy.joules = wms / 1000
		}
	}

	const emissions = impact.emissions as { total?: number; unit?: string } | undefined
	if (emissions?.total !== undefined) {
		if (emissions.unit === "ugCO2e") {
			// Micrograms CO2 equivalent to grams
			energy.gCO2e = emissions.total / 1_000_000
		}
	}

	return energy
}

/**
 * Format a watt-hour value with the appropriate metric prefix.
 *
 * Examples:
 *   formatWh(1500)    → "1.50 kWh"
 *   formatWh(2.5)     → "2.50 Wh"
 *   formatWh(0.175)   → "175.0 mWh"
 *   formatWh(0.00005) → "50.0 μWh"
 */
export function formatWh(wh: number): string {
	if (!Number.isFinite(wh) || wh < 0) return "\u2014"
	if (wh === 0) return "0 Wh"
	if (wh >= 1000) return (wh / 1000).toFixed(2) + " kWh"
	if (wh >= 1) return wh.toFixed(2) + " Wh"
	if (wh >= 0.001) return (wh * 1000).toFixed(1) + " mWh"
	return (wh * 1_000_000).toFixed(1) + " μWh"
}
