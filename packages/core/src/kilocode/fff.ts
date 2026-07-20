import os from "os"
import path from "path"

export function scanning(directory: string) {
  return {
    enableFsRootScanning: directory === path.parse(directory).root,
    enableHomeDirScanning: directory === os.homedir(),
  }
}
