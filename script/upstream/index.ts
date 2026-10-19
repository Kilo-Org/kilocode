#!/usr/bin/env bun
/**
 * Upstream sync tooling for the Kilo v2 line: utilities and transforms.
 */

// Utils
export * from "./utils/git"
export * from "./utils/logger"
export * from "./utils/config"
export * from "./utils/version"
export * from "./utils/report"
export * from "./utils/upstream"
export * from "./utils/markers"
export * from "./utils/reset"
export * from "./utils/owned"
export * from "./utils/shared"
export * from "./utils/baseline"

// Transforms
export { transformAll as transformPackageNames, transformFile } from "./transforms/package-names"
export { preserveAllVersions, preserveVersion, getCurrentVersion } from "./transforms/preserve-versions"
export { keepOursFiles, resetToOurs, shouldKeepOurs } from "./transforms/keep-ours"
export { skipFiles, skipSpecificFiles, shouldSkip } from "./transforms/skip-files"
export { isLockFile, resolveLockFileConflicts, regenerateLockFiles } from "./transforms/lock-files"
export {
  transformAllI18n,
  transformConflictedI18n,
  transformI18nFile,
  transformI18nContent,
  isI18nFile,
} from "./transforms/transform-i18n"
export {
  transformConflictedTakeTheirs,
  transformTakeTheirs,
  transformAllTakeTheirs,
  shouldTakeTheirs,
  applyBrandingTransforms,
  matchesPattern,
} from "./transforms/transform-take-theirs"
export {
  transformConflictedPackageJson,
  transformPackageJson,
  transformAllPackageJson,
  isPackageJson,
} from "./transforms/transform-package-json"
export {
  transformConflictedScripts,
  transformScriptFile,
  transformAllScripts,
  isScriptFile,
  applyScriptTransforms,
} from "./transforms/transform-scripts"
export {
  transformConflictedExtensions,
  transformExtensionFile,
  transformAllExtensions,
  isExtensionFile,
  applyExtensionTransforms,
} from "./transforms/transform-extensions"
export {
  transformConflictedWeb,
  transformWebFile,
  transformAllWeb,
  isWebFile,
  applyWebTransforms,
} from "./transforms/transform-web"
