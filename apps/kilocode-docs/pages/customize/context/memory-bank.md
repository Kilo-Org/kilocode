---
title: "Memory Bank"
description: "Persistent context storage for long-term projects"
---

# Memory Bank

## Overview

{% image src="/docs/img/memory-bank/at-work.png" alt="Executing task with the memory bank" width="350" caption="Kilo Code works more efficiently with Memory Bank enabled, instantly understanding project context and technologies." /%}

### The Problem: AI Memory Loss

AI assistants like Kilo Code face a fundamental limitation: they reset completely between sessions. This "memory loss" means that every time you start a new conversation, you need to re-explain your project's architecture, goals, technologies, and current status. This creates a critical efficiency dilemma: AI models either make edits without proper project understanding (leading to errors and misaligned solutions), or must spend significant time and resources analyzing your entire codebase in each session (which is prohibitively expensive and slow for larger projects)

Without a solution to this memory problem, AI assistants remain powerful but stateless tools that can't truly function as persistent development partners.

### The Solution: Memory Bank

Memory Bank is a system of structured documentation that enables Kilo Code to **better understand your project** and **maintain context across coding sessions**. It transforms your AI assistant from a stateless tool into a persistent development partner with perfect recall of your project details. Kilo Code automatically reads your Memory Bank files to rebuild its understanding of your project whenever you start a new session.

When Memory Bank is active, Kilo Code begins each task with `[Memory Bank: Active]` and a brief summary of your project context, ensuring consistent understanding without repetitive explanations.

## Key Benefits

- **Language Agnostic**: Functions with any programming language or framework
- **Efficient Project Understanding**: Helps Kilo Code understand the purpose and tech stack of a project
- **Context Preservation**: Maintain project knowledge across sessions without needing to scan files in every new session
- **Faster Startup**: Kilo Code immediately comprehends your project context when you begin a new session
- **Self-Documenting Projects**: Create valuable documentation as a byproduct

## How Memory Bank Works

Memory Bank is built on Kilo Code's [Custom Rules](/docs/advanced-usage/custom-rules) feature, providing a specialized framework for project documentation. Memory Bank files are standard markdown files stored in `.kilocode/rules/memory-bank` folder within your project repository. They're not hidden or proprietary - they're regular documentation files that both you and Kilo Code can access.

At the start of every task, Kilo Code reads all Memory Bank files to build a comprehensive understanding of your project. This happens automatically without requiring any action from you. Kilo Code then indicates successful Memory Bank activation with `[Memory Bank: Active]` at the beginning of its response, followed by a brief summary of its understanding of your project.

Files are organized in a hierarchical structure that builds a complete picture of your project:

## Core Memory Bank Files

### brief.md

_This file is created and maintained manually by you_

- The foundation of your project
- High-level overview of what you're building
- Core requirements and goals

Example: _"Building a React web app for inventory management with barcode scanning. The system needs to support multiple warehouses and integrate with our existing ERP system."_

Note: Kilo Code will not edit this file directly but may suggest improvements if it identifies ways to enhance your project brief.

### product.md

- Explains why the project exists
- Describes the problems being solved
- Outlines how the product should work
- User experience goals

Example: _"The inventory system needs to support multiple warehouses and real-time updates. It solves the problem of inventory discrepancies by providing barcode scanning for accurate stock counts."_

### context.md

- The most frequently updated file
- Contains current work focus and recent changes
- Tracks active decisions and considerations
- Next steps for development

Example: _"Currently implementing the barcode scanner component; last session completed the API integration. Next steps include adding error handling for network failures."_

### architecture.md

- Documents the system architecture
- Records key technical decisions
- Lists design patterns in use
- Explains component relationships
- Critical implementation paths

Example: _"Using Redux for state management with a normalized store structure. The application follows a modular architecture with separate services for API communication, state management, and UI components."_

### tech.md

- Lists technologies and frameworks used
- Describes development setup
- Notes technical constraints
- Records dependencies and tool configurations
- Tool usage patterns

Example: _"React 18, TypeScript, Firebase, Jest for testing. Development requires Node.js 16+ and uses Vite as the build tool."_

## Additional Context Files

Create additional files as needed to organize:

- Complex feature documentation
- Integration specifications
- API documentation
- Testing strategies
- Deployment procedures

