# Updated Onboarding Flow - Implementation Plan

## Overview

This document outlines the concrete implementation steps for the updated VSCode extension onboarding flow based on the product owner's specifications.

## Current State Analysis

### Existing Components

- **WelcomeViewProvider.tsx** - Main onboarding component with 3 states:
    1. Landing screen (selectedProvider === null)
    2. Provider selection screen (selectedProvider === "roo" or "custom")
    3. Waiting for cloud authentication (authInProgress === true)

### Current Flow

1. User sees landing screen with "Create Roo Account" button
2. User can click "or use without an account" to go to provider selection
3. Provider selection shows Roo Code Router vs 3rd-party provider options
4. Authentication flow for Roo Code Cloud

## New Requirements from Product Owner

### 1. Initial Load Variations

- **No open folder or session history**: Show Open Folder, Clone Repository, and fun project options
- **Open folder but no session history**: Show contextual content and prompts
- **Session history exists**: Show usual screen with optional sign-in link

### 2. Paid Model Selection Flow

- **Paid model without subscription**: Prompt to create account or go to provider settings
- **Paid model with subscription**: Different flow for supported models

### 3. Rate Limit Handling

- **Anonymous rate limit**: In-chat notification to login or wait

## Implementation Plan

### Phase 1: State Management & Detection (Week 1)

#### 1.1 Add New State Variables

**File**: `webview-ui/src/components/welcome/WelcomeViewProvider.tsx`

Add state for:

```typescript
const [hasOpenFolder, setHasOpenFolder] = useState<boolean>(false)
const [hasSessionHistory, setHasSessionHistory] = useState<boolean>(false)
const [selectedModelType, setSelectedModelType] = useState<"free" | "paid" | null>(null)
const [hasSubscription, setHasSubscription] = useState<boolean>(false)
const [isRateLimited, setIsRateLimited] = useState<boolean>(false)
```

#### 1.2 Create Detection Logic

**New File**: `src/core/onboarding/OnboardingStateDetector.ts`

Implement:

- `detectOpenFolder()`: Check if workspace has folders
- `detectSessionHistory()`: Check if user has previous chat sessions
- `detectModelType()`: Determine if selected model is free or paid
- `detectSubscription()`: Check if user has active subscription
- `detectRateLimit()`: Monitor API usage and detect rate limiting

#### 1.3 Add Message Handlers

**File**: `src/core/webview/ClineProvider.ts`

Add handlers for:

- `checkWorkspaceState`: Returns folder and session history status
- `checkModelType`: Returns model pricing information
- `checkSubscriptionStatus`: Returns subscription status
- `checkRateLimit`: Returns current rate limit status

### Phase 2: New Screen Components (Week 2)

#### 2.1 No Folder/No History Screen

**New File**: `webview-ui/src/components/welcome/NoFolderNoHistoryScreen.tsx`

Components:

- Hero section with welcome message
- Primary actions:
    - "Open Folder" button (highlighted)
    - "Clone Repository" button (highlighted)
- Secondary actions:
    - Fun project suggestions (e.g., "Build a Snake Game", "Create a Todo App")

#### 2.2 Folder But No History Screen

**New File**: `webview-ui/src/components/welcome/FolderNoHistoryScreen.tsx`

Components:

- Contextual welcome based on detected project type
- Suggested prompts relevant to the project:
    - "Explain this codebase"
    - "Find potential bugs"
    - "Add tests to untested files"
    - "Improve documentation"

#### 2.3 Paid Model Selection Screens

**New File**: `webview-ui/src/components/welcome/PaidModelScreen.tsx`

Two variations:

- **Without subscription support**:
    - Primary: "Create Account" button
    - Secondary: "Configure Provider Settings" link
- **With subscription support**:
    - Subscription signup flow
    - Payment information

#### 2.4 Rate Limit Notification

**New File**: `webview-ui/src/components/chat/RateLimitNotification.tsx`

In-chat notification component:

