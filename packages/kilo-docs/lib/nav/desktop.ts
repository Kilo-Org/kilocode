import { NavSection } from "../types"

export const DesktopNav: NavSection[] = [
  {
    title: "Introduction",
    links: [
      { href: "/desktop/overview", children: "Overview" },
      { href: "/desktop/installation", children: "Installation" },
      { href: "/desktop/quickstart", children: "Quickstart" },
      { href: "/desktop/what-you-can-ask", children: "What you can ask" },
    ],
  },
  {
    title: "Features",
    links: [
      { href: "/desktop/features", children: "Overview" },
      { href: "/desktop/features/notebooks", children: "Notebooks" },
      { href: "/desktop/features/browser", children: "In-app browser" },
      { href: "/desktop/features/terminal", children: "Terminal" },
      { href: "/desktop/features/git", children: "Git integration" },
      { href: "/desktop/features/local-inference", children: "Local inference" },
      { href: "/desktop/features/environments", children: "Conda environments" },
      { href: "/desktop/features/files", children: "Files" },
    ],
  },
  {
    title: "Settings",
    links: [
      { href: "/desktop/settings/general", children: "General settings" },
      { href: "/desktop/settings/ai", children: "AI settings" },
    ],
  },
  {
    title: "Help",
    links: [{ href: "/desktop/troubleshooting", children: "Troubleshooting" }],
  },
]
