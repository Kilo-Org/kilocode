# Extension Core Components

This directory contains documentation for the core extension components located in `src/core/`. These
components form the foundation of the VS Code extension and handle essential functionality like assistant
message processing, configuration management, context tracking, and tool execution.

## Directory Structure

- [Assistant Message System](./assistant-message.md) - Message parsing and presentation
- [Configuration Management](./config.md) - Settings and state management
- [Context Management](./context.md) - Context tracking and instructions
- [Task Management](./task.md) - Task execution and lifecycle
- [Tools System](./tools.md) - Tool implementations and execution
- [Environment Setup](./environment.md) - Environment detection and configuration

## Core Architecture

The extension core is organized into several key subsystems:

### Message Processing

The assistant message system handles parsing and presenting AI assistant responses, including tool use detection and content formatting.

### Configuration System

Centralized configuration management through `ContextProxy` that handles both global and workspace-specific settings, secrets management, and state persistence.

### Task Execution

The `Task` class orchestrates the entire conversation flow, API communication, tool execution, and state management for each user interaction.

### Tool Framework

A comprehensive tool system that provides the AI assistant with capabilities to read files, execute commands, search codebases, and modify files.

### Context Tracking

Systems for tracking file access, managing conversation context, and handling workspace-specific rules and workflows.

## Key Design Patterns

- **Proxy Pattern**: `ContextProxy` provides a unified interface to VS Code's extension context
- **Observer Pattern**: Event-driven communication between components
- **Strategy Pattern**: Different diff strategies for file modifications
- **Factory Pattern**: API handler creation based on provider settings
