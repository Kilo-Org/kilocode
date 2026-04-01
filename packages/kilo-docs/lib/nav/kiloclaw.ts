import { NavSection } from "../types"

export const KiloClawNav: NavSection[] = [
  {
    title: "KiloClaw",
    links: [
      { href: "/kiloclaw/overview", children: "Overview" },
      { href: "/kiloclaw/dashboard", children: "Dashboard" },
      { href: "/kiloclaw/pre-installed-software", children: "Pre-installed Software" },
      { href: "/kiloclaw/end-to-end", children: "End to End Config" },
      {
        href: "/kiloclaw/control-ui/overview",
        children: "Control UI",
        subLinks: [
          { href: "/kiloclaw/control-ui/overview", children: "Overview" },
          { href: "/kiloclaw/control-ui/changing-models", children: "Changing Models" },
          { href: "/kiloclaw/control-ui/exec-approvals", children: "Exec Approvals" },
          { href: "/kiloclaw/control-ui/version-pinning", children: "Version Pinning" },
        ],
      },
      {
        href: "/kiloclaw/chat-platforms",
        children: "Chat Platforms",
        subLinks: [
          { href: "/kiloclaw/chat-platforms", children: "Overview" },
          { href: "/kiloclaw/chat-platforms/telegram", children: "Telegram" },
          { href: "/kiloclaw/chat-platforms/discord", children: "Discord" },
          { href: "/kiloclaw/chat-platforms/slack", children: "Slack" },
        ],
      },
      {
        href: "/kiloclaw/development-tools",
        children: "Development Tools",
        subLinks: [
          { href: "/kiloclaw/development-tools", children: "Overview" },
          { href: "/kiloclaw/development-tools/github", children: "GitHub" },
          { href: "/kiloclaw/development-tools/google", children: "Google Workspace" },
        ],
      },
      {
        href: "/kiloclaw/triggers",
        children: "Triggers",
        subLinks: [
          { href: "/kiloclaw/triggers", children: "Overview" },
          { href: "/kiloclaw/triggers/webhooks", children: "Webhooks" },
        ],
      },
      {
        href: "/kiloclaw/tools",
        children: "Tools",
        subLinks: [
          { href: "/kiloclaw/tools", children: "Overview" },
          { href: "/kiloclaw/tools/1password", children: "1Password" },
          { href: "/kiloclaw/tools/brave-search", children: "Brave Search" },
          { href: "/kiloclaw/tools/agentcard", children: "AgentCard" },
        ],
      },
      {
        href: "/kiloclaw/troubleshooting/common-questions",
        children: "Troubleshooting",
        subLinks: [
          { href: "/kiloclaw/troubleshooting/common-questions", children: "Common Questions" },
          { href: "/kiloclaw/troubleshooting/gateway-process", children: "Gateway Process States" },
          { href: "/kiloclaw/troubleshooting/architecture", children: "Architecture Notes" },
        ],
      },
      {
        href: "/kiloclaw/faq/general",
        children: "FAQ",
        subLinks: [
          { href: "/kiloclaw/faq/general", children: "General" },
          { href: "/kiloclaw/faq/pricing", children: "Pricing" },
        ],
      },
    ],
  },
]
