# list_files

The `list_files` tool displays the files and directories within a specified location. It helps Kilo Code understand your project structure and navigate your codebase effectively.

## Parameters

The tool accepts these parameters:

- `path` (required): The path of the directory to list contents for, relative to the current working directory
- `recursive` (optional): Whether to list files recursively. Use `true` for recursive listing, `false` or omit for top-level only.

## What It Does

This tool lists all files and directories in a specified location, providing a clear overview of your project structure. It can either show just the top-level contents or recursively explore subdirectories.

## When is it used?

- When Kilo Code needs to understand your project structure
- When Kilo Code explores what files are available before reading specific ones
- When Kilo Code maps a codebase to better understand its organization
- Before using more targeted tools like `read_file` or `search_files`
- When Kilo Code needs to check for specific file types (like configuration files) across a project

## Key Features

- Lists both files and directories with directories clearly marked
- Offers both recursive and non-recursive listing modes
- Intelligently ignores common large directories like `node_modules` and `.git` in recursive mode
- Respects `.gitignore` rules when in recursive mode
- Marks files ignored by `.kilocodeignore` with a lock symbol (🔒) when `showKiloCodeIgnoredFiles` is enabled
- Optimizes performance with level-by-level directory traversal
- Sorts results to show directories before their contents, maintaining a logical hierarchy
- Presents results in a clean, organized format
- Automatically creates a mental map of your project structure

## Limitations

- File listing is capped at about 200 files by default to prevent performance issues
- Has a 10-second timeout for directory traversal to prevent hanging on complex directory structures
- When the file limit is hit, it adds a note suggesting to use `list_files` on specific subdirectories
- Not designed for confirming the existence of files you've just created
- May have reduced performance in very large directory structures
- Cannot list files in root or home directories for security reasons

## How It Works

When the `list_files` tool is invoked, it follows this process:

1. **Parameter Validation**: Validates the required `path` parameter and optional `recursive` parameter
2. **Path Resolution**: Resolves the relative path to an absolute path
3. **Security Checks**: Prevents listing files in sensitive locations like root or home directories
4. **Directory Scanning**:
    - For non-recursive mode: Lists only the top-level contents
    - For recursive mode: Traverses the directory structure level by level with a 10-second timeout
    - If timeout occurs, returns partial results collected up to that point
5. **Result Filtering**:
    - In recursive mode, skips common large directories like `node_modules`, `.git`, etc.
    - Respects `.gitignore` rules when in recursive mode
    - Handles `.kilocodeignore` patterns, either hiding files or marking them with a lock symbol
6. **Formatting**:
    - Marks directories with a trailing slash (`/`)
    - Sorts results to show directories before their contents for logical hierarchy
    - Marks ignored files with a lock symbol (🔒) when `showKiloCodeIgnored` is enabled
    - Caps results at 200 files by default with a note about using subdirectories
    - Organizes results for readability

## File Listing Format

The file listing results include:

- Each file path is displayed on its own line
- Directories are marked with a trailing slash (`/`)
- Files ignored by `.kilocodeignore` are marked with a lock symbol (🔒) when `showKiloCodeIgnored` is enabled
- Results are sorted logically with directories appearing before their contents
- When the file limit is reached, a message appears suggesting to use `list_files` on specific subdirectories

Example output format:

```
src/
src/components/
src/components/Button.tsx
src/components/Header.tsx
src/utils/
src/utils/helpers.ts
src/index.ts
...
File listing truncated (showing 200 of 543 files). Use list_files on specific subdirectories for more details.
```

When `.kilocodeignore` files are used and `showKiloCodeIgnored` is enabled:

```
src/
src/components/
src/components/Button.tsx
src/components/Header.tsx
🔒 src/secrets.json
src/utils/
src/utils/helpers.ts
src/index.ts
```

## Examples When Used

- When starting a new task, Kilo Code may list the project files to understand its structure before diving into specific code.
- When asked to find specific types of files (like all JavaScript files), Kilo Code first lists directories to know where to look.
- When providing recommendations for code organization, Kilo Code examines the current project structure first.
- When setting up a new feature, Kilo Code lists related directories to understand the project conventions.

## Usage Examples

Listing top-level files in the current directory:

```
<list_files>
<path>.</path>
</list_files>
```

Recursively listing all files in a source directory:

```
<list_files>
<path>src</path>
<recursive>true</recursive>
</list_files>
```

Examining a specific project subdirectory:

```
<list_files>
<path>src/components</path>
<recursive>false</recursive>
</list_files>
```
