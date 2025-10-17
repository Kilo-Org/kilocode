
# search_files

The `search_files` tool performs regex searches across multiple files in your project. It helps Kilo Code locate specific code patterns, text, or other content throughout your codebase with contextual results.

## Parameters

The tool accepts these parameters:

- `path` (required): The path of the directory to search in, relative to the current working directory
- `regex` (required): The regular expression pattern to search for (uses Rust regex syntax)
- `file_pattern` (optional): Glob pattern to filter files (e.g., '*.ts' for TypeScript files)

## What It Does

This tool searches across files in a specified directory using regular expressions, showing each match with surrounding context. It's like having a powerful "Find in Files" feature that works across the entire project structure.

## When is it used?

- When Kilo Code needs to find where specific functions or variables are used
- When Kilo Code helps with refactoring and needs to understand usage patterns
- When Kilo Code needs to locate all instances of a particular code pattern
- When Kilo Code searches for text across multiple files with filtering capabilities

## Key Features

- Searches across multiple files in a single operation using high-performance Ripgrep
- Shows context around each match (1 line before and after)
- Filters files by type using glob patterns (e.g., only TypeScript files)
- Provides line numbers for easy reference
- Uses powerful regex patterns for precise searches
- Automatically limits output to 300 results with notification
- Truncates lines longer than 500 characters with "[truncated...]" marker
- Intelligently combines nearby matches into single blocks for readability

## Limitations

- Works best with text-based files (not effective for binary files like images)
- Performance may slow with extremely large codebases
- Uses Rust regex syntax, which may differ slightly from other regex implementations
- Cannot search within compressed files or archives
- Default context size is fixed (1 line before and after)
- May display varying context sizes when matches are close together due to result grouping

## How It Works

When the `search_files` tool is invoked, it follows this process:

1. **Parameter Validation**: Validates the required `path` and `regex` parameters
2. **Path Resolution**: Resolves the relative path to an absolute path
3. **Search Execution**:
   - Uses Ripgrep (rg) for high-performance text searching
   - Applies file pattern filtering if specified
   - Collects matches with surrounding context
4. **Result Formatting**:
   - Formats results with file paths, line numbers, and context
   - Displays 1 line of context before and after each match
   - Structures output for easy readability
   - Limits results to a maximum of 300 matches with notification
   - Truncates lines longer than 500 characters
   - Merges nearby matches into contiguous blocks

## Search Results Format

The search results include:

- Relative file paths for each matching file (prefixed with #)
- Context lines before and after each match (1 line by default)
- Line numbers padded to 3 spaces followed by ` | ` and the line content
- A separator line (----) after each match group

Example output format:
```
# rel/path/to/app.ts
 11 |   // Some processing logic here
 12 |   // TODO: Implement error handling
 13 |   return processedData;
----

# Showing first 300 of 300+ results. Use a more specific search if necessary.
```

When matches occur close to each other, they're merged into a single block rather than shown as separate results:

```
# rel/path/to/auth.ts
 13 | // Some code here
 14 | // TODO: Add proper validation
 15 | function validateUser(credentials) {
 16 |   // TODO: Implement rate limiting
 17 |   return checkDatabase(credentials);
----
```

## Examples When Used

- When asked to refactor a function, Kilo Code first searches for all places the function is used to ensure comprehensive changes.
- When investigating bugs, Kilo Code searches for similar patterns to identify related issues across the codebase.
- When addressing technical debt, Kilo Code locates all TODO comments across the project.
- When analyzing dependencies, Kilo Code finds all imports of a particular module.

## Usage Examples

Searching for TODO comments in all JavaScript files:
```
<search_files>
<path>src</path>
<regex>TODO|FIXME</regex>
<file_pattern>*.js</file_pattern>
</search_files>
```

Finding all usages of a specific function:
```
<search_files>
<path>.</path>
<regex>function\s+calculateTotal</regex>
<file_pattern>*.{js,ts}</file_pattern>
</search_files>
```

Searching for a specific import pattern across the entire project:
```
<search_files>
<path>.</path>
<regex>import\s+.*\s+from\s+['"]@components/</regex>
</search_files>
```
