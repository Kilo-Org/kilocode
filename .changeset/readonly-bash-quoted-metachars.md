---
"@kilocode/cli": patch
---

Stop denying read-only bash commands in Ask, Plan, and Explore modes when a shell operator is only literal text, such as `grep "=>"`, `rg "foo|bar"`, or `cat <<'EOF'` bodies, or when output is discarded with `2>/dev/null` or `2>&1`. Real file redirects, pipes, chaining, and command substitution are still denied.
