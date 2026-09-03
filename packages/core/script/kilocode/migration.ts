function board(name: string) {
  return name === "kilocode_board" || name.endsWith("_kilocode_board")
}

export function file(name: string, value: string) {
  return board(name) ? `// kilocode_change - new file\n${value}` : value
}

export function block(name: string | undefined, source: string, value: string) {
  return (name !== undefined && board(name)) || /kilo_board(?:_message)?/.test(source)
    ? `// kilocode_change start\n${value}\n// kilocode_change end`
    : value
}

export function line(name: string, value: string) {
  return board(name) ? `${value} // kilocode_change` : value
}
