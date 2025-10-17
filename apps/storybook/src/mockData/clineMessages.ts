import { ClineMessage } from "@roo-code/types"
import { randomInterval } from "../utils/randomUtils"

// Fixed base timestamp for consistent snapshots (January 1, 2024, 12:00:00 UTC)
export const BASE_TIMESTAMP = 1704110400000

/**
 * Create mock messages for a typical component creation task
 * Shows realistic timing patterns for development workflows
 */
export const createComponentCreationMessages = (): ClineMessage[] => {
	let currentTime = BASE_TIMESTAMP

	const messages: ClineMessage[] = [
		{
			ts: currentTime,
			type: "ask",
			ask: "command",
			text: "Create a new React component with TypeScript support",
		},
	]

	// Quick initial response (1-3 seconds)
	currentTime += randomInterval(1000, 3000)
	messages.push({
		ts: currentTime,
		type: "say",
		say: "text",
		text: "I'll help you create a new React component with proper TypeScript typing. Let me analyze the requirements and create a well-structured component for you.",
	})

	// Thinking time before tool use (5-12 seconds)
	currentTime += randomInterval(5000, 12000)
	messages.push({
		ts: currentTime,
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "write_to_file",
			path: "Component.tsx",
			content:
				"import React from 'react'\n\ninterface ComponentProps {\n  title: string\n  children?: React.ReactNode\n}\n\nexport const Component: React.FC<ComponentProps> = ({ title, children }) => {\n  return (\n    <div className=\"component\">\n      <h2>{title}</h2>\n      {children}\n    </div>\n  )\n}",
		}),
	})

	// Quick tool execution (800ms - 2 seconds)
	currentTime += randomInterval(800, 2000)
	messages.push({
		ts: currentTime,
		type: "say",
		say: "command_output",
		text: "File created successfully",
	})

	// Immediate checkpoint (200-800ms)
	currentTime += randomInterval(200, 800)
	messages.push({
		ts: currentTime,
		type: "say",
		say: "checkpoint_saved",
		text: "Checkpoint saved",
	})

	// Long completion summary (10-20 seconds)
	currentTime += randomInterval(10000, 20000)
	messages.push({
		ts: currentTime,
		type: "ask",
		ask: "completion_result",
		text: "Task completed successfully! I've created a new React component with proper TypeScript typing, including an interface for props and exported it for use in your application. The component follows React best practices and is ready to be imported and used.",
	})

	return messages
}

/**
 * Create mock messages for a debugging workflow
 * Shows error handling and recovery patterns
 */
export const createDebuggingMessages = (): ClineMessage[] => {
	let currentTime = BASE_TIMESTAMP

	const messages: ClineMessage[] = [
		{
			ts: currentTime,
			type: "ask",
			ask: "command",
			text: "Debug the application and fix any critical issues found in the codebase",
		},
	]

	// Initial analysis response (2-4 seconds)
	currentTime += randomInterval(2000, 4000)
	messages.push({
		ts: currentTime,
		type: "say",
		say: "text",
		text: "I'll analyze the code for issues. Let me start by examining the main application files to identify potential problems.",
	})

	// Quick file read (1-2 seconds)
	currentTime += randomInterval(1000, 2000)
	messages.push({
		ts: currentTime,
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "read_file",
			path: "app.ts",
		}),
	})

	// Analysis time (6-10 seconds)
	currentTime += randomInterval(6000, 10000)
	messages.push({
		ts: currentTime,
		type: "say",
		say: "text",
		text: "Found several issues in the code including memory leaks, unhandled promise rejections, and type safety problems. Let me fix these systematically.",
	})

	// First fix attempt (3-5 seconds)
	currentTime += randomInterval(3000, 5000)
	messages.push({
		ts: currentTime,
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "apply_diff",
			path: "app.ts",
			diff: "Fix memory leak and add proper error handling",
		}),
	})

	// Error occurs quickly (500-1500ms)
	currentTime += randomInterval(500, 1500)
	messages.push({
		ts: currentTime,
		type: "say",
		say: "error",
		text: "Error applying the fix: merge conflict detected. Let me try a different approach.",
	})

	// Recovery attempt (2-4 seconds)
	currentTime += randomInterval(2000, 4000)
	messages.push({
		ts: currentTime,
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "write_to_file",
			path: "app.ts",
			content: "// Fixed code with proper error handling and memory management",
		}),
	})

	// Success (1-2 seconds)
	currentTime += randomInterval(1000, 2000)
	messages.push({
		ts: currentTime,
		type: "say",
		say: "command_output",
		text: "File updated successfully. All critical issues have been resolved.",
	})

	return messages
}

