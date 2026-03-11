/**
 * Zod schemas for extension <-> webview message communication.
 * All TypeScript types in messages.ts are derived from these schemas.
 * Zod validates/parses at the IO boundary (vscode.tsx) instead of casting.
 */

import { z } from "zod"

// ============================================
// Shared enums and primitives
// ============================================

export const connectionState = z.enum(["connecting", "connected", "disconnected", "error"])

export const sessionStatus = z.enum(["idle", "busy", "retry"])

export const sessionStatusInfo = z.discriminatedUnion("type", [
  z.object({ type: z.literal("idle") }),
  z.object({ type: z.literal("busy") }),
  z.object({ type: z.literal("retry"), attempt: z.number(), message: z.string(), next: z.number() }),
])

const recordStringUnknown = z.record(z.string(), z.unknown())

export const toolState = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), input: recordStringUnknown }),
  z.object({ status: z.literal("running"), input: recordStringUnknown, title: z.string().optional() }),
  z.object({ status: z.literal("completed"), input: recordStringUnknown, output: z.string(), title: z.string() }),
  z.object({ status: z.literal("error"), input: recordStringUnknown, error: z.string() }),
])

// ============================================
// Part schemas
// ============================================

const basePart = z.object({
  id: z.string(),
  sessionID: z.string().optional(),
  messageID: z.string().optional(),
})

export const textPart = basePart.extend({ type: z.literal("text"), text: z.string() })
export const toolPart = basePart.extend({ type: z.literal("tool"), tool: z.string(), state: toolState })
export const reasoningPart = basePart.extend({ type: z.literal("reasoning"), text: z.string() })
export const stepStartPart = basePart.extend({ type: z.literal("step-start") })
export const stepFinishPart = basePart.extend({
  type: z.literal("step-finish"),
  reason: z.string().optional(),
  cost: z.number().optional(),
  tokens: z
    .object({
      input: z.number(),
      output: z.number(),
      reasoning: z.number().optional(),
      cache: z.object({ read: z.number(), write: z.number() }).optional(),
    })
    .optional(),
})

export const part = z.discriminatedUnion("type", [textPart, toolPart, reasoningPart, stepStartPart, stepFinishPart])

export const partDelta = z.object({
  type: z.literal("text-delta"),
  textDelta: z.string().optional(),
})

// ============================================
// Token / context usage
// ============================================

export const tokenUsage = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number().optional(),
  cache: z.object({ read: z.number(), write: z.number() }).optional(),
})

export const contextUsage = z.object({
  tokens: z.number(),
  percentage: z.number().nullable(),
})

// ============================================
// Message / Session
// ============================================

export const message = z.object({
  id: z.string(),
  sessionID: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string().optional(),
  parts: z.array(part).optional(),
  createdAt: z.string(),
  time: z.object({ created: z.number(), completed: z.number().optional() }).optional(),
  agent: z.string().optional(),
  model: z.object({ providerID: z.string(), modelID: z.string() }).optional(),
  providerID: z.string().optional(),
  modelID: z.string().optional(),
  mode: z.string().optional(),
  parentID: z.string().optional(),
  path: z.object({ cwd: z.string(), root: z.string() }).optional(),
  error: z.object({ name: z.string(), data: recordStringUnknown.optional() }).optional(),
  summary: z
    .union([
      z.object({ title: z.string().optional(), body: z.string().optional(), diffs: z.array(z.unknown()).optional() }),
      z.boolean(),
    ])
    .optional(),
  cost: z.number().optional(),
  tokens: tokenUsage.optional(),
})

export const sessionInfo = z.object({
  id: z.string(),
  title: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const cloudSessionInfo = z.object({
  session_id: z.string(),
  title: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

// ============================================
// Permission / Todo / Question
// ============================================

export const permissionRequest = z.object({
  id: z.string(),
  sessionID: z.string(),
  toolName: z.string(),
  patterns: z.array(z.string()),
  args: recordStringUnknown,
  message: z.string().optional(),
  tool: z.object({ messageID: z.string(), callID: z.string() }).optional(),
})

export const todoItem = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
})

export const questionOption = z.object({
  label: z.string(),
  description: z.string(),
})

export const questionInfo = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(questionOption),
  multiple: z.boolean().optional(),
  custom: z.boolean().optional(),
})

export const questionRequest = z.object({
  id: z.string(),
  sessionID: z.string(),
  questions: z.array(questionInfo),
  tool: z.object({ messageID: z.string(), callID: z.string() }).optional(),
})

// ============================================
// Agent / Server / Auth
// ============================================

export const agentInfo = z.object({
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  native: z.boolean().optional(),
  hidden: z.boolean().optional(),
  color: z.string().optional(),
})

export const serverInfo = z.object({
  port: z.number(),
  version: z.string().optional(),
})

export const deviceAuthStatus = z.enum(["idle", "initiating", "pending", "success", "error", "cancelled"])

export const deviceAuthState = z.object({
  status: deviceAuthStatus,
  code: z.string().optional(),
  verificationUrl: z.string().optional(),
  expiresIn: z.number().optional(),
  error: z.string().optional(),
})

// ============================================
// Notifications
// ============================================

export const kilocodeNotificationAction = z.object({
  actionText: z.string(),
  actionURL: z.string(),
})

export const kilocodeNotification = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  action: kilocodeNotificationAction.optional(),
  showIn: z.array(z.string()).optional(),
})

// ============================================
// Profile
// ============================================

export const kilocodeBalance = z.object({ balance: z.number() })

