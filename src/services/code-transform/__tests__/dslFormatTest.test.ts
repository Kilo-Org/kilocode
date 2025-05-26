import { parseDslCommand } from '../dsl/parser';

describe('DSL Format Test', () => {
    it('should show the correct format for move operations', () => {
        // This is the correct format for a move operation
        const correctMoveCommand = {
            schemaVersion: "1.0",
            operation: "move",
            selector: {
                type: "identifier",
                name: "DataProcessor",
                kind: "class",
                filePath: "tests/refactor_code/01_move_class/input/main.ts"
            },
            targetFilePath: "tests/refactor_code/01_move_class/input/processor.ts"
        };

        // Test that this format parses correctly
        const result = parseDslCommand(JSON.stringify(correctMoveCommand));
        expect(result).toBeDefined();
        expect(result.operation).toBe('move');
    });

    it('should show the correct format for rename operations', () => {
        // This is the correct format for a rename operation
        const correctRenameCommand = {
            schemaVersion: "1.0",
            operation: "rename",
            selector: {
                type: "identifier",
                name: "Person",
                kind: "class",
                filePath: "tests/refactor_code/04_rename_class/input/user.ts"
            },
            newName: "User"
        };

        // Test that this format parses correctly
        const result = parseDslCommand(JSON.stringify(correctRenameCommand));
        expect(result).toBeDefined();
        expect(result.operation).toBe('rename');
    });

    it('should show what happens with incorrect format', () => {
        // This is the INCORRECT format that the agent might be using
        const incorrectCommand = {
            operation: "move_to_file",
            start_line: 8,
            end_line: 12,
            target_path: "processor.ts"
        };

        // This should throw an error
        expect(() => parseDslCommand(JSON.stringify(incorrectCommand))).toThrow(/selector/);
    });
});