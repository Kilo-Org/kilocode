---
title: "Code Actions"
description: "Quick code actions and refactoring with Kilo Code"
---

# Code Actions

Code Actions are a powerful feature of VS Code that provide quick fixes, refactorings, and other code-related suggestions directly within the editor. Kilo Code integrates with this system to offer AI-powered assistance for common coding tasks.

## What are Code Actions?

Code Actions appear as a lightbulb icon (💡) in the editor gutter (the area to the left of the line numbers). They can also be accessed via the right-click context menu, or via keyboard shortcut. They are triggered when:

- You select a range of code.
- Your cursor is on a line with a problem (error, warning, or hint).
- You invoke them via command.

Clicking the lightbulb, right-clicking and selecting "Kilo Code", or using the keyboard shortcut (`Ctrl+.` or `Cmd+.` on macOS, by default), displays a menu of available actions.

{% image src="/docs/img/code-actions/code-actions-1.png" alt="VS Code code actions in line with code" width="500" /%}

## Kilo Code's Code Actions

Kilo Code provides the following Code Actions:

- **Add to Context:** Quickly adds the selected code to your chat with Kilo, including line numbers so Kilo knows exactly where the code is from. It's listed first in the menu for easy access. (More details below).
- **Explain Code:** Asks Kilo Code to explain the selected code.
- **Fix Code:** Asks Kilo Code to fix problems in the selected code (available when diagnostics are present).
- **Improve Code:** Asks Kilo Code to suggest improvements to the selected code.

### Add to Context Deep Dive

The **Add to Context** action is listed first in the Code Actions menu so you can quickly add code snippets to your conversation. When you use it, Kilo Code includes the filename and line numbers along with the code.

This helps Kilo understand the exact context of your code within the project, allowing it to provide more relevant and accurate assistance.

{% image src="/docs/img/code-actions/add-to-context.gif" alt="code actions - add to context gif" width="80%" /%}

**Example Chat Input:**

```
Can you explain this function?
@myFile.js:15:25
```

_(Where `@myFile.js:15:25` represents the code added via "Add to Context")_

Each of these actions can be performed "in a new task" or "in the current task."

## Using Code Actions

There are three main ways to use Kilo Code's Code Actions:

### 1. From the Lightbulb (💡)

1.  **Select Code:** Select the code you want to work with. You can select a single line, multiple lines, or an entire block of code.
2.  **Look for the Lightbulb:** A lightbulb icon will appear in the gutter next to the selected code (or the line with the error/warning).
3.  **Click the Lightbulb:** Click the lightbulb icon to open the Code Actions menu.
4.  **Choose an Action:** Select the desired Kilo Code action from the menu.
5.  **Review and Approve:** Kilo Code will propose a solution in the chat panel. Review the proposed changes and approve or reject them.

### 2. From the Right-Click Context Menu

1.  **Select Code:** Select the code you want to work with.
2.  **Right-Click:** Right-click on the selected code to open the context menu.
3.  **Choose "Kilo Code":** Select the "Kilo Code" option from the context menu. A submenu will appear with the available Kilo Code actions.
4.  **Choose an Action:** Select the desired action from the submenu.
5.  **Review and Approve:** Kilo Code will propose a solution in the chat panel. Review the proposed changes and approve or reject them.

### 3. From the Command Palette

1.  **Select Code:** Select the code you want to work with.
2.  **Open the Command Palette:** Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
3.  **Type a Command:** Type "Kilo Code" to filter the commands, then choose the relevant code action (e.g., "Kilo Code: Explain Code"). You can also type the start of the command, like "Kilo Code: Explain", and select from the filtered list.
4.  **Review and Approve:** Kilo Code will propose a solution in the chat panel. Review the proposed changes and approve or reject them.

## Code Actions and Current Task

Each code action gives you two options:

- **in New Task:** Select this to begin a conversation with Kilo centered around this code action.
- **in Current Task:** If a conversation has already begun, this option will add the code action as an additional message.

## Customizing Code Action Prompts

You can customize the prompts used for each Code Action by modifying the "Support Prompts" in the **Prompts** tab. This allows you to fine-tune the instructions given to the AI model and tailor the responses to your specific needs.

1.  **Open the Prompts Tab:** Click the {% codicon name="notebook" /%} icon in the Kilo Code top menu bar.
2.  **Find "Support Prompts":** You will see the support prompts, including "Enhance Prompt", "Explain Code", "Fix Code", and "Improve Code".
3.  **Edit the Prompts:** Modify the text in the text area for the prompt you want to customize. You can use placeholders like `${filePath}` and `${selectedText}` to include information about the current file and selection.
4.  **Click "Done":** Save your changes.

By using Kilo Code's Code Actions, you can quickly get AI-powered assistance directly within your coding workflow. This can save you time and help you write better code.