export const profileData = z.object({
  profile: z.object({
    email: z.string(),
    name: z.string().optional(),
    organizations: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })).optional(),
  }),
  balance: kilocodeBalance.nullable(),
  currentOrgId: z.string().nullable(),
})

// ============================================
// Provider / Model
// ============================================

export const providerModel = z.object({
  id: z.string(),
  name: z.string(),
  inputPrice: z.number().optional(),
  outputPrice: z.number().optional(),
  contextLength: z.number().optional(),
  releaseDate: z.string().optional(),
  latest: z.boolean().optional(),
  limit: z.object({ context: z.number(), input: z.number().optional(), output: z.number() }).optional(),
  variants: z.record(z.string(), recordStringUnknown).optional(),
  capabilities: z.object({ reasoning: z.boolean() }).optional(),
})

export const provider = z.object({
  id: z.string(),
  name: z.string(),
  models: z.record(z.string(), providerModel),
})

export const modelSelection = z.object({
  providerID: z.string(),
  modelID: z.string(),
})

// ============================================
// Config types
// ============================================

export const permissionLevel = z.enum(["allow", "ask", "deny"])
export const permissionRule = z.union([permissionLevel, z.record(z.string(), permissionLevel)])
export const permissionConfig = z.record(z.string(), permissionRule).partial()

export const agentConfig = z.object({
  model: z.string().nullable().optional(),
  prompt: z.string().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  steps: z.number().optional(),
  permission: permissionConfig.optional(),
})

export const providerConfig = z.object({
  name: z.string().optional(),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  models: recordStringUnknown.optional(),
})

export const mcpConfig = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})

export const commandConfig = z.object({
  command: z.string(),
  description: z.string().optional(),
})

export const skillsConfig = z.object({
  paths: z.array(z.string()).optional(),
  urls: z.array(z.string()).optional(),
})

export const compactionConfig = z.object({
  auto: z.boolean().optional(),
  prune: z.boolean().optional(),
})

export const watcherConfig = z.object({
  ignore: z.array(z.string()).optional(),
})

export const experimentalConfig = z.object({
  disable_paste_summary: z.boolean().optional(),
  batch_tool: z.boolean().optional(),
  primary_tools: z.array(z.string()).optional(),
  continue_loop_on_deny: z.boolean().optional(),
  mcp_timeout: z.number().optional(),
})

export const config = z.object({
  permission: permissionConfig.optional(),
  model: z.string().nullable().optional(),
  small_model: z.string().nullable().optional(),
  default_agent: z.string().optional(),
  agent: z.record(z.string(), agentConfig).optional(),
  provider: z.record(z.string(), providerConfig).optional(),
  disabled_providers: z.array(z.string()).optional(),
  enabled_providers: z.array(z.string()).optional(),
  mcp: z.record(z.string(), mcpConfig).optional(),
  command: z.record(z.string(), commandConfig).optional(),
  instructions: z.array(z.string()).optional(),
  skills: skillsConfig.optional(),
  snapshot: z.boolean().optional(),
  share: z.enum(["manual", "auto", "disabled"]).optional(),
  username: z.string().optional(),
  watcher: watcherConfig.optional(),
  formatter: z.union([z.literal(false), recordStringUnknown]).optional(),
  lsp: z.union([z.literal(false), recordStringUnknown]).optional(),
  compaction: compactionConfig.optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  layout: z.enum(["auto", "stretch"]).optional(),
  experimental: experimentalConfig.optional(),
})

// ============================================
// Review comment
// ============================================

export const reviewComment = z.object({
  id: z.string(),
  file: z.string(),
  side: z.enum(["additions", "deletions"]),
  line: z.number(),
  comment: z.string(),
  selectedText: z.string(),
})

// ============================================
// Browser settings
// ============================================

export const browserSettings = z.object({
  enabled: z.boolean(),
  useSystemChrome: z.boolean(),
  headless: z.boolean(),
})

// ============================================
// Agent Manager types
// ============================================

export const sessionMode = z.enum(["local", "worktree"])

export const worktreeState = z.object({
  id: z.string(),
  branch: z.string(),
  path: z.string(),
  parentBranch: z.string(),
  remote: z.string().optional(),
  createdAt: z.string(),
  groupId: z.string().optional(),
  label: z.string().optional(),
})

export const managedSessionState = z.object({
  id: z.string(),
  worktreeId: z.string().nullable(),
  createdAt: z.string(),
})

export const worktreeFileDiff = z.object({
  file: z.string(),
  before: z.string(),
  after: z.string(),
  additions: z.number(),
  deletions: z.number(),
  status: z.enum(["added", "deleted", "modified"]).optional(),
})

export const applyWorktreeDiffStatus = z.enum(["checking", "applying", "success", "conflict", "error"])

export const applyWorktreeDiffConflict = z.object({
  file: z.string().optional(),
  reason: z.string(),
})

export const worktreeGitStats = z.object({
  worktreeId: z.string(),
  files: z.number(),
  additions: z.number(),
  deletions: z.number(),
  ahead: z.number(),
  behind: z.number(),
})

export const localGitStats = z.object({
  branch: z.string(),
  files: z.number(),
  additions: z.number(),
  deletions: z.number(),
  ahead: z.number(),
  behind: z.number(),
})

export const branchInfo = z.object({
  name: z.string(),
  isLocal: z.boolean(),
  isRemote: z.boolean(),
  isDefault: z.boolean(),
  lastCommitDate: z.string().optional(),
  isCheckedOut: z.boolean().optional(),
})