- Message: "You've reached your free usage limit"
- Actions:
    - "Create Account" button
    - "Wait X minutes" message

### Phase 3: Folder & Repository Operations (Week 3)

#### 3.1 Open Folder Functionality

**File**: `src/core/webview/ClineProvider.ts`

Add message handler:

```typescript
case "openFolder":
  // Trigger VSCode's open folder dialog
  vscode.commands.executeCommand("vscode.openFolder")
  break
```

#### 3.2 Clone Repository Functionality

**New File**: `src/core/git/RepositoryCloner.ts`

Implement:

- `cloneRepository(url: string, targetPath: string)`: Clone git repository
- `findRepository(description: string)`: Search for repository by description (using GitHub API)
- `promptForCloneDetails()`: Show dialog for URL/description and target folder

**File**: `src/core/webview/ClineProvider.ts`

Add message handlers:

```typescript
case "cloneRepository":
  // Show clone dialog and handle cloning
  await RepositoryCloner.promptForCloneDetails()
  break

case "reopenWorkspace":
  // Reopen VSCode in the cloned folder
  vscode.commands.executeCommand("vscode.openFolder", Uri.file(clonedPath))
  break
```

### Phase 4: Model & Subscription Detection (Week 4)

#### 4.1 Model Type Detection

**New File**: `src/core/models/ModelTypeDetector.ts`

Implement:

- `isModelPaid(modelId: string)`: Check if model requires payment
- `hasSubscriptionSupport(modelId: string)`: Check if model has subscription option
- `getModelPricingInfo(modelId: string)`: Get pricing details

#### 4.2 Subscription Status

**File**: `src/services/kilocode/OrganizationService.ts`

Add methods:

- `checkSubscriptionStatus()`: Query user's subscription status
- `getSubscriptionDetails()`: Get subscription plan details

#### 4.3 Model Selection Hook

**New File**: `webview-ui/src/hooks/useModelSelection.ts`

Custom hook to:

- Monitor model selection changes
- Trigger appropriate onboarding screen
- Handle model-specific authentication

### Phase 5: Rate Limiting (Week 5)

#### 5.1 Rate Limit Detection

**New File**: `src/core/rate-limiting/RateLimitMonitor.ts`

Implement:

- `monitorApiUsage()`: Track API calls
- `checkRateLimit()`: Determine if user is rate limited
- `getRateLimitResetTime()`: Calculate when limit resets

#### 5.2 Rate Limit Notification

**File**: `webview-ui/src/components/chat/ChatView.tsx`

Add:

- Rate limit notification component
- Conditional rendering based on rate limit status
- Actions for account creation or waiting

### Phase 6: UI Components & Styling (Week 6)

#### 6.1 New Button Components

**Files to modify**:

- `webview-ui/src/components/ui/Button.tsx` - Add new button variants if needed

#### 6.2 Dialog Components

**New File**: `webview-ui/src/components/dialogs/CloneRepositoryDialog.tsx`

Implement:

- URL input field
- Description input field (with AI-powered search)
- Target folder selection
- Clone progress indicator

#### 6.3 Contextual Prompt Suggestions

**New File**: `webview-ui/src/components/welcome/ContextualPrompts.tsx`

Implement:

- Project type detection
- Relevant prompt suggestions
- Quick action buttons

### Phase 7: Translation & Localization (Week 7)

#### 7.1 Update Translation Files

**Files to update**: All locale files in `webview-ui/src/i18n/locales/*/welcome.json`

Add keys for:

- `noFolderNoHistory.heading`
- `noFolderNoHistory.openFolder`
- `noFolderNoHistory.cloneRepository`
- `noFolderNoHistory.funProjects`
- `folderNoHistory.heading`
- `folderNoHistory.contextualPrompts`
- `paidModel.withoutSubscription.heading`
- `paidModel.withoutSubscription.createAccount`
- `paidModel.withoutSubscription.providerSettings`
- `paidModel.withSubscription.heading`
- `rateLimit.heading`
- `rateLimit.createAccount`
- `rateLimit.waitTime`

