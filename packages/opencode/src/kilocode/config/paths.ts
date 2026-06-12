import { unique } from "remeda"

export function orderConfigDirectories(dirs: string[], env?: string) {
  const regular = env ? dirs.filter((dir) => dir !== env) : dirs
  return unique([...regular, ...(env ? [env] : [])])
}
