import { describe, it, expect } from "bun:test"
import { parseHeredoc } from "../../webview-ui/src/components/chat/permission-command-utils"

describe("parseHeredoc", () => {
  it("returns null for a simple command without heredoc", () => {
    expect(parseHeredoc("ls -la")).toBeNull()
  })

  it("returns null for a multi-line command without heredoc", () => {
    expect(parseHeredoc("echo hello\necho world")).toBeNull()
  })

  it("detects heredoc with quoted delimiter", () => {
    const result = parseHeredoc("python3 << 'EOF'\nprint('hi')\nEOF")
    expect(result).not.toBeNull()
    expect(result!.head).toBe("python3 << 'EOF'\nEOF")
    expect(result!.body).toBe("print('hi')")
    expect(result!.count).toBe(1)
  })

  it("detects heredoc with unquoted delimiter", () => {
    const result = parseHeredoc("cat << EOF\nhello\nEOF")
    expect(result).not.toBeNull()
    expect(result!.head).toBe("cat << EOF\nEOF")
    expect(result!.body).toBe("hello")
    expect(result!.count).toBe(1)
  })

  it("handles multi-line heredoc content", () => {
    const result = parseHeredoc("python3 << 'PY'\nimport json\nprint('hi')\nPY")
    expect(result).not.toBeNull()
    expect(result!.head).toBe("python3 << 'PY'\nPY")
    expect(result!.body).toBe("import json\nprint('hi')")
    expect(result!.count).toBe(2)
  })

  it("preserves commands after heredoc in head", () => {
    const result = parseHeredoc("cat << EOF\ndata\nEOF\necho 'done'")
    expect(result).not.toBeNull()
    expect(result!.head).toBe("cat << EOF\nEOF\necho 'done'")
    expect(result!.body).toBe("data")
  })

  it("returns null when closing delimiter is missing", () => {
    expect(parseHeredoc("cat << EOF\ndata\nstill data")).toBeNull()
  })

  it("handles heredoc in a pipe/redirect command", () => {
    const result = parseHeredoc("cat > file.mjs << 'SCRIPT'\ncontent\nSCRIPT\necho done")
    expect(result).not.toBeNull()
    expect(result!.head).toBe("cat > file.mjs << 'SCRIPT'\nSCRIPT\necho done")
    expect(result!.body).toBe("content")
    expect(result!.count).toBe(1)
  })

  it("handles empty heredoc content", () => {
    const result = parseHeredoc("cat << EOF\nEOF")
    expect(result).not.toBeNull()
    expect(result!.head).toBe("cat << EOF\nEOF")
    expect(result!.body).toBe("")
    expect(result!.count).toBe(0)
  })

  it("matches the storybook heredoc pattern correctly", () => {
    const cmd = [
      "python3 << 'EOF'",
      "import json",
      "from pathlib import Path",
      "",
      "events_path = Path('test_sound/events.json')",
      'print("hi")',
      "EOF",
    ].join("\n")
    const result = parseHeredoc(cmd)
    expect(result).not.toBeNull()
    expect(result!.head).toBe("python3 << 'EOF'\nEOF")
    expect(result!.body).toBe(
      "import json\nfrom pathlib import Path\n\nevents_path = Path('test_sound/events.json')\nprint(\"hi\")",
    )
    expect(result!.count).toBe(5)
  })

  it("does not match << inside a string or other context", () => {
    expect(parseHeredoc('echo "this << is not a heredoc"')).toBeNull()
  })

  it("detects heredoc with <<- (indent-strip / tab-remove)", () => {
    const result = parseHeredoc("cat <<- EOF\n\thello\nEOF")
    expect(result).not.toBeNull()
    expect(result!.head).toBe("cat <<- EOF\nEOF")
    expect(result!.body).toBe("\thello")
    expect(result!.count).toBe(1)
  })

  it("detects heredoc with <<- and quoted delimiter", () => {
    const result = parseHeredoc("python3 <<- 'EOF'\nprint('hi')\nEOF")
    expect(result).not.toBeNull()
    expect(result!.head).toBe("python3 <<- 'EOF'\nEOF")
    expect(result!.body).toBe("print('hi')")
    expect(result!.count).toBe(1)
  })

  it("detects heredoc with double-quoted delimiter", () => {
    const result = parseHeredoc('cat << "EOF"\nhello\nEOF')
    expect(result).not.toBeNull()
    expect(result!.head).toBe('cat << "EOF"\nEOF')
    expect(result!.body).toBe("hello")
    expect(result!.count).toBe(1)
  })

  it("detects heredoc with delimiter containing hyphens", () => {
    const result = parseHeredoc('cat << "my-delim"\nhello world\nmy-delim')
    expect(result).not.toBeNull()
    expect(result!.head).toBe('cat << "my-delim"\nmy-delim')
    expect(result!.body).toBe("hello world")
    expect(result!.count).toBe(1)
  })

  it("detects heredoc with <<- and double-quoted delimiter with hyphens", () => {
    const result = parseHeredoc("python3 <<- \"my-script\"\nprint('hi')\nmy-script")
    expect(result).not.toBeNull()
    expect(result!.head).toBe('python3 <<- "my-script"\nmy-script')
    expect(result!.body).toBe("print('hi')")
    expect(result!.count).toBe(1)
  })
})
