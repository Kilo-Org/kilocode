# Kilo v2 project configuration

Use `--project-config` when you explicitly want the isolated Kilo host to read project configuration. Without that flag, only the isolated profile configuration is loaded.

Project configuration is read from `kilo.json` or `kilo.jsonc`, plus matching files in `.kilo/` and `.kilocode/`, while walking from the project boundary to the selected directory. The `.kilocode` directory has higher priority than `.kilo`; JSONC has higher priority than JSON.

Project markdown agents may live below `.kilo/agent`, `.kilo/agents`, `.kilocode/agent`, or `.kilocode/agents`. Native v2 and supported v1 agent frontmatter are accepted. Symlinked project configuration and agent files are ignored.

Project skills are loaded from the native skills roots under `.kilo/` and `.kilocode/` when project configuration is enabled. Project plugin declarations and generic plugin directories are not loaded by this host.

The v2 host passes skill markdown to the model as content. It does not execute `!` command placeholders; trusted v1 command expansion is not part of this compatibility slice.
