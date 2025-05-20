/**
 * Default mode slug used in the application.
 */
export const defaultModeSlug = "code";

/**
 * Default prompts for different modes.
 */
export const defaultPrompts = {
  code: { customInstructions: "Write code to solve my problem." },
  ask: { customInstructions: "Answer my question." },
  architect: { customInstructions: "Plan a solution for my problem." },
  debug: { customInstructions: "Debug my code." },
  orchestrator: { customInstructions: "Coordinate tasks to solve my problem." },
  translate: { customInstructions: "Translate text or manage localization." },
  test: { customInstructions: "Write tests for my code." }
};

/**
 * Mode configuration interface.
 */
export interface ModeConfig {
  slug: string;
  name: string;
  model: string;
  role: string;
  roleDefinition: string;
  groups: ("read" | "edit" | "browser" | "command" | "mcp" | "modes")[];
  customInstructions?: string;
}

/**
 * Available modes in the application.
 */
export const modes: ModeConfig[] = [
  { slug: "code", name: "Code", model: "grok-3-beta", role: "You are a skilled software engineer.", roleDefinition: "Software Engineer", groups: ["read", "edit", "command"] },
  { slug: "ask", name: "Ask", model: "grok-3-beta", role: "You are a knowledgeable technical assistant.", roleDefinition: "Technical Assistant", groups: ["read"] },
  { slug: "architect", name: "Architect", model: "grok-3-beta", role: "You are an experienced technical leader.", roleDefinition: "Technical Leader", groups: ["read", "edit"] },
  { slug: "debug", name: "Debug", model: "grok-3-beta", role: "You are an expert software debugger.", roleDefinition: "Software Debugger", groups: ["read", "edit", "command"] },
  { slug: "orchestrator", name: "Orchestrator", model: "grok-3-beta", role: "You are a strategic workflow orchestrator.", roleDefinition: "Workflow Orchestrator", groups: ["read", "edit", "command", "mcp"] },
  { slug: "translate", name: "Translate", model: "grok-3-beta", role: "You are a linguistic specialist.", roleDefinition: "Linguistic Specialist", groups: ["read"] },
  { slug: "test", name: "Test", model: "grok-3-beta", role: "You are a Jest testing specialist.", roleDefinition: "Testing Specialist", groups: ["read", "edit", "command"] }
];

/**
 * Type representing a single mode.
 */
export type Mode = ModeConfig;

/**
 * Get all available modes.
 * @param customModes - Optional custom modes to include.
 * @returns Array of all modes.
 */
export function getAllModes(customModes: ModeConfig[] = []): ModeConfig[] {
  return [...modes, ...customModes];
}