export const externalWorktreeInfo = z.object({
  path: z.string(),
  branch: z.string(),
})

export const fileAttachment = z.object({
  mime: z.string(),
  url: z.string(),
})

export const modelAllocation = z.object({
  providerID: z.string(),
  modelID: z.string(),
  count: z.number(),
})

// ============================================
// Legacy migration types
// ============================================

export const migrationProviderInfo = z.object({
  profileName: z.string(),
  provider: z.string(),
  model: z.string().optional(),
  hasApiKey: z.boolean(),
  supported: z.boolean(),
  newProviderName: z.string().optional(),
})

export const migrationMcpServerInfo = z.object({
  name: z.string(),
  type: z.string(),
})

export const migrationCustomModeInfo = z.object({
  name: z.string(),
  slug: z.string(),
})

export const legacyAutocompleteSettings = z.object({
  enableAutoTrigger: z.boolean().optional(),
  enableSmartInlineTaskKeybinding: z.boolean().optional(),
  enableChatAutocomplete: z.boolean().optional(),
})

export const legacySettings = z.object({
  autoApprovalEnabled: z.boolean().optional(),
  allowedCommands: z.array(z.string()).optional(),
  deniedCommands: z.array(z.string()).optional(),
  alwaysAllowReadOnly: z.boolean().optional(),
  alwaysAllowReadOnlyOutsideWorkspace: z.boolean().optional(),
  alwaysAllowWrite: z.boolean().optional(),
  alwaysAllowExecute: z.boolean().optional(),
  alwaysAllowMcp: z.boolean().optional(),
  alwaysAllowModeSwitch: z.boolean().optional(),
  alwaysAllowSubtasks: z.boolean().optional(),
  language: z.string().optional(),
  autocomplete: legacyAutocompleteSettings.optional(),
})

export const migrationResultItem = z.object({
  item: z.string(),
  category: z.enum(["provider", "mcpServer", "customMode", "defaultModel", "settings"]),
  status: z.enum(["success", "warning", "error"]),
  message: z.string().optional(),
})

export const migrationAutoApprovalSelections = z.object({
  commandRules: z.boolean(),
  readPermission: z.boolean(),
  writePermission: z.boolean(),
  executePermission: z.boolean(),
  mcpPermission: z.boolean(),
  taskPermission: z.boolean(),
})

// ============================================
// Messages FROM extension TO webview
// ============================================

export const readyMessage = z.object({
  type: z.literal("ready"),
  serverInfo: serverInfo.optional(),
  extensionVersion: z.string().optional(),
  vscodeLanguage: z.string().optional(),
  languageOverride: z.string().optional(),
  workspaceDirectory: z.string().optional(),
})

export const workspaceDirectoryChangedMessage = z.object({
  type: z.literal("workspaceDirectoryChanged"),
  directory: z.string(),
})

export const connectionStateMessage = z.object({
  type: z.literal("connectionState"),
  state: connectionState,
  error: z.string().optional(),
})

export const errorMessage = z.object({
  type: z.literal("error"),
  message: z.string(),
  code: z.string().optional(),
  sessionID: z.string().optional(),
})

export const partUpdatedMessage = z.object({
  type: z.literal("partUpdated"),
  sessionID: z.string().optional(),
  messageID: z.string().optional(),
  part: part,
  delta: partDelta.optional(),
})

export const sessionStatusMessage = z.object({
  type: z.literal("sessionStatus"),
  sessionID: z.string(),
  status: sessionStatus,
  attempt: z.number().optional(),
  message: z.string().optional(),
  next: z.number().optional(),
})

export const permissionRequestMessage = z.object({
  type: z.literal("permissionRequest"),
  permission: permissionRequest,
})

export const permissionResolvedMessage = z.object({
  type: z.literal("permissionResolved"),
  permissionID: z.string(),
})

export const permissionErrorMessage = z.object({
  type: z.literal("permissionError"),
  permissionID: z.string(),
})

export const todoUpdatedMessage = z.object({
  type: z.literal("todoUpdated"),
  sessionID: z.string(),
  items: z.array(todoItem),
})

export const sessionCreatedMessage = z.object({
  type: z.literal("sessionCreated"),
  session: sessionInfo,
})

export const sessionUpdatedMessage = z.object({
  type: z.literal("sessionUpdated"),
  session: sessionInfo,
})

export const sessionDeletedMessage = z.object({
  type: z.literal("sessionDeleted"),
  sessionID: z.string(),
})

export const messagesLoadedMessage = z.object({
  type: z.literal("messagesLoaded"),
  sessionID: z.string(),
  messages: z.array(message),
})

export const messageCreatedMessage = z.object({
  type: z.literal("messageCreated"),
  message: message,
})

export const sessionsLoadedMessage = z.object({
  type: z.literal("sessionsLoaded"),
  sessions: z.array(sessionInfo),
})

export const cloudSessionsLoadedMessage = z.object({
  type: z.literal("cloudSessionsLoaded"),
  sessions: z.array(cloudSessionInfo),
  nextCursor: z.string().nullable(),
})

export const gitRemoteUrlLoadedMessage = z.object({
  type: z.literal("gitRemoteUrlLoaded"),
  gitUrl: z.string().nullable(),
})

export const cloudSessionDataLoadedMessage = z.object({
  type: z.literal("cloudSessionDataLoaded"),
  cloudSessionId: z.string(),
  title: z.string(),
  messages: z.array(message),
})

