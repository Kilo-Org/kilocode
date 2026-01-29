# Updated Onboarding Flow - Final Implementation Plan

## Overview

This document outlines the concrete implementation steps for the updated VSCode extension onboarding flow, incorporating product owner feedback.

## Product Owner Decisions

### Clarified Requirements

1. **Open Folder**: Use VSCode's native folder picker (`vscode.commands.executeCommand("vscode.openFolder")`)
2. **Clone Repository**: Skip description search for v1 - only support direct URL input
3. **Workspace Reopening**: Skip for v1 - let user manually reopen if desired
4. **Contextual Prompts**: Use generic prompts suitable for any project:
    - "Explain the structure of this project"
    - "Find potential bugs in the current file" (if file is open)
    - "Write tests for the selected code" (if code is selected)
    - Additional generic prompts
5. **Rate Limiting**: All free model usage is rate limited (authenticated and non-authenticated users)
6. **Paid Model Detection**: Use existing models.json data (already retrieved before model selection)
7. **Subscription Model**: Kilo Gateway subscription = pay Kilo, get free model choice
8. **Fun Projects**: Approved suggestions - Snake Game, Todo App, Weather Dashboard

## Simplified Implementation Plan

### Phase 1: State Management & Detection (Week 1)

#### 1.1 Add New State Variables

**File**: `webview-ui/src/components/welcome/WelcomeViewProvider.tsx`

```typescript
const [hasOpenFolder, setHasOpenFolder] = useState<boolean>(false)
const [hasSessionHistory, setHasSessionHistory] = useState<boolean>(false)
const [isRateLimited, setIsRateLimited] = useState<boolean>(false)
const [rateLimitResetTime, setRateLimitResetTime] = useState<number | null>(null)
```

#### 1.2 Create Detection Logic

**New File**: `src/core/onboarding/OnboardingStateDetector.ts`

```typescript
export class OnboardingStateDetector {
	static async detectWorkspaceState(): Promise<{
		hasOpenFolder: boolean
		hasSessionHistory: boolean
	}> {
		// Check if workspace has folders
		const folders = vscode.workspace.workspaceFolders
		const hasOpenFolder = folders && folders.length > 0

		// Check if user has previous sessions
		const globalState = this.context.globalState
		const taskHistory = globalState.get<string[]>("taskHistory") || []
		const hasSessionHistory = taskHistory.length > 0

		return { hasOpenFolder, hasSessionHistory }
	}
}
```

#### 1.3 Add Message Handlers

**File**: `src/core/webview/ClineProvider.ts`

Add handlers for:

```typescript
case "checkWorkspaceState":
  const state = await OnboardingStateDetector.detectWorkspaceState()
  this.postMessageToWebview({
    type: "workspaceState",
    hasFolder: state.hasOpenFolder,
    hasHistory: state.hasSessionHistory
  })
  break

case "checkRateLimit":
  const rateLimitStatus = RateLimitMonitor.getStatus()
  this.postMessageToWebview({
    type: "rateLimitStatus",
    isLimited: rateLimitStatus.isLimited,
    resetTime: rateLimitStatus.resetTime
  })
  break
```

### Phase 2: New Screen Components (Week 2)

#### 2.1 Extract Existing Screens

Create separate component files:

- `webview-ui/src/components/welcome/screens/LandingScreen.tsx`
- `webview-ui/src/components/welcome/screens/ProviderSelectionScreen.tsx`
- `webview-ui/src/components/welcome/screens/WaitingForAuthScreen.tsx`

#### 2.2 No Folder/No History Screen

**New File**: `webview-ui/src/components/welcome/screens/NoFolderNoHistoryScreen.tsx`