These additional files help organize more detailed information that doesn't fit neatly into the core files.

### tasks.md

_Optional file for documenting repetitive tasks_

- Stores workflows for tasks that follow similar patterns
- Documents which files need to be modified
- Captures step-by-step procedures
- Records important considerations and gotchas

Example: Adding support for new AI models, implementing API endpoints, or any task that requires doing similar jobs repeatedly.

## Getting Started with Memory Bank

### First-Time Setup

1. Create a `.kilocode/rules/memory-bank/` folder in your project
2. Write a basic project brief in `.kilocode/rules/memory-bank/brief.md`
3. Create a file `.kilocode/rules/memory-bank-instructions.md` and paste there [this document](pathname:///downloads/memory-bank.md)
4. Switch to `Architect` mode
5. Check if a best available AI model is selected, don't use "lightweight" models
6. Ask Kilo Code to "initialize memory bank"
7. Wait for Kilo Code to analyze your project and initialize the Memory Bank files
8. Verify the content of the files to see if the project is described correctly. Update the files if necessary.

### Project Brief Tips

- Start simple - it can be as detailed or high-level as you like
- Focus on what matters most to you
- Kilo Code will help fill in gaps and ask questions
- You can update it as your project evolves

Sample prompt that delivers a reasonably good brief:

```
Provide a concise and comprehensive description of this project, highlighting its main objectives, key features, used technologies and significance. Then, write this description into a text file named appropriately to reflect the project's content, ensuring clarity and professionalism in the writing. Stay brief and short.
```

## Working with Memory Bank

### Core Workflows

#### Memory Bank Initialization

The initialization step is critically important as it establishes the foundation for all future interactions with your project. When you request initialization with the command `initialize memory bank`, Kilo Code will:

1. Perform an exhaustive analysis of your project, including:
    - All source code files and their relationships
    - Configuration files and build system setup
    - Project structure and organization patterns
    - Documentation and comments
    - Dependencies and external integrations
    - Testing frameworks and patterns
2. Create comprehensive memory bank files in the `.kilocode/rules/memory-bank` folder
3. Provide a detailed summary of what it has understood about your project
4. Ask you to verify the accuracy of the generated files

:::warning Important
Take time to carefully review and correct the generated files after initialization. Any misunderstandings or missing information at this stage will affect all future interactions. A thorough initialization dramatically improves Kilo Code's effectiveness, while a rushed or incomplete initialization will permanently limit its ability to assist you effectively.
:::

#### Memory Bank Updates

Memory Bank updates occur when:

1. Kilo Code discovers new project patterns
2. After implementing significant changes
3. When you explicitly request with `update memory bank`
4. When context needs clarification

To execute a Memory Bank update, Kilo Code will:

1. Review ALL project files
2. Document the current state
3. Document insights and patterns
4. Update all memory bank files as needed

You can direct Kilo Code to focus on specific information sources by using commands like `update memory bank using information from @/Makefile`.

#### Regular Task Execution

At the beginning of every task, Kilo Code:

1. Reads ALL memory bank files
2. Includes `[Memory Bank: Active]` at the beginning of its response
3. Provides a brief summary of its understanding of your project
4. Proceeds with the requested task

At the end of a task, Kilo Code may suggest updating the memory bank if significant changes were made, using the phrase: "Would you like me to update memory bank to reflect these changes?"

#### Add Task Workflow

When you complete a repetitive task that follows a similar pattern each time, you can document it for future reference. This is particularly useful for tasks like adding features that follow existing patterns

To document a task, use the command `add task` or `store this as a task`. Kilo Code will:

1. Create or update the `tasks.md` file in the memory bank folder
2. Document the task using current context:
    - Task name and description
    - List of files that need to be modified
    - Step-by-step workflow
    - Important considerations
    - Example implementation

When starting a new task, Kilo Code will check if it matches any documented tasks and follow the established workflow to ensure no steps are missed.

### Key Commands

- `initialize memory bank` - Use when starting a new project
- `update memory bank` - Initiates a comprehensive re-analysis of the contextual documentation for the current task. **Caution:** This is resource-intensive and not recommended for "lightweight" models due to potentially reduced effectiveness. Can be used multiple times, well combinable with specific instructions, e.g. `update memory bank using information from @/Makefile`
- `add task` or `store this as a task` - Documents a repetitive task for future reference

### Status Indicators

Kilo Code uses status indicators to clearly communicate Memory Bank status:

- `[Memory Bank: Active]` - Indicates Memory Bank files were successfully read and are being used
- `[Memory Bank: Missing]` - Indicates Memory Bank files could not be found or are empty

These indicators appear at the beginning of Kilo Code's responses, providing immediate confirmation of Memory Bank status.

### Documentation Updates

Memory Bank updates should automatically occur when:

- You discover new patterns in your project
- After implementing significant changes
- When you explicitly request with `update memory bank`
- When you feel context needs clarification

## Context Window Management

As you work with Kilo Code, your context window will eventually fill up. When you notice responses slowing down or references becoming less accurate:

1. Ask Kilo Code to "update memory bank" to document the current state
2. Start a new conversation/task
3. Kilo Code will automatically access your Memory Bank in the new conversation

This process ensures continuity across multiple sessions without losing important context.

## Handling Inconsistencies

If Kilo Code detects inconsistencies between memory bank files:

1. It will prioritize information from `brief.md` as the source of truth
2. Note any discrepancies to you
3. Continue working with the most reliable information available

This ensures that even with imperfect documentation, Kilo Code can still function effectively.

## Frequently Asked Questions

### Where are the memory bank files stored?

The Memory Bank files are regular markdown files stored in your project repository, typically in a `.kilocode/rules/memory-bank/` folder. They're not hidden system files - they're designed to be part of your project documentation.

### How often should I update the memory bank?

Update the Memory Bank after significant milestones or changes in direction. For active development, updates every few sessions can be helpful. Use the "update memory bank" command when you want to ensure all context is preserved.

### Can I edit memory bank files manually?

Yes! While Kilo Code manages most of the files, you can edit any of them manually. The `brief.md` file is specifically designed to be maintained by you. Manual edits to other files will be respected by Kilo Code.

### What happens if memory bank files are missing?

If memory bank files are missing, Kilo Code will indicate this with `[Memory Bank: Missing]` at the beginning of its response and suggest initializing the memory bank.

### Does Memory Bank work with all AI models?

Memory Bank works with all AI models, but more powerful models will create more comprehensive and accurate memory bank files. Lightweight models may struggle with the resource-intensive process of analyzing and updating memory bank files.

### Can I use Memory Bank with multiple projects?

Yes! Each project has its own Memory Bank in its `.kilocode/rules/memory-bank/` folder. Kilo Code will automatically use the correct Memory Bank for each project.

### Doesn't Memory Bank use up my context window?

Yes, Memory Bank does consume some of your context window at the beginning of each session as it loads all memory bank files. However, this is a strategic tradeoff that significantly improves overall efficiency. By front-loading project context:

- You eliminate repetitive explanations that would consume even more context over time
- You reach productive outcomes with fewer back-and-forth exchanges
- You maintain consistent understanding throughout your session

Testing shows that while Memory Bank uses more tokens initially, it dramatically reduces the total number of interactions needed to achieve results. This means less time explaining and more time building.

## Best Practices

### Getting Started

- Start with a basic project brief and let the structure evolve
- Let Kilo Code help create the initial structure
- Review and adjust files as needed to match your workflow
- Verify the accuracy of generated files after initialization

### Ongoing Work

- Let patterns emerge naturally as you work
- Don't force documentation updates - they should happen organically
- Trust the process - the value compounds over time
- Watch for context confirmation at the start of sessions
- Use the status indicators to confirm Memory Bank is active

### Documentation Flow

- `brief.md` is your foundation
- `context.md` changes most frequently
- All files collectively maintain project intelligence
- Update after significant milestones or changes in direction

### Optimizing Memory Bank Performance

- Keep memory bank files concise and focused
- Use additional files for detailed documentation
- Update regularly but not excessively
- Use specific update commands when focusing on particular aspects

## Remember

The Memory Bank is Kilo Code's only link to previous work. Its effectiveness depends entirely on maintaining clear, accurate documentation and confirming context preservation in every interaction. When you see `[Memory Bank: Active]` at the beginning of a response, you can be confident that Kilo Code has a comprehensive understanding of your project.
