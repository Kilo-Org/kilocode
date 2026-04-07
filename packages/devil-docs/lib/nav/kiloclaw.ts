import { NavSection } from "../types"

export const DevilClawNav: NavSection[] = [
  {
    title: "DevilClaw",
    links: [
      { href: "/DevilClaw/overview", children: "Overview" },
      { href: "/DevilClaw/dashboard", children: "Dashboard" },
      { href: "/DevilClaw/pre-installed-software", children: "Pre-installed Software" },
      { href: "/DevilClaw/end-to-end", children: "End to End Config" },
      {
        href: "/DevilClaw/control-ui/overview",
        children: "Control UI",
        subLinks: [
          { href: "/DevilClaw/control-ui/overview", children: "Overview" },
          { href: "/DevilClaw/control-ui/changing-models", children: "Changing Models" },
          { href: "/DevilClaw/control-ui/exec-approvals", children: "Exec Approvals" },
          { href: "/DevilClaw/control-ui/version-pinning", children: "Version Pinning" },
        ],
      },
      {
        href: "/DevilClaw/chat-platforms",
        children: "Chat Platforms",
        subLinks: [
          { href: "/DevilClaw/chat-platforms", children: "Overview" },
          { href: "/DevilClaw/chat-platforms/telegram", children: "Telegram" },
          { href: "/DevilClaw/chat-platforms/discord", children: "Discord" },
          { href: "/DevilClaw/chat-platforms/slack", children: "Slack" },
        ],
      },
      {
        href: "/DevilClaw/development-tools",
        children: "Development Tools",
        subLinks: [
          { href: "/DevilClaw/development-tools", children: "Overview" },
          { href: "/DevilClaw/development-tools/github", children: "GitHub" },
          { href: "/DevilClaw/development-tools/google", children: "Google Workspace" },
        ],
      },
      {
        href: "/DevilClaw/triggers",
        children: "Triggers",
        subLinks: [
          { href: "/DevilClaw/triggers", children: "Overview" },
          { href: "/DevilClaw/triggers/webhooks", children: "Webhooks" },
          { href: "/DevilClaw/triggers/scheduled", children: "Scheduled" },
        ],
      },
      {
        href: "/DevilClaw/tools",
        children: "Tools",
        subLinks: [
          { href: "/DevilClaw/tools", children: "Overview" },
          { href: "/DevilClaw/tools/1password", children: "1Password" },
          { href: "/DevilClaw/tools/brave-search", children: "Brave Search" },
          { href: "/DevilClaw/tools/agentcard", children: "AgentCard" },
        ],
      },
      {
        href: "/DevilClaw/troubleshooting/common-questions",
        children: "Troubleshooting",
        subLinks: [
          { href: "/DevilClaw/troubleshooting/common-questions", children: "Common Questions" },
          { href: "/DevilClaw/troubleshooting/gateway-process", children: "Gateway Process States" },
          { href: "/DevilClaw/troubleshooting/architecture", children: "Architecture Notes" },
        ],
      },
      {
        href: "/DevilClaw/faq/general",
        children: "FAQ",
        subLinks: [
          { href: "/DevilClaw/faq/general", children: "General" },
          { href: "/DevilClaw/faq/pricing", children: "Pricing" },
        ],
      },
    ],
  },
]
