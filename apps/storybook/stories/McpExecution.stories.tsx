import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import { McpExecution } from "../../../webview-ui/src/components/chat/McpExecution"
import { withTooltipProvider } from "../src/decorators/withTooltipProvider"

const meta = {
	title: "Chat/McpExecution",
	component: McpExecution,
	parameters: { layout: "padded" },
} satisfies Meta<typeof McpExecution>

export default meta
type Story = StoryObj<typeof meta>

// Mock server configuration
const mockServer = {
	tools: [
		{
			name: "get_weather",
			description: "Get current weather information for a location",
			alwaysAllow: false,
		},
		{
			name: "search_files",
			description: "Search for files in the project directory",
			alwaysAllow: true,
		},
	],
	source: "global" as const,
}

// Sample JSON arguments
const jsonArguments = JSON.stringify(
	{
		location: "San Francisco, CA",
		units: "metric",
		include_forecast: true,
	},
	null,
	2,
)

// Sample JSON response
const jsonResponse = JSON.stringify(
	{
		location: "San Francisco, CA",
		temperature: 18,
		humidity: 65,
		conditions: "Partly cloudy",
		forecast: [
			{ day: "Tomorrow", high: 20, low: 15, conditions: "Sunny" },
			{ day: "Tuesday", high: 19, low: 14, conditions: "Cloudy" },
		],
	},
	null,
	2,
)

export const CompletedWithJsonResponse: Story = {
	name: "Completed - JSON Response",
	args: {
		executionId: "exec-003",
		text: jsonArguments,
		serverName: "weather-server",
		useMcpServer: {
			type: "use_mcp_tool",
			serverName: "weather-server",
			toolName: "get_weather",
			arguments: jsonArguments,
			response: jsonResponse,
		},
		server: mockServer,
		alwaysAllowMcp: false,
		initiallyExpanded: true,
	},
}

export const CompletedWithMarkdownResponse: Story = {
	name: "Completed - Markdown Response",
	args: {
		executionId: "exec-004",
		text: jsonArguments,
		serverName: "weather-server",
		useMcpServer: {
			type: "use_mcp_tool",
			serverName: "weather-server",
			toolName: "get_weather",
			arguments: jsonArguments,
			response: `# Weather Report

**Location:** San Francisco, CA  
**Temperature:** 18°C  
**Humidity:** 65%  
**Conditions:** Partly cloudy

## 3-Day Forecast

- **Tomorrow:** Sunny, High: 20°C, Low: 15°C
- **Tuesday:** Cloudy, High: 19°C, Low: 14°C
- **Wednesday:** Rain, High: 17°C, Low: 12°C`,
		},
		server: mockServer,
		alwaysAllowMcp: false,
		initiallyExpanded: true,
	},
}

export const RunningState: Story = {
	name: "Running State",
	args: {
		executionId: "exec-005",
		text: jsonArguments,
		serverName: "weather-server",
		useMcpServer: {
			type: "use_mcp_tool",
			serverName: "weather-server",
			toolName: "get_weather",
			arguments: jsonArguments,
		},
		server: mockServer,
		alwaysAllowMcp: false,
	},
	play: async ({ canvasElement }) => {
		// Simulate a running execution by dispatching a status message
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "mcpExecutionStatus",
					text: JSON.stringify({
						executionId: "exec-005",
						status: "started",
						serverName: "weather-server",
						toolName: "get_weather",
					}),
				},
			}),
		)
	},
}

export const ErrorState: Story = {
	name: "Error State",
	args: {
		executionId: "exec-006",
		text: jsonArguments,
		serverName: "weather-server",
		useMcpServer: {
			type: "use_mcp_tool",
			serverName: "weather-server",
			toolName: "get_weather",
			arguments: jsonArguments,
		},
		server: mockServer,
		alwaysAllowMcp: false,
	},
	play: async ({ canvasElement }) => {
		// Simulate an error state
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "mcpExecutionStatus",
					text: JSON.stringify({
						executionId: "exec-006",
						status: "error",
						error: "Connection timeout to weather service",
					}),
				},
			}),
		)
	},
}