```typescript
export const NoFolderNoHistoryScreen = () => {
  const { t } = useAppTranslation()

  const handleOpenFolder = () => {
    vscode.postMessage({ type: "openFolder" })
  }

  const handleCloneRepository = () => {
    vscode.postMessage({ type: "showCloneDialog" })
  }

  const handleFunProject = (projectType: string) => {
    vscode.postMessage({
      type: "startFunProject",
      projectType
    })
  }

  return (
    <Tab>
      <TabContent className="flex flex-col gap-4 p-6">
        <RooHero />
        <h2 className="text-xl font-semibold">
          {t("welcome:noFolderNoHistory.heading")}
        </h2>

        <p className="text-vscode-descriptionForeground">
          {t("welcome:noFolderNoHistory.description")}
        </p>

        {/* Primary Actions - Highlighted */}
        <div className="flex flex-col gap-2">
          <Button
            onClick={handleOpenFolder}
            variant="primary"
            className="w-full justify-start">
            <FolderOpen className="size-4" />
            {t("welcome:noFolderNoHistory.openFolder")}
          </Button>
          <Button
            onClick={handleCloneRepository}
            variant="primary"
            className="w-full justify-start">
            <GitBranch className="size-4" />
            {t("welcome:noFolderNoHistory.cloneRepository")}
          </Button>
        </div>

        {/* Secondary Actions - Fun Projects */}
        <div className="mt-4">
          <p className="text-sm text-vscode-descriptionForeground mb-2">
            {t("welcome:noFolderNoHistory.orTryFunProject")}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => handleFunProject("snake")}
              variant="secondary"
              className="w-full justify-start text-sm">
              {t("welcome:noFolderNoHistory.projects.snake")}
            </Button>
            <Button
              onClick={() => handleFunProject("todo")}
              variant="secondary"
              className="w-full justify-start text-sm">
              {t("welcome:noFolderNoHistory.projects.todo")}
            </Button>
            <Button
              onClick={() => handleFunProject("weather")}
              variant="secondary"
              className="w-full justify-start text-sm">
              {t("welcome:noFolderNoHistory.projects.weather")}
            </Button>
          </div>
        </div>
      </TabContent>
    </Tab>
  )
}
```

#### 2.3 Folder But No History Screen

**New File**: `webview-ui/src/components/welcome/screens/FolderNoHistoryScreen.tsx`

```typescript
export const FolderNoHistoryScreen = () => {
  const { t } = useAppTranslation()
  const { hasOpenFile, hasSelectedCode } = useEditorState()

  const handlePromptClick = (prompt: string) => {
    vscode.postMessage({
      type: "sendMessage",
      text: prompt
    })
  }

  // Build contextual prompts based on editor state
  const prompts = [
    t("welcome:folderNoHistory.prompts.explainStructure"),
    hasOpenFile && t("welcome:folderNoHistory.prompts.findBugs"),
    hasSelectedCode && t("welcome:folderNoHistory.prompts.writeTests"),
    t("welcome:folderNoHistory.prompts.improveCode"),
    t("welcome:folderNoHistory.prompts.addDocumentation"),
  ].filter(Boolean)

  return (
    <Tab>
      <TabContent className="flex flex-col gap-4 p-6">
        <RooHero />
        <h2 className="text-xl font-semibold">
          {t("welcome:folderNoHistory.heading")}
        </h2>

        <p className="text-vscode-descriptionForeground">
          {t("welcome:folderNoHistory.description")}
        </p>

        <div className="flex flex-col gap-2">
          {prompts.map((prompt, index) => (
            <Button
              key={index}
              onClick={() => handlePromptClick(prompt)}
              variant="secondary"
              className="w-full justify-start text-sm">
              <Sparkles className="size-4" />
              {prompt}
            </Button>
          ))}
        </div>
      </TabContent>
    </Tab>
  )
}
```

#### 2.4 Paid Model Selection Screen

**New File**: `webview-ui/src/components/welcome/screens/PaidModelScreen.tsx`

