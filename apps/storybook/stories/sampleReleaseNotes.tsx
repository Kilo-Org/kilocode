// kilocode_change - new file: Sample release notes data for Storybook testing
import { ReleaseNote } from "@/types/release-notes"

// Sample release notes data for testing
export const sampleReleaseNotes: ReleaseNote[] = [
	{
		version: "4.106.0",
		features: [
			{
				description: "Preliminary support for native tool calling (a.k.a native function calling) was added",
				category: "feature",
				prNumber: 2833,
				commitHash: "0b8ef46",
				author: "mcowger",
				details:
					"This feature is currently experimental and mostly intended for users interested in contributing to its development.\nIt is so far only supported when using OpenRouter or Kilo Code providers.",
			},
		],
		fixes: [],
		improvements: [
			{
				description: "CMD-I now invokes the agent so you can give it more complex prompts",
				category: "improvement",
				prNumber: 3050,
				commitHash: "357d438",
				author: "markijbema",
			},
		],
		breakingChanges: [],
		rawChanges: [],
	},
	{
		version: "4.105.0",
		features: [
			{
				description: "Improve the edit chat area to allow context and file drag and drop when editing messages",
				category: "feature",
				prNumber: 3005,
				commitHash: "b87ae9c",
				author: "kevinvandijk",
			},
		],
		fixes: [
			{
				description: "A warning is now shown when the webview memory usage crosses 90% of the limit",
				category: "fix",
				prNumber: 3046,
				commitHash: "1bd934f",
				author: "chrarnoldus",
			},
		],
		improvements: [],
		breakingChanges: [],
		rawChanges: [],
	},
	{
		version: "4.104.0",
		features: [],
		fixes: [],
		improvements: [],
		breakingChanges: [],
		rawChanges: [
			{
				description: "Update Gemini provider to support dynamic model retrieval",
				category: "other",
				prNumber: 2673,
				commitHash: "cf1aca2",
				author: "mcowger",
			},
			{
				description: "Improved OpenAI compatible parser's ability to yield reasoning content",
				category: "other",
				prNumber: 2749,
				commitHash: "7e493ec",
				author: "mcowger",
			},
		],
	},
]
