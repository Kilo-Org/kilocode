# write_to_file

The `write_to_file` tool creates new files or completely replaces existing file content with an interactive approval process. It provides a diff view for reviewing changes before they're applied.

## Parameters

The tool accepts these parameters:

- `path` (required): The path of the file to write to, relative to the current working directory
- `content` (required): The complete content to write to the file
- `line_count` (required): The number of lines in the file, including empty lines

## What It Does

This tool writes content to a specified file, either creating a new file if it doesn't exist or completely overwriting an existing file. All changes require explicit user approval through a diff view interface, where users can review and even edit the proposed changes before they're applied.

## When is it used?

- When Kilo Code needs to create a new file from scratch
- When Kilo Code needs to completely rewrite an existing file
- When creating multiple files for a new project
- When generating configuration files, documentation, or source code
- When you need to review changes before they're applied

## Key Features

- Interactive Approval: Shows changes in a diff view requiring explicit approval before applying
- User Edit Support: Allows editing the proposed content before final approval
- Safety Measures: Detects code omission, validates paths, and prevents truncated content
- Editor Integration: Opens a diff view that scrolls to the first difference automatically
- Content Preprocessing: Handles artifacts from different AI models to ensure clean content
- Access Control: Validates against `.kilocodeignore` restrictions before making changes
- Parent Directories: May handle directory creation through system dependencies
- Complete Replacement: Provides a fully transformed file in a single operation

## Limitations

- Not suitable for existing files: Much slower and less efficient than `apply_diff` for modifying existing files
- Performance with large files: Operation becomes significantly slower with larger files
- Complete overwrite: Replaces entire file content, cannot preserve original content
- Line count required: Needs accurate line count to detect potential content truncation
- Review overhead: The approval process adds extra steps compared to direct edits
- Interactive only: Cannot be used in automated workflows that require non-interactive execution

## How It Works

When the `write_to_file` tool is invoked, it follows this process:

1. **Parameter Validation**: Validates the required parameters and permissions

    - Checks that `path`, `content`, and `line_count` are provided
    - Validates the file is allowed (not restricted by `.kilocodeignore`)
    - Ensures the path is within the workspace boundaries
    - Tracks consecutive mistake counts for missing parameters
    - Shows specific error messages for each validation failure

2. **Content Preprocessing**:

    - Removes code block markers that might be added by AI models
    - Handles escaped HTML entities (specifically for non-Claude models)
    - Strips line numbers if accidentally included in content
    - Performs model-specific processing for different AI providers

3. **Diff View Generation**:

    - Opens a diff view in the editor showing the proposed changes
    - Adds a 300ms delay to ensure UI responsiveness
    - Scrolls automatically to the first difference
    - Highlights changes for easy review

4. **User Approval Process**:

    - Waits for explicit user approval to proceed
    - Allows users to edit the content in the diff view
    - Captures any user edits for the final content
    - Provides option to reject changes entirely
    - Detects and incorporates user modifications into the final result

5. **Safety Validation**:

    - Detects potential content truncation by comparing with provided line count
    - Shows warnings if content appears incomplete
    - Validates file path and access permissions
    - Specifically checks if files are outside the workspace with `isOutsideWorkspace` flag

6. **File Writing**:
    - Writes the approved content (with any user edits) to the file
    - Provides confirmation of successful write
    - Resets the consecutive mistakes counter on success

## Examples When Used

- When creating a new project, Kilo Code generates multiple files but lets you review each before committing changes.
- When setting up configuration files, Kilo Code shows the proposed configuration in a diff view for approval.
- When generating documentation, Kilo Code creates markdown files but lets you make final adjustments in the diff view.
- When developing a prototype, Kilo Code shows complete source files in a diff view where you can fine-tune before saving.

## Usage Examples

Creating a new JSON configuration file:

```
<write_to_file>
<path>config/settings.json</path>
<content>
{
  "apiEndpoint": "https://api.example.com",
  "theme": {
    "primaryColor": "#007bff",
    "secondaryColor": "#6c757d",
    "fontFamily": "Arial, sans-serif"
  },
  "features": {
    "darkMode": true,
    "notifications": true,
    "analytics": false
  },
  "version": "1.0.0"
}
</content>
<line_count>14</line_count>
</write_to_file>
```

Creating a simple HTML file:

```
<write_to_file>
<path>src/index.html</path>
<content>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Application</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script src="app.js"></script>
</body>
</html>
</content>
<line_count>13</line_count>
</write_to_file>
```

Creating a JavaScript module:

```
<write_to_file>
<path>src/utils/helpers.js</path>
<content>
/**
 * Utility functions for the application
 */

export function formatDate(date) {
  return new Date(date).toLocaleDateString();
}

export function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export function debounce(func, delay) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}
</content>
<line_count>18</line_count>
</write_to_file>
```
