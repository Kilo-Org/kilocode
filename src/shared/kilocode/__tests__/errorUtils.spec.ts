import { isPaymentRequiredError } from "../errorUtils"

describe("isPaymentRequiredError", () => {
	test("returns true for HTTP 402 payment required errors", () => {
		expect(
			isPaymentRequiredError({
				status: 402,
				message: "Payment required",
			}),
		).toBe(true)
	})

	test("returns true for insufficient credits throttling responses", () => {
		expect(
			isPaymentRequiredError({
				status: 429,
				error: "Insufficient credits",
			}),
		).toBe(true)
	})

	test("returns false for generic rate limit responses", () => {
		expect(
			isPaymentRequiredError({
				status: 429,
				error: "Rate limit exceeded",
			}),
		).toBe(false)
	})
})
