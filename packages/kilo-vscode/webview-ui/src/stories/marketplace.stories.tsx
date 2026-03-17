/** @jsxImportSource solid-js */
/**
 * Stories for Marketplace components.
 *
 * Renders SkillsMarketplace and ItemCard directly with mock data
 * so no API requests are made.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import SkillsMarketplace from "../components/marketplace/SkillsMarketplace"
import ItemCard from "../components/marketplace/ItemCard"
import type { SkillMarketplaceItem, MarketplaceInstalledMetadata } from "../types/marketplace"
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

const EMPTY_METADATA: MarketplaceInstalledMetadata = { project: {}, global: {} }

const PARTIAL_INSTALLED: MarketplaceInstalledMetadata = {
  project: { "nextjs-developer": { type: "skill" } },
  global: { "python-data-science": { type: "skill" } },
}

const noop = () => {}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export const SkillsTabWithItems: Story = {
  name: "Skills tab — with items",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", height: "700px", overflow: "auto", padding: "12px" }}>
        <SkillsMarketplace
          items={MOCK_SKILLS}
          metadata={EMPTY_METADATA}
          fetching={false}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const SkillsTabWithInstalled: Story = {
  name: "Skills tab — some installed",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", height: "700px", overflow: "auto", padding: "12px" }}>
        <SkillsMarketplace
          items={MOCK_SKILLS}
          metadata={PARTIAL_INSTALLED}
          fetching={false}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const SkillsTabEmpty: Story = {
  name: "Skills tab — empty state",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", height: "400px", overflow: "auto", padding: "12px" }}>
        <SkillsMarketplace items={[]} metadata={EMPTY_METADATA} fetching={false} onInstall={noop} onRemove={noop} />
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
          metadata={PARTIAL_INSTALLED}
          displayName={MOCK_SKILLS[0].displayName}
          linkUrl={MOCK_SKILLS[0].githubUrl}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}
