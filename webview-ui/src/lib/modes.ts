import { ModeConfig as SharedModeConfig } from "@roo/schemas";

/**
 * Re-export ModeConfig from shared schemas
 */
export type ModeConfig = SharedModeConfig;

/**
 * Default mode slug used in the application.
 */
export const defaultModeSlug = "code";

/**
 * Type for custom mode prompts mapping.
 */
export type CustomModePrompts = Record<string, {
  roleDefinition?: string;
  customInstructions?: string;
}>;

/**
 * Default prompts for different modes.
 */
export const defaultPrompts: CustomModePrompts = {
  code: { customInstructions: "Write code to solve my problem." },
  ask: { customInstructions: "Answer my question." },
  architect: { customInstructions: "Plan a solution for my problem." },
  debug: { customInstructions: "Debug my code." },
  orchestrator: { customInstructions: "Coordinate tasks to solve my problem." },
  translate: { customInstructions: "Translate text or manage localization." },
  test: { customInstructions: "Write tests for my code." }
};

/**
 * Available modes in the application.
 */
export const modes: ModeConfig[] = [
  { slug: "code", name: "Code", roleDefinition: "Software Engineer", groups: ["read", "edit", "command"] },
  { slug: "ask", name: "Ask", roleDefinition: "Technical Assistant", groups: ["read"] },
  { slug: "architect", name: "Architect", roleDefinition: "Technical Leader", groups: ["read", "edit"] },
  { slug: "debug", name: "Debug", roleDefinition: "Software Debugger", groups: ["read", "edit", "command"] },
  { slug: "orchestrator", name: "Orchestrator", roleDefinition: "Workflow Orchestrator", groups: ["read", "edit", "command", "mcp"] },
  { slug: "translate", name: "Translate", roleDefinition: "Linguistic Specialist", groups: ["read"] },
  { slug: "test", name: "Test", roleDefinition: "Testing Specialist", groups: ["read", "edit", "command"] }
];

/**
 * Type representing a single mode slug.
 */
export type Mode = string;

/**
 * Get all available modes.
 * @param customModes - Optional custom modes to include.
 * @returns Array of all modes.
 */
export function getAllModes(customModes: ModeConfig[] = []): ModeConfig[] {
  return [...modes, ...customModes];
}