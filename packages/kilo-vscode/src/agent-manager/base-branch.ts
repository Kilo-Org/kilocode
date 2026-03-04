export function normalizeBaseBranch(value: string | undefined): string | undefined {
  const branch = value?.trim()
  if (!branch) return undefined
  return branch
}

export function chooseBaseBranch(opts: { explicit?: string; configured?: string; configuredExists?: boolean }): {
  branch?: string
  stale?: string
} {
  const explicit = normalizeBaseBranch(opts.explicit)
  if (explicit) return { branch: explicit }

  const configured = normalizeBaseBranch(opts.configured)
  if (!configured) return {}
  if (opts.configuredExists) return { branch: configured }
  return { stale: configured }
}