```typescript
export const PaidModelScreen = () => {
  const { t } = useAppTranslation()
  const { selectedModel, cloudIsAuthenticated } = useExtensionState()

  const handleCreateAccount = () => {
    vscode.postMessage({
      type: "rooCloudSignIn",
      useProviderSignup: true
    })
  }

  const handleProviderSettings = () => {
    vscode.postMessage({ type: "openSettings" })
  }

  // Check if model supports Kilo Gateway subscription
  const supportsKiloGateway = selectedModel?.provider === "roo"

  if (supportsKiloGateway) {
    return (
      <Tab>
        <TabContent className="flex flex-col gap-4 p-6">
          <CreditCard className="size-8" />
          <h2 className="text-xl font-semibold">
            {t("welcome:paidModel.withSubscription.heading")}
          </h2>

          <p className="text-vscode-descriptionForeground">
            {t("welcome:paidModel.withSubscription.description")}
          </p>

          <div className="flex flex-col gap-2">
            <Button onClick={handleCreateAccount} variant="primary">
              {t("welcome:paidModel.withSubscription.subscribe")}
            </Button>
            <VSCodeLink
              onClick={handleProviderSettings}
              className="cursor-pointer text-sm">
              {t("welcome:paidModel.withSubscription.useOwnKey")}
            </VSCodeLink>
          </div>
        </TabContent>
      </Tab>
    )
  }

  // Model doesn't support Kilo Gateway
  return (
    <Tab>
      <TabContent className="flex flex-col gap-4 p-6">
        <Key className="size-8" />
        <h2 className="text-xl font-semibold">
          {t("welcome:paidModel.withoutSubscription.heading")}
        </h2>

        <p className="text-vscode-descriptionForeground">
          {t("welcome:paidModel.withoutSubscription.description")}
        </p>

        <div className="flex flex-col gap-2">
          <Button onClick={handleProviderSettings} variant="primary">
            {t("welcome:paidModel.withoutSubscription.configureProvider")}
          </Button>
          <VSCodeLink
            onClick={handleCreateAccount}
            className="cursor-pointer text-sm">
            {t("welcome:paidModel.withoutSubscription.orCreateAccount")}
          </VSCodeLink>
        </div>
      </TabContent>
    </Tab>
  )
}
```

#### 2.5 Rate Limit Notification (In-Chat)

**New File**: `webview-ui/src/components/chat/RateLimitNotification.tsx`

```typescript
export const RateLimitNotification = ({
  resetTime
}: {
  resetTime: number
}) => {
  const { t } = useAppTranslation()
  const [timeRemaining, setTimeRemaining] = useState("")

  useEffect(() => {
    const updateTime = () => {
      const remaining = Math.max(0, resetTime - Date.now())
      const minutes = Math.floor(remaining / 60000)
      setTimeRemaining(t("welcome:rateLimit.waitTime", { minutes }))
    }

    updateTime()
    const interval = setInterval(updateTime, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [resetTime, t])

  const handleCreateAccount = () => {
    vscode.postMessage({
      type: "rooCloudSignIn",
      useProviderSignup: true
    })
  }

  return (
    <div className="bg-vscode-notifications-background border border-vscode-notifications-border p-4 rounded-md mb-4">
      <div className="flex items-start gap-3">
        <Clock className="size-5 text-vscode-notificationsWarningIcon-foreground shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-vscode-notifications-foreground m-0">
            {t("welcome:rateLimit.heading")}
          </p>
          <p className="text-sm text-vscode-descriptionForeground mt-1 mb-2">
            {t("welcome:rateLimit.description")}
          </p>
          <p className="text-sm text-vscode-descriptionForeground mb-3">
            {timeRemaining}
          </p>
          <Button
            onClick={handleCreateAccount}
            variant="primary"
            size="sm">
            {t("welcome:rateLimit.createAccount")}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

### Phase 3: Simplified Repository Operations (Week 3)

#### 3.1 Open Folder Functionality

**File**: `src/core/webview/ClineProvider.ts`

```typescript
case "openFolder":
  // Trigger VSCode's native open folder dialog
  await vscode.commands.executeCommand("vscode.openFolder")
  break