export const cloudSessionImportedMessage = z.object({
  type: z.literal("cloudSessionImported"),
  cloudSessionId: z.string(),
  session: sessionInfo,
})

export const cloudSessionImportFailedMessage = z.object({
  type: z.literal("cloudSessionImportFailed"),
  cloudSessionId: z.string(),
  error: z.string(),
})

export const openCloudSessionMessage = z.object({
  type: z.literal("openCloudSession"),
  sessionId: z.string(),
})

export const actionMessage = z.object({
  type: z.literal("action"),
  action: z.string(),
})

export const setChatBoxMessage = z.object({
  type: z.literal("setChatBoxMessage"),
  text: z.string(),
})

export const appendChatBoxMessage = z.object({
  type: z.literal("appendChatBoxMessage"),
  text: z.string(),
})

export const appendReviewCommentsMessage = z.object({
  type: z.literal("appendReviewComments"),
  comments: z.array(reviewComment),
})

export const triggerTaskMessage = z.object({
  type: z.literal("triggerTask"),
  text: z.string(),
})

export const profileDataMessage = z.object({
  type: z.literal("profileData"),
  data: profileData.nullable(),
})

export const deviceAuthStartedMessage = z.object({
  type: z.literal("deviceAuthStarted"),
  code: z.string().optional(),
  verificationUrl: z.string(),
  expiresIn: z.number(),
})

export const deviceAuthCompleteMessage = z.object({
  type: z.literal("deviceAuthComplete"),
})

export const deviceAuthFailedMessage = z.object({
  type: z.literal("deviceAuthFailed"),
  error: z.string(),
})

export const deviceAuthCancelledMessage = z.object({
  type: z.literal("deviceAuthCancelled"),
})

export const navigateMessage = z.object({
  type: z.literal("navigate"),
  view: z.enum([
    "newTask",
    "marketplace",
    "history",
    "cloudHistory",
    "profile",
    "settings",
    "migration",
    "subAgentViewer",
  ]),
})

export const providersLoadedMessage = z.object({
  type: z.literal("providersLoaded"),
  providers: z.record(z.string(), provider),
  connected: z.array(z.string()),
  defaults: z.record(z.string(), z.string()),
  defaultSelection: modelSelection,
})

export const agentsLoadedMessage = z.object({
  type: z.literal("agentsLoaded"),
  agents: z.array(agentInfo),
  defaultAgent: z.string(),
})

export const autocompleteSettingsLoadedMessage = z.object({
  type: z.literal("autocompleteSettingsLoaded"),
  settings: z.object({
    enableAutoTrigger: z.boolean(),
    enableSmartInlineTaskKeybinding: z.boolean(),
    enableChatAutocomplete: z.boolean(),
  }),
})

export const chatCompletionResultMessage = z.object({
  type: z.literal("chatCompletionResult"),
  text: z.string(),
  requestId: z.string(),
})

export const fileSearchResultMessage = z.object({
  type: z.literal("fileSearchResult"),
  paths: z.array(z.string()),
  dir: z.string(),
  requestId: z.string(),
})

export const questionRequestMessage = z.object({
  type: z.literal("questionRequest"),
  question: questionRequest,
})

export const questionResolvedMessage = z.object({
  type: z.literal("questionResolved"),
  requestID: z.string(),
})

export const questionErrorMessage = z.object({
  type: z.literal("questionError"),
  requestID: z.string(),
})

export const browserSettingsLoadedMessage = z.object({
  type: z.literal("browserSettingsLoaded"),
  settings: browserSettings,
})

export const configLoadedMessage = z.object({
  type: z.literal("configLoaded"),
  config: config,
})

export const configUpdatedMessage = z.object({
  type: z.literal("configUpdated"),
  config: config,
})

export const notificationSettingsLoadedMessage = z.object({
  type: z.literal("notificationSettingsLoaded"),
  settings: z.object({
    notifyAgent: z.boolean(),
    notifyPermissions: z.boolean(),
    notifyErrors: z.boolean(),
    soundAgent: z.string(),
    soundPermissions: z.string(),
    soundErrors: z.string(),
  }),
})

export const notificationsLoadedMessage = z.object({
  type: z.literal("notificationsLoaded"),
  notifications: z.array(kilocodeNotification),
  dismissedIds: z.array(z.string()),
})

export const agentManagerSessionMetaMessage = z.object({
  type: z.literal("agentManager.sessionMeta"),
  sessionId: z.string(),
  mode: sessionMode,
  branch: z.string().optional(),
  path: z.string().optional(),
  parentBranch: z.string().optional(),
})

export const agentManagerRepoInfoMessage = z.object({
  type: z.literal("agentManager.repoInfo"),
  branch: z.string(),
  defaultBranch: z.string().optional(),
})

export const agentManagerWorktreeSetupMessage = z.object({
  type: z.literal("agentManager.worktreeSetup"),
  status: z.enum(["creating", "starting", "ready", "error"]),
  message: z.string(),
  sessionId: z.string().optional(),
  branch: z.string().optional(),
  worktreeId: z.string().optional(),
})

export const agentManagerSessionAddedMessage = z.object({
  type: z.literal("agentManager.sessionAdded"),
  sessionId: z.string(),
  worktreeId: z.string(),
})

