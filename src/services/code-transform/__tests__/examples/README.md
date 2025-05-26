# Code Transform Test Examples

This directory contains example files for testing the code transformation functionality, particularly the identifier-based code movement features.

## Directory Structure

- `/move/input/`: Contains source files used as input for tests
- `/move/expected/`: Contains expected output files after transformations
- `/move/temp/`: Temporary directory used during test execution (not committed to git)

## Adding New Tests

To add a new test case:

1. Create input files in the `/move/input/` directory
2. Create expected output files in the `/move/expected/` directory
3. Update the test file (`moveCode.test.ts`) to include the new test case

## Test File Naming Conventions

- Input files: `descriptive-name.ts`
- Expected output files after transformation: `descriptive-name.ts` and `target-file.ts`

## Notes

- Test fixtures are excluded from TypeScript compilation in the main tsconfig.json
- Temporary and generated files (*.actual.*) are git-ignored
- Tests use real file operations and do not mock JSCodeshift