### Phase 8: Integration & Flow Control (Week 8)

#### 8.1 Update Main Onboarding Component

**File**: `webview-ui/src/components/welcome/WelcomeViewProvider.tsx`

Refactor to support:

- Multiple screen variations based on state
- Conditional rendering logic
- Navigation between screens

#### 8.2 Add Routing Logic

Implement screen selection based on:

```typescript
if (!hasOpenFolder && !hasSessionHistory) {
  return <NoFolderNoHistoryScreen />
} else if (hasOpenFolder && !hasSessionHistory) {
  return <FolderNoHistoryScreen />
} else if (hasSessionHistory) {
  return <MainChatView />
} else if (selectedModelType === 'paid') {
  if (hasSubscription) {
    return <PaidModelWithSubscriptionScreen />
  } else {
    return <PaidModelWithoutSubscriptionScreen />
  }
}
```

### Phase 9: Testing (Week 9)

#### 9.1 Unit Tests

Create test files:

- `OnboardingStateDetector.spec.ts`
- `ModelTypeDetector.spec.ts`
- `RateLimitMonitor.spec.ts`
- `RepositoryCloner.spec.ts`

#### 9.2 Integration Tests

Test complete flows:

- New user with no folder
- New user with open folder
- Existing user with history
- Paid model selection flows
- Rate limit scenarios

#### 9.3 E2E Tests

Test user journeys:

- Complete onboarding from scratch
- Clone repository flow
- Model selection and authentication
- Rate limit recovery

### Phase 10: Documentation & Polish (Week 10)

#### 10.1 Update Documentation

**Files to create/update**:

- `docs/onboarding-flow.md` - Complete flow documentation
- `docs/repository-cloning.md` - Clone feature documentation
- `docs/rate-limiting.md` - Rate limit handling documentation

#### 10.2 Code Review & Refinement

- Review all new code
- Optimize performance
- Ensure accessibility
- Polish UI/UX

## Technical Details

### State Management Structure

```typescript
interface OnboardingState {
	// Workspace state
	hasOpenFolder: boolean
	hasSessionHistory: boolean

	// Model state
	selectedModelType: "free" | "paid" | null
	hasSubscription: boolean

	// Auth state
	isAuthenticated: boolean
	authInProgress: boolean

	// Rate limiting
	isRateLimited: boolean
	rateLimitResetTime: number | null

	// UI state
	currentScreen: OnboardingScreen
	showManualEntry: boolean
}

type OnboardingScreen =
	| "landing"
	| "noFolderNoHistory"
	| "folderNoHistory"
	| "providerSelection"
	| "paidModelWithoutSub"
	| "paidModelWithSub"
	| "waitingForAuth"
```

### Message Protocol Extensions

New message types to add to `src/shared/ExtensionMessage.ts`:

```typescript
// From webview to extension
| { type: "openFolder" }
| { type: "cloneRepository"; url?: string; description?: string }
| { type: "checkWorkspaceState" }
| { type: "checkModelType"; modelId: string }
| { type: "checkSubscriptionStatus" }
| { type: "checkRateLimit" }

// From extension to webview
| { type: "workspaceState"; hasFolder: boolean; hasHistory: boolean }
| { type: "modelType"; isPaid: boolean; hasSubscription: boolean }
| { type: "subscriptionStatus"; isActive: boolean; plan: string }
| { type: "rateLimitStatus"; isLimited: boolean; resetTime: number }
```

### Component Hierarchy

