import { readOrEmpty, ensureDirAndWrite } from './fileOperations';

/**
 * Manages file operations for code transformation
 * Handles loading, modifying, and writing files
 */
export class FileManager {
    private fileContents = new Map<string, string>();
    private originalContents = new Map<string, string>();

    /**
     * Loads a file's content from disk
     * @param filePath Path to the file
     * @returns The file content as a string
     */
    async loadFile(filePath: string): Promise<string> {
        if (!this.fileContents.has(filePath)) {
            try {
                const content = await readOrEmpty(filePath);
                this.fileContents.set(filePath, content);
                this.originalContents.set(filePath, content);
            } catch (error) {
                this.fileContents.set(filePath, '');
                this.originalContents.set(filePath, '');
            }
        }
        return this.fileContents.get(filePath)!;
    }

    /**
     * Gets the current content of a file
     * @param filePath Path to the file
     * @returns The file content as a string
     */
    getContent(filePath: string): string {
        return this.fileContents.get(filePath) || '';
    }

    /**
     * Sets the content of a file in memory
     * @param filePath Path to the file
     * @param content New content for the file
     */
    setContent(filePath: string, content: string): void {
        this.fileContents.set(filePath, content);
    }

    /**
     * Writes all modified files to disk
     */
    async writeAll(): Promise<void> {
        const writePromises = Array.from(this.fileContents.entries()).map(
            ([filePath, content]) => ensureDirAndWrite(filePath, content)
        );
        await Promise.all(writePromises);
    }

    /**
     * Checks if a file has been modified
     * @param filePath Path to the file
     * @returns True if the file has been modified
     */
    hasChanged(filePath: string): boolean {
        const current = this.fileContents.get(filePath) || '';
        const original = this.originalContents.get(filePath) || '';
        return current !== original;
    }
}