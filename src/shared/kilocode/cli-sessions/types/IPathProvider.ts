/**
 * Interface for providing file system paths needed by session management.
 * Implementations should provide methods to resolve paths for various session-related files and directories.
 */
export interface IPathProvider {
	/**
	 * Get the directory where task data is stored.
	 * @returns The absolute path to the tasks directory
	 */
	getTasksDir(): string

	/**
	 * Get the path to the file that stores the local session data.
	 * @param workspaceDir The workspace directory path
	 * @returns The absolute path to the session file
	 */
	getSessionFilePath(workspaceDir: string): string
}
