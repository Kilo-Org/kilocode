/** @jsxImportSource solid-js */
/**
 * Stories for Marketplace components.
 *
 * Renders MarketplaceListView and ItemCard directly with mock data
 * so no API requests are made.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import { MarketplaceListView } from "../components/marketplace/MarketplaceListView"
import { ItemCard } from "../components/marketplace/ItemCard"
import { InstallModal } from "../components/marketplace/InstallModal"
import { MarketplaceSessionProvider } from "../context/marketplace-session"
import type {
  SkillMarketplaceItem,
  McpMarketplaceItem,
  AgentMarketplaceItem,
  MarketplaceInstalledMetadata,
} from "../types/marketplace"
import "../components/marketplace/marketplace.css"

const meta: Meta = {
  title: "Marketplace",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_SKILLS: SkillMarketplaceItem[] = [
  {
    type: "skill",
    id: "nextjs-developer",
    name: "Next.js Developer",
    displayName: "Next.js Developer",
    description:
      "Expert at building Next.js applications with App Router, server components, and modern React patterns.",
    category: "web-development",
    displayCategory: "Web Development",
    githubUrl: "https://github.com/example/nextjs-developer",
    content: "https://example.com/nextjs-developer.tar.gz",
  },
  {
    type: "skill",
    id: "python-data-science",
    name: "Python Data Science",
    displayName: "Python Data Science",
    description:
      "Analyzes data using pandas, numpy, and matplotlib. Creates visualizations and builds machine learning models.",
    category: "data-science",
    displayCategory: "Data Science",
    githubUrl: "https://github.com/example/python-data-science",
    content: "https://example.com/python-data-science.tar.gz",
    author: "DataTeam",
  },
  {
    type: "skill",
    id: "rust-systems",
    name: "Rust Systems",
    displayName: "Rust Systems",
    description: "Systems programming with Rust. Memory safety, concurrency, and performance optimization.",
    category: "systems",
    displayCategory: "Systems",
    githubUrl: "https://github.com/example/rust-systems",
    content: "https://example.com/rust-systems.tar.gz",
  },
  {
    type: "skill",
    id: "react-native-mobile",
    name: "React Native Mobile",
    displayName: "React Native Mobile",
    description: "Build cross-platform mobile apps with React Native, Expo, and native modules.",
    category: "mobile",
    displayCategory: "Mobile",
    githubUrl: "https://github.com/example/react-native-mobile",
    content: "https://example.com/react-native-mobile.tar.gz",
    author: "MobileDev",
  },
  {
    type: "skill",
    id: "devops-kubernetes",
    name: "DevOps Kubernetes",
    displayName: "DevOps Kubernetes",
    description: "Container orchestration with Kubernetes. Helm charts, deployments, and cluster management.",
    category: "devops",
    displayCategory: "DevOps",
    githubUrl: "https://github.com/example/devops-kubernetes",
    content: "https://example.com/devops-kubernetes.tar.gz",
  },
  {
    type: "skill",
    id: "api-design",
    name: "API Design",
    displayName: "API Design",
    description: "Design RESTful and GraphQL APIs with OpenAPI specs, authentication, and rate limiting.",
    category: "web-development",
    displayCategory: "Web Development",
    githubUrl: "https://github.com/example/api-design",
    content: "https://example.com/api-design.tar.gz",
    author: "APIGuild",
  },
]

const MOCK_MCPS: McpMarketplaceItem[] = [
  {
    type: "mcp",
    id: "github-mcp",
    name: "GitHub",
    description:
      "Interact with GitHub repositories, issues, and pull requests. Search code, manage branches, and automate workflows.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    content:
      '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } }',
    parameters: [{ name: "GitHub Token", key: "GITHUB_TOKEN", placeholder: "ghp_xxxxxxxxxxxx" }],
    suggest_for: { vscode_extension: ["github.vscode-pull-request-github"] },
    author: "Anthropic",
    category: "development",
  },
  {
    type: "mcp",
    id: "postgres-mcp",
    name: "PostgreSQL",
    description: "Query and manage PostgreSQL databases. Run SQL, inspect schemas, and manage connections.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    content: [
      {
        name: "npx",
        content:
          '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", "${CONNECTION_STRING}"] }',
        parameters: [
          { name: "Connection String", key: "CONNECTION_STRING", placeholder: "postgresql://user:pass@localhost/db" },
        ],
      },
      {
        name: "Docker",
        content:
          '{ "command": "docker", "args": ["run", "--rm", "-e", "CONNECTION_STRING=${CONNECTION_STRING}", "mcp/postgres"] }',
        parameters: [
          { name: "Connection String", key: "CONNECTION_STRING", placeholder: "postgresql://user:pass@localhost/db" },
        ],
        prerequisites: ["Docker must be installed and running"],
      },
    ],
    author: "Anthropic",
    category: "data",
  },
  {
    type: "mcp",
    id: "filesystem-mcp",
    name: "Filesystem",
    description: "Read, write, and manage files on the local filesystem with configurable access controls.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    content: '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "${ALLOWED_DIR}"] }',
    parameters: [{ name: "Allowed Directory", key: "ALLOWED_DIR", placeholder: "/path/to/directory" }],
    category: "development",
  },
  {
    type: "mcp",
    id: "slack-mcp",
    name: "Slack",
    description: "Send and receive messages, manage channels, and search conversations in Slack workspaces.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    content:
      '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-slack"], "env": { "SLACK_TOKEN": "${SLACK_TOKEN}" } }',
    parameters: [{ name: "Slack Bot Token", key: "SLACK_TOKEN", placeholder: "xoxb-xxxxxxxxxxxx" }],
    author: "Anthropic",
    category: "productivity",
  },
  {
    type: "mcp",
    id: "brave-search-mcp",
    name: "Brave Search",
    description: "Search the web using the Brave Search API for real-time information retrieval.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    content:
      '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-brave-search"], "env": { "BRAVE_API_KEY": "${BRAVE_API_KEY}" } }',
    parameters: [{ name: "API Key", key: "BRAVE_API_KEY", placeholder: "BSA-xxxxxxxxxxxx" }],
    category: "search",
  },
  {
    type: "mcp",
    id: "puppeteer-mcp",
    name: "Puppeteer",
    description: "Automate browser interactions, take screenshots, and scrape web pages using headless Chrome.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    content: '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"] }',
    prerequisites: ["Chrome or Chromium must be installed"],
    category: "web-automation",
  },
]

const MOCK_AGENTS: AgentMarketplaceItem[] = [
  {
    type: "agent",
    id: "architect",
    name: "Architect",
    description:
      "High-level system design and planning. Focuses on architecture decisions, component boundaries, and technical specifications without writing implementation code.",
    suggest_for: { filename: ["*.architecture.md"] },
    content: {
      mode: "primary",
      description: "Stress-test technical designs and produce implementation-ready plans",
      prompt: "You are a software architect...",
      options: { displayName: "Architect" },
      permission: { read: "allow", edit: "deny", bash: "deny", mcp: "deny", question: "allow" },
    },
    author: "Kilo",
    category: "development",
  },
  {
    type: "agent",
    id: "reviewer",
    name: "Code Reviewer",
    description:
      "Reviews code for bugs, security issues, and best practices. Provides actionable feedback with specific line references.",
    content: {
      mode: "primary",
      description: "Senior software engineer conducting thorough code reviews",
      prompt: "You are a code reviewer...",
      options: { displayName: "Code Reviewer" },
      permission: { read: "allow", edit: "deny", bash: "allow", mcp: "deny", question: "allow" },
    },
    author: "Kilo",
    category: "development",
  },
  {
    type: "agent",
    id: "docs-writer",
    name: "Documentation Writer",
    description: "Generates and maintains documentation including READMEs, API docs, and inline code comments.",
    content: {
      mode: "primary",
      description: "Focus on writing documentation and other text-based files",
      prompt: "You write documentation...",
      options: { displayName: "Documentation Writer" },
      permission: { read: "allow", edit: "allow", bash: "allow", mcp: "deny", question: "allow" },
    },
    category: "business",
  },
  {
    type: "agent",
    id: "tdd",
    name: "Test-Driven Developer",
    description:
      "Follows strict TDD methodology: write failing tests first, implement minimum code to pass, then refactor.",
    content: {
      mode: "primary",
      description: "Strict TDD practitioner",
      prompt: "You follow TDD...",
      options: { displayName: "Test-Driven Developer" },
      permission: { read: "allow", edit: "allow", bash: "allow", mcp: "allow", question: "allow" },
    },
    author: "Community",
    category: "development",
  },
  {
    type: "agent",
    id: "debug",
    name: "Debugger",
    description: "Systematically diagnoses and fixes bugs. Uses logs, stack traces, and bisection to isolate issues.",
    content: {
      mode: "primary",
      description: "Systematic bug diagnosis and fixing",
      prompt: "You are a debugger...",
      options: { displayName: "Debugger" },
      permission: { read: "allow", edit: "allow", bash: "allow", mcp: "deny", question: "allow" },
    },
    category: "development",
  },
]

const EMPTY_METADATA: MarketplaceInstalledMetadata = { project: {}, global: {} }
const RELEVANCE = {
  "agent:architect": { filename: ["*.architecture.md"] },
  "mcp:github-mcp": { vscodeExtension: ["github.vscode-pull-request-github"] },
}

const PARTIAL_INSTALLED_SKILLS: MarketplaceInstalledMetadata = {
  project: { "skill:nextjs-developer": { type: "skill" } },
  global: { "skill:python-data-science": { type: "skill" } },
}

const PARTIAL_INSTALLED_MCPS: MarketplaceInstalledMetadata = {
  project: { "mcp:github-mcp": { type: "mcp" } },
  global: { "mcp:postgres-mcp": { type: "mcp" } },
}

const PARTIAL_INSTALLED_AGENTS: MarketplaceInstalledMetadata = {
  project: { "agent:architect": { type: "agent" } },
  global: { "agent:reviewer": { type: "agent" } },
}

const PARTIAL_INSTALLED_MIXED: MarketplaceInstalledMetadata = {
  project: {
    "agent:architect": { type: "agent" },
    "mcp:github-mcp": { type: "mcp" },
  },
  global: { "skill:python-data-science": { type: "skill" } },
}

const noop = () => {}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export const MixedListWithItems: Story = {
  name: "Mixed list — categories and installed items",
  render: () => (
    <StoryProviders>
      <div style={{ "max-height": "700px", overflow: "auto", padding: "12px" }}>
        <MarketplaceListView
          items={[...MOCK_AGENTS, ...MOCK_MCPS, ...MOCK_SKILLS]}
          metadata={PARTIAL_INSTALLED_MIXED}
          relevance={RELEVANCE}
          fetching={false}
          searchPlaceholder="Search marketplace..."
          emptyMessage="No items found"
          relevantEmptyMessage="No relevant marketplace items found for this workspace."
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const RelevantItems: Story = {
  name: "Mixed list — relevant to workspace",
  render: () => (
    <StoryProviders>
      <div style={{ "max-height": "700px", overflow: "auto", padding: "12px" }}>
        <MarketplaceListView
          items={[...MOCK_AGENTS, ...MOCK_MCPS, ...MOCK_SKILLS]}
          metadata={PARTIAL_INSTALLED_MIXED}
          relevance={RELEVANCE}
          fetching={false}
          searchPlaceholder="Search marketplace..."
          emptyMessage="No items found"
          relevantEmptyMessage="No relevant marketplace items found for this workspace."
          initialRelevant
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const EmptyList: Story = {
  name: "Mixed list — empty state",
  render: () => (
    <StoryProviders>
      <div style={{ "max-height": "400px", overflow: "auto", padding: "12px" }}>
        <MarketplaceListView
          items={[]}
          metadata={EMPTY_METADATA}
          relevance={{}}
          fetching={false}
          searchPlaceholder="Search marketplace..."
          emptyMessage="No items found"
          relevantEmptyMessage="No relevant marketplace items found for this workspace."
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const SingleSkillCard: Story = {
  name: "ItemCard — single skill not installed",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard
          item={MOCK_SKILLS[0]}
          metadata={EMPTY_METADATA}
          displayName={MOCK_SKILLS[0].displayName}
          linkUrl={MOCK_SKILLS[0].githubUrl}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const InstalledSkillCard: Story = {
  name: "ItemCard — installed skill",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard
          item={MOCK_SKILLS[0]}
          metadata={PARTIAL_INSTALLED_SKILLS}
          displayName={MOCK_SKILLS[0].displayName}
          linkUrl={MOCK_SKILLS[0].githubUrl}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// MCP Stories
// ---------------------------------------------------------------------------

export const SingleMcpCard: Story = {
  name: "ItemCard — single MCP not installed",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard
          item={MOCK_MCPS[0]}
          metadata={EMPTY_METADATA}
          linkUrl={MOCK_MCPS[0].url}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const InstalledMcpCard: Story = {
  name: "ItemCard — installed MCP",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard
          item={MOCK_MCPS[0]}
          metadata={PARTIAL_INSTALLED_MCPS}
          linkUrl={MOCK_MCPS[0].url}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const InstallMcpModal: Story = {
  name: "InstallModal — MCP explanation and destination",
  render: () => (
    <StoryProviders>
      <MarketplaceSessionProvider>
        <div style={{ "max-height": "700px", overflow: "auto", padding: "12px" }}>
          <InstallModal item={MOCK_MCPS[0]} onClose={noop} onInstallResult={noop} />
        </div>
      </MarketplaceSessionProvider>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Mode Stories
// ---------------------------------------------------------------------------

export const SingleAgentCard: Story = {
  name: "ItemCard — single agent not installed",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard item={MOCK_AGENTS[0]} metadata={EMPTY_METADATA} onInstall={noop} onRemove={noop} />
      </div>
    </StoryProviders>
  ),
}

export const InstalledAgentCard: Story = {
  name: "ItemCard — installed agent",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard item={MOCK_AGENTS[0]} metadata={PARTIAL_INSTALLED_AGENTS} onInstall={noop} onRemove={noop} />
      </div>
    </StoryProviders>
  ),
}