/**
 * Create mock messages for a complex full-stack development task
 * Shows extended workflow with many varied operations
 */
export const createFullStackMessages = (): ClineMessage[] => {
	let currentTime = BASE_TIMESTAMP

	const messages: ClineMessage[] = [
		{
			ts: currentTime,
			type: "ask",
			ask: "command",
			text: "Build a complete full-stack application with authentication, database, and API",
		},
	]

	// Generate 15-20 messages with varied timing
	const messageCount = 15 + randomInterval(0, 5) // 15-20 messages

	const messageTypes = [
		{ type: "say", say: "text", baseText: "Analyzing requirements and planning architecture" },
		{ type: "ask", ask: "tool", baseText: "Creating database schema" },
		{ type: "say", say: "command_output", baseText: "Database created successfully" },
		{ type: "ask", ask: "tool", baseText: "Setting up authentication middleware" },
		{ type: "say", say: "text", baseText: "Implementing user registration and login" },
		{ type: "ask", ask: "tool", baseText: "Creating API endpoints" },
		{ type: "say", say: "checkpoint_saved", baseText: "Checkpoint saved" },
		{ type: "ask", ask: "tool", baseText: "Building frontend components" },
		{ type: "say", say: "text", baseText: "Adding responsive design and styling" },
		{ type: "ask", ask: "tool", baseText: "Implementing state management" },
		{ type: "say", say: "error", baseText: "Build error: dependency conflict" },
		{ type: "ask", ask: "tool", baseText: "Fixing dependency issues" },
		{ type: "say", say: "command_output", baseText: "Build successful" },
		{ type: "ask", ask: "tool", baseText: "Running tests and deployment" },
		{ type: "say", say: "text", baseText: "Application deployed successfully" },
	]

	for (let i = 1; i < messageCount && i < messageTypes.length + 1; i++) {
		// Vary timing based on message type
		let interval: number
		const msgType = messageTypes[(i - 1) % messageTypes.length]

		if (msgType.ask === "tool") {
			// Tool operations: 2-8 seconds
			interval = randomInterval(2000, 8000)
		} else if (msgType.say === "command_output") {
			// Command outputs: quick 500ms-2s
			interval = randomInterval(500, 2000)
		} else if (msgType.say === "checkpoint_saved") {
			// Checkpoints: very quick 200-600ms
			interval = randomInterval(200, 600)
		} else if (msgType.say === "error") {
			// Errors: quick 800-2s
			interval = randomInterval(800, 2000)
		} else {
			// Text responses: 3-15 seconds (thinking time)
			interval = randomInterval(3000, 15000)
		}

		currentTime += interval

		messages.push({
			ts: currentTime,
			type: msgType.type as "ask" | "say",
			...(msgType.ask && { ask: msgType.ask as any }),
			...(msgType.say && { say: msgType.say as any }),
			text:
				msgType.baseText + (msgType.ask === "tool" ? JSON.stringify({ tool: "example", path: "file.ts" }) : ""),
		})
	}

	return messages
}

/**
 * Create mock messages for TaskHeader stories
 * Shows a realistic agent workflow with proper read/write ratios
 */
