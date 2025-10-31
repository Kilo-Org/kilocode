import { describe, it, expect } from "vitest"
import { getAllowedJSONToolsForMode } from "../getAllowedJSONToolsForMode"
import { Mode } from "../../../../../shared/modes"
import { ClineProviderState } from "../../../../webview/ClineProvider"
import { apply_diff_multi_file, apply_diff_single_file } from "../apply_diff"

describe("getAllowedJSONToolsForMode", () => {
	const mockCodeIndexManager = {
		isFeatureEnabled: true,
		isFeatureConfigured: true,
		isInitialized: true,
	} as any

	const baseProviderState: Partial<ClineProviderState> = {
		apiConfiguration: {
			diffEnabled: true,
		},
		experiments: {},
	}

	it("should use single file diff when multiFileApplyDiff experiment is disabled", () => {
		const providerState: Partial<ClineProviderState> = {
			...baseProviderState,
			apiConfiguration: {
				diffEnabled: true,
			},
			experiments: {
				multiFileApplyDiff: false,
			},
		}

		const tools = getAllowedJSONToolsForMode(
			"code" as Mode,
			mockCodeIndexManager,
			providerState as ClineProviderState,
			true,
			undefined,
		)

		const applyDiffTool = tools.find((tool) => "function" in tool && tool.function.name === "apply_diff")
		expect(applyDiffTool).toBeDefined()
		expect(applyDiffTool).toEqual(apply_diff_single_file)
		expect(applyDiffTool).not.toEqual(apply_diff_multi_file)
	})

	it("should use multi file diff when multiFileApplyDiff experiment is enabled", () => {
		const providerState: Partial<ClineProviderState> = {
			...baseProviderState,
			apiConfiguration: {
				diffEnabled: true,
			},
			experiments: {
				multiFileApplyDiff: true,
			},
		}

		const tools = getAllowedJSONToolsForMode(
			"code" as Mode,
			mockCodeIndexManager,
			providerState as ClineProviderState,
			true,
			undefined,
		)

		const applyDiffTool = tools.find((tool) => "function" in tool && tool.function.name === "apply_diff")
		expect(applyDiffTool).toBeDefined()
		expect(applyDiffTool).toEqual(apply_diff_multi_file)
		expect(applyDiffTool).not.toEqual(apply_diff_single_file)
	})
})
