/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"

const meta: Meta<typeof ProviderIcon> = {
  title: "Components/ProviderIcon",
  component: ProviderIcon,
  argTypes: {
    id: {
      control: "select",
      options: [
        "anthropic",
        "openai",
        "google",
        "mistral",
        "azure",
        "deepseek",
        "groq",
        "ollama-cloud",
        "github-copilot",
        "huggingface",
        "amazon-bedrock",
        "openrouter",
        "perplexity",
        "fireworks-ai",
        "cohere",
      ],
    },
  },
}

export default meta
type Story = StoryObj<typeof ProviderIcon>

export const Default: Story = {
  args: { id: "openai", width: 32, height: 32 },
}

export const Anthropic: Story = {
  args: { id: "anthropic", width: 32, height: 32 },
}

export const Google: Story = {
  args: { id: "google", width: 32, height: 32 },
}

export const Small: Story = {
  render: () => <ProviderIcon id="openai" width={16} height={16} />,
}

export const Large: Story = {
  render: () => <ProviderIcon id="anthropic" width={48} height={48} />,
}

const popularIcons = [
  "anthropic",
  "openai",
  "google",
  "mistral",
  "azure",
  "deepseek",
  "groq",
  "ollama-cloud",
  "github-copilot",
  "huggingface",
  "amazon-bedrock",
  "openrouter",
  "perplexity",
  "fireworks-ai",
  "cohere",
] as const

export const Gallery: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "repeat(auto-fill, 80px)",
        gap: "12px",
        padding: "16px",
      }}
    >
      {popularIcons.map((id) => (
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            gap: "6px",
          }}
        >
          <ProviderIcon id={id} width={32} height={32} />
          <span style={{ "font-size": "10px", color: "var(--text-weak)", "text-align": "center" }}>{id}</span>
        </div>
      ))}
    </div>
  ),
  parameters: { layout: "fullscreen" },
}

const allIcons = [
  "zhipuai",
  "zhipuai-coding-plan",
  "zenmux",
  "zai",
  "zai-coding-plan",
  "xiaomi",
  "xai",
  "wandb",
  "vultr",
  "vercel",
  "venice",
  "v0",
  "upstage",
  "togetherai",
  "synthetic",
  "submodel",
  "siliconflow",
  "siliconflow-cn",
  "scaleway",
  "sap-ai-core",
  "requesty",
  "poe",
  "perplexity",
  "ovhcloud",
  "openrouter",
  "opencode",
  "openai",
  "ollama-cloud",
  "nvidia",
  "nebius",
  "nano-gpt",
  "morph",
  "moonshotai",
  "moonshotai-cn",
  "modelscope",
  "mistral",
  "minimax",
  "minimax-cn",
  "lucidquery",
  "lmstudio",
  "llama",
  "kimi-for-coding",
  "io-net",
  "inference",
  "inception",
  "iflowcn",
  "huggingface",
  "helicone",
  "groq",
  "google",
  "google-vertex",
  "google-vertex-anthropic",
  "github-models",
  "github-copilot",
  "friendli",
  "fireworks-ai",
  "fastrouter",
  "deepseek",
  "deepinfra",
  "cortecs",
  "cohere",
  "cloudflare-workers-ai",
  "cloudflare-ai-gateway",
  "chutes",
  "cerebras",
  "baseten",
  "bailing",
  "azure",
  "azure-cognitive-services",
  "anthropic",
  "amazon-bedrock",
  "alibaba",
  "alibaba-cn",
  "aihubmix",
  "abacus",
] as const

export const AllIcons: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "repeat(auto-fill, 80px)",
        gap: "12px",
        padding: "16px",
      }}
    >
      {allIcons.map((id) => (
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            gap: "6px",
          }}
        >
          <ProviderIcon id={id} width={32} height={32} />
          <span style={{ "font-size": "10px", color: "var(--text-weak)", "text-align": "center" }}>{id}</span>
        </div>
      ))}
    </div>
  ),
  parameters: { layout: "fullscreen" },
}
