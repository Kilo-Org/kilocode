import { $ } from "bun"
import path from "node:path"
import { filename, tag } from "./npm-tarballs"

// Only the read-only producer builds packages or runs their pack lifecycle. Test the packed license and
// exercise the tarball with npm before handing it off.
export async function packNpm(directory: string, destination: string, name: string, version: string) {
  await $`bun pm pack --quiet --destination ${destination}`.cwd(directory)
  const archive = filename(name, version)
  const file = path.join(destination, archive)
  const notice = await $`tar -xOf ${archive} package/LICENSE`.cwd(destination).text()
  const license = await Bun.file(path.join(import.meta.dir, "../../LICENSE")).text()
  if (!(name.startsWith("@kilocode/cli-") ? notice.startsWith(license) : notice === license)) {
    throw new Error(`${name} does not include the repository MIT license`)
  }
  await $`npm publish ${file} --dry-run --offline --ignore-scripts --access public --tag ${tag}`
  return file
}
