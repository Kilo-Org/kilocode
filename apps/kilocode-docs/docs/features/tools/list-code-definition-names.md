# list_code_definition_names

The `list_code_definition_names` tool provides a structural overview of your codebase by listing code definitions from source files at the top level of a specified directory. It helps Kilo Code understand code architecture by displaying line numbers and definition snippets.

## Parameters

The tool accepts these parameters:

- `path` (required): The path of the directory to list top level source code definitions for, relative to the current working directory

## What It Does

This tool scans source code files at the top level of a specified directory and extracts code definitions like classes, functions, and interfaces. It displays the line numbers and actual code for each definition, providing a quick way to map the important components of your codebase.

## When is it used?

- When Kilo Code needs to understand your codebase architecture quickly
- When Kilo Code needs to locate important code constructs across multiple files
- When planning refactoring or extensions to existing code
- Before diving into implementation details with other tools
- When identifying relationships between different parts of your codebase

## Key Features

- Extracts classes, functions, methods, interfaces, and other definitions from source files
- Displays line numbers and actual source code for each definition
- Supports multiple programming languages including JavaScript, TypeScript, Python, Rust, Go, C++, C, C#, Ruby, Java, PHP, Swift, and Kotlin
- Processes only files at the top level of the specified directory (not subdirectories)
- Limits processing to a maximum of 50 files for performance
- Focuses on top-level definitions to avoid overwhelming detail
- Helps identify code organization patterns across the project
- Creates a mental map of your codebase's architecture
- Works in conjunction with other tools like `read_file` for deeper analysis

## Limitations

- Only identifies top-level definitions, not nested ones
- Only processes files at the top level of the specified directory, not subdirectories
- Limited to processing a maximum of 50 files per request
- Dependent on language-specific parsers, with varying detection quality
- May not recognize all definitions in languages with complex syntax
- Not a substitute for reading code to understand implementation details
- Cannot detect runtime patterns or dynamic code relationships
- Does not provide information about how definitions are used
- May have reduced accuracy with highly dynamic or metaprogrammed code
- Limited to specific languages supported by the implemented Tree-sitter parsers

## How It Works

When the `list_code_definition_names` tool is invoked, it follows this process:

1. **Parameter Validation**: Validates the required `path` parameter
2. **Path Resolution**: Resolves the relative path to an absolute path
3. **Directory Scanning**: Scans only the top level of the specified directory for source code files (not recursive)
4. **File Filtering**: Limits processing to a maximum of 50 files
5. **Language Detection**: Identifies file types based on extensions (.js, .jsx, .ts, .tsx, .py, .rs, .go, .cpp, .hpp, .c, .h, .cs, .rb, .java, .php, .swift, .kt, .kts)
6. **Code Parsing**: Uses Tree-sitter to parse code and extract definitions through these steps:
   - Parsing file content into an Abstract Syntax Tree (AST)
   - Creating a query using a language-specific query string
   - Sorting the captures by their position in the file
7. **Result Formatting**: Outputs definitions with line numbers and actual source code

## Output Format

The output shows file paths followed by line numbers and the actual source code of each definition. For example:

```
src/utils.js:
0--0 | export class HttpClient {
5--5 | formatDate() {
10--10 | function parseConfig(data) {

src/models/User.js:
0--0 | interface UserProfile {
10--10 | export class User {
20--20 | function createUser(data) {
```

Each line displays:
- The start and end line numbers of the definition
- The pipe symbol (|) as a separator
- The actual source code of the definition

This output format helps you quickly see both where definitions are located in the file and their implementation details.

## Examples When Used

- When starting a new task, Kilo Code first lists key code definitions to understand the overall structure of your project.
- When planning refactoring work, Kilo Code uses this tool to identify classes and functions that might be affected.
- When exploring unfamiliar codebases, Kilo Code maps the important code constructs before diving into implementation details.
- When adding new features, Kilo Code identifies existing patterns and relevant code definitions to maintain consistency.
- When troubleshooting bugs, Kilo Code maps the codebase structure to locate potential sources of the issue.
- When planning architecture changes, Kilo Code identifies all affected components across files.

## Usage Examples

Listing code definitions in the current directory:
```
<list_code_definition_names>
<path>.</path>
</list_code_definition_names>
```

Examining a specific module's structure:
```
<list_code_definition_names>
<path>src/components</path>
</list_code_definition_names>
```

Exploring a utility library:
```
<list_code_definition_names>
<path>lib/utils</path>
</list_code_definition_names>
```
