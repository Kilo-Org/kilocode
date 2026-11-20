const preview = /^0\.0\.0-v2-([1-9]\d{0,14})(?:\.([1-9]\d{0,8}))?$/

export const isPreview = (version: string) => preview.test(version)

// The run number is embedded in an alphanumeric SemVer identifier, so SemVer's lexical order is wrong here.
export function newer(candidate: string, current: string) {
  const next = preview.exec(candidate)
  const previous = preview.exec(current)
  if (!next || !previous) return false
  return (
    Number(next[1]) > Number(previous[1]) ||
    (next[1] === previous[1] && Number(next[2] ?? 1) > Number(previous[2] ?? 1))
  )
}