```
WelcomeViewProvider (main container)
├── LandingScreen (current, minimal changes)
├── NoFolderNoHistoryScreen (new)
│   ├── OpenFolderButton
│   ├── CloneRepositoryButton
│   └── FunProjectSuggestions
├── FolderNoHistoryScreen (new)
│   ├── ContextualWelcome
│   └── ContextualPrompts
├── ProviderSelectionScreen (current, minor updates)
├── PaidModelWithoutSubscriptionScreen (new)
│   ├── CreateAccountButton
│   └── ProviderSettingsLink
├── PaidModelWithSubscriptionScreen (new)
│   └── SubscriptionSignupFlow
└── WaitingForAuthScreen (current, minor updates)

ChatView (separate component)
└── RateLimitNotification (new, conditional)
```

### File Structure

```
webview-ui/src/components/welcome/
├── WelcomeViewProvider.tsx (modify)
├── screens/
│   ├── LandingScreen.tsx (extract from WelcomeViewProvider)
│   ├── NoFolderNoHistoryScreen.tsx (new)
│   ├── FolderNoHistoryScreen.tsx (new)
│   ├── ProviderSelectionScreen.tsx (extract from WelcomeViewProvider)
│   ├── PaidModelScreen.tsx (new)
│   └── WaitingForAuthScreen.tsx (extract from WelcomeViewProvider)
├── components/
│   ├── OpenFolderButton.tsx (new)
│   ├── CloneRepositoryButton.tsx (new)
│   ├── FunProjectSuggestions.tsx (new)
│   └── ContextualPrompts.tsx (new)
└── hooks/
    └── useOnboardingState.ts (new)

src/core/onboarding/
├── OnboardingStateDetector.ts (new)
├── ModelTypeDetector.ts (new)
└── RateLimitMonitor.ts (new)

src/core/git/
└── RepositoryCloner.ts (new)

webview-ui/src/components/chat/
└── RateLimitNotification.tsx (new)
```

## Implementation Steps (Detailed)

### Step 1: Create State Detection Service

**File**: `src/core/onboarding/OnboardingStateDetector.ts`

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
		const history = await this.getSessionHistory()
		const hasSessionHistory = history && history.length > 0

		return { hasOpenFolder, hasSessionHistory }
	}

	private static async getSessionHistory() {
		// Query extension state for previous sessions
		// Implementation depends on how sessions are stored
	}
}
```

### Step 2: Extract Current Screens into Separate Components

#### 2.1 Extract Landing Screen

**New File**: `webview-ui/src/components/welcome/screens/LandingScreen.tsx`

Move current landing screen JSX from WelcomeViewProvider into this component.

#### 2.2 Extract Provider Selection Screen

**New File**: `webview-ui/src/components/welcome/screens/ProviderSelectionScreen.tsx`

Move provider selection JSX from WelcomeViewProvider into this component.

#### 2.3 Extract Waiting Screen

**New File**: `webview-ui/src/components/welcome/screens/WaitingForAuthScreen.tsx`

Move waiting for auth JSX from WelcomeViewProvider into this component.

### Step 3: Create New Screen Components

#### 3.1 No Folder/No History Screen

**New File**: `webview-ui/src/components/welcome/screens/NoFolderNoHistoryScreen.tsx`

```typescript
export const NoFolderNoHistoryScreen = () => {
  const { t } = useAppTranslation()

  const handleOpenFolder = () => {
    vscode.postMessage({ type: "openFolder" })
  }

  const handleCloneRepository = () => {
    vscode.postMessage({ type: "cloneRepository" })
  }

  return (
    <Tab>
      <TabContent className="flex flex-col gap-4 p-6">
        <RooHero />
        <h2>{t("welcome:noFolderNoHistory.heading")}</h2>

        {/* Primary Actions - Highlighted */}
        <div className="flex gap-2">
          <Button onClick={handleOpenFolder} variant="primary">
            {t("welcome:noFolderNoHistory.openFolder")}
          </Button>
          <Button onClick={handleCloneRepository} variant="primary">
            {t("welcome:noFolderNoHistory.cloneRepository")}
          </Button>
        </div>

        {/* Secondary Actions - Fun Projects */}
        <FunProjectSuggestions />
      </TabContent>
    </Tab>
  )
}
```

#### 3.2 Folder But No History Screen

**New File**: `webview-ui/src/components/welcome/screens/FolderNoHistoryScreen.tsx`

```typescript
export const FolderNoHistoryScreen = () => {
  const { t } = useAppTranslation()
  const { projectType } = useProjectDetection()

  return (
    <Tab>
      <TabContent className="flex flex-col gap-4 p-6">
        <RooHero />
        <h2>{t(`welcome:folderNoHistory.${projectType}.heading`)}</h2>

        <ContextualPrompts projectType={projectType} />
      </TabContent>
    </Tab>
  )
}
```

### Step 4: Implement Repository Cloning

#### 4.1 Repository Cloner Service

**New File**: `src/core/git/RepositoryCloner.ts`

```typescript
export class RepositoryCloner {
	static async promptForCloneDetails(): Promise<void> {
		// Show input dialog
		const input = await vscode.window.showInputBox({
			prompt: "Enter repository URL or description",
			placeHolder: "https://github.com/user/repo or 'React todo app'",
		})

		if (!input) return

		// Determine if input is URL or description
		const isUrl = input.includes("://")

		if (isUrl) {
			await this.cloneFromUrl(input)
		} else {
			await this.cloneFromDescription(input)
		}
	}

