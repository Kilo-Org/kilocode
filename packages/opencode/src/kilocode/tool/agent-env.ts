export function agentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    AI_AGENT: env.AI_AGENT?.trim() || "kilo-code",
  }
}
