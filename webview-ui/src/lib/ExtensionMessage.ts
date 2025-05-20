/**
 * Types for extension messages.
 */
export type ClineAsk = {
  type: "ask";
  ts: number;
  ask?: "command" | "followup" | "command_output" | "completion_result" | "tool" | "api_req_failed" | "resume_task" | "resume_completed_task" | "mistake_limit_reached" | "browser_action_launch" | "use_mcp_server" | "payment_required_prompt";
  // Add other properties as needed
};

export type ClineMessage = {
  type: "ask" | "say";
  ts: number;
  ask?: "command" | "followup" | "command_output" | "completion_result" | "tool" | "api_req_failed" | "resume_task" | "resume_completed_task" | "mistake_limit_reached" | "browser_action_launch" | "use_mcp_server" | "payment_required_prompt";
  say?: "command_output" | "completion_result" | "api_req_started" | "browser_action" | "error" | "text" | "api_req_finished" | "api_req_retried" | "api_req_retry_delayed" | "api_req_deleted" | "tool" | "other" | "api_req_timeout" | "api_req_timeout_reached" | "api_req_timeout_reset" | "api_req_timeout_expired" | "payment_required_prompt" | "low_credit_warning" | "reasoning" | "user_feedback" | "user_feedback_diff" | "shell_integration_warning" | "browser_action_result";
  text?: string;
  images?: string[];
  partial?: boolean;
  progressStatus?: {
    current?: number;
    total?: number;
    // Add other properties as needed
  };
  // Add other properties as needed
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