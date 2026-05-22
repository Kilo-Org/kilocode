import { NavSection } from "../types"

export const CustomizeNav: NavSection[] = [
  {
    title: "Customization",
    links: [
      { href: "/customize", children: "Overview" },
      {
        href: "/customize/custom-modes",
        children: "Custom Modes",
      },
      {
        href: "/customize/custom-rules",
        children: "Custom Rules",
      },
      {
        href: "/customize/custom-instructions",
        children: "Custom Instructions",
      },
      {
        href: "/customize/custom-subagents",
        children: "Custom Subagents",
        platform: "new",
      },
      { href: "/customize/agents-md", children: "agents.md" },
      { href: "/customize/workflows", children: "Workflows", platform: "new" },
      { href: "/customize/skills", children: "Skills" },
      {
        href: "/customize/prompt-engineering",
        children: "Prompt Engineering",
      },
    ],
  },
  {
    title: "Context & Indexing",
    links: [
      {
        href: "/customize/context/codebase-indexing",
        children: "Codebase Indexing",
      },
      {
        href: "/customize/context/context-condensing",
        children: "Context Condensing",
      },
      {
        href: "/customize/context/kilocodeignore",
        children: ".kilocodeignore",
      },
      {
        href: "/customize/context/large-projects",
        children: "Large Projects",
        platform: "legacy",
      },
    ],
  },
]
