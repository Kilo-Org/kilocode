import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { executeRemoveOperation } from '../../dsl/operations/remove';

/**
 * Snapshot test runner for remove code operations
 *
 * This uses Jest's snapshot testing to verify that symbol-based code removal
 * operations produce the expected outputs.
 */
describe('Remove Code Snapshot Tests', () => {
    // Directory for test fixtures
    const fixturesDir = path.join(__dirname, 'fixtures', 'remove');

    // Clean temporary files after each test
    afterEach(async () => {
        // Find and remove all temp files in the fixtures directory
        const files = await fs.readdir(fixturesDir);
        const promises = files
            .filter(file => file.includes('.actual.') || file.includes('.temp.'))
            .map(file => fs.unlink(path.join(fixturesDir, file)));

        await Promise.all(promises);
    });

    // Test 1: Remove a function from a file
    it('should remove a function from a file', async () => {
        // Setup test paths
        const sourcePath = path.join(fixturesDir, 'removeFunction.source.ts');
        const actualPath = path.join(fixturesDir, 'removeFunction.source.actual.ts');

        // Copy source file to actual file
        await fs.copyFile(sourcePath, actualPath);

        // Ensure the file exists
        expect(existsSync(actualPath)).toBe(true);

        // Perform the remove operation using symbol-based approach
        const result = await executeRemoveOperation(
            { type: 'remove' },
            {
                type: 'identifier',
                name: 'functionToRemove',
                filePath: actualPath,
                kind: 'function'
            }
        );

        // Verify success
        expect(result.success).toBe(true);

        // Read the resulting file
        const modifiedContent = await fs.readFile(actualPath, 'utf-8');

        // Compare with Jest snapshot
        expect(modifiedContent).toMatchSnapshot('removeFunction-result');
    });

    // Test 2: Remove a constant from a file
    it('should remove a constant from a file', async () => {
        // Setup test paths
        const sourcePath = path.join(fixturesDir, 'removeFunction.source.ts');
        const actualPath = path.join(fixturesDir, 'removeFunction.source.actual.ts');

        // Copy source file to actual file
        await fs.copyFile(sourcePath, actualPath);

        // Ensure the file exists
        expect(existsSync(actualPath)).toBe(true);

        // Perform the remove operation using symbol-based approach
        const result = await executeRemoveOperation(
            { type: 'remove' },
            {
                type: 'identifier',
                name: 'CONSTANT_TO_REMOVE',
                filePath: actualPath,
                kind: 'variable'
            }
        );

        // Verify success
        expect(result.success).toBe(true);

        // Read the resulting file
        const modifiedContent = await fs.readFile(actualPath, 'utf-8');

        // Compare with Jest snapshot
        expect(modifiedContent).toMatchSnapshot('removeConstant-result');
    });

    // Test 3: Remove multiple elements from a file
    it('should remove multiple elements from a file', async () => {
        // Setup test paths
        const sourcePath = path.join(fixturesDir, 'removeFunction.source.ts');
        const actualPath = path.join(fixturesDir, 'removeFunction.source.actual.ts');
        const expectedPath = path.join(fixturesDir, 'removeFunction.expected.ts');

        // Copy source file to actual file
        await fs.copyFile(sourcePath, actualPath);

        // Ensure the file exists
        expect(existsSync(actualPath)).toBe(true);
        expect(existsSync(expectedPath)).toBe(true);

        // Remove the first function
        await executeRemoveOperation(
            { type: 'remove' },
            {
                type: 'identifier',
                name: 'functionToRemove',
                filePath: actualPath,
                kind: 'function'
            }
        );

        // Remove the second function
        await executeRemoveOperation(
            { type: 'remove' },
            {
                type: 'identifier',
                name: 'anotherFunctionToRemove',
                filePath: actualPath,
                kind: 'function'
            }
        );

        // Remove the constant
        await executeRemoveOperation(
            { type: 'remove' },
            {
                type: 'identifier',
                name: 'CONSTANT_TO_REMOVE',
                filePath: actualPath,
                kind: 'variable'
            }
        );

        // Read the resulting file
        const modifiedContent = await fs.readFile(actualPath, 'utf-8');
        const expectedContent = await fs.readFile(expectedPath, 'utf-8');

        // Compare with expected content
        expect(modifiedContent.trim()).toBe(expectedContent.trim());

        // Compare with Jest snapshot
        expect(modifiedContent).toMatchSnapshot('removeMultiple-result');
    });
});