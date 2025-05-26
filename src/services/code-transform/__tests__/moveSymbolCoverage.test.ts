import * as path from 'path';
import * as fs from 'fs/promises';
import { moveSymbol } from '../moveSymbol';

/**
 * Additional tests to improve coverage for moveSymbol.ts
 */
describe('Move Symbol Coverage Tests', () => {
    const fixturesDir = path.join(__dirname, 'fixtures', 'move-coverage');

    beforeAll(async () => {
        // Create fixtures directory if it doesn't exist
        await fs.mkdir(fixturesDir, { recursive: true });
    });

    afterEach(async () => {
        // Clean up test files
        const files = await fs.readdir(fixturesDir).catch(() => []);
        await Promise.all(
            files.map(file => fs.unlink(path.join(fixturesDir, file)).catch(() => { }))
        );
    });

    it('should handle errors when source file does not exist', async () => {
        const result = await moveSymbol(
            path.join(fixturesDir, 'non-existent-file.ts'),
            path.join(fixturesDir, 'target.ts'),
            'testFunction'
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('File not found');
    });

    it('should handle errors when symbol is not found in source file', async () => {
        // Create a test file
        const srcPath = path.join(fixturesDir, 'source.ts');
        await fs.writeFile(srcPath, 'const x = 1;', 'utf-8');

        const targetPath = path.join(fixturesDir, 'target.ts');

        const result = await moveSymbol(
            srcPath,
            targetPath,
            'nonExistentFunction'
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Could not find identifier');
    });

    it('should create target file if it does not exist', async () => {
        // Create a source file with a function
        const srcPath = path.join(fixturesDir, 'source-create.ts');
        const sourceContent = `
export function testFunction() {
    return 'Hello, world!';
}

export function otherFunction() {
    return testFunction() + '!';
}
`;
        await fs.writeFile(srcPath, sourceContent, 'utf-8');

        // Target file that doesn't exist yet
        const targetPath = path.join(fixturesDir, 'new-target.ts');

        // Perform move operation
        const result = await moveSymbol(
            srcPath,
            targetPath,
            'testFunction',
            'function'
        );

        expect(result.success).toBe(true);

        // Verify target file was created
        const targetExists = await fs.stat(targetPath).then(() => true).catch(() => false);
        expect(targetExists).toBe(true);

        // Verify content was moved correctly
        const targetContent = await fs.readFile(targetPath, 'utf-8');
        expect(targetContent).toContain('export function testFunction');

        // Verify source file was updated
        const modifiedSource = await fs.readFile(srcPath, 'utf-8');
        expect(modifiedSource).toContain('import { testFunction }');
        expect(modifiedSource).not.toContain('export function testFunction');
        expect(modifiedSource).toContain('export function otherFunction');
    });

    it('should handle moving a class with dependencies', async () => {
        // Create a source file with a class that has dependencies
        const srcPath = path.join(fixturesDir, 'source-class.ts');
        const sourceContent = `
export function formatDate(date: Date): string {
    return date.toISOString();
}

export class UserProfile {
    name: string;
    createdAt: Date;

    constructor(name: string, createdAt: Date) {
        this.name = name;
        this.createdAt = createdAt;
    }

    getFormattedDate(): string {
        return formatDate(this.createdAt);
    }
}

export function createUser(name: string): UserProfile {
    return new UserProfile(name, new Date());
}
`;
        await fs.writeFile(srcPath, sourceContent, 'utf-8');

        // Target file
        const targetPath = path.join(fixturesDir, 'target-class.ts');
        await fs.writeFile(targetPath, '// Target file', 'utf-8');

        // Perform move operation
        const result = await moveSymbol(
            srcPath,
            targetPath,
            'UserProfile',
            'class'
        );

        expect(result.success).toBe(true);

        // Verify target file was updated
        const targetContent = await fs.readFile(targetPath, 'utf-8');
        expect(targetContent).toContain('export class UserProfile');

        // Verify source file was updated
        const modifiedSource = await fs.readFile(srcPath, 'utf-8');
        expect(modifiedSource).toContain('import { UserProfile }');
        expect(modifiedSource).not.toContain('export class UserProfile');
        expect(modifiedSource).toContain('export function formatDate');
        expect(modifiedSource).toContain('export function createUser');
    });

    it('should handle moving a variable declaration', async () => {
        // Create a source file with a variable
        const srcPath = path.join(fixturesDir, 'source-var.ts');
        const sourceContent = `
export const CONFIG = {
    apiUrl: 'https://api.example.com',
    timeout: 5000
};

export function fetchData() {
    return fetch(CONFIG.apiUrl, { timeout: CONFIG.timeout });
}
`;
        await fs.writeFile(srcPath, sourceContent, 'utf-8');

        // Target file
        const targetPath = path.join(fixturesDir, 'target-var.ts');

        // Perform move operation
        const result = await moveSymbol(
            srcPath,
            targetPath,
            'CONFIG',
            'variable'
        );

        expect(result.success).toBe(true);

        // Verify target file was created with the variable
        const targetContent = await fs.readFile(targetPath, 'utf-8');
        expect(targetContent).toContain('export const CONFIG');
        expect(targetContent).toContain('apiUrl');

        // Verify source file was updated
        const modifiedSource = await fs.readFile(srcPath, 'utf-8');
        expect(modifiedSource).toContain('import { CONFIG }');
        expect(modifiedSource).not.toContain('export const CONFIG');
        expect(modifiedSource).toContain('export function fetchData');
    });
});