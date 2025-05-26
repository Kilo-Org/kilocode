import { parseDslCommand, isSupportedOperation, validateOperationDetails } from '../parser';
import { RenameOperation, MoveOperation } from '../types';

describe('DSL Parser', () => {
    describe('parseDslCommand', () => {
        it('should parse valid rename command', () => {
            const input = JSON.stringify({
                schemaVersion: '1.0',
                operation: 'rename',
                selector: {
                    type: 'identifier',
                    name: 'oldFunction',
                    filePath: 'src/app.js',
                    kind: 'function'
                },
                type: 'rename',
                newName: 'newFunction',
                acrossFiles: true
            });

            const result = parseDslCommand(input);
            expect(result).toBeDefined();
            expect(result.operation).toBe('rename');
            expect(result.operationDetails.type).toBe('rename');
            expect((result.operationDetails as RenameOperation).newName).toBe('newFunction');
            expect(result.selector).toHaveProperty('name', 'oldFunction');
        });

        it('should parse valid move command', () => {
            const input = JSON.stringify({
                schemaVersion: '1.0',
                operation: 'move',
                selector: {
                    type: 'location',
                    filePath: 'src/app.js',
                    startLine: 10,
                    endLine: 20
                },
                type: 'move',
                targetFilePath: 'src/utils.js',
                targetPosition: {
                    line: 5,
                    insertBefore: true
                },
                addExports: true
            });

            const result = parseDslCommand(input);
            expect(result).toBeDefined();
            expect(result.operation).toBe('move');
            expect(result.operationDetails.type).toBe('move');
            expect((result.operationDetails as MoveOperation).targetFilePath).toBe('src/utils.js');
            expect(result.selector).toHaveProperty('startLine', 10);
        });

        it('should throw error for invalid JSON', () => {
            const input = '{invalid json}';
            expect(() => parseDslCommand(input)).toThrow('Failed to parse DSL command: Invalid JSON');
        });

        it('should add default schema version when missing', () => {
            const input = JSON.stringify({
                operation: 'rename',
                selector: {
                    type: 'identifier',
                    name: 'oldFunction'
                },
                newName: 'newFunction'
            });

            const result = parseDslCommand(input);
            expect(result.schemaVersion).toBe('1');
            expect(result.operation).toBe('rename');
        });

        it('should throw error for unsupported operation', () => {
            const input = JSON.stringify({
                schemaVersion: '1.0',
                operation: 'unsupported',
                selector: {
                    type: 'identifier',
                    name: 'oldFunction'
                }
            });

            expect(() => parseDslCommand(input)).toThrow(/Unsupported operation/);
        });

        it('should throw error for invalid selector type', () => {
            const input = JSON.stringify({
                schemaVersion: '1.0',
                operation: 'rename',
                selector: {
                    type: 'invalid',
                    name: 'oldFunction'
                },
                newName: 'newFunction'
            });

            expect(() => parseDslCommand(input)).toThrow();
        });

        it('should provide fallback for missing newName in rename operation', () => {
            const input = JSON.stringify({
                schemaVersion: '1.0',
                operation: 'rename',
                selector: {
                    type: 'identifier',
                    name: 'oldFunction'
                },
                type: 'rename'
                // Missing newName
            });

            const result = parseDslCommand(input);
            expect(result.operation).toBe('rename');
            expect((result.operationDetails as RenameOperation).newName).toBeDefined();
            // Should fallback to something like 'newoldFunction'
            expect((result.operationDetails as RenameOperation).newName).toContain('new');
        });

        it('should still require targetFilePath in move operation', () => {
            const input = JSON.stringify({
                schemaVersion: '1.0',
                operation: 'move',
                selector: {
                    type: 'location',
                    filePath: 'src/app.js',
                    startLine: 10,
                    endLine: 20
                },
                type: 'move'
                // Missing targetFilePath
            });

            // We still need targetFilePath for move operations
            expect(() => parseDslCommand(input)).toThrow();
        });

        it('should throw error for invalid line numbers in location selector', () => {
            const input = JSON.stringify({
                schemaVersion: '1.0',
                operation: 'move',
                selector: {
                    type: 'location',
                    filePath: 'src/app.js',
                    startLine: 20,
                    endLine: 10  // End line before start line
                },
                type: 'move',
                targetFilePath: 'src/utils.js'
            });

            expect(() => parseDslCommand(input)).toThrow(/End line must be greater than or equal to start line/);
        });

        it('should throw error when trying to move with identifier selector without filepath', () => {
            const input = JSON.stringify({
                schemaVersion: '1.0',
                operation: 'move',
                selector: {
                    type: 'identifier',
                    name: 'someFunction'
                    // Missing filePath
                },
                type: 'move',
                targetFilePath: 'src/utils.js'
            });

            expect(() => parseDslCommand(input)).toThrow(/require a filePath/);
        });
    });

    describe('isSupportedOperation', () => {
        it('should return true for supported operations', () => {
            expect(isSupportedOperation('rename')).toBe(true);
            expect(isSupportedOperation('move')).toBe(true);
        });

        it('should return false for unsupported operations', () => {
            expect(isSupportedOperation('delete')).toBe(false);
            expect(isSupportedOperation('unknown')).toBe(false);
        });
    });

    describe('validateOperationDetails', () => {
        it('should validate rename operation details', () => {
            const details = {
                type: 'rename',
                newName: 'newFunction',
                acrossFiles: true
            };

            const result = validateOperationDetails('rename', details);
            expect(result).toEqual(details);
        });

        it('should validate move operation details', () => {
            const details = {
                type: 'move',
                targetFilePath: 'src/utils.js',
                targetPosition: {
                    line: 0
                },
                addExports: true
            };

            const result = validateOperationDetails('move', details);
            expect(result).toEqual(details);
        });

        it('should throw error for unsupported operation', () => {
            expect(() => validateOperationDetails('unknown', {})).toThrow(/Unsupported operation/);
        });

        it('should throw error for invalid rename details', () => {
            const details = {
                type: 'rename',
                // Missing newName
            };

            expect(() => validateOperationDetails('rename', details)).toThrow(/newName/);
        });

        it('should throw error for invalid move details', () => {
            const details = {
                type: 'move',
                // Missing targetFilePath
            };

            expect(() => validateOperationDetails('move', details)).toThrow(/targetFilePath/);
        });
    });
});