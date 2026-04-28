// kilocode_change - new file
export function bell() {
  if (process.stdout.isTTY) {
    process.stdout.write("\x07")
  }
}
