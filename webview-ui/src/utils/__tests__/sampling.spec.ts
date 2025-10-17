import { createSampledFunction } from "../sampling"
import { vi } from "vitest"

describe("createSampledFunction", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it("should call the wrapped function when random value is less than sample rate", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.005) // 0.5%
		const mockFn = vi.fn()
		const sampledFn = createSampledFunction(mockFn, 0.01) // 1%

		sampledFn("test", 123)

		expect(mockFn).toHaveBeenCalledWith("test", 123)
	})

	it("should not call the wrapped function when random value is greater than sample rate", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.015) // 1.5%
		const mockFn = vi.fn()
		const sampledFn = createSampledFunction(mockFn, 0.01) // 1%

		sampledFn("test", 123)

		expect(mockFn).not.toHaveBeenCalled()
	})
})
