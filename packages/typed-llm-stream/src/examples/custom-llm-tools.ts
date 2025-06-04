import { createTool, createToolSystem } from "../index.js"
import { z } from "zod"

/**
 * Example: Custom LLM Tools with Functional API
 *
 * This example demonstrates how to create more advanced custom LLM tools
 * with complex schemas and specialized functionality using the functional API.
 */

// Define schemas with proper typing
const codeGenerationSchema = z.object({
	language: z.string().describe("Programming language"),
	code: z.string().describe("The generated code"),
	explanation: z.string().describe("Explanation of how the code works"),
	imports: z.string().optional().describe("Required imports or dependencies (comma-separated)"),
	complexity: z.enum(["simple", "moderate", "complex"]).optional().describe("Complexity level of the code"),
	performance: z
		.object({
			timeComplexity: z.string().optional().describe("Time complexity (e.g., O(n), O(log n))"),
			spaceComplexity: z.string().optional().describe("Space complexity (e.g., O(n), O(1))"),
			optimizationNotes: z.string().optional().describe("Notes about performance considerations"),
		})
		.optional()
		.describe("Performance characteristics"),
})

const metricSchema = z.object({
	name: z.string().describe("Name of the metric"),
	value: z.union([z.number(), z.string()]).describe("Value of the metric"),
	unit: z.string().optional().describe("Unit of measurement"),
})

const insightSchema = z.object({
	finding: z.string().describe("Key finding from the data"),
	confidence: z.number().min(0).max(1).describe("Confidence score (0.0 to 1.0)"),
	impact: z.enum(["low", "medium", "high"]).describe("Impact level of the finding"),
})

const visualizationSuggestionSchema = z.object({
	type: z.string().describe("Chart type (bar, line, scatter, etc.)"),
	description: z.string().describe("What the visualization would show"),
})

const dataAnalysisSchema = z.object({
	dataset_name: z.string().describe("Name of the dataset"),
	analysis_type: z.enum(["descriptive", "diagnostic", "predictive", "prescriptive"]).describe("Type of analysis"),
	metrics: z.array(metricSchema).describe("Key metrics from the analysis"),
	insights: z.array(insightSchema).describe("Insights derived from the data"),
	visualization_suggestions: z.array(visualizationSuggestionSchema).optional().describe("Recommended visualizations"),
})

// Define types based on schemas
type CodeGenerationData = z.infer<typeof codeGenerationSchema>
type DataAnalysisData = z.infer<typeof dataAnalysisSchema>

// Create a code generation tool
const codeGenerationTool = createTool<typeof codeGenerationSchema, CodeGenerationData>({
	id: "code-generator",
	name: "Code Generator",
	description: "Generates code snippets in various languages",
	schema: codeGenerationSchema,
	xmlTag: "code-snippet",
	category: "development",
	handler: async (data: CodeGenerationData) => {
		console.log(`Generated ${data.language} code snippet:`)
		console.log("-----------------------------------")
		console.log(data.code)
		console.log("-----------------------------------")
		console.log(`Explanation: ${data.explanation}`)

		if (data.imports && data.imports.trim() !== "") {
			console.log("Required imports:")
			data.imports.split(",").forEach((imp) => console.log(`- ${imp.trim()}`))
		}

		if (data.complexity) {
			console.log(`Complexity level: ${data.complexity}`)
		}

		if (data.performance) {
			console.log("Performance characteristics:")
			if (data.performance.timeComplexity) {
				console.log(`- Time complexity: ${data.performance.timeComplexity}`)
			}
			if (data.performance.spaceComplexity) {
				console.log(`- Space complexity: ${data.performance.spaceComplexity}`)
			}
			if (data.performance.optimizationNotes) {
				console.log(`- Optimization notes: ${data.performance.optimizationNotes}`)
			}
		}

		return data
	},
})

// Create a data analysis tool
const dataAnalysisTool = createTool<typeof dataAnalysisSchema, DataAnalysisData>({
	id: "data-analysis",
	name: "Data Analysis Tool",
	description: "Analyzes data and provides statistical insights",
	schema: dataAnalysisSchema,
	xmlTag: "data-analysis",
	category: "analytics",
	handler: async (data: DataAnalysisData) => {
		console.log(`Analysis of ${data.dataset_name} (${data.analysis_type}):`)
		console.log("-----------------------------------")

		console.log("Key Metrics:")
		data.metrics.forEach((metric) => {
			const unitStr = metric.unit ? ` ${metric.unit}` : ""
			console.log(`- ${metric.name}: ${metric.value}${unitStr}`)
		})

		console.log("\nInsights:")
		data.insights.forEach((insight) => {
			const confidencePercent = Math.round(insight.confidence * 100)
			console.log(`- ${insight.finding} (${confidencePercent}% confidence, ${insight.impact} impact)`)
		})

		if (data.visualization_suggestions && data.visualization_suggestions.length > 0) {
			console.log("\nRecommended Visualizations:")
			data.visualization_suggestions.forEach((viz) => {
				console.log(`- ${viz.type}: ${viz.description}`)
			})
		}

		return data
	},
})

