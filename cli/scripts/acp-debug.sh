#!/bin/bash
# ACP Debug Wrapper - logs stderr to /tmp/kilocode-acp.log
exec node /Users/silv/projects/kilocode/cli/dist/index.js --acp --acp-debug "$@" 2>/tmp/kilocode-acp.log