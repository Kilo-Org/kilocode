/**
 * Types for extension messages.
 */
export type ClineAsk = "command" | "followup" | "command_output" | "completion_result" | "tool" | "api_req_failed" | "resume_task" | "resume_completed_task" | "mistake_limit_reached" | "browser_action_launch" | "use_mcp_server" | "payment_required_prompt";

export type ClineSay = "error" | "api_req_started" | "api_req_finished" | "api_req_retried" | "api_req_retry_delayed" | "api_req_deleted" | "text" | "reasoning" | "completion_result" | "user_feedback" | "user_feedback_diff" | "command_output" | "shell_integration_warning" | "browser_action" | "browser_action_result" | "mcp_server_request_started" | "mcp_server_response" | "subtask_result" | "checkpoint_saved" | "rooignore_error" | "diff_error" | "tool" | "payment_required_prompt";

export type ClineMessage = {
  type: "ask" | "say";
  ts: number;
  ask?: ClineAsk;
  say?: ClineSay;
  text?: string;
  images?: string[];
  partial?: boolean;
  reasoning?: string;
  conversationHistoryIndex?: number;
  checkpoint?: Record<string, unknown>;
  progressStatus?: {
    icon?: string;
    text?: string;
  };
};

export type ClineSayBrowserAction = {
  type: "say";
  ts: number;
  say: "browser_action";
  action?: "launch" | "close";
  // Add other properties as needed
};

export type ClineSayTool = {
  type: "say";
  ts: number;
  say: "tool";
  toolName?: string;
  tool?: string;
  // Add other properties as needed
};

export type ExtensionMessage = {
  type: string;
  text?: string;
  images?: string[];
  action?: string;
  invoke?: string;
  // Add other properties as needed
};