export const agentManagerStateMessage = z.object({
  type: z.literal("agentManager.state"),
  worktrees: z.array(worktreeState),
  sessions: z.array(managedSessionState),
  staleWorktreeIds: z.array(z.string()).optional(),
  tabOrder: z.record(z.string(), z.array(z.string())).optional(),
  sessionsCollapsed: z.boolean().optional(),
  reviewDiffStyle: z.enum(["unified", "split"]).optional(),
  isGitRepo: z.boolean().optional(),
  defaultBaseBranch: z.string().optional(),
})

export const agentManagerKeybindingsMessage = z.object({
  type: z.literal("agentManager.keybindings"),
  bindings: z.record(z.string(), z.string()),
})

export const agentManagerMultiVersionProgressMessage = z.object({
  type: z.literal("agentManager.multiVersionProgress"),
  status: z.enum(["creating", "done"]),
  total: z.number(),
  completed: z.number(),
  groupId: z.string().optional(),
})

export const variantsLoadedMessage = z.object({
  type: z.literal("variantsLoaded"),
  variants: z.record(z.string(), z.string()),
})

export const agentManagerBranchesMessage = z.object({
  type: z.literal("agentManager.branches"),
  branches: z.array(branchInfo),
  defaultBranch: z.string(),
})

export const agentManagerExternalWorktreesMessage = z.object({
  type: z.literal("agentManager.externalWorktrees"),
  worktrees: z.array(externalWorktreeInfo),
})

export const agentManagerImportResultMessage = z.object({
  type: z.literal("agentManager.importResult"),
  success: z.boolean(),
  message: z.string(),
})

export const agentManagerWorktreeDiffMessage = z.object({
  type: z.literal("agentManager.worktreeDiff"),
  sessionId: z.string(),
  diffs: z.array(worktreeFileDiff),
})

export const agentManagerWorktreeDiffLoadingMessage = z.object({
  type: z.literal("agentManager.worktreeDiffLoading"),
  sessionId: z.string(),
  loading: z.boolean(),
})

export const agentManagerApplyWorktreeDiffResultMessage = z.object({
  type: z.literal("agentManager.applyWorktreeDiffResult"),
  worktreeId: z.string(),
  status: applyWorktreeDiffStatus,
  message: z.string(),
  conflicts: z.array(applyWorktreeDiffConflict).optional(),
})

export const agentManagerWorktreeStatsMessage = z.object({
  type: z.literal("agentManager.worktreeStats"),
  stats: z.array(worktreeGitStats),
})

export const agentManagerLocalStatsMessage = z.object({
  type: z.literal("agentManager.localStats"),
  stats: localGitStats,
})

export const agentManagerSetSessionModelMessage = z.object({
  type: z.literal("agentManager.setSessionModel"),
  sessionId: z.string(),
  providerID: z.string(),
  modelID: z.string(),
})

export const agentManagerSendInitialMessage = z.object({
  type: z.literal("agentManager.sendInitialMessage"),
  sessionId: z.string(),
  worktreeId: z.string(),
  text: z.string().optional(),
  providerID: z.string().optional(),
  modelID: z.string().optional(),
  agent: z.string().optional(),
  files: z.array(z.object({ mime: z.string(), url: z.string() })).optional(),
})

// legacy-migration start
export const legacyMigrationDataMessage = z.object({
  type: z.literal("legacyMigrationData"),
  data: z.object({
    providers: z.array(migrationProviderInfo),
    mcpServers: z.array(migrationMcpServerInfo),
    customModes: z.array(migrationCustomModeInfo),
    defaultModel: z.object({ provider: z.string(), model: z.string() }).optional(),
    settings: legacySettings.optional(),
  }),
})

export const legacyMigrationProgressMessage = z.object({
  type: z.literal("legacyMigrationProgress"),
  item: z.string(),
  status: z.enum(["migrating", "success", "warning", "error"]),
  message: z.string().optional(),
})

export const legacyMigrationCompleteMessage = z.object({
  type: z.literal("legacyMigrationComplete"),
  results: z.array(migrationResultItem),
})
// legacy-migration end

export const enhancePromptResultMessage = z.object({
  type: z.literal("enhancePromptResult"),
  text: z.string(),
  requestId: z.string(),
})

export const enhancePromptErrorMessage = z.object({
  type: z.literal("enhancePromptError"),
  error: z.string(),
  requestId: z.string(),
})

export const viewSubAgentSessionMessage = z.object({
  type: z.literal("viewSubAgentSession"),
  sessionID: z.string(),
})

export const diffViewerDiffsMessage = z.object({
  type: z.literal("diffViewer.diffs"),
  diffs: z.array(worktreeFileDiff),
})

export const diffViewerLoadingMessage = z.object({
  type: z.literal("diffViewer.loading"),
  loading: z.boolean(),
})

// ============================================
// Extension → Webview union
// ============================================

