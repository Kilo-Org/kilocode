import { createTool, createToolSystem } from "../index.js"
import { z } from "zod"

/**
 * Example: Basic usage of typed-llm-stream with functional API
 *
 * This example demonstrates how to create simple tools and use them with the tool system.
 */

// Define schemas with proper typing
const greetingSchema = z.object({
	name: z.string().describe("Person's name"),
	style: z.enum(["formal", "casual", "friendly"]).describe("Style of greeting"),
	message: z.string().describe("The greeting message"),
})

const recommendationItemSchema = z.object({
	name: z.string().describe("Item name"),
	reason: z.string().describe("Why this is recommended"),
	score: z.number().min(1).max(10).optional().describe("Rating from 1-10"),
})

const recommendationSchema = z.object({
	category: z.string().describe("Category of recommendations"),
	items: z.array(recommendationItemSchema).min(1).max(5).describe("List of recommended items"),
	audience: z.string().optional().describe("Target audience"),
})

// Define types based on schemas
type GreetingData = z.infer<typeof greetingSchema>
type RecommendationData = z.infer<typeof recommendationSchema>

// Create a greeting tool
const greetingTool = createTool<typeof greetingSchema, GreetingData>({
	id: "greeting",
	name: "Greeting Generator",
	description: "Generates personalized greetings",
	schema: greetingSchema,
	xmlTag: "greeting",
	handler: async (data: GreetingData) => {
		console.log(`Generated greeting: ${data.message} (${data.style} style for ${data.name})`)
		return data
	},
})

// Create a recommendation tool
const recommendationTool = createTool<typeof recommendationSchema, RecommendationData>({
	id: "recommendation",
	name: "Recommendation Generator",
	description: "Generates personalized recommendations",
	schema: recommendationSchema,
	xmlTag: "recommendation",
	handler: async (data: RecommendationData) => {
		console.log(`Generated ${data.items.length} recommendations for ${data.category}:`)
		data.items.forEach((item, index) => {
			console.log(
				`  ${index + 1}. ${item.name} - ${item.reason} ${item.score ? `(Score: ${item.score}/10)` : ""}`,
			)
		})
		if (data.audience) {
			console.log(`Target audience: ${data.audience}`)
		}
		return data
	},
})

// Main example function
async function runExample() {
	// Create the tool system with both tools and proper typing
	type ToolRegistry = {
		greeting: { tool: typeof greetingTool; schema: typeof greetingSchema; dataType: GreetingData }
		recommendation: {
			tool: typeof recommendationTool
			schema: typeof recommendationSchema
			dataType: RecommendationData
		}
	}

	const toolSystem = createToolSystem<ToolRegistry>([greetingTool, recommendationTool])
		.onToolResponse("greeting", (data: GreetingData) => {
			console.log(`[UI] Displaying greeting: "${data.message}"`)
		})
		.onToolResponse("recommendation", (data: RecommendationData) => {
			console.log(`[UI] Displaying ${data.items.length} recommendations`)
		})

	// Generate the prompt that would be sent to an LLM
	const prompt = toolSystem.generatePrompt({
		systemMessage: "You are a helpful assistant that can provide greetings and recommendations.",
		userMessage: "Recommend some books and greet me as Alice.",
	})

	console.log("\n=== PROMPT ===\n")
	console.log(prompt)

	// Example LLM response (this would normally come from an actual LLM API)
	const exampleResponse = `
I'd be happy to help with that!

<greeting>
  <name>Alice</name>
  <style>friendly</style>
  <message>Hey Alice! Great to see you today. Hope you're having a wonderful day!</message>
</greeting>

<recommendation>
  <category>books</category>
  <items>
    <item>
      <name>Project Hail Mary</name>
      <reason>A science fiction novel by Andy Weir that combines technical problem-solving with an engaging story about first contact.</reason>
      <score>9</score>
    </item>
    <item>
      <name>Atomic Habits</name>
      <reason>A practical productivity book that breaks down how small changes can lead to remarkable results.</reason>
      <score>8</score>
    </item>
    <item>
      <name>The Pragmatic Programmer</name>
      <reason>A classic technology book that offers practical advice for software developers.</reason>
      <score>9</score>
    </item>
  </items>
  <audience>technology enthusiasts who enjoy science fiction and want to improve productivity</audience>
</recommendation>
`

	console.log("\n=== PROCESSING COMPLETE RESPONSE ===\n")

	// Convert the string to a mock async iterable for demonstration
	async function* mockStream() {
		// Extract complete XML blocks for better parsing
		const greetingMatch = exampleResponse.match(/<greeting>[\s\S]*?<\/greeting>/)
		const recommendationMatch = exampleResponse.match(/<recommendation>[\s\S]*?<\/recommendation>/)

		// Send intro text
		yield "I'd be happy to help with that!\n\n"

		// Send greeting block
		if (greetingMatch) {
			await new Promise((resolve) => setTimeout(resolve, 300))
			yield greetingMatch[0]
		}

		// Send recommendation block
		if (recommendationMatch) {
			await new Promise((resolve) => setTimeout(resolve, 300))
			yield recommendationMatch[0]
		}
	}

	// Process the streaming response
	await toolSystem.processStream(mockStream(), {
		onChunk: (chunk: string) => console.log(`Received chunk: ${chunk.trim()}`),
		onComplete: () => console.log("\nStream processing complete"),
	})

	// Get the final results
	const results = toolSystem.getResults()
	console.log("\n=== RESULTS ===\n")
	console.log(JSON.stringify(results, null, 2))

	// Access specific results with type safety
	const greetingResult = toolSystem.getResult("greeting")
	if (greetingResult) {
		console.log(`\nGreeting result: ${greetingResult.message}`)
	}

	const recommendationResult = toolSystem.getResult("recommendation")
	if (recommendationResult) {
		console.log(
			`\nRecommendation result: ${recommendationResult.category} with ${recommendationResult.items.length} items`,
		)
	}
}

// Run the example
// For ES modules, we can check if this is the main module
import { fileURLToPath } from "url"
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)

if (isMainModule) {
	runExample().catch(console.error)
}

export { greetingTool, recommendationTool, runExample }
