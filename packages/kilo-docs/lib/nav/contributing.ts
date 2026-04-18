import { NavSection } from "../types"

export const ContributingNav: NavSection[] = [
  {
    title: "Getting Started",
    links: [
      { href: "/contributing", children: "Contributing Overview" },
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
        children: "Architecture Overview",
      },
      {
        href: "/contributing/architecture/features",
        children: "Features",
        subLinks: [
          {
            href: "/contributing/architecture/agent-observability",
            children: "Agent Observability",
          },
          {
            href: "/contributing/architecture/auto-model-tiers",
            children: "Auto Model Tiers",
          },
          {
            href: "/contributing/architecture/benchmarking",
            children: "Benchmarking",
          },
          {
            href: "/contributing/architecture/config-schema",
            children: "CLI Config Schema",
          },
          {
            href: "/contributing/architecture/enterprise-mcp-controls",
            children: "Enterprise MCP Controls",
          },
          {
            href: "/contributing/architecture/mcp-oauth-authorization",
            children: "MCP OAuth Authorization",
          },
          {
            href: "/contributing/architecture/onboarding-improvements",
            children: "Onboarding Improvements",
          },
          {
            href: "/contributing/architecture/organization-modes-library",
            children: "Organization Modes Library",
          },
          {
            href: "/deploy-secure/security-reviews",
            children: "Agentic Security Reviews",
          },
          {
            href: "/contributing/architecture/track-repo-url",
            children: "Track Repo URL",
          },
          {
            href: "/contributing/architecture/voice-transcription",
            children: "Voice Transcription",
          },
        ],
      },
    ],
  },
]