export const extensionMessage = z.discriminatedUnion("type", [
  readyMessage,
  connectionStateMessage,
  errorMessage,
  partUpdatedMessage,
  sessionStatusMessage,
  permissionRequestMessage,
  permissionResolvedMessage,
  permissionErrorMessage,
  todoUpdatedMessage,
  sessionCreatedMessage,
  sessionUpdatedMessage,
  sessionDeletedMessage,
  messagesLoadedMessage,
  messageCreatedMessage,
  sessionsLoadedMessage,
  cloudSessionsLoadedMessage,
  gitRemoteUrlLoadedMessage,
  actionMessage,
  profileDataMessage,
  deviceAuthStartedMessage,
  deviceAuthCompleteMessage,
  deviceAuthFailedMessage,
  deviceAuthCancelledMessage,
  navigateMessage,
  providersLoadedMessage,
  agentsLoadedMessage,
  autocompleteSettingsLoadedMessage,
  chatCompletionResultMessage,
  fileSearchResultMessage,
  questionRequestMessage,
  questionResolvedMessage,
  questionErrorMessage,
  browserSettingsLoadedMessage,
  configLoadedMessage,
  configUpdatedMessage,
  notificationSettingsLoadedMessage,
  notificationsLoadedMessage,
  agentManagerSessionMetaMessage,
  agentManagerRepoInfoMessage,
  agentManagerWorktreeSetupMessage,
  agentManagerSessionAddedMessage,
  agentManagerStateMessage,
  agentManagerKeybindingsMessage,
  agentManagerMultiVersionProgressMessage,
  agentManagerSetSessionModelMessage,
  agentManagerSendInitialMessage,
  setChatBoxMessage,
  appendChatBoxMessage,
  appendReviewCommentsMessage,
  triggerTaskMessage,
  variantsLoadedMessage,
  cloudSessionDataLoadedMessage,
  cloudSessionImportedMessage,
  cloudSessionImportFailedMessage,
  openCloudSessionMessage,
  agentManagerBranchesMessage,
  agentManagerExternalWorktreesMessage,
  agentManagerImportResultMessage,
  workspaceDirectoryChangedMessage,
  agentManagerWorktreeDiffMessage,
  agentManagerWorktreeDiffLoadingMessage,
  agentManagerApplyWorktreeDiffResultMessage,
  agentManagerWorktreeStatsMessage,
  agentManagerLocalStatsMessage,
  // legacy-migration start
  legacyMigrationDataMessage,
  legacyMigrationProgressMessage,
  legacyMigrationCompleteMessage,
  // legacy-migration end
  enhancePromptResultMessage,
  enhancePromptErrorMessage,
  viewSubAgentSessionMessage,
  diffViewerDiffsMessage,
  diffViewerLoadingMessage,
])

// ============================================
// Messages FROM webview TO extension
// ============================================

export const sendMessageRequest = z.object({
  type: z.literal("sendMessage"),
  text: z.string(),
  sessionID: z.string().optional(),
  providerID: z.string().optional(),
  modelID: z.string().optional(),
  agent: z.string().optional(),
  variant: z.string().optional(),
  files: z.array(fileAttachment).optional(),
})

export const abortRequest = z.object({
  type: z.literal("abort"),
  sessionID: z.string(),
})

export const permissionResponseRequest = z.object({
  type: z.literal("permissionResponse"),
  permissionId: z.string(),
  sessionID: z.string(),
  response: z.enum(["once", "always", "reject"]),
})

export const createSessionRequest = z.object({ type: z.literal("createSession") })
export const clearSessionRequest = z.object({ type: z.literal("clearSession") })

export const loadMessagesRequest = z.object({
  type: z.literal("loadMessages"),
  sessionID: z.string(),
})

export const loadSessionsRequest = z.object({ type: z.literal("loadSessions") })

export const requestCloudSessionsMessage = z.object({
  type: z.literal("requestCloudSessions"),
  cursor: z.string().optional(),
  limit: z.number().optional(),
  gitUrl: z.string().optional(),
})

export const requestGitRemoteUrlMessage = z.object({ type: z.literal("requestGitRemoteUrl") })

export const requestCloudSessionDataMessage = z.object({
  type: z.literal("requestCloudSessionData"),
  sessionId: z.string(),
})

export const importAndSendMessage = z.object({
  type: z.literal("importAndSend"),
  cloudSessionId: z.string(),
  text: z.string(),
  providerID: z.string().optional(),
  modelID: z.string().optional(),
  agent: z.string().optional(),
  variant: z.string().optional(),
  files: z.array(fileAttachment).optional(),
})

export const loginRequest = z.object({ type: z.literal("login") })
export const logoutRequest = z.object({ type: z.literal("logout") })
export const refreshProfileRequest = z.object({ type: z.literal("refreshProfile") })

export const openExternalRequest = z.object({
  type: z.literal("openExternal"),
  url: z.string(),
})

export const openFileRequest = z.object({
  type: z.literal("openFile"),
  filePath: z.string(),
  line: z.number().optional(),
  column: z.number().optional(),
})

export const cancelLoginRequest = z.object({ type: z.literal("cancelLogin") })

export const setOrganizationRequest = z.object({
  type: z.literal("setOrganization"),
  organizationId: z.string().nullable(),
})

export const webviewReadyRequest = z.object({ type: z.literal("webviewReady") })

export const requestProvidersMessage = z.object({ type: z.literal("requestProviders") })

export const compactRequest = z.object({
  type: z.literal("compact"),
  sessionID: z.string(),
  providerID: z.string().optional(),
  modelID: z.string().optional(),
})

export const requestAgentsMessage = z.object({ type: z.literal("requestAgents") })

export const setLanguageRequest = z.object({
  type: z.literal("setLanguage"),
  locale: z.string(),
})

export const questionReplyRequest = z.object({
  type: z.literal("questionReply"),
  requestID: z.string(),
  answers: z.array(z.array(z.string())),
})

export const questionRejectRequest = z.object({
  type: z.literal("questionReject"),
  requestID: z.string(),
})

export const deleteSessionRequest = z.object({
  type: z.literal("deleteSession"),
  sessionID: z.string(),
})

export const renameSessionRequest = z.object({
  type: z.literal("renameSession"),
  sessionID: z.string(),
  title: z.string(),
})