// Main example function
async function runExample() {
	// Create the tool system with both tools and proper typing
	type ToolRegistry = {
		"code-generator": {
			tool: typeof codeGenerationTool
			schema: typeof codeGenerationSchema
			dataType: CodeGenerationData
		}
		"data-analysis": {
			tool: typeof dataAnalysisTool
			schema: typeof dataAnalysisSchema
			dataType: DataAnalysisData
		}
	}

	const toolSystem = createToolSystem<ToolRegistry>([codeGenerationTool, dataAnalysisTool])
		.onToolResponse("code-generator", (data: CodeGenerationData) => {
			console.log(`[UI] Displaying code snippet in ${data.language}`)
		})
		.onToolResponse("data-analysis", (data: DataAnalysisData) => {
			console.log(`[UI] Displaying analysis of ${data.dataset_name} with ${data.insights.length} insights`)
		})

	// Generate the prompt
	const prompt = toolSystem.generatePrompt({
		systemMessage: "You are a helpful assistant that can generate code and analyze data.",
		userMessage: "Generate Python code for customer segmentation and analyze the results.",
	})

	console.log("\n=== PROMPT ===\n")
	console.log(prompt)

	// Example LLM response for code generation
	const codeResponse = `
<code-snippet>
  <language>python</language>
  <code>
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.cluster import KMeans

def analyze_customer_segments(data_path, n_clusters=3):
    # Load the customer data
    df = pd.read_csv(data_path)
    
    # Select features for clustering
    features = ['purchase_frequency', 'average_order_value', 'time_since_last_purchase']
    X = df[features].copy()
    
    # Normalize the data
    X_scaled = (X - X.mean()) / X.std()
    
    # Apply KMeans clustering
    kmeans = KMeans(n_clusters=n_clusters, random_state=42)
    df['segment'] = kmeans.fit_predict(X_scaled)
    
    # Analyze the segments
    segment_analysis = df.groupby('segment').agg({
        'purchase_frequency': 'mean',
        'average_order_value': 'mean',
        'time_since_last_purchase': 'mean',
        'customer_id': 'count'
    }).rename(columns={'customer_id': 'count'})
    
    return df, segment_analysis

# Example usage
if __name__ == "__main__":
    customer_data, segments = analyze_customer_segments('customer_data.csv')
    print(segments)
  </code>
  <explanation>
    This code performs customer segmentation using KMeans clustering. It loads customer data from a CSV file, selects relevant features (purchase frequency, average order value, and time since last purchase), normalizes the data, and applies KMeans to identify customer segments. It then calculates the mean values for each feature within each segment to help understand the characteristics of each customer group.
  </explanation>
  <imports>pandas,matplotlib.pyplot,seaborn,sklearn.cluster.KMeans</imports>
  <complexity>moderate</complexity>
  <performance>
    <timeComplexity>O(n*k*i) where n is the number of samples, k is the number of clusters, and i is the number of iterations</timeComplexity>
    <spaceComplexity>O(n) for storing the dataset and results</spaceComplexity>
    <optimizationNotes>For very large datasets, consider using MiniBatchKMeans instead of standard KMeans for better performance. Also, feature selection is important as irrelevant features can degrade clustering quality.</optimizationNotes>
  </performance>
</code-snippet>
`

	// Example LLM response for data analysis
	const analysisResponse = `
<data-analysis>
  <dataset_name>Customer Purchase History</dataset_name>
  <analysis_type>diagnostic</analysis_type>
  <metrics>
    <metric>
      <name>Average Customer Lifetime Value</name>
      <value>842.50</value>
      <unit>USD</unit>
    </metric>
    <metric>
      <name>Customer Retention Rate</name>
      <value>0.68</value>
    </metric>
    <metric>
      <name>Average Purchase Frequency</name>
      <value>2.3</value>
      <unit>orders/month</unit>
    </metric>
    <metric>
      <name>Customer Acquisition Cost</name>
      <value>65.20</value>
      <unit>USD</unit>
    </metric>
  </metrics>
  <insights>
    <insight>
      <finding>Customers who make a second purchase within 30 days of their first purchase have 3x higher lifetime value</finding>
      <confidence>0.92</confidence>
      <impact>high</impact>
    </insight>
    <insight>
      <finding>Free shipping promotions increase average order value by 15%</finding>
      <confidence>0.78</confidence>
      <impact>medium</impact>
    </insight>
    <insight>
      <finding>Mobile app users have 27% higher purchase frequency than web-only customers</finding>
      <confidence>0.85</confidence>
      <impact>high</impact>
    </insight>
    <insight>
      <finding>Email engagement has declined 12% over the past quarter</finding>
      <confidence>0.88</confidence>
      <impact>medium</impact>
    </insight>
  </insights>
  <visualization_suggestions>
    <suggestion>
      <type>Cohort Analysis Heatmap</type>
      <description>Visualize retention rates by customer acquisition cohort over time</description>
    </suggestion>
    <suggestion>
      <type>Funnel Chart</type>
      <description>Show conversion rates through the purchase funnel from product view to checkout</description>
    </suggestion>
    <suggestion>
      <type>Scatter Plot</type>
      <description>Plot customer lifetime value against purchase frequency with point size representing average order value</description>
    </suggestion>
  </visualization_suggestions>
</data-analysis>
`

	console.log("\n=== PROCESSING RESPONSES ===\n")

	// Convert the strings to mock async iterables for demonstration
	async function* mockCodeStream() {
		// Extract complete XML blocks for better parsing
		const codeMatch = codeResponse.match(/<code-snippet>[\s\S]*?<\/code-snippet>/)

		if (codeMatch) {
			console.log("Found code snippet XML block, length:", codeMatch[0].length)
			console.log("Code snippet preview:", codeMatch[0].substring(0, 100) + "...")

			// Simulate network delay
			await new Promise((resolve) => setTimeout(resolve, 300))
			yield codeMatch[0]
		} else {
			console.error("Failed to match code snippet XML block")
		}
	}

	async function* mockAnalysisStream() {
		// Extract complete XML blocks for better parsing
		const analysisMatch = analysisResponse.match(/<data-analysis>[\s\S]*?<\/data-analysis>/)

		if (analysisMatch) {
			console.log("Found data analysis XML block, length:", analysisMatch[0].length)
			console.log("Data analysis preview:", analysisMatch[0].substring(0, 100) + "...")

			// Simulate network delay
			await new Promise((resolve) => setTimeout(resolve, 300))
			yield analysisMatch[0]
		} else {
			console.error("Failed to match data analysis XML block")
		}
	}

	// Process the code generation response
	console.log("Processing code generation response...")
	try {
		await toolSystem.processStream(mockCodeStream(), {
			onChunk: (chunk: string) => console.log(`Received code chunk: ${chunk.substring(0, 50)}...`),
			onComplete: () => console.log("Code generation processing complete"),
			onError: (error: Error) => console.error("Code generation error:", error.message),
		})
	} catch (error) {
		console.error("Error processing code stream:", error)
	}

	// Process the data analysis response
	console.log("\nProcessing data analysis response...")
	try {
		await toolSystem.processStream(mockAnalysisStream(), {
			onChunk: (chunk: string) => console.log(`Received analysis chunk: ${chunk.substring(0, 50)}...`),
			onComplete: () => console.log("Data analysis processing complete"),
			onError: (error: Error) => console.error("Data analysis error:", error.message),
		})
	} catch (error) {
		console.error("Error processing analysis stream:", error)
	}

	// Get the final results
	const results = toolSystem.getResults()
	console.log("\n=== FINAL RESULTS ===\n")
	console.log("All results:", JSON.stringify(results, null, 2))
	console.log("Code Generator Result:", results["code-generator"] ? "✓" : "✗")
	if (results["code-generator"]) {
		console.log("Code Generator Data:", results["code-generator"])
	} else {
		console.log("No code generator data found")
	}

	console.log("Data Analysis Result:", results["data-analysis"] ? "✓" : "✗")
	if (results["data-analysis"]) {
		console.log("Data Analysis Data:", results["data-analysis"])
	} else {
		console.log("No data analysis data found")
	}
}

// For direct execution:
// For ES modules, we can check if this is the main module
import { fileURLToPath } from "url"
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)

if (isMainModule) {
	runExample().catch(console.error)
}

export { codeGenerationTool, dataAnalysisTool, runExample }
