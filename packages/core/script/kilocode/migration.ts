function board(name: string) {
  return /(?:^|_)kilocode_board(?:_reset)?$/.test(name)
}

export function file(name: string, value: string) {
  return board(name) ? `// kilocode_change - new file\n${value}` : value
}

export function block(name: string | undefined, source: string, value: string) {
  return (name !== undefined && board(name)) || /kilo_board(?:_message)?|part_session_step_finish_idx/.test(source)
    ? `// kilocode_change start\n${value}\n// kilocode_change end`
    : value
}

export function line(name: string, value: string) {
  return board(name) || name.endsWith("_kilocode_model_usage_index") ? `${value} // kilocode_change` : value
}
