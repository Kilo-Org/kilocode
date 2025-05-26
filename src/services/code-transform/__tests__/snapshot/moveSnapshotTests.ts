import * as path from 'path';
import * as fs from 'fs/promises';
import { moveCodeByIdentifier } from '../../index';
import { existsSync } from 'fs';

/**
 * Snapshot test runner for move code operations
 *
 * This uses Jest's snapshot testing to verify that symbol-based code movement
 * operations produce the expected outputs.
 */
describe('Move Code Snapshot Tests', () => {
    // Directory for test fixtures
    const fixturesDir = path.join(__dirname, 'fixtures', 'move');

    // Clean temporary files after each test
    afterEach(async () => {
        // Find and remove all temp files in the fixtures directory
        const files = await fs.readdir(fixturesDir);
        const promises = files
            .filter(file => file.includes('.actual.') || file.includes('.temp.'))
            .map(file => fs.unlink(path.join(fixturesDir, file)));

        await Promise.all(promises);
    });

    // Test 1: Move a function to a new file
    it('should move a function to a new file', async () => {
        // Setup test paths
        const sourcePath = path.join(fixturesDir, 'moveFunction.source.ts');
        const targetPath = path.join(fixturesDir, 'moveFunction.target.actual.ts');

        // Ensure the source file exists
        expect(existsSync(sourcePath)).toBe(true);

        // Perform the move operation using symbol-based approach
        const result = await moveCodeByIdentifier(
            sourcePath,
            targetPath,
            'formatDate', // Function name to move
            'function'
        );

        // Verify success
        expect(result.success).toBe(true);

        // Read the resulting files
        const sourceContent = await fs.readFile(sourcePath, 'utf-8');
        const targetContent = await fs.readFile(targetPath, 'utf-8');

        // Compare with Jest snapshots
        expect(sourceContent).toMatchSnapshot('moveFunction-source');
        expect(targetContent).toMatchSnapshot('moveFunction-target');
    });

    // Test 2: Move a class to an existing file
    it('should move a class to an existing file', async () => {
        // Setup test paths
        const sourcePath = path.join(fixturesDir, 'moveClass.source.ts');
        const targetPath = path.join(fixturesDir, 'moveClass.target.ts');
        const targetActualPath = path.join(fixturesDir, 'moveClass.target.actual.ts');

        // Copy existing target file to actual target
        await fs.copyFile(targetPath, targetActualPath);

        // Ensure files exist
        expect(existsSync(sourcePath)).toBe(true);
        expect(existsSync(targetActualPath)).toBe(true);

        // Perform the move operation using symbol-based approach
        const result = await moveCodeByIdentifier(
            sourcePath,
            targetActualPath,
            'UserProfile', // Class name to move
            'class'
        );

        // Verify success
        expect(result.success).toBe(true);

        // Read the resulting files
        const sourceContent = await fs.readFile(sourcePath, 'utf-8');
        const targetContent = await fs.readFile(targetActualPath, 'utf-8');

        // Compare with Jest snapshots
        expect(sourceContent).toMatchSnapshot('moveClass-source');
        expect(targetContent).toMatchSnapshot('moveClass-target');
    });

    // Test 3: Move a function with dependencies
    it('should move a function with its dependencies', async () => {
        // Setup test paths
        const sourcePath = path.join(fixturesDir, 'moveFunctionWithDeps.source.ts');
        const targetPath = path.join(fixturesDir, 'moveFunctionWithDeps.target.actual.ts');

        // Ensure file exists
        expect(existsSync(sourcePath)).toBe(true);

        // Perform the move operation using symbol-based approach
        const result = await moveCodeByIdentifier(
            sourcePath,
            targetPath,
            'formatPrice', // Function name to move
            'function'
        );

        // Verify success
        expect(result.success).toBe(true);

        // Read the resulting files
        const sourceContent = await fs.readFile(sourcePath, 'utf-8');
        const targetContent = await fs.readFile(targetPath, 'utf-8');

        // Compare with Jest snapshots
        expect(sourceContent).toMatchSnapshot('moveFunctionWithDeps-source');
        expect(targetContent).toMatchSnapshot('moveFunctionWithDeps-target');
    });
});