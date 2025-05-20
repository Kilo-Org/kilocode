/**
 * Interface for command execution status data.
 */
export interface CommandExecutionStatus {
  executionId: string;
  status: "started" | "running" | "completed" | "exited" | "error";
  command?: string;
  output?: string;
  pid?: number;
  exitCode?: number;
}

/**
 * Schema for command execution status.
 */
export const commandExecutionStatusSchema = {
  parse: (data: unknown): CommandExecutionStatus => {
    // Mock implementation for command execution status parsing
    return data as CommandExecutionStatus;
  },
  safeParse: (data: unknown) => {
    // Mock implementation for safe parsing
    return { success: true, data: data as CommandExecutionStatus };
  }
};