export const createTaskHeaderMessages = (): ClineMessage[] => {
	let currentTime = BASE_TIMESTAMP
	const messages: ClineMessage[] = []

	// Helper to add message with realistic timing
	const addMessage = (message: Omit<ClineMessage, "ts">, timingRange: [number, number] = [800, 1200]) => {
		messages.push({ ...message, ts: currentTime })
		currentTime += randomInterval(timingRange[0], timingRange[1])
	}

	// Initial user request
	addMessage(
		{
			type: "ask",
			ask: "command",
			text: "Create a React component with TypeScript that displays user profiles. Include proper prop types, error handling, and responsive design.",
		},
		[0, 0],
	) // No delay for first message

	// Agent response and API request
	addMessage(
		{
			type: "say",
			say: "text",
			text: "I'll help you create a React component with TypeScript for displaying user profiles. Let me start by examining the project structure.",
		},
		[2000, 4000],
	)

	addMessage(
		{
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({
				cost: undefined, // API request in progress
				provider: "anthropic",
				model: "claude-3-sonnet-20240229",
			}),
		},
		[500, 1000],
	)

	// Realistic workflow: Read files to understand context (happens 2-3x more than writes)
	const filesToRead = [
		"package.json",
		"src/types/User.ts",
		"src/components/common/Card.tsx",
		"src/styles/globals.css",
		"src/utils/api.ts",
		"src/hooks/useUsers.ts",
	]

	filesToRead.forEach((file) => {
		addMessage(
			{
				type: "ask",
				ask: "tool",
				text: JSON.stringify({
					tool: "read_file",
					path: file,
				}),
			},
			[1000, 2000],
		)

		addMessage(
			{
				type: "say",
				say: "text",
				text: `Reading ${file} to understand the project structure...`,
			},
			[800, 1500],
		)
	})

	// First checkpoint after analysis
	addMessage(
		{
			type: "say",
			say: "checkpoint_saved",
			text: "Checkpoint saved after analyzing project structure",
		},
		[200, 600],
	)

	// Write main component
	addMessage(
		{
			type: "ask",
			ask: "tool",
			text: JSON.stringify({
				tool: "write_to_file",
				path: "src/components/UserProfile.tsx",
				content:
					'export interface UserProfileProps {\n  user: User\n  onEdit?: () => void\n}\n\nexport const UserProfile: React.FC<UserProfileProps> = ({ user, onEdit }) => {\n  return (\n    <Card className="user-profile">\n      <img src={user.avatar} alt={user.name} />\n      <h2>{user.name}</h2>\n      <p>{user.email}</p>\n    </Card>\n  )\n}',
			}),
		},
		[3000, 6000],
	)

	addMessage(
		{
			type: "say",
			say: "text",
			text: "Created UserProfile component with TypeScript interfaces and proper prop types.",
		},
		[1000, 2000],
	)

	// Read more files for styling context
	addMessage(
		{
			type: "ask",
			ask: "tool",
			text: JSON.stringify({
				tool: "read_file",
				path: "src/components/UserProfile.tsx",
			}),
		},
		[1000, 2000],
	)

	// Write styles
	addMessage(
		{
			type: "ask",
			ask: "tool",
			text: JSON.stringify({
				tool: "write_to_file",
				path: "src/components/UserProfile.module.css",
				content:
					".user-profile {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  padding: 1rem;\n  border-radius: 8px;\n  box-shadow: 0 2px 4px rgba(0,0,0,0.1);\n}",
			}),
		},
		[2000, 4000],
	)

	// Write tests
	addMessage(
		{
			type: "ask",
			ask: "tool",
			text: JSON.stringify({
				tool: "write_to_file",
				path: "src/components/__tests__/UserProfile.test.tsx",
				content:
					"import { render, screen } from '@testing-library/react'\nimport { UserProfile } from '../UserProfile'\n\ntest('renders user profile', () => {\n  const mockUser = { name: 'John Doe', email: 'john@example.com' }\n  render(<UserProfile user={mockUser} />)\n  expect(screen.getByText('John Doe')).toBeInTheDocument()\n})",
			}),
		},
		[2000, 5000],
	)

	// Second checkpoint after implementation
	addMessage(
		{
			type: "say",
			say: "checkpoint_saved",
			text: "Checkpoint saved after implementing UserProfile component",
		},
		[200, 600],
	)

	// Read package.json to check dependencies
	addMessage(
		{
			type: "ask",
			ask: "tool",
			text: JSON.stringify({
				tool: "read_file",
				path: "package.json",
			}),
		},
		[1000, 2000],
	)

	// Final summary
	addMessage(
		{
			type: "say",
			say: "text",
			text: "I've successfully created a UserProfile component with TypeScript, proper prop types, responsive design, and comprehensive tests. The component includes error handling and follows React best practices.",
		},
		[5000, 10000],
	)

	// Task completion
	addMessage(
		{
			type: "say",
			say: "completion_result",
			text: "Task completed successfully. Created UserProfile component with TypeScript interfaces, responsive CSS, and unit tests.",
		},
		[2000, 4000],
	)

	return messages
}

/**
 * Create a mock task message for TaskHeader stories
 */
export const createMockTask = (): ClineMessage => ({
	ts: BASE_TIMESTAMP,
	type: "ask",
	ask: "command",
	text: "Create a React component with TypeScript that displays user profiles. Include proper prop types, error handling, and responsive design. The component should fetch data from an API and handle loading states gracefully.",
	images: [
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	],
})

/**
 * Create mock messages for a very quick task
 * Shows minimum timing constraints and fast operations
 */
