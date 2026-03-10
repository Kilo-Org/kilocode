import { NavSection } from "../types"

export const AutomateNav: NavSection[] = [
  {
    title: "Agents",
    links: [
      { href: "/automate", children: "Overview" },
      { href: "/automate/integrations", children: "Integrations" },
      {
        href: "/automate/code-reviews/overview",
        children: "Code Reviews",
        subLinks: [
          { href: "/automate/code-reviews/overview", children: "Overview" },
          { href: "/automate/code-reviews/github", children: "GitHub" },
          { href: "/automate/code-reviews/gitlab", children: "GitLab" },
        ],
      },
      { href: "/automate/agent-manager", children: "Agent Manager", platform: "next" },
      {
        href: "/automate/kiloclaw/overview",
        children: "KiloClaw",
        subLinks: [
          { href: "/automate/kiloclaw/overview", children: "Overview" },
          { href: "/automate/kiloclaw/dashboard", children: "Dashboard" },
          {
            href: "/automate/kiloclaw/pre-installed-software",
            children: "Pre-installed Software",
          },
          { href: "/automate/kiloclaw/control-ui", children: "Control UI" },
          {
            href: "/automate/kiloclaw/chat-platforms",
            children: "Chat Platforms",
          },
          {
            href: "/automate/kiloclaw/troubleshooting",
            children: "Troubleshooting",
          },
          { href: "/automate/kiloclaw/pricing", children: "Pricing" },
        ],
      },
    ],
  },
  {
    title: "Extending Kilo",
    links: [
      { href: "/automate/extending/local-models", children: "Local Models" },
      {
        href: "/automate/extending/shell-integration",
        children: "Shell Integration",
      },
      {
        href: "/automate/extending/auto-launch",
        children: "Auto-launch Configuration",
        platform: "classic",
      },
      {
        href: "/automate/mcp/overview",
        children: "MCP",
        subLinks: [
          { href: "/automate/mcp/overview", children: "MCP Overview" },
          {
            href: "/automate/mcp/using-in-kilo-code",
            children: "Configuring MCP Servers",
          },
          { href: "/automate/mcp/what-is-mcp", children: "What is MCP" },
          {
            href: "/automate/mcp/server-transports",
            children: "Server Transports",
          },
          { href: "/automate/mcp/mcp-vs-api", children: "MCP vs API" },
        ],
      },
    ],
  },
  {
    title: "Tools",
    links: [
      { href: "/automate/how-tools-work", children: "How Tools Work", platform: "classic" },
      { href: "/automate/tools", children: "Tools Details", platform: "classic" },
    ],
  },
]
