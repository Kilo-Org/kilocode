const CHANGELOG_ACTION = "View Changelog"
const CHANGELOG_URL = "https://github.com/Kilo-Org/kilo/blob/dev/packages/kilo-vscode/CHANGELOG.md"
const RELEASE_URL = "https://github.com/Kilo-Org/kilo/releases/tag"

export const VERSION_KEY = "kilo-code.new.version"

type Input = {
  version: string
  previous: string | undefined
  update: (version: string) => Thenable<void>
  show: (message: string, action: string) => Thenable<string | undefined>
  open: (url: string) => Thenable<boolean>
}

function release(version: string) {
  const tag = version.startsWith("v") ? version : `v${version}`
  return `${RELEASE_URL}/${encodeURIComponent(tag)}`
}

export async function showChangelogOnUpdate(input: Input) {
  if (!input.version) {
    return
  }

  if (!input.previous) {
    await input.update(input.version)
    return
  }

  if (input.previous === input.version) {
    return
  }

  await input.update(input.version)
  const clicked = await input.show(`Kilo Code was updated to v${input.version}.`, CHANGELOG_ACTION)

  if (clicked !== CHANGELOG_ACTION) {
    return
  }

  const opened = await input.open(release(input.version))

  if (opened) {
    return
  }

  await input.open(CHANGELOG_URL)
}

export const changelog = {
  action: CHANGELOG_ACTION,
  url: CHANGELOG_URL,
  release: RELEASE_URL,
}
