/**
 * Telemetry event names for the Kilo VS Code extension.
 * These are forwarded to the CLI server via POST /telemetry/capture.
 */
export enum TelemetryEventName {
  // Task Lifecycle
  TASK_CREATED = "Task Created",
  TASK_RESTARTED = "Task Reopened",
  TASK_COMPLETED = "Task Completed",
  TASK_CONVERSATION_MESSAGE = "Conversation Message",

  // LLM & AI
  LLM_COMPLETION = "LLM Completion",
  CONTEXT_CONDENSED = "Context Condensed",
  SLIDING_WINDOW_TRUNCATION = "Sliding Window Truncation",

  // Tools & Modes
  TOOL_USED = "Tool Used",
  MODE_SWITCH = "Mode Switched",
  MODE_SETTINGS_CHANGED = "Mode Setting Changed",
  CUSTOM_MODE_CREATED = "Custom Mode Created",
  CODE_ACTION_USED = "Code Action Used",

  // Checkpoints
  CHECKPOINT_CREATED = "Checkpoint Created",
  CHECKPOINT_RESTORED = "Checkpoint Restored",
  CHECKPOINT_DIFFED = "Checkpoint Diffed",

  // UI Interactions
  TAB_SHOWN = "Tab Shown",
  TITLE_BUTTON_CLICKED = "Title Button Clicked",
  PROMPT_ENHANCED = "Prompt Enhanced",

  // Marketplace
  MARKETPLACE_ITEM_INSTALLED = "Marketplace Item Installed",
  MARKETPLACE_ITEM_REMOVED = "Marketplace Item Removed",

  // Account & Auth
  ACCOUNT_CONNECT_CLICKED = "Account Connect Clicked",
  ACCOUNT_CONNECT_SUCCESS = "Account Connect Success",
  ACCOUNT_LOGOUT_CLICKED = "Account Logout Clicked",
  ACCOUNT_LOGOUT_SUCCESS = "Account Logout Success",

  // Error Tracking
  SCHEMA_VALIDATION_ERROR = "Schema Validation Error",
  DIFF_APPLICATION_ERROR = "Diff Application Error",
  SHELL_INTEGRATION_ERROR = "Shell Integration Error",
  CONSECUTIVE_MISTAKE_ERROR = "Consecutive Mistake Error",

  // Autocomplete
  AUTOCOMPLETE_SUGGESTION_REQUESTED = "Autocomplete Suggestion Requested",
  AUTOCOMPLETE_LLM_REQUEST_COMPLETED = "Autocomplete LLM Request Completed",
  AUTOCOMPLETE_LLM_REQUEST_FAILED = "Autocomplete LLM Request Failed",
  AUTOCOMPLETE_LLM_SUGGESTION_RETURNED = "Autocomplete LLM Suggestion Returned",
  AUTOCOMPLETE_SUGGESTION_CACHE_HIT = "Autocomplete Suggestion Cache Hit",
  AUTOCOMPLETE_ACCEPT_SUGGESTION = "Autocomplete Accept Suggestion",
  AUTOCOMPLETE_SUGGESTION_FILTERED = "Autocomplete Suggestion Filtered",
  AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN = "Autocomplete Unique Suggestion Shown",

  // Inline Assist
  INLINE_ASSIST_AUTO_TASK = "Inline Assist Auto Task",

  // Kilo-specific
  COMMIT_MSG_GENERATED = "Commit Message Generated",
  AGENT_MANAGER_OPENED = "Agent Manager Opened",
  AGENT_MANAGER_SESSION_STARTED = "Agent Manager Session Started",
  AGENT_MANAGER_SESSION_COMPLETED = "Agent Manager Session Completed",
  AGENT_MANAGER_SESSION_STOPPED = "Agent Manager Session Stopped",
  AGENT_MANAGER_SESSION_ERROR = "Agent Manager Session Error",
  AGENT_MANAGER_LOGIN_ISSUE = "Agent Manager Login Issue",
  AUTO_PURGE_STARTED = "Auto Purge Started",
  AUTO_PURGE_COMPLETED = "Auto Purge Completed",
  AUTO_PURGE_FAILED = "Auto Purge Failed",
  MANUAL_PURGE_TRIGGERED = "Manual Purge Triggered",
  WEBVIEW_MEMORY_USAGE = "Webview Memory Usage",
  MEMORY_WARNING_SHOWN = "Memory Warning Shown",
  ASK_APPROVAL = "Ask Approval",
  NOTIFICATION_CLICKED = "Notification Clicked",
  SUGGESTION_BUTTON_CLICKED = "Suggestion Button Clicked",
  FREE_MODELS_LINK_CLICKED = "Free Models Link Clicked",
  CREATE_ORGANIZATION_LINK_CLICKED = "Create Organization Link Clicked",
  GHOST_SERVICE_DISABLED = "Ghost Service Disabled",
}

/**
 * Provider that supplies context properties to be merged into every telemetry event.
 */
export interface TelemetryPropertiesProvider {
  getTelemetryProperties(): Record<string, unknown>
}
