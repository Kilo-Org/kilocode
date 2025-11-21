// pnpm --filter @roo-code/types test src/__tests__/message.test.ts

import { clineAsks, isIdleAsk, isInteractiveAsk, isResumableAsk, isNonBlockingAsk } from "../message.js"

describe("ask messages", () => {
	test("all ask messages are classified", () => {
		for (const ask of clineAsks) {
			expect(
				isIdleAsk(ask) || isInteractiveAsk(ask) || isResumableAsk(ask) || isNonBlockingAsk(ask),
				`${ask} is not classified`,
			).toBe(true)
		}
	})
})
