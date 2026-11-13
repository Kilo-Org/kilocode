import { FSUtil } from "@opencode/util/fs-util"
import { Effect } from "effect"
import path from "path"

/**
 * The directory a project write or deletion must stay inside: the worktree root inside version control, or the
 * filesystem root outside it, matching the config discovery walk. `project.directory` equals the location outside
 * VCS, so a VCS marker at the location decides between the two cases.
 */
export const projectBoundary = Effect.fn("KiloProjectBoundary")(function* (
  fs: FSUtil.Interface,
  location: { readonly directory: string; readonly project: { readonly directory: string } },
) {
  const locationRoot = yield* fs.resolve(location.directory)
  const projectRoot = yield* fs.resolve(location.project.directory)
  const vcs =
    projectRoot !== locationRoot ||
    (yield* fs.existsSafe(path.join(locationRoot, ".git"))) ||
    (yield* fs.existsSafe(path.join(locationRoot, ".hg")))
  return vcs ? projectRoot : path.parse(locationRoot).root
})