	private static async cloneFromUrl(url: string): Promise<void> {
		// Select target folder
		const targetUri = await vscode.window.showOpenDialog({
			canSelectFolders: true,
			canSelectFiles: false,
			canSelectMany: false,
			openLabel: "Select Clone Location",
		})

		if (!targetUri || targetUri.length === 0) return

		// Execute git clone
		await vscode.commands.executeCommand("git.clone", url, targetUri[0].fsPath)

		// Ask if user wants to reopen workspace
		const reopen = await vscode.window.showInformationMessage(
			"Repository cloned successfully. Open in new window?",
			"Yes",
			"No",
		)

		if (reopen === "Yes") {
			await vscode.commands.executeCommand(
				"vscode.openFolder",
				vscode.Uri.file(path.join(targetUri[0].fsPath, this.getRepoName(url))),
			)
		}
	}

	private static async cloneFromDescription(description: string): Promise<void> {
		// Use AI or GitHub API to search for repository
		const results = await this.searchRepositories(description)

		// Show quick pick with results
		const selected = await vscode.window.showQuickPick(
			results.map((r) => ({
				label: r.name,
				description: r.description,
				detail: r.url,
			})),
			{ placeHolder: "Select a repository" },
		)

		if (selected) {
			await this.cloneFromUrl(selected.detail)
		}
	}

	private static async searchRepositories(query: string) {
		// Implement GitHub API search or use AI to find relevant repos
	}
}
```

### Step 5: Implement Model Selection Detection

#### 5.1 Model Type Detector

**New File**: `src/core/models/ModelTypeDetector.ts`

```typescript
export class ModelTypeDetector {
	private static paidModels = new Set([
		"anthropic/claude-3-opus",
		"openai/gpt-4",
		// ... other paid models
	])

	private static subscriptionSupportedModels = new Set([
		"anthropic/claude-3-opus",
		"anthropic/claude-3-sonnet",
		// ... models with subscription support
	])

	static isModelPaid(modelId: string): boolean {
		return this.paidModels.has(modelId)
	}

	static hasSubscriptionSupport(modelId: string): boolean {
		return this.subscriptionSupportedModels.has(modelId)
	}

	static async onModelSelected(modelId: string): Promise<void> {
		if (this.isModelPaid(modelId)) {
			// Trigger paid model flow
			vscode.postMessage({
				type: "showPaidModelScreen",
				hasSubscription: this.hasSubscriptionSupport(modelId),
			})
		}
	}
}
```

### Step 6: Implement Rate Limiting

#### 6.1 Rate Limit Monitor

**New File**: `src/core/rate-limiting/RateLimitMonitor.ts`

```typescript
export class RateLimitMonitor {
	private static usageCount = 0
	private static resetTime: number | null = null
	private static readonly FREE_LIMIT = 100 // requests per hour