export const createQuickTaskMessages = (): ClineMessage[] => [
	{
		ts: BASE_TIMESTAMP,
		type: "ask",
		ask: "command",
		text: "Quick fix",
	},
	{
		ts: BASE_TIMESTAMP + 500, // Very quick response
		type: "say",
		say: "text",
		text: "Done!",
	},
	{
		ts: BASE_TIMESTAMP + 800, // Quick tool use
		type: "ask",
		ask: "tool",
		text: JSON.stringify({ tool: "apply_diff", path: "fix.ts" }),
	},
	{
		ts: BASE_TIMESTAMP + 1000, // Immediate result
		type: "say",
		say: "command_output",
		text: "Fixed",
	},
]

/**
 * Create mock messages for testing different message types
 * Includes examples of all message types supported by the timeline registry
 */
export const createMessageTypeVarietyMessages = (): ClineMessage[] => {
	let currentTime = BASE_TIMESTAMP
	const messages: ClineMessage[] = []

	// Helper to add message with timing
	const addMessage = (message: Omit<ClineMessage, "ts">, timingRange: [number, number] = [1000, 3000]) => {
		messages.push({ ...message, ts: currentTime })
		currentTime += randomInterval(timingRange[0], timingRange[1])
	}

	// All supported ASK message types from registry
	addMessage(
		{
			type: "ask",
			ask: "command",
			text: "Create a new React component with TypeScript support",
		},
		[0, 0],
	) // First message has no delay

	addMessage(
		{
			type: "ask",
			ask: "followup",
			text: "Please review the implementation and provide feedback",
		},
		[2000, 4000],
	)

	addMessage(
		{
			type: "ask",
			ask: "followup",
			text: "Would you like me to add error handling to this component?",
		},
		[1000, 2000],
	)

	addMessage(
		{
			type: "ask",
			ask: "tool",
			text: JSON.stringify({
				tool: "read_file",
				path: "src/components/UserProfile.tsx",
			}),
		},
		[1000, 3000],
	)

	addMessage(
		{
			type: "ask",
			ask: "tool",
			text: JSON.stringify({
				tool: "write_to_file",
				path: "src/components/NewComponent.tsx",
				content: "export const NewComponent = () => <div>Hello World</div>",
			}),
		},
		[2000, 4000],
	)

	addMessage(
		{
			type: "ask",
			ask: "browser_action_launch",
			text: "Launching browser to test the component",
		},
		[1000, 2000],
	)

	addMessage(
		{
			type: "ask",
			ask: "use_mcp_server",
			text: "Using MCP server to fetch additional data",
		},
		[1500, 3000],
	)

	addMessage(
		{
			type: "ask",
			ask: "completion_result",
			text: "Task completed successfully! Created a new React component with proper TypeScript typing and error handling.",
		},
		[3000, 5000],
	)

	// All supported SAY message types from registry
	addMessage(
		{
			type: "say",
			say: "text",
			text: "I'll help you create a new React component. Let me analyze the requirements first.",
		},
		[2000, 4000],
	)

	addMessage(
		{
			type: "say",
			say: "reasoning",
			text: "Based on the project structure, I should use functional components with hooks for better performance and maintainability.",
		},
		[3000, 6000],
	)

	addMessage(
		{
			type: "say",
			say: "command_output",
			text: "File created successfully: src/components/NewComponent.tsx",
		},
		[500, 1500],
	)

	addMessage(
		{
			type: "say",
			say: "mcp_server_response",
			text: "MCP server returned user data successfully",
		},
		[1000, 2000],
	)

	addMessage(
		{
			type: "say",
			say: "browser_action",
			text: "Clicking on the submit button to test form functionality",
		},
		[800, 1500],
	)

	addMessage(
		{
			type: "say",
			say: "browser_action_result",
			text: "Button click successful - form submitted correctly",
		},
		[500, 1000],
	)

	addMessage(
		{
			type: "say",
			say: "checkpoint_saved",
			text: "Checkpoint saved after component creation",
		},
		[200, 600],
	)

	addMessage(
		{
			type: "say",
			say: "completion_result",
			text: "All components have been successfully created and tested",
		},
		[2000, 4000],
	)

	addMessage(
		{
			type: "say",
			say: "error",
			text: "Error: TypeScript compilation failed. Missing import statement for React.",
		},
		[800, 2000],
	)

	addMessage(
		{
			type: "say",
			say: "condense_context",
			text: "Condensing conversation to save context space",
		},
		[1000, 2000],
	)

	addMessage(
		{
			type: "say",
			say: "text",
			text: "Context condensed - removed redundant information while preserving key details",
		},
		[1500, 3000],
	)

	return messages
}
