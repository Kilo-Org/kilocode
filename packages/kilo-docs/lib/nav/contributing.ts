import type { NavSection } from "../types"

export const ContributingNav: NavSection[] = [
  {
    title: "Getting Started",
    links: [
      { href: "/contributing", children: "Overview" },
      {
        href: "/contributing/development-environment",
        children: "Development Environment",
      },
      {
        href: "/contributing/ecosystem",
        children: "Ecosystem",
      },
    ],
  },
  {
    title: "Architecture",
    links: [
      {
        href: "/contributing/architecture",
        children: "Overview",
      },
      {
        href: "/contributing/architecture/cli-runtime",
        children: "CLI Runtime",
      },
      {
        href: "/contributing/architecture/vscode-extension",
        children: "VS Code Extension",
      },
      {
        href: "/contributing/architecture/jetbrains-plugin",
        children: "JetBrains Plugin",
      },
      {
        href: "/contributing/architecture/cloud-platform",
        children: "Cloud Platform",
      },
      {
        href: "/contributing/architecture/automation-services",
        children: "Automation Services",
      },
      {
        href: "/contributing/architecture/cloud-security",
        children: "Cloud Security",
      },
    ],
  },
  {
    title: "Development",
    links: [
      {
        href: "/contributing/architecture/development-patterns",
        children: "Development Patterns",
      },
      {
        href: "/contributing/architecture/config-schema",
        children: "CLI Config Schema",
      },
    ],
  },
  {
    title: "Feature Proposals",
    links: [
      {
        href: "/contributing/features",
        children: "Overview",
      },
      {
        href: "/contributing/features/enterprise-mcp-controls",
        children: "Enterprise MCP Controls",
      },
      {
        href: "/contributing/features/onboarding-improvements",
        children: "Onboarding Improvements",
      },
      {
        href: "/contributing/features/agent-observability",
        children: "Agent Observability",
      },
      {
        href: "/contributing/features/benchmarking",
        children: "Benchmarking",
      },
    ],
  },
]