	static trackApiCall(): void {
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

#### 6.2 Rate Limit Notification Component

**New File**: `webview-ui/src/components/chat/RateLimitNotification.tsx`

```typescript
export const RateLimitNotification = ({ resetTime }: { resetTime: number }) => {
  const { t } = useAppTranslation()
  const [timeRemaining, setTimeRemaining] = useState("")

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, resetTime - Date.now())
      const minutes = Math.floor(remaining / 60000)
      setTimeRemaining(`${minutes} minutes`)
    }, 1000)

    return () => clearInterval(interval)
  }, [resetTime])

  return (
    <div className="bg-vscode-notifications-background p-4 rounded">
      <p className="font-semibold">{t("welcome:rateLimit.heading")}</p>
      <p>{t("welcome:rateLimit.message", { time: timeRemaining })}</p>
      <div className="flex gap-2 mt-2">
        <Button onClick={handleCreateAccount} variant="primary">
          {t("welcome:rateLimit.createAccount")}
        </Button>
      </div>
    </div>
  )
}
```

## Questions for Product Owner

1. **Open Folder Button**: Should this trigger VSCode's native folder picker, or do we need a custom implementation?
   native

2. **Clone Repository - Description Search**: Should we use:
    - GitHub API to search public repositories?
    - AI model to interpret description and suggest repos?
    - Both options?

Lets just skip this for the first version.

3. **Workspace Reopening**: After cloning, should we:
    - Always ask user if they want to reopen?
    - Automatically reopen in new window?
    - Provide option in settings?

and then also this

4. **Contextual Prompts**: How should we detect project type? Based on:

    - File extensions?
    - Package.json/requirements.txt/etc?
    - Folder structure?

    no generic prompts appropriate for a project, like:

    - explain the structure of this project
    - find potential bugs in the current file (if there is a file open)
    - write tests for the selected code (if code is selected)
    - make sure to add more of these

5. **Rate Limit Values**: What are the exact limits for:

    - Anonymous users?
    - Authenticated free users?
    - Paid users?

    all use of free models is rate limited, for both authenticated and non-authenticate, paying, non-paying

6. **Paid Model Detection**: Should we maintain a hardcoded list of paid models, or query this from an API?

    we already have this information because we retrieved the models.json before you can choose the model

7. **Subscription Support**: Which models exactly support subscriptions through Roo Code Cloud?

no man, kilo gateway is what we are talking about. you pay kilo, and you get free model choice

8. **Fun Project Suggestions**: What specific projects should we suggest? Examples:
    - "Build a Snake Game"
    - "Create a Todo App"
    - "Make a Weather Dashboard"
    - Others?

Seems fine for now

## Timeline

- **Week 1**: State management & detection logic
- **Week 2**: New screen components
- **Week 3**: Folder & repository operations
- **Week 4**: Model & subscription detection
- **Week 5**: Rate limiting implementation
- **Week 6**: UI components & styling
- **Week 7**: Translation & localization
- **Week 8**: Integration & flow control
- **Week 9**: Testing
- **Week 10**: Documentation & polish

**Total Estimated Time**: 10 weeks

## Success Criteria

- [ ] All onboarding screens render correctly based on state
- [ ] Open Folder functionality works seamlessly
- [ ] Clone Repository handles both URL and description inputs
- [ ] Workspace reopens correctly after cloning
- [ ] Paid model detection triggers appropriate screens
- [ ] Rate limiting is detected and handled gracefully
- [ ] All text is properly translated
- [ ] No regressions in existing onboarding flow
- [ ] All tests pass
- [ ] Documentation is complete

## Notes

- The current implementation already has a good foundation with the 3-screen flow
- Main work is adding conditional logic and new screen variations
- Repository cloning is the most complex new feature
- Rate limiting needs careful consideration for UX
- Translation files need significant updates across all locales
