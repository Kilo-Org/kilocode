/**
 * Interface for providing access to task data needed for session management.
 * Implementations should provide methods to retrieve task information including
 * task content and associated file paths.
 */
export interface ITaskDataProvider {
	/**
	 * Get task data by task ID, including the history item and file paths.
	 * @param taskId The unique identifier of the task
	 * @returns An object containing the task's history item and file paths for conversation data
	 */
	getTaskWithId(taskId: string): Promise<{
		historyItem: { task?: string }
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
	}>
}
