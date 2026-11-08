---
title: "Terminal"
description: "Run commands in an interactive shell scoped to your workspace in Kilo Desktop."
---

# Terminal

Run commands in an interactive shell next to your chat. Each terminal is a real shell session that starts in the workspace's root folder, so commands run against the same files the agent is working with.

## Working with the agent

The terminal is yours to drive, but it's connected to the chat:

- **The agent can open a terminal for you**, starting in the workspace folder, for you to work in. It won't type or run commands in it (the agent runs its own commands through a separate, permission-gated shell).
- **The agent can read what your terminals print**, such as a dev server or test watcher you're running, to help you spot issues and offer assistance.

## Work in multiple terminals

Open more than one terminal at a time — each is numbered and runs independently, so a command in one doesn't affect another. The tab title updates to show the command that's currently running.

## Select and copy

Drag to select text, double-click to select a word, or triple-click to select a line. Selections are highlighted in every theme. Press **Cmd+C** (macOS) or **Ctrl+Shift+C** (Windows/Linux) to copy the selection. Copying doesn't take **Ctrl+C** away from the shell: it still stops the running command.

## Keyboard shortcuts

| Action | macOS | Windows/Linux |
|---|---|---|
| Copy selection | **Cmd+C** | **Ctrl+Shift+C** |
| Select all | **Cmd+A** | **Ctrl+Shift+A** |
| Clear screen and scrollback | **Cmd+K** | — |
| Move to start / end of line | **Cmd+←** / **Cmd+→** | — |
| Move back / forward one word | **Option+←** / **Option+→** | — |
| Delete to start of line | **Cmd+Backspace** | — |
| Scroll to top / bottom | **Cmd+Home** / **Cmd+End** | **Shift+Home** / **Shift+End** |
| Scroll one page up / down | **Cmd+Page Up** / **Cmd+Page Down** | **Shift+Page Up** / **Shift+Page Down** |

**Cmd+K** also clears the terminal's saved scrollback, so it stays cleared after a reload. It has no effect while a full-screen program such as `vim` or `less` is running.

## Sessions that survive reloads

A terminal keeps its scrollback and stays running across window reloads. If the view reloads, it reconnects to the same session rather than starting over, so a long-running command keeps going. Closing a terminal, though, ends its session and stops whatever it's running.