export const requestAutocompleteSettingsMessage = z.object({ type: z.literal("requestAutocompleteSettings") })

export const updateAutocompleteSettingMessage = z.object({
  type: z.literal("updateAutocompleteSetting"),
  key: z.enum(["enableAutoTrigger", "enableSmartInlineTaskKeybinding", "enableChatAutocomplete"]),
  value: z.boolean(),
})

export const requestChatCompletionMessage = z.object({
  type: z.literal("requestChatCompletion"),
  text: z.string(),
  requestId: z.string(),
})

export const requestFileSearchMessage = z.object({
  type: z.literal("requestFileSearch"),
  query: z.string(),
  requestId: z.string(),
})

export const chatCompletionAcceptedMessage = z.object({
  type: z.literal("chatCompletionAccepted"),
  suggestionLength: z.number().optional(),
})

export const updateSettingRequest = z.object({
  type: z.literal("updateSetting"),
  key: z.string(),
  value: z.unknown(),
})

export const requestBrowserSettingsMessage = z.object({ type: z.literal("requestBrowserSettings") })
export const requestConfigMessage = z.object({ type: z.literal("requestConfig") })

export const updateConfigMessage = z.object({
  type: z.literal("updateConfig"),
  config: config.partial(),
})

export const requestNotificationSettingsMessage = z.object({ type: z.literal("requestNotificationSettings") })
export const resetAllSettingsRequest = z.object({ type: z.literal("resetAllSettings") })
export const requestNotificationsMessage = z.object({ type: z.literal("requestNotifications") })

export const dismissNotificationMessage = z.object({
  type: z.literal("dismissNotification"),
  notificationId: z.string(),
})

export const syncSessionRequest = z.object({
  type: z.literal("syncSession"),
  sessionID: z.string(),
})

export const createWorktreeSessionRequest = z.object({
  type: z.literal("agentManager.createWorktreeSession"),
  text: z.string(),
  providerID: z.string().optional(),
  modelID: z.string().optional(),
  agent: z.string().optional(),
  files: z.array(fileAttachment).optional(),
})

export const telemetryRequest = z.object({
  type: z.literal("telemetry"),
  event: z.string(),
  properties: recordStringUnknown.optional(),
})

export const createWorktreeRequest = z.object({
  type: z.literal("agentManager.createWorktree"),
  baseBranch: z.string().optional(),
  branchName: z.string().optional(),
})

export const deleteWorktreeRequest = z.object({
  type: z.literal("agentManager.deleteWorktree"),
  worktreeId: z.string(),
})

export const removeStaleWorktreeRequest = z.object({
  type: z.literal("agentManager.removeStaleWorktree"),
  worktreeId: z.string(),
})

export const promoteSessionRequest = z.object({
  type: z.literal("agentManager.promoteSession"),
  sessionId: z.string(),
})

export const addSessionToWorktreeRequest = z.object({
  type: z.literal("agentManager.addSessionToWorktree"),
  worktreeId: z.string(),
})

export const closeSessionRequest = z.object({
  type: z.literal("agentManager.closeSession"),
  sessionId: z.string(),
})

export const renameWorktreeRequest = z.object({
  type: z.literal("agentManager.renameWorktree"),
  worktreeId: z.string(),
  label: z.string(),
})

export const requestRepoInfoMessage = z.object({ type: z.literal("agentManager.requestRepoInfo") })
export const requestStateMessage = z.object({ type: z.literal("agentManager.requestState") })
export const configureSetupScriptRequest = z.object({ type: z.literal("agentManager.configureSetupScript") })

export const showTerminalRequest = z.object({
  type: z.literal("agentManager.showTerminal"),
  sessionId: z.string(),
})

export const showLocalTerminalRequest = z.object({ type: z.literal("agentManager.showLocalTerminal") })

export const openWorktreeRequest = z.object({
  type: z.literal("agentManager.openWorktree"),
  worktreeId: z.string(),
})

export const showExistingLocalTerminalRequest = z.object({ type: z.literal("agentManager.showExistingLocalTerminal") })

export const agentManagerOpenFileRequest = z.object({
  type: z.literal("agentManager.openFile"),
  sessionId: z.string(),
  filePath: z.string(),
  line: z.number().optional(),
  column: z.number().optional(),
})

export const createMultiVersionRequest = z.object({
  type: z.literal("agentManager.createMultiVersion"),
  text: z.string().optional(),
  name: z.string().optional(),
  versions: z.number(),
  providerID: z.string().optional(),
  modelID: z.string().optional(),
  agent: z.string().optional(),
  files: z.array(z.object({ mime: z.string(), url: z.string() })).optional(),
  baseBranch: z.string().optional(),
  branchName: z.string().optional(),
  modelAllocations: z.array(modelAllocation).optional(),
})

export const setTabOrderRequest = z.object({
  type: z.literal("agentManager.setTabOrder"),
  key: z.string(),
  order: z.array(z.string()),
})

export const setSessionsCollapsedRequest = z.object({
  type: z.literal("agentManager.setSessionsCollapsed"),
  collapsed: z.boolean(),
})

export const setReviewDiffStyleRequest = z.object({
  type: z.literal("agentManager.setReviewDiffStyle"),
  style: z.enum(["unified", "split"]),
})

export const requestBranchesMessage = z.object({ type: z.literal("agentManager.requestBranches") })
export const requestExternalWorktreesMessage = z.object({ type: z.literal("agentManager.requestExternalWorktrees") })

