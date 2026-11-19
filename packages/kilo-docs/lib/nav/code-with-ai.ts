import { NavSection } from "../types"

export const CodeWithAiNav: NavSection[] = [
  {
    title: "Platforms",
    links: [
      { href: "/code-with-ai", children: "Overview" },
      {
        href: "/code-with-ai/platforms/vscode",
        children: "VS Code Extension",
        subLinks: [{ href: "/code-with-ai/platforms/vscode/whats-new", children: "What's New" }],
      },
      {
        href: "/code-with-ai/platforms/jetbrains",
        children: "JetBrains Extension",
      },
      {
        href: "/code-with-ai/platforms/cli",
        children: "CLI",
        subLinks: [{ href: "/code-with-ai/platforms/cli-reference", children: "Command Reference" }],
      },
      {
        href: "/code-with-ai/platforms/kilo-connect",
        children: "Kilo Connect",
        subLinks: [
          { href: "/code-with-ai/platforms/slack", children: "Slack" },
          { href: "/code-with-ai/platforms/github", children: "GitHub" },
          { href: "/code-with-ai/platforms/linear", children: "Linear" },
        ],
      },
      { href: "/code-with-ai/platforms/cloud-agent", children: "Cloud Agent" },
      { href: "/code-with-ai/platforms/mobile", children: "Mobile Apps" },
    ],
  },
  {
    title: "Chat & Context",
    links: [
      {
        href: "/code-with-ai/agents/chat-interface",
        children: "Chat Interface",
      },
      {
        href: "/code-with-ai/agents/session-history",
        children: "Session History and Search",
      },
      {
        href: "/code-with-ai/agents/context-mentions",
        children: "Context & Mentions",
      },
      {
        href: "/code-with-ai/agents/model-selection",
        children: "Model Selection",
      },
      {
        href: "/code-with-ai/agents/auto-model",
        children: "Auto Model",
      },
      {
        href: "/code-with-ai/agents/custom-models",
        children: "Custom Models",
        platform: "new",
      },
      {
        href: "/code-with-ai/agents/using-agents",
        children: "Agents",
        subLinks: [
          {
            href: "/code-with-ai/agents/orchestrator-mode",
            children: "Orchestrator Mode",
          },
        ],
      },
      {
        href: "/code-with-ai/agents/goals",
        children: "Session Goals",
      },
    ],
  },
  {
    title: "Productivity Tools",
    links: [
      {
        href: "/code-with-ai/features/autocomplete",
        children: "Autocomplete",
        subLinks: [{ href: "/code-with-ai/features/autocomplete/mistral-setup", children: "Mistral Setup" }],
      },
      { href: "/code-with-ai/features/code-actions", children: "Code Actions" },
      {
        href: "/code-with-ai/features/enhance-prompt",
        children: "Enhance Prompt",
      },
      {
        href: "/code-with-ai/features/git-commit-generation",
        children: "Git Commit Generation",
      },
      { href: "/code-with-ai/features/speech-to-text", children: "Voice Transcription" },
      { href: "/code-with-ai/features/message-feedback", children: "Message Feedback" },
      {
        href: "/code-with-ai/features/browser-use",
        children: "Agent Behavior",
        subLinks: [
          { href: "/code-with-ai/features/task-todo-list", children: "Task Todo List" },
          { href: "/code-with-ai/features/checkpoints", children: "Checkpoints" },
          { href: "/code-with-ai/features/file-encoding", children: "File Encoding" },
        ],
      },
    ],
  },
]
