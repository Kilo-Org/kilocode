import { describe, it, expect, vi } from "vitest"
import { StrategyFactory } from "../StrategyFactory"
import { HoleFillerStrategy } from "../HoleFillerStrategy"
import { FimStrategy } from "../FimStrategy"
import { GhostModel } from "../../../GhostModel"
import { GhostContextProvider } from "../../GhostContextProvider"

describe("StrategyFactory", () => {
	it("should create HoleFillerStrategy when model does not support FIM", () => {
		const mockModel = {
			supportsFim: vi.fn().mockReturnValue(false),
		} as unknown as GhostModel

		const mockContextProvider = {} as GhostContextProvider

		const strategy = StrategyFactory.createStrategy(mockModel, mockContextProvider)

		expect(strategy).toBeInstanceOf(HoleFillerStrategy)
		expect(mockModel.supportsFim).toHaveBeenCalled()
	})

	it("should create FimStrategy when model supports FIM", () => {
		const mockModel = {
			supportsFim: vi.fn().mockReturnValue(true),
		} as unknown as GhostModel

		const mockContextProvider = {} as GhostContextProvider

		const strategy = StrategyFactory.createStrategy(mockModel, mockContextProvider)

		expect(strategy).toBeInstanceOf(FimStrategy)
		expect(mockModel.supportsFim).toHaveBeenCalled()
	})
})
