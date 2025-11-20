---
sidebar_label: Your First Task
---

# Starting Your First Task with Kilo Code

<YouTubeEmbed
  url="https://www.youtube.com/watch?v=pO7zRLQS-p0"
/>

This quick tour shows how Kilo Code handles a simple request from start to finish.

After you [set up Kilo Code](/getting-started/setting-up), follow these steps:

## Step 1: Open the Kilo Code Panel

Click the Kilo Code icon (<img src="/docs/img/kilo-v1.svg" width="12" />) in the VS Code Primary Side Bar (vertical bar on the side of the window) to open the chat interface. If you don't see the icon, verify the extension is [installed](/getting-started/installing) and enabled.

<img src="/docs/img/your-first-task/your-first-task.png" alt="Kilo Code icon in VS Code Primary Side Bar" width="800" />

_The Kilo Code icon in the Primary Side Bar opens the chat interface._

## Step 2: Type Your Task

Type a clear, concise description of what you want Kilo Code to do in the chat box at the bottom of the panel. Examples of effective tasks:

- "Create a file named `hello.txt` containing 'Hello, world!'."
- "Write a Python function that adds two numbers."
- "Create an HTML file for a simple website with the title 'Kilo test'"

No special commands or syntax needed—just use plain English.

<img src="/docs/img/your-first-task/your-first-task-6.png" alt="Typing a task in the Kilo Code chat interface" width="500" />
*Enter your task in natural language - no special syntax required.*

## Step 3: Send Your Task

Press Enter or click the Send icon (<Codicon name="send" />) to the right of the input box.

## Step 4: Review and Approve Actions

Kilo Code analyzes your request and proposes specific actions. These may include:

- **Reading files:** Shows file contents it needs to access
- **Writing to files:** Displays a diff with proposed changes (added lines in green, removed in red)
- **Executing commands:** Shows the exact command to run in your terminal
- **Using the Browser:** Outlines browser actions (click, type, etc.)
- **Asking questions:** Requests clarification when needed to proceed

<img src="/docs/img/your-first-task/your-first-task-7.png" alt="Reviewing a proposed file creation action" width="400" />
*Kilo Code shows exactly what action it wants to perform and waits for your approval.*

- In **Code** mode, writing capabilities are on by default.
- In **Architect** and **Ask** modes, Kilo Code won't write code.

:::tip

The level of autonomy is configurable, allowing you to make the agent more or less autonomous.

You can learn more about [using modes](/basic-usage/using-modes) and [auto-approving actions](/features/auto-approving-actions).

:::

## Step 5: Iterate

Kilo Code works iteratively. After each action, it waits for your feedback before proposing the next step. Continue this review-approve cycle until your task is complete.

<img src="/docs/img/your-first-task/your-first-task-8.png" alt="Final result of a completed task showing the iteration process" width="500" />
*After completing the task, Kilo Code shows the final result and awaits your next instruction.*

## Conclusion

You've completed your first task. Along the way you learned:

- How to interact with Kilo Code using natural language
- Why approval keeps you in control
- How iteration lets the AI refine its work

Ready for more? Explore different [modes](/basic-usage/using-modes) or try [auto-approval](/features/auto-approving-actions) to speed up repetitive tasks.
