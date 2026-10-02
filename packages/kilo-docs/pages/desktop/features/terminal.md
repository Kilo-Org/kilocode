---
title: "Terminal"
description: "Run commands in an interactive shell scoped to your workspace in Kilo Desktop."
---

# Terminal

Run commands in an interactive shell next to your chat. Each terminal is a real shell session that starts in the workspace's root folder, so commands run against the same files the agent is working with.

## Working with the agent

The terminal is yours to drive, but it's connected to the chat:

- **The agent can open a terminal for you**, starting in the workspace folder, for you to work in. It won't type or run commands in it (the agent runs its own commands through a separate, permission-gated shell).
- **The agent can read what your terminals print**, such as a dev server or test watcher you're running, to help you spot issues and offer assistance, but it can't write commands to your terminal.

## Work in multiple terminals

Open more than one terminal at a time — each is numbered and runs independently, so a command in one doesn't affect another. The tab title updates to show the command that's currently running.

## Sessions that survive reloads

A terminal keeps its scrollback and stays running across window reloads. If the view reloads, it reconnects to the same session rather than starting over, so a long-running command keeps going. Closing a terminal, though, ends its session and stops whatever it's running.