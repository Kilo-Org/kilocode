import * as path from 'path';
import * as fs from 'fs/promises';
import { renameSymbol } from '../../renameSymbol';
import { existsSync } from 'fs';
import { RenameSymbolOperation } from '../../refactorModels';

/**
 * Snapshot test runner for rename symbol operations
 * 
 * This uses Jest's built-in snapshot testing to verify that rename operations 
 * produce the expected outputs without having to manually maintain expected files.
 */
describe('Rename Symbol Snapshot Tests', () => {
    // Directory for test fixtures
    const fixturesDir = path.join(__dirname, 'fixtures', 'rename');

    // Clean temporary files after each test
    afterEach(async () => {
        // Find and remove all temp files in the fixtures directory
        const files = await fs.readdir(fixturesDir);
        const promises = files
            .filter(file => file.includes('.actual.'))
            .map(file => fs.unlink(path.join(fixturesDir, file)));

        await Promise.all(promises);
    });

    // Test 1: Rename a variable by name
    it('should rename a variable by name', async () => {
        // Setup test paths
        const sourcePath = path.join(fixturesDir, 'renameVariable.source.ts');
        const actualPath = path.join(fixturesDir, 'renameVariable.actual.ts');

        // Copy source to actual for testing
        await fs.copyFile(sourcePath, actualPath);

        // Ensure the files exist
        expect(existsSync(sourcePath)).toBe(true);
        expect(existsSync(actualPath)).toBe(true);

        // Create rename operation
        const operation: RenameSymbolOperation = {
            operation: 'rename_symbol',
            filePath: actualPath,
            newName: 'apiBaseUrl',
            oldName: 'baseUrl'
        };

        // Perform the rename operation
        const result = await renameSymbol(operation);

        // Verify success
        expect(result.success).toBe(true);

        // Read the resulting file
        const actualContent = await fs.readFile(actualPath, 'utf-8');

        // Compare with Jest snapshot
        expect(actualContent).toMatchSnapshot('renameVariable');
    });

    // Test 2: Rename a function by line
    it('should rename a function by line', async () => {
        // Setup test paths
        const sourcePath = path.join(fixturesDir, 'renameFunction.source.ts');
        const actualPath = path.join(fixturesDir, 'renameFunction.actual.ts');

        // Copy source to actual for testing
        await fs.copyFile(sourcePath, actualPath);

        // Ensure the files exist
        expect(existsSync(sourcePath)).toBe(true);
        expect(existsSync(actualPath)).toBe(true);

        // Create rename operation
        const operation: RenameSymbolOperation = {
            operation: 'rename_symbol',
            filePath: actualPath,
            newName: 'calculateDiscount',
            startLine: 3 // Line with calculateTax function
        };

        // Perform the rename operation
        const result = await renameSymbol(operation);

        // Verify success
        expect(result.success).toBe(true);

        // Read the resulting file
        const actualContent = await fs.readFile(actualPath, 'utf-8');

        // Compare with Jest snapshot
        expect(actualContent).toMatchSnapshot('renameFunction');
    });

    // Test 3: Rename class property with multiple references
    it('should rename class property with multiple references', async () => {
        // Setup test paths
        const sourcePath = path.join(fixturesDir, 'renameClassProperty.source.ts');
        const actualPath = path.join(fixturesDir, 'renameClassProperty.actual.ts');

        // Copy source to actual for testing
        await fs.copyFile(sourcePath, actualPath);

        // Ensure the files exist
        expect(existsSync(sourcePath)).toBe(true);
        expect(existsSync(actualPath)).toBe(true);

        // Create rename operation
        const operation: RenameSymbolOperation = {
            operation: 'rename_symbol',
            filePath: actualPath,
            newName: 'discountRate',
            oldName: 'taxRate'
        };

        // Perform the rename operation
        const result = await renameSymbol(operation);

        // Verify success
        expect(result.success).toBe(true);

        // Read the resulting file
        const actualContent = await fs.readFile(actualPath, 'utf-8');

        // Compare with Jest snapshot
        expect(actualContent).toMatchSnapshot('renameClassProperty');
    });

    // Test 4: Rename an import alias
    it('should rename an import alias', async () => {
        // Setup test paths
        const sourcePath = path.join(fixturesDir, 'renameImport.source.ts');
        const actualPath = path.join(fixturesDir, 'renameImport.actual.ts');

        // Copy source to actual for testing
        await fs.copyFile(sourcePath, actualPath);

        // Ensure the files exist
        expect(existsSync(sourcePath)).toBe(true);
        expect(existsSync(actualPath)).toBe(true);

        // Create rename operation
        const operation: RenameSymbolOperation = {
            operation: 'rename_symbol',
            filePath: actualPath,
            newName: 'utilFunctions',
            startLine: 1 // Line with import statement
        };

        // Perform the rename operation
        const result = await renameSymbol(operation);

        // Verify success
        expect(result.success).toBe(true);

        // Read the resulting file
        const actualContent = await fs.readFile(actualPath, 'utf-8');

        // Compare with Jest snapshot
        expect(actualContent).toMatchSnapshot('renameImport');
    });
});