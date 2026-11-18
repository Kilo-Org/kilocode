/**
 * Check whether a file path is absolute.
 *
 * Handles both Unix (`/foo/bar`) and Windows (`C:\foo`, `D:/bar`) conventions.
 * UNC paths (`\\server\share`) are also treated as absolute.
 *
 * Returns false for relative paths, bare filenames, empty strings, and
 * protocol-prefixed strings like `https://…`.
 */
export function isAbsolutePath(filePath: string): boolean {
  if (!filePath) return false
  // Unix absolute
  if (filePath.charCodeAt(0) === 47 /* / */) return true
  // Windows drive letter: C:\ or C:/
  if (
    filePath.length >= 3 &&
    filePath.charCodeAt(1) === 58 /* : */ &&
    (filePath.charCodeAt(2) === 92 /* \ */ || filePath.charCodeAt(2) === 47) /* / */ &&
    ((filePath.charCodeAt(0) >= 65 && filePath.charCodeAt(0) <= 90) /* A-Z */ ||
      (filePath.charCodeAt(0) >= 97 && filePath.charCodeAt(0) <= 122)) /* a-z */
  )
    return true
  // Windows UNC path: \\server\share
  if (filePath.length >= 2 && filePath.charCodeAt(0) === 92 /* \ */ && filePath.charCodeAt(1) === 92 /* \ */)
    return true
  return false
}
