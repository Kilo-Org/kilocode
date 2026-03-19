import { NavSection } from "../types"

export const KiloClawNav: NavSection[] = [
  {
    title: "KiloClaw",
    links: [
      { href: "/kiloclaw/overview", children: "Overview" },
      { href: "/kiloclaw/dashboard", children: "Dashboard" },
      { href: "/kiloclaw/pre-installed-software", children: "Pre-installed Software" },
      { href: "/kiloclaw/control-ui", children: "Control UI" },
      { href: "/kiloclaw/chat-platforms", children: "Chat Platforms" },
      {
        href: "/kiloclaw/development-tools/github",
        children: "Development Tools",
        subLinks: [
          { href: "/kiloclaw/development-tools/github", children: "GitHub" },
          { href: "/kiloclaw/development-tools/google", children: "Google Workspace" },
        ],
      },
      { href: "/kiloclaw/version-pinning", children: "Version Pinning" },
      { href: "/kiloclaw/troubleshooting", children: "Troubleshooting" },
      { href: "/kiloclaw/pricing", children: "Pricing" },
    ],
  },
]