export const importFromBranchRequest = z.object({
  type: z.literal("agentManager.importFromBranch"),
  branch: z.string(),
})

export const importFromPRRequest = z.object({
  type: z.literal("agentManager.importFromPR"),
  url: z.string(),
})

export const importExternalWorktreeRequest = z.object({
  type: z.literal("agentManager.importExternalWorktree"),
  path: z.string(),
  branch: z.string(),
})

export const importAllExternalWorktreesRequest = z.object({
  type: z.literal("agentManager.importAllExternalWorktrees"),
})

export const requestWorktreeDiffMessage = z.object({
  type: z.literal("agentManager.requestWorktreeDiff"),
  sessionId: z.string(),
})

export const startDiffWatchMessage = z.object({
  type: z.literal("agentManager.startDiffWatch"),
  sessionId: z.string(),
})

export const stopDiffWatchMessage = z.object({ type: z.literal("agentManager.stopDiffWatch") })

export const applyWorktreeDiffMessage = z.object({
  type: z.literal("agentManager.applyWorktreeDiff"),
  worktreeId: z.string(),
  selectedFiles: z.array(z.string()).optional(),
})

export const persistVariantRequest = z.object({
  type: z.literal("persistVariant"),
  key: z.string(),
  value: z.string(),
})

export const requestVariantsMessage = z.object({ type: z.literal("requestVariants") })

export const enhancePromptRequest = z.object({
  type: z.literal("enhancePrompt"),
  text: z.string(),
  requestId: z.string(),
})

export const openChangesRequest = z.object({ type: z.literal("openChanges") })

export const openSubAgentViewerRequest = z.object({
  type: z.literal("openSubAgentViewer"),
  sessionID: z.string(),
  title: z.string().optional(),
})

export const setDefaultBaseBranchRequest = z.object({
  type: z.literal("agentManager.setDefaultBaseBranch"),
  branch: z.string().optional(),
})

// legacy-migration start
export const requestLegacyMigrationDataMessage = z.object({ type: z.literal("requestLegacyMigrationData") })

export const startLegacyMigrationMessage = z.object({
  type: z.literal("startLegacyMigration"),
  selections: z.object({
    providers: z.array(z.string()),
    mcpServers: z.array(z.string()),
    customModes: z.array(z.string()),
    defaultModel: z.boolean(),
    settings: z.object({
      autoApproval: migrationAutoApprovalSelections,
      language: z.boolean(),
      autocomplete: z.boolean(),
    }),
  }),
})

export const skipLegacyMigrationMessage = z.object({ type: z.literal("skipLegacyMigration") })
export const clearLegacyDataMessage = z.object({ type: z.literal("clearLegacyData") })
// legacy-migration end

// ============================================
// Webview → Extension union
// ============================================

export const webviewMessage = z.discriminatedUnion("type", [
  sendMessageRequest,
  abortRequest,
  permissionResponseRequest,
  createSessionRequest,
  clearSessionRequest,
  loadMessagesRequest,
  loadSessionsRequest,
  requestCloudSessionsMessage,
  requestGitRemoteUrlMessage,
  loginRequest,
  logoutRequest,
  refreshProfileRequest,
  openExternalRequest,
  openFileRequest,
  cancelLoginRequest,
  setOrganizationRequest,
  webviewReadyRequest,
  requestProvidersMessage,
  compactRequest,
  requestAgentsMessage,
  setLanguageRequest,
  questionReplyRequest,
  questionRejectRequest,
  deleteSessionRequest,
  renameSessionRequest,
  requestAutocompleteSettingsMessage,
  updateAutocompleteSettingMessage,
  requestChatCompletionMessage,
  requestFileSearchMessage,
  chatCompletionAcceptedMessage,
  updateSettingRequest,
  requestBrowserSettingsMessage,
  requestConfigMessage,
  updateConfigMessage,
  requestNotificationSettingsMessage,
  resetAllSettingsRequest,
  syncSessionRequest,
  createWorktreeSessionRequest,
  requestNotificationsMessage,
  dismissNotificationMessage,
  createWorktreeRequest,
  deleteWorktreeRequest,
  removeStaleWorktreeRequest,
  promoteSessionRequest,
  addSessionToWorktreeRequest,
  closeSessionRequest,
  renameWorktreeRequest,
  telemetryRequest,
  requestRepoInfoMessage,
  requestStateMessage,
  configureSetupScriptRequest,
  showTerminalRequest,
  showLocalTerminalRequest,
  openWorktreeRequest,
  showExistingLocalTerminalRequest,
  agentManagerOpenFileRequest,
  createMultiVersionRequest,
  setTabOrderRequest,
  setSessionsCollapsedRequest,
  setReviewDiffStyleRequest,
  persistVariantRequest,
  requestVariantsMessage,
  requestCloudSessionDataMessage,
  importAndSendMessage,
  requestBranchesMessage,
  requestExternalWorktreesMessage,
  importFromBranchRequest,
  importFromPRRequest,
  importExternalWorktreeRequest,
  importAllExternalWorktreesRequest,
  requestWorktreeDiffMessage,
  startDiffWatchMessage,
  stopDiffWatchMessage,
  // legacy-migration start
  requestLegacyMigrationDataMessage,
  startLegacyMigrationMessage,
  skipLegacyMigrationMessage,
  clearLegacyDataMessage,
  // legacy-migration end
  applyWorktreeDiffMessage,
  enhancePromptRequest,
  openChangesRequest,
  openSubAgentViewerRequest,
  setDefaultBaseBranchRequest,
])
