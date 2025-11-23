# delete_file

The `delete_file` tool safely removes files from the workspace with user confirmation. It provides a cross-platform alternative to shell commands like `rm` with built-in safety features.

## Parameters

The tool accepts this parameter:

- `path` (required): The relative path to the file to delete from the current working directory

## What It Does

This tool deletes a specified file from the workspace after receiving user confirmation. It provides a safer, platform-independent alternative to executing shell delete commands directly.

## When is it used?

- When Kilo Code needs to remove temporary or generated files
- When cleaning up old files during refactoring
- When removing outdated configuration files
- When deleting test files that are no longer needed
- When removing files as part of a larger file reorganization task

## Key Features

- **User Confirmation**: Requires explicit user approval before deleting any file
- **Workspace Safety**: Only allows deletion of files within the workspace boundaries
- **Cross-Platform**: Works consistently across all operating systems (Windows, macOS, Linux)
- **Access Control**: Respects `.kilocodeignore` restrictions and file permissions
- **Error Handling**: Provides clear error messages if deletion fails or file doesn't exist

## Limitations

- **Single File Only**: Cannot delete multiple files in one operation
- **No Directory Deletion**: Directories cannot be deleted with this tool
- **Workspace Boundary**: Cannot delete files outside the workspace directory
- **Protected Files**: Cannot delete files blocked by `.kilocodeignore`
- **Interactive Only**: Requires user confirmation, cannot be used in automated workflows

## How It Works

When the `delete_file` tool is invoked, it follows this process:

1. **Parameter Validation**: Validates the required `path` parameter

    - Checks that the path is provided
    - Ensures the path is properly formatted
    - Validates it's a relative path within the workspace

2. **Path Resolution**: Resolves the relative path to an absolute path

    - Converts the relative path to an absolute workspace path
    - Verifies the file exists at the specified location
    - Checks that the path points to a file, not a directory

3. **Access Control Check**:

    - Validates the file is not restricted by `.kilocodeignore` rules
    - Ensures the file is within workspace boundaries
    - Verifies user has permission to delete the file

4. **User Confirmation**:

    - Presents the file path to the user for confirmation
    - Waits for explicit user approval to proceed
    - Allows user to cancel the deletion operation

5. **File Deletion**:

    - Deletes the file from the filesystem if approved
    - Provides confirmation of successful deletion
    - Returns appropriate error message if deletion fails

6. **Error Handling**:
    - Reports if file doesn't exist
    - Notifies if path points to a directory
    - Indicates if file is protected or inaccessible
    - Shows clear error messages for any failure conditions

## Examples When Used

- When refactoring code, Kilo Code might delete deprecated files after migrating their functionality to new modules.
- When cleaning up a project, Kilo Code removes temporary files or build artifacts that are no longer needed.
- When implementing new features, Kilo Code might delete old test files before creating new ones with updated test cases.
- When reorganizing file structure, Kilo Code deletes files from old locations after copying them to new locations.

## Usage Examples

Here are several scenarios demonstrating how the `delete_file` tool is used.

### Deleting a Single File

To delete a temporary file:

**Input:**

```xml
<delete_file>
<path>temp/old_file.txt</path>
</delete_file>
```

**Expected Flow:**

1. User receives confirmation prompt showing the file path
2. User approves the deletion
3. File is removed from the filesystem
4. Confirmation message is returned

### Deleting a Configuration File

To remove an outdated configuration file:

**Input:**

```xml
<delete_file>
<path>config/deprecated-settings.json</path>
</delete_file>
```

**Expected Flow:**

1. Tool validates the file exists
2. User confirms the deletion
3. Configuration file is removed
4. Success message is returned

### Deleting a Test File

To remove an old test file during refactoring:

**Input:**

```xml
<delete_file>
<path>src/__tests__/old-component.test.ts</path>
</delete_file>
```

**Expected Flow:**

1. Path is validated within workspace
2. User approves deletion
3. Test file is removed
4. Confirmation provided

### Attempting to Delete a Non-Existent File

If the specified file does not exist:

**Input:**

```xml
<delete_file>
<path>non_existent_file.txt</path>
</delete_file>
```

**Expected Output (Error):**

```
Error: File not found at path 'non_existent_file.txt'.
```

### Attempting to Delete a Directory

If trying to delete a directory instead of a file:

**Input:**

```xml
<delete_file>
<path>src/components</path>
</delete_file>
```

**Expected Output (Error):**

```
Error: Cannot delete directories.
```

### Attempting to Delete a Protected File

If the file is blocked by `.kilocodeignore` rules:

**Input:**

```xml
<delete_file>
<path>.env</path>
</delete_file>
```

**Expected Output (Error):**

```
Error: Access denied to file '.env' due to .kilocodeignore rules.
```

## Best Practices

When using the `delete_file` tool:

- **Verify First**: Use `list_files` or `read_file` to confirm the file exists before attempting deletion
- **Single Operations**: Delete files one at a time rather than attempting batch operations
- **Document Changes**: Explain to the user why a file is being deleted
- **Check Dependencies**: Ensure no other files depend on the file being deleted
- **Consider Alternatives**: For temporary cleanup, consider if the file could be modified instead of deleted
