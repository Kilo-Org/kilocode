function board(name: string) {
  return /(?:^|_)kilocode_board(?:_reset)?$/.test(name)
}

function continuation(name: string) {
  return /(?:^|_)kilocode_continuation(?:_intent)?$/.test(name)
}

export function file(name: string, value: string) {
  return board(name) || continuation(name) ? `// kilocode_change - new file\n${value}` : value
}

export function block(name: string | undefined, source: string, value: string) {
  return (name !== undefined && (board(name) || continuation(name))) ||
    /kilo_board(?:_message)?|part_session_step_finish_idx|recall_(?:part_search|message_role)_idx|kilo_continuation_intent/.test(source)
    ? `// kilocode_change start\n${value}\n// kilocode_change end`
    : value
}

export function line(name: string, value: string) {
  return board(name) || continuation(name) || name.endsWith("_kilocode_model_usage_index")
    ? `${value} // kilocode_change`
    : value
}
