import {
	isPaymentRequiredError,
	isUnauthorizedPaidModelError,
	isUnauthorizedPromotionLimitError,
	isUnauthorizedGenericError,
	isAnyRecognizedKiloCodeError,
	errorCodes,
} from "../errorUtils"

describe("isPaymentRequiredError", () => {
	it("returns true for status 402", () => {
		expect(isPaymentRequiredError({ status: 402 })).toBe(true)
	})

	it("returns false for other statuses", () => {
		expect(isPaymentRequiredError({ status: 401 })).toBe(false)
		expect(isPaymentRequiredError({ status: 500 })).toBe(false)
		expect(isPaymentRequiredError(null)).toBe(false)
	})
})

describe("isUnauthorizedPaidModelError", () => {
	it("returns true for status 401 with PAID_MODEL_AUTH_REQUIRED code", () => {
		expect(isUnauthorizedPaidModelError({ status: 401, code: errorCodes.PAID_MODEL_AUTH_REQUIRED })).toBe(true)
	})

	it("returns false for status 401 without matching code", () => {
		expect(isUnauthorizedPaidModelError({ status: 401 })).toBe(false)
		expect(isUnauthorizedPaidModelError({ status: 401, code: "OTHER" })).toBe(false)
	})
})

describe("isUnauthorizedPromotionLimitError", () => {
	it("returns true for status 401 with PROMOTION_MODEL_LIMIT_REACHED code", () => {
		expect(isUnauthorizedPromotionLimitError({ status: 401, code: errorCodes.PROMOTION_MODEL_LIMIT_REACHED })).toBe(
			true,
		)
	})

	it("returns true for status 429 with PROMOTION_MODEL_LIMIT_REACHED code (future backend)", () => {
		expect(isUnauthorizedPromotionLimitError({ status: 429, code: errorCodes.PROMOTION_MODEL_LIMIT_REACHED })).toBe(
			true,
		)
	})

	it("returns false for status 401 without matching code", () => {
		expect(isUnauthorizedPromotionLimitError({ status: 401 })).toBe(false)
		expect(isUnauthorizedPromotionLimitError({ status: 401, code: "OTHER" })).toBe(false)
	})

	it("returns false for status 429 without matching code", () => {
		expect(isUnauthorizedPromotionLimitError({ status: 429 })).toBe(false)
		expect(isUnauthorizedPromotionLimitError({ status: 429, code: "OTHER" })).toBe(false)
	})
})

describe("isUnauthorizedGenericError", () => {
	it("returns true for status 401 with no specific code", () => {
		expect(isUnauthorizedGenericError({ status: 401 })).toBe(true)
		expect(isUnauthorizedGenericError({ status: 401, code: "SOMETHING_ELSE" })).toBe(true)
	})

	it("returns false for status 401 with PAID_MODEL_AUTH_REQUIRED code", () => {
		expect(isUnauthorizedGenericError({ status: 401, code: errorCodes.PAID_MODEL_AUTH_REQUIRED })).toBe(false)
	})

	it("returns false for status 401 with PROMOTION_MODEL_LIMIT_REACHED code", () => {
		expect(isUnauthorizedGenericError({ status: 401, code: errorCodes.PROMOTION_MODEL_LIMIT_REACHED })).toBe(false)
	})
})

describe("isAnyRecognizedKiloCodeError", () => {
	it("returns true for each recognized error type", () => {
		expect(isAnyRecognizedKiloCodeError({ status: 402 })).toBe(true)
		expect(isAnyRecognizedKiloCodeError({ status: 401 })).toBe(true)
		expect(isAnyRecognizedKiloCodeError({ status: 401, code: errorCodes.PAID_MODEL_AUTH_REQUIRED })).toBe(true)
		expect(isAnyRecognizedKiloCodeError({ status: 401, code: errorCodes.PROMOTION_MODEL_LIMIT_REACHED })).toBe(true)
		expect(isAnyRecognizedKiloCodeError({ status: 429, code: errorCodes.PROMOTION_MODEL_LIMIT_REACHED })).toBe(true)
	})

	it("returns false for unrecognized errors", () => {
		expect(isAnyRecognizedKiloCodeError({ status: 500 })).toBe(false)
		expect(isAnyRecognizedKiloCodeError(null)).toBe(false)
		expect(isAnyRecognizedKiloCodeError({})).toBe(false)
	})
})
