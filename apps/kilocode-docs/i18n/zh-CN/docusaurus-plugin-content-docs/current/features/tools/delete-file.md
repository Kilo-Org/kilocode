# delete_file

Delete a file or directory from the workspace. This tool provides a safe alternative to rm commands and works across all platforms.

## Parameters

- `path` (required): Relative path to the file or directory to delete

## Description

This tool safely deletes files and directories with user confirmation. For directories, it validates all contained files and shows statistics before deletion.

## Safety Features

- Only deletes files/directories within the workspace
- Requires user confirmation before deletion
- Prevents deletion of write-protected files
- Validates all files against `.kilocodeignore` rules
- For directories: scans recursively and shows statistics (file count, directory count, total size) before deletion
- Blocks directory deletion if any contained file is protected or ignored

## Usage

### Delete a single file

```xml
<delete_file>
<path>temp/old_file.txt</path>
</delete_file>
```

### Delete a directory

```xml
<delete_file>
<path>old_project/</path>
</delete_file>
```

When deleting a directory, the tool:

1. Scans the directory recursively
2. Validates all files can be deleted
3. Shows summary with file count, subdirectory count, and total size
4. Requires user approval before deletion

## Error Handling

The tool provides clear error messages for:

- File or directory does not exist
- File is write-protected
- File is blocked by `.kilocodeignore` rules
- Directory contains protected or ignored files
- Path is outside the workspace
