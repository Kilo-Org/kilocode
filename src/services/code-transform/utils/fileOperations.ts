import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read a file or return empty string if it doesn't exist
 * 
 * @param filePath Path to the file to read
 * @returns File content as string or empty string if not found
 */
export async function readOrEmpty(filePath: string): Promise<string> {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
        // File doesn't exist or other error
        return '';
    }
}

/**
 * Ensure directory exists and write content to file
 * 
 * @param filePath Path to the file to write
 * @param content Content to write to the file
 */
export async function ensureDirAndWrite(filePath: string, content: string): Promise<void> {
    // Get the directory part of the path
    const dir = path.dirname(filePath);

    // Only create the directory if it's not the current directory
    // and it doesn't already exist
    if (dir !== '.' && dir !== '') {
        await fs.mkdir(dir, { recursive: true });
    }

    // Write the file
    await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Generate a relative import path between two files
 * 
 * @param fromFilePath Path of the file containing the import
 * @param toFilePath Path of the file being imported
 * @returns Properly formatted relative import path
 */
export function getRelativeImportPath(fromFilePath: string, toFilePath: string): string {
    const fromDir = path.dirname(fromFilePath);
    const toDir = path.dirname(toFilePath);
    const toFileName = path.basename(toFilePath, path.extname(toFilePath));

    // Calculate relative path from source to target
    let relativePath = path.relative(fromDir, toDir);

    if (!relativePath) {
        relativePath = '.'; // Same directory
    }

    // Create the import path
    const importPath = `${relativePath}/${toFileName}`.replace(/\\/g, '/');

    // Ensure the path starts with ./ or ../
    return importPath.startsWith('.') ? importPath : `./${importPath}`;
}