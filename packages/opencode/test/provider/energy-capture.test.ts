import { describe, it, expect, afterEach } from "bun:test"
import * as EnergyCapture from "../../src/provider/energy-capture"

describe("EnergyCapture", () => {
	afterEach(() => {
		EnergyCapture.discard()
	})

	describe("store and consume", () => {
		it("should store and consume energy data", () => {
			const energy = { wh: 0.5, joules: 1800, source: "measured" as const, provider: "neuralwatt" }
			EnergyCapture.store(energy)

			const result = EnergyCapture.consume()
			expect(result).toEqual(energy)
		})

		it("should return undefined when no energy is stored", () => {
			expect(EnergyCapture.consume()).toBeUndefined()
		})

		it("should clear energy after consume", () => {
			EnergyCapture.store({ wh: 0.5, source: "measured" })
			EnergyCapture.consume()

			expect(EnergyCapture.consume()).toBeUndefined()
		})

		it("should overwrite previous energy on second store", () => {
			EnergyCapture.store({ wh: 0.1, source: "measured" })
			EnergyCapture.store({ wh: 0.2, source: "measured" })

			const result = EnergyCapture.consume()
			expect(result?.wh).toBe(0.2)
		})
	})

	describe("discard", () => {
		it("should clear stored energy", () => {
			EnergyCapture.store({ wh: 0.5, source: "measured" })
			EnergyCapture.discard()

			expect(EnergyCapture.consume()).toBeUndefined()
		})
	})

	describe("wrapResponse", () => {
		it("should capture Neuralwatt energy from SSE comments", async () => {
			const sseBody = [
				'data: {"choices":[{"delta":{"content":"hello"}}]}\n',
				"\n",
				': energy {"energy_joules":1632,"energy_kwh":0.000453,"attribution_method":"rapl"}\n',
				"\n",
				"data: [DONE]\n",
			].join("")

			const response = new Response(sseBody, {
				headers: { "content-type": "text/event-stream" },
			})

			const wrapped = EnergyCapture.wrapResponse(response)
			// Consume the stream to trigger the transform
			await new Response(wrapped.body).text()

			const energy = EnergyCapture.consume()
			expect(energy).toBeDefined()
			expect(energy!.joules).toBe(1632)
			expect(energy!.kwh).toBe(0.000453)
			expect(energy!.provider).toBe("neuralwatt")
			expect(energy!.method).toBe("rapl")
		})

		it("should capture GreenPT energy from impact fields", async () => {
			const sseBody = [
				'data: {"choices":[{"delta":{"content":"hi"}}],"impact":{"energy":{"total":3600000,"unit":"Wms"},"emissions":{"total":1000000,"unit":"ugCO2e"}}}\n',
				"\n",
				"data: [DONE]\n",
			].join("")

			const response = new Response(sseBody, {
				headers: { "content-type": "text/event-stream" },
			})

			const wrapped = EnergyCapture.wrapResponse(response)
			await new Response(wrapped.body).text()

			const energy = EnergyCapture.consume()
			expect(energy).toBeDefined()
			expect(energy!.wh).toBeCloseTo(1.0)
			expect(energy!.gCO2e).toBeCloseTo(1.0)
			expect(energy!.provider).toBe("greenpt")
		})

		it("should pass through response bytes unchanged", async () => {
			const sseBody = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n'

			const response = new Response(sseBody, {
				headers: { "content-type": "text/event-stream" },
			})

			const wrapped = EnergyCapture.wrapResponse(response)
			const text = await new Response(wrapped.body).text()

			expect(text).toBe(sseBody)
		})

		it("should return response unchanged when body is null", () => {
			const response = new Response(null)
			const wrapped = EnergyCapture.wrapResponse(response)
			expect(wrapped).toBe(response)
		})
	})
})
