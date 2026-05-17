type Progress = {
  current: number
  total: number
  label: string
}

export function reportScanProgress(
  options: { progress?: (event: Progress) => void } | undefined,
  label: string,
) {
  options?.progress?.({ current: 0, total: 1, label })
}
