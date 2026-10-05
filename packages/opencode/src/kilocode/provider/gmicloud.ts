const ALIAS = "GMI_API_KEY"
const PRIMARY = "GMICLOUD_API_KEY"

export function load(input: {
  env: Record<string, string | undefined>
  saved: string | undefined
  configured: string | undefined
}) {
  const key = input.env[ALIAS]
  if (!key || input.saved || input.configured || input.env[PRIMARY]) {
    return { autoload: false, options: {} }
  }
  return { autoload: true, options: { apiKey: key } }
}
