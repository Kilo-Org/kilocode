export type Invocation = {
  request: string
  result: string
}

export function args(argv = process.argv.slice(2)): Invocation {
  const requestIndex = argv.indexOf("--request")
  const resultIndex = argv.indexOf("--result")
  const request = requestIndex >= 0 ? argv[requestIndex + 1] : undefined
  const result = resultIndex >= 0 ? argv[resultIndex + 1] : undefined
  if (!request || !result) {
    console.error("usage: <fixture> --request <path> --result <path>")
    process.exit(2)
  }
  return { request, result }
}
