import { z } from "zod"
import { createTool, createToolSystem } from "../index.js"

// Example: Using the functional API to create tools and process responses

// Define our schemas with proper typing
const weatherSchema = z.object({
	location: z.string().describe("City or location name"),
	temperature: z.number().describe("Temperature in Celsius"),
	conditions: z.string().describe("Weather conditions description"),
})

const newsItemSchema = z.object({
	title: z.string().describe("Headline title"),
	source: z.string().describe("News source"),
	summary: z.string().describe("Brief summary of the news"),
})

// Define types based on schemas for better type safety
type WeatherData = z.infer<typeof weatherSchema>
type NewsItem = z.infer<typeof newsItemSchema>
type NewsData = NewsItem[]

// 1. Create a weather forecast tool with proper typing
const weatherTool = createTool<typeof weatherSchema, WeatherData>({
	id: "weather",
	name: "Weather Forecast",
	description: "Provides weather forecasts for locations",
	schema: weatherSchema,
	xmlTag: "weather_forecast",
	handler: (data: WeatherData) => {
		console.log(`Weather for ${data.location}: ${data.temperature}°C, ${data.conditions}`)
		return data
	},
})

// 2. Create a news headlines tool with proper typing
const newsTool = createTool<typeof newsItemSchema, NewsItem>({
	id: "news",
	name: "News Headlines",
	description: "Provides recent news headlines on a topic",
	schema: newsItemSchema,
	xmlTag: "news_headline",
	handler: (data: NewsItem) => {
		console.log(`${data.title} (${data.source}): ${data.summary}`)
		return data
	},
})

// 3. Create a tool system with chaining and proper typing
// TypeScript will infer the correct types for each tool
const system = createToolSystem()
	.addTool(weatherTool)
	.addTool(newsTool)
	.onToolResponse("weather", (data: WeatherData) => {
		// TypeScript knows this is WeatherData
		console.log(`[UI UPDATE] Weather widget updated with: ${data.temperature}°C in ${data.location}`)
	})
	.onToolResponse("news", (data: NewsItem) => {
		// TypeScript knows this is NewsItem
		console.log(`[UI UPDATE] News feed updated with headline: ${data.title}`)
	})
	.onToolResponse((toolId: string, data: any) => {
		// Global callback with type discrimination
		if (toolId === "weather") {
			// TypeScript knows this is WeatherData
			console.log(`Weather data received: ${data.temperature}°C`)
		} else if (toolId === "news") {
			// TypeScript knows this is NewsItem
			console.log(`News data received: ${data.title}`)
		}
	})

// 4. Simulate a streaming response from an LLM
async function* mockLLMStream(prompt: string) {
	console.log("Sending prompt to LLM:", prompt)

	// Simulate chunks of a response
	const chunks = [
		`<weather_forecast>
<location>San Francisco</location>
<temperature>18</temperature>
<conditions>Partly cloudy with fog</conditions>
</weather_forecast>`,
		`<news_headline>
<title>Tech Conference Announced</title>
<source>Tech Daily</source>
<summary>Major tech conference to be held next month</summary>
</news_headline>`,
	]

	for (const chunk of chunks) {
		// Simulate network delay
		await new Promise((resolve) => setTimeout(resolve, 300))
		yield chunk
	}
}

// 5. Main function to demonstrate the API
async function main() {
	// Generate a prompt
	const prompt = system.generatePrompt({
		systemMessage: "You are a helpful assistant that provides weather and news information.",
		userMessage: "What's the weather in San Francisco and any tech news?",
	})

	// Process the streaming response
	await system.processStream(mockLLMStream(prompt), {
		onChunk: (chunk: string) => console.log("Received chunk:", chunk),
		onComplete: () => console.log("Stream complete"),
		onError: (err: Error) => console.error("Error:", err),
	})

	// Get the final results with proper typing
	const results = system.getResults()
	console.log("Final results:", results)

	// Type-safe access to specific tool results
	const weatherResult = system.getResult("weather")
	if (weatherResult) {
		// TypeScript knows this is WeatherData
		console.log(`Weather: ${weatherResult.temperature}°C in ${weatherResult.location}`)
	}

	// Example of early termination with type safety
	const earlyTerminationSystem = createToolSystem()
		.addTool(weatherTool)
		.onToolResponse("weather", (data: WeatherData) => {
			console.log(`Got weather for ${data.location}, terminating stream early`)
			// Terminate the stream after getting weather data
			earlyTerminationSystem.terminateStream("Weather data received, no need for more")
		})

	console.log("\nDemonstrating early termination:")
	await earlyTerminationSystem.processStream(mockLLMStream(prompt), {
		onChunk: (chunk: string) => console.log("Received chunk:", chunk),
		onComplete: () => console.log("Stream complete (early termination)"),
	})
}

// Run the example
// For ES modules, we can check if this is the main module
import { fileURLToPath } from "url"
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)

if (isMainModule) {
	main().catch(console.error)
}

export { weatherTool, newsTool, system, mockLLMStream, main }
