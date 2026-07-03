import { NavSection } from "../types"

export const GettingStartedNav: NavSection[] = [
  {
    title: "Introduction",
    links: [
      { href: "/getting-started", children: "Overview" },
      { href: "/getting-started/installing", children: "Installation" },
      { href: "/getting-started/quickstart", children: "Quickstart" },
    ],
  },
  {
    title: "Configuration",
    links: [
      {
        href: "/getting-started/setup-authentication",
        children: "Setup & Authentication",
      },
      {
        href: "/getting-started/using-kilo-for-free",
        children: "Using Kilo for Free",
      },
      {
        href: "/getting-started/byok",
        children: "Bring Your Own Key (BYOK)",
      },
      { href: "/ai-providers", children: "AI Providers" },
      {
        href: "/getting-started/settings",
        children: "Settings",
        subLinks: [
          { href: "/getting-started/settings/auto-approving-actions", children: "Auto-Approving Actions" },
          { href: "/getting-started/settings/sandboxing", children: "Sandboxing" },
        ],
      },
      { href: "/getting-started/adding-credits", children: "Adding Credits" },
      { href: "/getting-started/rate-limits-and-costs", children: "Cost Efficiency & Model Selection" },
      { href: "/getting-started/cost-controls-and-usage-safeguards", children: "Cost Controls and Usage Safeguards" },
    ],
  },
  {
    title: "Help",
    links: [
      {
        href: "/getting-started/faq",
        children: "FAQ",
        subLinks: [
          { href: "/getting-started/faq/general", children: "General" },
          { href: "/getting-started/faq/setup-and-installation", children: "Setup and Installation" },
          { href: "/getting-started/faq/credits-and-billing", children: "Credits and Billing" },
          { href: "/getting-started/faq/account-and-integration", children: "Account and Integration" },
        ],
      },
      {
        href: "/getting-started/migrating",
        children: "Migrating from Cursor",
      },
      {
        href: "/getting-started/troubleshooting",
        children: "Troubleshooting",
        subLinks: [
          {
            href: "/getting-started/troubleshooting/troubleshooting-extension",
            children: "Extension Troubleshooting",
          },
        ],
      },
      {
        href: "/getting-started/using-docs-with-agents",
        children: "Using Docs with Agents",
      },
    ],
  },
]
