# Prompt Debugger Components

## EditableCodeBlock

The `EditableCodeBlock` component provides a code editor with syntax highlighting for the prompt debugger. It allows users to edit template code while seeing syntax highlighting in real-time.

### Implementation Details

The component uses a layered approach:

1. A hidden textarea captures all user input and keyboard events
2. A visible div displays the syntax-highlighted code using Shiki
3. The two layers are synchronized to provide a seamless editing experience

### Key Features

- Real-time syntax highlighting using Shiki (same engine as VS Code)
- Support for multiple programming languages
- Tab key handling for proper indentation
- Automatic height adjustment based on content
- Cursor and selection styling that matches VS Code

### Usage

```tsx
import EditableCodeBlock from "./EditableCodeBlock"

// Basic usage
<EditableCodeBlock
  value={code}
  onChange={setCode}
  language="javascript"
/>

// With all props
<EditableCodeBlock
  value={code}
  onChange={setCode}
  language="javascript"
  placeholder="Enter your code here..."
  className="custom-class"
  rows={10}
/>
```

### Props

| Prop          | Type     | Default              | Description                                      |
| ------------- | -------- | -------------------- | ------------------------------------------------ |
| `value`       | string   | (required)           | The code content to display and edit             |
| `onChange`    | function | (required)           | Callback function when the code changes          |
| `language`    | string   | (required)           | The programming language for syntax highlighting |
| `placeholder` | string   | "Enter code here..." | Placeholder text when the editor is empty        |
| `className`   | string   | undefined            | Additional CSS class names                       |
| `rows`        | number   | 5                    | Minimum number of rows to display                |

### How It Works

The component uses a technique where:

1. A transparent textarea captures all user input
2. The input is processed and passed to Shiki for syntax highlighting
3. The highlighted HTML is rendered in a div positioned behind the textarea
4. CSS is used to ensure the cursor and selection appear correctly

This approach provides the best of both worlds: the native editing experience of a textarea with the visual richness of syntax highlighting.

### Maintenance Notes

- The component extends the functionality of the existing `CodeBlock` component but is fully independent to avoid conflicts with upstream repositories
- Shiki is used for syntax highlighting to maintain consistency with the rest of the application
- The component is designed to be lightweight and not dependent on external editor libraries
