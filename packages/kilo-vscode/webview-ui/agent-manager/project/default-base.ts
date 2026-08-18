type Store = {
  defaultBaseBranch: () => string | undefined
  localStats: () => { branch?: string } | undefined
}

export function defaultBase(store: Store, active: boolean, branch: string | undefined) {
  return store.defaultBaseBranch() ?? store.localStats()?.branch ?? (active ? branch : undefined)
}