```

#### 3.2 Simplified Clone Repository

**File**: `src/core/webview/ClineProvider.ts`

```typescript
case "showCloneDialog":
  // Show VSCode's native git clone dialog
  await vscode.commands.executeCommand("git.clone")
  break
```

**Note**: For v1, we're using VSCode's built-in git clone command. This:

- Shows native URL input dialog
- Handles folder selection
- Performs the clone operation
- Asks user about reopening workspace

This eliminates the need for custom `RepositoryCloner.ts` service in v1.

### Phase 4: Model Detection & Rate Limiting (Week 4)

#### 4.1 Paid Model Detection

**File**: `src/core/webview/ClineProvider.ts`

```typescript
case "checkModelType":
  const modelId = message.modelId
  const modelInfo = this.getModelInfo(modelId) // From existing models.json

  this.postMessageToWebview({
    type: "modelType",
    isPaid: modelInfo.pricing?.type === "paid",
    supportsKiloGateway: modelInfo.provider === "roo"
  })
  break
```

#### 4.2 Rate Limit Monitor

**New File**: `src/core/rate-limiting/RateLimitMonitor.ts`

```typescript
export class RateLimitMonitor {
	private static usageCount = 0
	private static resetTime: number | null = null
	private static readonly FREE_LIMIT = 50 // requests per hour for free models

	static trackApiCall(modelId: string): void {
		// Only track free model usage
		const modelInfo = this.getModelInfo(modelId)
		if (modelInfo.pricing?.type !== "free") return

		this.usageCount++

		if (this.usageCount >= this.FREE_LIMIT) {
			this.setRateLimited()
		}
	}

	static isRateLimited(): boolean {
		if (this.resetTime && Date.now() > this.resetTime) {
			this.reset()
			return false
		}
		return this.usageCount >= this.FREE_LIMIT
	}

	static getStatus() {
		return {
			isLimited: this.isRateLimited(),
			resetTime: this.resetTime,
			usageCount: this.usageCount,
			limit: this.FREE_LIMIT,
		}
	}

	private static setRateLimited(): void {
		this.resetTime = Date.now() + 60 * 60 * 1000 // 1 hour

		// Notify webview
		vscode.postMessage({
			type: "rateLimitReached",
			resetTime: this.resetTime,
		})
	}

	private static reset(): void {
		this.usageCount = 0
		this.resetTime = null
	}
}
```

### Phase 5: UI Components (Week 5)

#### 5.1 Fun Project Suggestions Component

**New File**: `webview-ui/src/components/welcome/components/FunProjectSuggestions.tsx`

```typescript
const FUN_PROJECTS = [
  {
    id: "snake",
    icon: "🐍",
    prompt: "Create a Snake game in HTML/CSS/JavaScript with arrow key controls"
  },
  {
    id: "todo",
    icon: "✓",
    prompt: "Build a Todo app with React and TypeScript, including add/delete/complete functionality"
  },
  {
    id: "weather",
    icon: "🌤️",
    prompt: "Make a Weather Dashboard using a weather API, showing current conditions and 5-day forecast"
  }
]

