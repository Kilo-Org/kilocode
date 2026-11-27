#!/usr/bin/env bash
# kilocode_change - new file
#
# Reads this job's secret bundle from Kilo STS with the job's GitHub OIDC token and sets each
# requested secret as a step output named after its bundle key. A key that action.yml declares as
# `<KEY>_FILE` (private keys, certificate chains) is written to a mode 0600 file instead, and the
# output holds its path. See README.md next to this file.
#
# Tokens and secret values never appear in argv or in the log: curl reads its Authorization header
# from a config on stdin, jq reads values from files and writes them only as ::add-mask:: commands,
# to GITHUB_OUTPUT and to the key files. The two responses live in a mode 0700 temporary directory
# that is deleted on exit. Nothing is written to GITHUB_ENV.
set -euo pipefail
umask 077

readonly MAX_BODY_BYTES=1048576

# Prints one error line and exits. The message keeps only a small printable character set and is
# capped, so text from a response can neither inject a workflow command nor flood the log.
fail() {
  local message
  message=$(printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9 ._:;/()=,-' '?' | cut -c1-300)
  printf '::error title=kilo-credentials::%s\n' "$message"
  exit 1
}

workload=${INPUT_WORKLOAD-}
requested=${INPUT_SECRETS-}
sts_url=${INPUT_STS_URL-}

[[ $workload =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || fail "input workload is not an STS workload name"
[[ $sts_url =~ ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$ ]] ||
  fail "input sts-url must be an https origin without a path"
[[ -n ${GITHUB_OUTPUT-} && -f $GITHUB_OUTPUT ]] || fail "GITHUB_OUTPUT is not set; run this action in a GitHub Actions job"
[[ -n ${GITHUB_ACTION_PATH-} && -f $GITHUB_ACTION_PATH/action.yml ]] || fail "GITHUB_ACTION_PATH does not hold action.yml"
[[ -n ${ACTIONS_ID_TOKEN_REQUEST_URL-} && -n ${ACTIONS_ID_TOKEN_REQUEST_TOKEN-} ]] ||
  fail "no GitHub OIDC token available; the job needs permissions: id-token: write"
[[ $ACTIONS_ID_TOKEN_REQUEST_URL =~ ^https://[^[:space:]\"\\]+$ ]] || fail "ACTIONS_ID_TOKEN_REQUEST_URL is not an https URL"
[[ $ACTIONS_ID_TOKEN_REQUEST_TOKEN =~ ^[A-Za-z0-9._-]+$ ]] || fail "ACTIONS_ID_TOKEN_REQUEST_TOKEN has an unexpected format"

# A composite action passes on only the outputs its action.yml declares, so a key without a
# declared output would reach the caller as an empty string. The declared outputs are the
# upper-case keys under `outputs:`; `<KEY>_FILE` declares a key that is delivered as a file.
declared=" $(awk '
  /^outputs:/ { inside = 1; next }
  /^[^ #]/ { inside = 0 }
  inside && /^  [A-Z][A-Z0-9_]*:$/ { sub(/^  /, ""); sub(/:$/, ""); printf "%s ", $0 }
' "$GITHUB_ACTION_PATH/action.yml")" || fail "could not read the outputs of action.yml"

# Each non-empty line of the secrets input is one bundle key. Lines are reported by number, never
# echoed, in case someone pasted a value into the input.
bundle_keys=()
line_number=0
while IFS= read -r line || [[ -n $line ]]; do
  line_number=$((line_number + 1))
  line=${line%$'\r'}
  line=${line#"${line%%[![:space:]]*}"}
  line=${line%"${line##*[![:space:]]}"}
  [[ -z $line ]] && continue
  [[ $line =~ ^[A-Z][A-Z0-9_]{0,127}$ ]] ||
    fail "input secrets line $line_number is not a bundle key (upper case, digits, underscores)"
  [[ $declared == *" $line "* || $declared == *" ${line}_FILE "* ]] ||
    fail "input secrets line $line_number: $line is not an output of action.yml; declare it there first"
  [[ $line != *_FILE || $declared != *" $line "* ]] ||
    fail "input secrets line $line_number: request the bundle key ${line%_FILE}, not the output $line"
  for seen in ${bundle_keys[@]+"${bundle_keys[@]}"}; do
    [[ $seen != "$line" ]] || fail "input secrets line $line_number: $line is requested twice"
  done
  bundle_keys+=("$line")
done <<<"$requested"
((${#bundle_keys[@]} > 0)) || fail "input secrets names no bundle key"

temp_root=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
tmp=$(mktemp -d "$temp_root/kilo-credentials.XXXXXX")
# The key files outlive this step only when every output is set.
files_dir=""
keep_files=""
cleanup() {
  rm -rf -- "$tmp"
  if [[ -n $files_dir && -z $keep_files ]]; then rm -rf -- "$files_dir"; fi
}
trap cleanup EXIT

# -q must come first: it stops curl from reading a .curlrc that could add tracing.
curl_options=(--silent --proto '=https' --max-time 30 --max-filesize "$MAX_BODY_BYTES" --write-out '%{http_code}')

# 1. GitHub OIDC token for the STS audience. The audience is the STS origin, whose characters
# need only ':' and '/' encoded.
audience=${sts_url//:/%3A}
audience=${audience//\//%2F}
separator='?'
[[ $ACTIONS_ID_TOKEN_REQUEST_URL == *\?* ]] && separator='&'
oidc_url="$ACTIONS_ID_TOKEN_REQUEST_URL${separator}audience=$audience"

status=$(
  printf 'header = "Authorization: Bearer %s"\nurl = "%s"\n' "$ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$oidc_url" |
    curl -q --config - "${curl_options[@]}" --output "$tmp/oidc.json" 2>/dev/null
) || fail "GitHub OIDC token request failed (curl exit $?)"
[[ $status == 200 ]] || fail "GitHub OIDC token request returned HTTP ${status:0:3}"
jq -r '
  if type == "object" and (.value | type) == "string"
    and (.value | test("^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$"))
  then "::add-mask::" + .value
  else error
  end
' "$tmp/oidc.json" 2>/dev/null || fail "GitHub OIDC response holds no token"

# 2. The bundle (STS POST /v1/bundle). The body is an empty BundleRequest.
status=$(
  {
    jq -r '"header = \"Authorization: Bearer \(.value)\""' "$tmp/oidc.json"
    printf '%s\n' 'header = "Content-Type: application/json"' 'header = "Accept: application/json"' 'data = "{}"'
    printf 'url = "%s/v1/bundle"\n' "$sts_url"
  } | curl -q --config - "${curl_options[@]}" --output "$tmp/bundle.json" 2>/dev/null
) || fail "STS bundle request failed (curl exit $?)"
rm -f -- "$tmp/oidc.json"

if [[ $status != 200 ]]; then
  # STS answers a refusal with a BundleResult or { error }. Only short snake_case words from it are
  # shown; anything else in the body stays out of the log.
  detail=$(
    jq -r '
      if type == "object"
      then [.status, .reason, .error] | map(select(type == "string" and test("^[a-z_]{1,64}$"))) | join(" ")
      else empty
      end
    ' "$tmp/bundle.json" 2>/dev/null
  ) || detail=""
  fail "STS bundle request returned HTTP ${status:0:3}${detail:+ ($detail)}"
fi
size=$(wc -c <"$tmp/bundle.json")
((size <= MAX_BODY_BYTES)) || fail "STS bundle response is larger than $MAX_BODY_BYTES bytes"

# 3. Mask every line of every value in the bundle, requested or not, before anything else reads
# it. The runner decodes %25, %0D and %0A in a command, so '%' is encoded.
jq -r '
  objects | .secrets | objects | .[] | objects | .value | strings
  | splits("[\r\n]+") | select(test("\\S"))
  | "::add-mask::" + gsub("%"; "%25")
' "$tmp/bundle.json" 2>/dev/null || fail "STS bundle response is not JSON"

# 4. The response must be exactly an ok BundleResult (sts-contracts BundleResultSchema).
jq -e '
  def name: type == "string" and test("^[A-Z][A-Z0-9_]{0,127}$");
  type == "object"
  and (keys == ["environment", "etag", "fetchedAt", "missing", "secrets", "stale", "status", "workload"])
  and .status == "ok"
  and (.workload | type == "string" and test("^[a-z0-9][a-z0-9-]{0,62}$"))
  and (.environment | IN("development", "staging", "production"))
  and (.etag | type == "string" and test("^\"[A-Za-z0-9_-]{16,96}\"$"))
  and (.stale | type == "boolean")
  and (.fetchedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$"))
  and (.secrets | type == "object" and all(to_entries[];
    (.key | name)
    and (.value | type == "object" and keys == ["value", "version"]
      and (.value | type == "string")
      and (.version | type == "number" and . >= 0 and . == floor))))
  and (.missing | type == "array" and all(.[]; name))
' "$tmp/bundle.json" >/dev/null 2>&1 || fail "STS bundle response does not have the expected shape"

# The shape is checked, so the reads below cannot fail on the document; their stderr stays
# suppressed anyway, because a jq error quotes the input.
response_workload=$(jq -r '.workload' "$tmp/bundle.json" 2>/dev/null) || fail "could not read the STS bundle"
[[ $response_workload == "$workload" ]] ||
  fail "STS returned the bundle of workload $response_workload, not $workload; check the job environment and the input workload"

absent=$(jq -r --arg keys "${bundle_keys[*]}" '
  . as $bundle
  | [$keys | split(" ")[] | . as $key | select($bundle.secrets | has($key) | not)
    | if IN($bundle.missing[]) then . + "(not in the manager)" else . end]
  | join(" ")
' "$tmp/bundle.json" 2>/dev/null) || fail "could not read the STS bundle"
[[ -z $absent ]] || fail "STS bundle of $workload lacks requested keys: $absent"

# 5. Set only the requested keys as outputs, all at once from a file in the temporary directory.
# Each value gets its own random heredoc delimiter; jq writes nothing if a value contains its
# delimiter. A file key's exact bytes go to its own mode 0600 file in a new mode 0700 directory.
value_keys=()
file_keys=()
for key in "${bundle_keys[@]}"; do
  if [[ $declared == *" ${key}_FILE "* ]]; then file_keys+=("$key"); else value_keys+=("$key"); fi
done
: >"$tmp/outputs"
if ((${#value_keys[@]} > 0)); then
  delimiters=""
  for _ in "${value_keys[@]}"; do
    delimiters+="ghadelimiter_$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') "
  done
  jq -j --arg keys "${value_keys[*]}" --arg delimiters "$delimiters" '
    . as $bundle
    | [$keys | split(" ")[]] as $keys
    | [$delimiters | split(" ")[] | select(length > 0)] as $delimiters
    | if ($keys | length) != ($delimiters | length)
        or any(range($keys | length) as $i | $bundle.secrets[$keys[$i]].value | contains($delimiters[$i]); .)
      then error
      else range($keys | length) as $i
        | "\($keys[$i])<<\($delimiters[$i])\n\($bundle.secrets[$keys[$i]].value)\n\($delimiters[$i])\n"
      end
  ' "$tmp/bundle.json" >"$tmp/outputs" 2>/dev/null || fail "could not set the outputs"
fi
if ((${#file_keys[@]} > 0)); then
  files_dir=$(mktemp -d "$temp_root/kilo-credentials-files.XXXXXX")
  [[ $files_dir != *$'\n'* ]] || fail "the temporary directory path holds a line break"
  for key in "${file_keys[@]}"; do
    { jq -j --arg key "$key" '.secrets[$key].value' "$tmp/bundle.json" >"$files_dir/$key"; } 2>/dev/null ||
      fail "could not write the file of $key"
    printf '%s_FILE=%s\n' "$key" "$files_dir/$key" >>"$tmp/outputs"
  done
fi
{ cat "$tmp/outputs" >>"$GITHUB_OUTPUT"; } 2>/dev/null || fail "could not set the outputs"
keep_files=1

stale_fetched_at=$(jq -r 'if .stale then .fetchedAt else empty end' "$tmp/bundle.json" 2>/dev/null) ||
  fail "could not read the STS bundle"
if [[ -n $stale_fetched_at ]]; then
  printf '::warning title=kilo-credentials::STS served its last known copy of the %s bundle, fetched at %s\n' \
    "$workload" "$stale_fetched_at"
fi
printf 'kilo-credentials: set outputs for %s from the %s bundle\n' "${bundle_keys[*]}" "$workload"