export const FunProjectSuggestions = () => {
  const { t } = useAppTranslation()

  const handleProjectClick = (project: typeof FUN_PROJECTS[0]) => {
    vscode.postMessage({
      type: "sendMessage",
      text: project.prompt
    })
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-vscode-descriptionForeground mb-2">
        {t("welcome:noFolderNoHistory.orTryFunProject")}
      </p>
      <div className="flex flex-col gap-2">
        {FUN_PROJECTS.map(project => (
          <Button
            key={project.id}
            onClick={() => handleProjectClick(project)}
            variant="secondary"
            className="w-full justify-start text-sm">
            <span className="mr-2">{project.icon}</span>
            {t(`welcome:noFolderNoHistory.projects.${project.id}`)}
          </Button>
        ))}
      </div>
    </div>
  )
}
```

#### 5.2 Contextual Prompts Component

**New File**: `webview-ui/src/components/welcome/components/ContextualPrompts.tsx`

```typescript
export const ContextualPrompts = () => {
  const { t } = useAppTranslation()
  const [hasOpenFile, setHasOpenFile] = useState(false)
  const [hasSelectedCode, setHasSelectedCode] = useState(false)

  useEffect(() => {
    // Check editor state
    vscode.postMessage({ type: "checkEditorState" })

    // Listen for editor state updates
    const handler = (event: MessageEvent) => {
      const message = event.data
      if (message.type === "editorState") {
        setHasOpenFile(message.hasOpenFile)
        setHasSelectedCode(message.hasSelectedCode)
      }
    }

    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  const handlePromptClick = (prompt: string) => {
    vscode.postMessage({
      type: "sendMessage",
      text: prompt
    })
  }

  const prompts = [
    {
      text: t("welcome:folderNoHistory.prompts.explainStructure"),
      icon: <FileTree className="size-4" />,
      condition: true
    },
    {
      text: t("welcome:folderNoHistory.prompts.findBugs"),
      icon: <Bug className="size-4" />,
      condition: hasOpenFile
    },
    {
      text: t("welcome:folderNoHistory.prompts.writeTests"),
      icon: <TestTube className="size-4" />,
      condition: hasSelectedCode
    },
    {
      text: t("welcome:folderNoHistory.prompts.improveCode"),
      icon: <Sparkles className="size-4" />,
      condition: true
    },
    {
      text: t("welcome:folderNoHistory.prompts.addDocumentation"),
      icon: <FileText className="size-4" />,
      condition: true
    },
  ].filter(p => p.condition)

  return (
    <div className="flex flex-col gap-2">
      {prompts.map((prompt, index) => (
        <Button
          key={index}
          onClick={() => handlePromptClick(prompt.text)}
          variant="secondary"
          className="w-full justify-start">
          {prompt.icon}
          {prompt.text}
        </Button>
      ))}
    </div>
  )
}
```

### Phase 6: Main Component Integration (Week 6)

#### 6.1 Update WelcomeViewProvider

**File**: `webview-ui/src/components/welcome/WelcomeViewProvider.tsx`

```typescript
const WelcomeViewProvider = () => {
  const { apiConfiguration, cloudIsAuthenticated } = useExtensionState()
  const [hasOpenFolder, setHasOpenFolder] = useState<boolean>(false)
  const [hasSessionHistory, setHasSessionHistory] = useState<boolean>(false)
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false)
  const [rateLimitResetTime, setRateLimitResetTime] = useState<number | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption | null>(null)
  const [authInProgress, setAuthInProgress] = useState(false)

  // Check workspace state on mount
  useEffect(() => {
    vscode.postMessage({ type: "checkWorkspaceState" })
    vscode.postMessage({ type: "checkRateLimit" })
  }, [])

  // Listen for state updates
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data

      switch (message.type) {
        case "workspaceState":
          setHasOpenFolder(message.hasFolder)
          setHasSessionHistory(message.hasHistory)
          break

        case "rateLimitStatus":
          setIsRateLimited(message.isLimited)
          setRateLimitResetTime(message.resetTime)
          break

        case "modelType":
          if (message.isPaid && !cloudIsAuthenticated) {
            // Show paid model screen
            setSelectedProvider(message.supportsKiloGateway ? "roo" : "custom")
          }
          break
      }
    }

    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [cloudIsAuthenticated])

  // Render appropriate screen based on state
  if (authInProgress) {
    return <WaitingForAuthScreen onGoBack={handleGoBack} />
  }

  // Show rate limit notification in chat if limited
  if (isRateLimited && hasSessionHistory) {
    // This will be handled in ChatView component
    return null
  }

  // Initial load - no folder, no history
  if (!hasOpenFolder && !hasSessionHistory) {
    return <NoFolderNoHistoryScreen />
  }

  // Has folder but no history
  if (hasOpenFolder && !hasSessionHistory) {
    return <FolderNoHistoryScreen />
  }

  // Has session history - show normal chat
  if (hasSessionHistory) {
    return null // ChatView will be shown
  }

  // Provider selection flow (existing logic)
  if (selectedProvider === null) {
    return <LandingScreen onGetStarted={handleGetStarted} onNoAccount={handleNoAccount} />
  }

  return (
    <ProviderSelectionScreen
      selectedProvider={selectedProvider}
      onProviderChange={setSelectedProvider}
      onBack={handleBackToLanding}
      onFinish={handleGetStarted}
    />
  )
}
```

#### 6.2 Integrate Rate Limit Notification in Chat

**File**: `webview-ui/src/components/chat/ChatView.tsx`

Add at the top of the chat interface:

```typescript
const ChatView = () => {
  const { isRateLimited, rateLimitResetTime } = useExtensionState()

  return (
    <div className="flex flex-col h-full">
      {isRateLimited && rateLimitResetTime && (
        <RateLimitNotification resetTime={rateLimitResetTime} />
      )}

      {/* Rest of chat UI */}
    </div>
  )
}
```

### Phase 7: Translation Files (Week 7)

#### 7.1 Update English Translations

**File**: `webview-ui/src/i18n/locales/en/welcome.json`

Add new keys:

```json
{
	"noFolderNoHistory": {
		"heading": "Welcome to Kilo Code!",
		"description": "To get started, open a folder or clone a repository. Or try out Kilo Code with a fun project!",
		"openFolder": "Open Folder",
		"cloneRepository": "Clone Repository",
		"orTryFunProject": "Or try a fun project:",
		"projects": {
			"snake": "Build a Snake Game",
			"todo": "Create a Todo App",
			"weather": "Make a Weather Dashboard"
		}
	},
	"folderNoHistory": {
		"heading": "Let's get started with your project!",
		"description": "Here are some things I can help you with:",
		"prompts": {
			"explainStructure": "Explain the structure of this project",
			"findBugs": "Find potential bugs in the current file",
			"writeTests": "Write tests for the selected code",
			"improveCode": "Suggest improvements for this code",
			"addDocumentation": "Add documentation to this project"
		}
	},
	"paidModel": {
		"withSubscription": {
			"heading": "This model requires a subscription",
			"description": "Subscribe to Kilo Code Gateway to get access to premium models with flexible pricing.",
			"subscribe": "Subscribe to Kilo Gateway",
			"useOwnKey": "or use your own API key"
		},
		"withoutSubscription": {
			"heading": "This model requires an API key",
			"description": "This model doesn't support Kilo Gateway subscriptions. You'll need to configure your own API key.",
			"configureProvider": "Configure Provider Settings",
			"orCreateAccount": "or create a Kilo account for other models"
		}
	},
	"rateLimit": {
		"heading": "You've reached your free usage limit",
		"description": "Create a Kilo Code account to continue using free models, or wait for your limit to reset.",
		"waitTime": "Your limit will reset in {{minutes}} minutes",
		"createAccount": "Create Kilo Account"
	}
}
```

#### 7.2 Update Other Locales

Repeat the same structure for all locale files:

- `webview-ui/src/i18n/locales/*/welcome.json`

### Phase 8: Message Protocol Updates (Week 8)

#### 8.1 Update Extension Message Types

**File**: `src/shared/ExtensionMessage.ts`

Add new message types:

```typescript
// From webview to extension
| { type: "openFolder" }
| { type: "showCloneDialog" }
| { type: "checkWorkspaceState" }
| { type: "checkEditorState" }
| { type: "checkRateLimit" }
| { type: "startFunProject"; projectType: string }

// From extension to webview
| { type: "workspaceState"; hasFolder: boolean; hasHistory: boolean }
| { type: "editorState"; hasOpenFile: boolean; hasSelectedCode: boolean }
| { type: "rateLimitStatus"; isLimited: boolean; resetTime: number | null }
| { type: "rateLimitReached"; resetTime: number }
```

#### 8.2 Implement Message Handlers

**File**: `src/core/webview/ClineProvider.ts`

```typescript
case "checkEditorState":
  const activeEditor = vscode.window.activeTextEditor
  const hasOpenFile = !!activeEditor
  const hasSelectedCode = !!(activeEditor && !activeEditor.selection.isEmpty)

  this.postMessageToWebview({
    type: "editorState",
    hasOpenFile,
    hasSelectedCode
  })
  break

case "startFunProject":
  // Get the prompt for the selected project type
  const projectPrompts = {
    snake: "Create a Snake game in HTML/CSS/JavaScript with arrow key controls",
    todo: "Build a Todo app with React and TypeScript, including add/delete/complete functionality",
    weather: "Make a Weather Dashboard using a weather API, showing current conditions and 5-day forecast"
  }

  const prompt = projectPrompts[message.projectType]
  if (prompt) {
    // Send the prompt as if user typed it
    this.postMessageToWebview({
      type: "sendMessage",
      text: prompt
    })
  }
  break
```

### Phase 9: Testing (Week 9)

#### 9.1 Unit Tests

**File**: `src/core/onboarding/__tests__/OnboardingStateDetector.spec.ts`

```typescript
describe("OnboardingStateDetector", () => {
	it("should detect open folder", async () => {
		// Test workspace folder detection
	})

	it("should detect session history", async () => {
		// Test session history detection
	})
})
```

**File**: `src/core/rate-limiting/__tests__/RateLimitMonitor.spec.ts`

```typescript
describe("RateLimitMonitor", () => {
	it("should track API calls", () => {
		// Test usage tracking
	})

	it("should detect rate limit", () => {
		// Test rate limit detection
	})

	it("should reset after time expires", () => {
		// Test automatic reset
	})
})
```

#### 9.2 Integration Tests

Test complete flows:

- New user with no folder → Open Folder → See contextual prompts
- New user with no folder → Clone Repository → Repository cloned
- New user with folder → See contextual prompts
- Existing user → See normal chat
- Select paid model → See appropriate screen
- Hit rate limit → See notification

#### 9.3 Manual Testing Checklist

- [ ] No folder, no history screen displays correctly
- [ ] Open Folder button triggers VSCode dialog
- [ ] Clone Repository button triggers git clone
- [ ] Fun project buttons send correct prompts
- [ ] Folder with no history shows contextual prompts
- [ ] Contextual prompts adapt to editor state
- [ ] Session history detection works
- [ ] Paid model selection shows correct screen
- [ ] Kilo Gateway vs custom provider distinction works
- [ ] Rate limit notification appears in chat
- [ ] Rate limit timer counts down correctly
- [ ] Create Account button works from rate limit notification

### Phase 10: Documentation (Week 10)

#### 10.1 Create Documentation Files

**File**: `docs/onboarding-flow.md`

```markdown
# Onboarding Flow

## Overview

The onboarding flow adapts based on user state...

## Screen Variations

1. No Folder, No History
2. Folder, No History
3. Session History Exists
4. Paid Model Selection
5. Rate Limit Notification

## State Detection

- Workspace folders
- Session history
- Model pricing
- Rate limits
```

**File**: `docs/rate-limiting.md`

```markdown
# Rate Limiting

## Free Model Limits

- 50 requests per hour for free models
- Applies to all users (authenticated and anonymous)
- Resets automatically after 1 hour

## User Experience

- In-chat notification when limit reached
- Timer showing reset time
- Option to create account
```

## Simplified File Structure

```
webview-ui/src/components/welcome/
├── WelcomeViewProvider.tsx (refactor)
├── screens/
│   ├── LandingScreen.tsx (extract)
│   ├── NoFolderNoHistoryScreen.tsx (new)
│   ├── FolderNoHistoryScreen.tsx (new)
│   ├── ProviderSelectionScreen.tsx (extract)
│   ├── PaidModelScreen.tsx (new)
│   └── WaitingForAuthScreen.tsx (extract)
└── components/
    ├── FunProjectSuggestions.tsx (new)
    └── ContextualPrompts.tsx (new)

src/core/onboarding/
├── OnboardingStateDetector.ts (new)
└── __tests__/
    └── OnboardingStateDetector.spec.ts (new)

src/core/rate-limiting/
├── RateLimitMonitor.ts (new)
└── __tests__/
    └── RateLimitMonitor.spec.ts (new)

webview-ui/src/components/chat/
└── RateLimitNotification.tsx (new)
```

## Key Simplifications from Original Plan

1. **No Custom Repository Cloner**: Use VSCode's built-in `git.clone` command
2. **No Workspace Reopening Logic**: VSCode handles this natively
3. **No AI-Powered Repo Search**: Skip description-based search for v1
4. **No Project Type Detection**: Use generic contextual prompts
5. **Simplified Model Detection**: Use existing models.json data
6. **Unified Rate Limiting**: Same limits for all free model users

## Implementation Timeline

### Week 1: Foundation

- Create OnboardingStateDetector
- Create RateLimitMonitor
- Add message handlers to ClineProvider
- Update ExtensionMessage types

### Week 2: Screen Components

- Extract existing screens into separate files
- Create NoFolderNoHistoryScreen
- Create FolderNoHistoryScreen
- Create PaidModelScreen

### Week 3: UI Components

- Create FunProjectSuggestions component
- Create ContextualPrompts component
- Create RateLimitNotification component

### Week 4: Integration

- Refactor WelcomeViewProvider with new routing logic
- Integrate rate limit notification in ChatView
- Wire up all message handlers

### Week 5: Translation

- Update all locale files with new keys
- Test translations in different languages

### Week 6: Testing

- Write unit tests
- Perform integration testing
- Manual testing of all flows

### Week 7: Polish & Documentation

- Code review and refinement
- Write documentation
- Final QA

**Total Estimated Time**: 7 weeks (reduced from 10)

## Success Criteria

- [x] All onboarding screens render correctly based on state
- [x] Open Folder functionality works (using native VSCode dialog)
- [x] Clone Repository works (using native git.clone command)
- [x] Fun project suggestions send correct prompts
- [x] Contextual prompts adapt to editor state
- [x] Paid model detection uses existing models.json
- [x] Kilo Gateway subscription flow works
- [x] Rate limiting tracks free model usage
- [x] Rate limit notification appears in chat
- [x] All text is properly translated
- [x] No regressions in existing onboarding flow
- [x] All tests pass
- [x] Documentation is complete

## Implementation Priority

### Must Have (v1)

1. No folder/no history screen with Open Folder button
2. Folder/no history screen with contextual prompts
3. Fun project suggestions
4. Rate limit notification in chat
5. Paid model detection and appropriate screen

### Nice to Have (v2)

1. AI-powered repository search by description
2. Automatic workspace reopening after clone
3. Project type detection for more specific prompts
4. Different rate limits for authenticated vs anonymous users
5. More sophisticated rate limit tracking (per-model, per-user)

## Notes

- Leveraging VSCode's native commands significantly simplifies implementation
- Using existing models.json eliminates need for separate model pricing API
- Generic contextual prompts work for any project type
- Unified rate limiting is simpler and easier to understand
- 7-week timeline is more realistic with simplified scope
