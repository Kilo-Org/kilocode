#!/usr/bin/env bash
# kilocode_change - new file
#
# Reads this job's secret bundle from Kilo STS with the job's GitHub OIDC token and sets each
# requested secret as a step output named after its bundle key. A key that action.yml declares as
# `<KEY>_FILE` (private keys, certificate chains) is also, or only, written to a mode 0600 file, and
# that output holds its path. See README.md next to this file.
#
# Tokens and secret values never appear in argv or in the log: curl reads its Authorization header
# from a config on stdin, jq reads values from files and writes them only as ::add-mask:: commands,
# to GITHUB_OUTPUT and to the key files. The responses live in a mode 0700 temporary directory
# that is deleted on exit. Nothing is written to GITHUB_ENV.
set -euo pipefail
umask 077
export LC_ALL=C

readonly MAX_BODY_BYTES=1048576
readonly MAX_ATTEMPTS=3
readonly MAX_RETRY_WAIT_SECONDS=60
readonly DEFAULT_RETRY_WAIT_SECONDS=5

# Prints one error line and exits. The message keeps only a small printable character set and is
# capped, so text from a response can neither inject a workflow command nor flood the log. It uses
# only bash, so it works even when a tool is missing.
fail() {
  local unsafe='[^A-Za-z0-9 ._:;/()=,-]'
  local message=${1//$unsafe/?}
  printf '::error title=kilo-credentials::%s\n' "${message:0:300}"
  exit 1
}

for tool in awk cat curl jq mktemp od rm sleep tr wc; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is not installed on the runner"
done

workload=${INPUT_WORKLOAD-}
requested=${INPUT_SECRETS-}
sts_url=${INPUT_STS_URL-}

[[ $workload =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || fail "input workload is not an STS workload name"
# Only the two STS deployments (services/sts/wrangler.jsonc in Kilo-Org/cloud): another origin
# would receive the job's OIDC token.
case $sts_url in
  https://sts.kiloapps.io | https://sts-staging.kiloapps.io) ;;
  *) fail "input sts-url must be https://sts.kiloapps.io or https://sts-staging.kiloapps.io" ;;
esac
[[ -n ${GITHUB_OUTPUT-} && -f $GITHUB_OUTPUT ]] || fail "GITHUB_OUTPUT is not set; run this action in a GitHub Actions job"
[[ -n ${GITHUB_ACTION_PATH-} && -f $GITHUB_ACTION_PATH/action.yml ]] || fail "GITHUB_ACTION_PATH does not hold action.yml"
[[ -n ${ACTIONS_ID_TOKEN_REQUEST_URL-} && -n ${ACTIONS_ID_TOKEN_REQUEST_TOKEN-} ]] ||
  fail "no GitHub OIDC token available; the job needs permissions: id-token: write"
[[ $ACTIONS_ID_TOKEN_REQUEST_URL =~ ^https://[^[:space:]\"\\]+$ ]] || fail "ACTIONS_ID_TOKEN_REQUEST_URL is not an https URL"
[[ $ACTIONS_ID_TOKEN_REQUEST_TOKEN =~ ^[A-Za-z0-9._-]+$ ]] || fail "ACTIONS_ID_TOKEN_REQUEST_TOKEN has an unexpected format"

# A composite action passes on only the outputs its action.yml declares, so a key without a
# declared output would reach the caller as an empty string. The declared outputs are the
# upper-case keys under `outputs:`; `<KEY>` declares a value output and `<KEY>_FILE` a key file.
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
tmp=$(mktemp -d "$temp_root/kilo-credentials.XXXXXX") || fail "could not create a temporary directory"
# The key files outlive this step only when every output is set.
files_dir=""
keep_files=""
cleanup() {
  rm -rf -- "$tmp"
  if [[ -n $files_dir && -z $keep_files ]]; then rm -rf -- "$files_dir"; fi
}
trap cleanup EXIT

# -q must come first: it stops curl from reading a .curlrc that could add tracing.
curl_options=(--silent --proto '=https' --max-filesize "$MAX_BODY_BYTES" --write-out '%{http_code}')

# Transport failures worth another attempt: no connection (7), HTTP/2 framing (16), timeout (28),
# TLS handshake (35), empty reply (52), send or receive failure (55, 56), HTTP/2 stream (92).
retryable_curl_exit() {
  case $1 in
    7 | 16 | 28 | 35 | 52 | 55 | 56 | 92) return 0 ;;
    *) return 1 ;;
  esac
}

# 1. A GitHub OIDC token for the STS audience, in $tmp/oidc.json and masked. The audience is the
# STS origin, whose characters need only ':' and '/' encoded. A 5xx answer or a retryable
# transport failure sets `problem` and returns 1; any other failure ends the action.
audience=${sts_url//:/%3A}
audience=${audience//\//%2F}
separator='?'
[[ $ACTIONS_ID_TOKEN_REQUEST_URL == *\?* ]] && separator='&'
oidc_url="$ACTIONS_ID_TOKEN_REQUEST_URL${separator}audience=$audience"

request_oidc_token() {
  local status curl_exit=0
  rm -f -- "$tmp/oidc.json"
  status=$(
    printf 'header = "Authorization: Bearer %s"\nurl = "%s"\n' "$ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$oidc_url" |
      curl -q --config - "${curl_options[@]}" --max-time 30 --output "$tmp/oidc.json" 2>/dev/null
  ) || curl_exit=$?
  if ((curl_exit != 0)); then
    retryable_curl_exit "$curl_exit" || fail "GitHub OIDC token request failed (curl exit $curl_exit)"
    problem="GitHub OIDC token request failed (curl exit $curl_exit)"
    return 1
  fi
  if [[ $status =~ ^5[0-9][0-9]$ ]]; then
    problem="GitHub OIDC token request returned HTTP $status"
    return 1
  fi
  [[ $status == 200 ]] || fail "GitHub OIDC token request returned HTTP ${status:0:3}"
  jq -s -r '
    if length == 1 and (.[0] | type == "object" and (.value | type) == "string"
      and (.value | test("^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$")))
    then "::add-mask::" + .[0].value
    else error
    end
  ' "$tmp/oidc.json" 2>/dev/null || fail "GitHub OIDC response holds no token"
}

# STS answers a refusal with a BundleResult or { error }. Only short snake_case words from it are
# shown; anything else in the body stays out of the log.
refusal_detail() {
  jq -s -r '
    if length == 1 and (.[0] | type == "object")
    then .[0] | [.status, .reason, .error] | map(select(type == "string" and test("^[a-z_]{1,64}$"))) | join(" ")
    else empty
    end
  ' "$tmp/bundle.json" 2>/dev/null || true
}

# 2. The bundle (STS POST /v1/bundle with an empty BundleRequest). Each attempt requests a new
# OIDC token. A retryable OIDC or transport failure waits 5 s; an STS 503 waits for the
# retryAfterSeconds of its body, else its Retry-After header, else 5 s, capped at 60 s. At most
# three attempts.
attempt=1
while :; do
  problem=""
  wait_seconds=$DEFAULT_RETRY_WAIT_SECONDS
  if request_oidc_token; then
    rm -f -- "$tmp/bundle.json" "$tmp/headers"
    curl_exit=0
    status=$(
      {
        jq -r '"header = \"Authorization: Bearer \(.value)\""' "$tmp/oidc.json"
        printf '%s\n' 'header = "Content-Type: application/json"' 'header = "Accept: application/json"' 'data = "{}"'
        printf 'url = "%s/v1/bundle"\n' "$sts_url"
      } | curl -q --config - "${curl_options[@]}" --max-time 60 --dump-header "$tmp/headers" \
        --output "$tmp/bundle.json" 2>/dev/null
    ) || curl_exit=$?
    rm -f -- "$tmp/oidc.json"

    if ((curl_exit != 0)); then
      retryable_curl_exit "$curl_exit" || fail "STS bundle request failed (curl exit $curl_exit)"
      problem="STS bundle request failed (curl exit $curl_exit)"
    elif [[ $status == 503 ]]; then
      detail=$(refusal_detail)
      problem="STS bundle request returned HTTP 503${detail:+ ($detail)}"
      retry_after=$(
        jq -s -r '
          if length == 1 and (.[0] | type == "object")
            and (.[0].retryAfterSeconds | type == "number" and . >= 1 and . <= 3600 and . == floor)
          then .[0].retryAfterSeconds
          else empty
          end
        ' "$tmp/bundle.json" 2>/dev/null
      ) || retry_after=""
      if [[ $retry_after =~ ^[0-9]{1,4}$ ]]; then
        problem+="; retryAfterSeconds=$retry_after"
        wait_seconds=$retry_after
      else
        retry_after=$(
          awk 'tolower($0) ~ /^retry-after:[ \t]*[0-9]+[ \t\r]*$/ { sub(/^[^:]*:[ \t]*/, ""); sub(/[ \t\r]+$/, ""); print; exit }' \
            "$tmp/headers" 2>/dev/null
        ) || retry_after=""
        if [[ $retry_after =~ ^[0-9]{1,4}$ ]]; then
          problem+="; Retry-After=$retry_after"
          wait_seconds=$retry_after
        fi
      fi
      wait_seconds=$((10#$wait_seconds))
      ((wait_seconds <= MAX_RETRY_WAIT_SECONDS)) || wait_seconds=$MAX_RETRY_WAIT_SECONDS
      ((wait_seconds >= 1)) || wait_seconds=1
    else
      break
    fi
  fi
  ((attempt < MAX_ATTEMPTS)) || fail "$problem after $attempt attempts"
  printf 'kilo-credentials: %s; retrying in %s s (attempt %s of %s)\n' \
    "$problem" "$wait_seconds" "$((attempt + 1))" "$MAX_ATTEMPTS"
  sleep "$wait_seconds" || fail "could not wait before retrying"
  attempt=$((attempt + 1))
done

if [[ $status != 200 ]]; then
  detail=$(refusal_detail)
  fail "STS bundle request returned HTTP ${status:0:3}${detail:+ ($detail)}"
fi
[[ -f $tmp/bundle.json ]] || fail "STS bundle response is empty"
size=$(wc -c <"$tmp/bundle.json") || fail "could not measure the STS bundle response"
((size <= MAX_BODY_BYTES)) || fail "STS bundle response is larger than $MAX_BODY_BYTES bytes"

# 3. Mask every line of every value in the bundle, requested or not, before anything else reads
# it, and every multi-line value as a whole as well. The runner decodes %25, %0D and %0A in a
# command, so those characters are encoded.
jq -r '
  objects | .secrets | objects | .[] | objects | .value | strings
  | (splits("[\r\n]+") | select(test("\\S")) | "::add-mask::" + gsub("%"; "%25")),
    (select(test("[\r\n]")) | "::add-mask::" + (gsub("%"; "%25") | gsub("\r"; "%0D") | gsub("\n"; "%0A")))
' "$tmp/bundle.json" 2>/dev/null || fail "STS bundle response is not JSON"

# 4. The response must be exactly one ok BundleResult (sts-contracts BundleResultSchema).
jq -s -e '
  def name: type == "string" and test("^[A-Z][A-Z0-9_]{0,127}$");
  length == 1 and (.[0] |
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
    and (.missing | type == "array" and all(.[]; name)))
' "$tmp/bundle.json" >/dev/null 2>&1 || fail "STS bundle response does not have the expected shape"

# The shape is checked, so the reads below cannot fail on the document; their stderr stays
# suppressed anyway, because a jq error quotes the input.
response_workload=$(jq -r '.workload' "$tmp/bundle.json" 2>/dev/null) || fail "could not read the STS bundle"
[[ $response_workload == "$workload" ]] ||
  fail "STS returned the bundle of workload $response_workload, not $workload; check the job environment and the input workload"

# A stale bundle is STS's last known copy while the secret manager is unreachable; it may hold a
# revoked key. A CI job can run again later, so it gets no stale values.
stale_fetched_at=$(jq -r 'if .stale then .fetchedAt else empty end' "$tmp/bundle.json" 2>/dev/null) ||
  fail "could not read the STS bundle"
[[ -z $stale_fetched_at ]] ||
  fail "STS served a stale copy of the $workload bundle, fetched at $stale_fetched_at; run the job again later"

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
  [[ $declared != *" $key "* ]] || value_keys+=("$key")
  [[ $declared != *" ${key}_FILE "* ]] || file_keys+=("$key")
done
: >"$tmp/outputs"
if ((${#value_keys[@]} > 0)); then
  delimiters=""
  for _ in "${value_keys[@]}"; do
    hex=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') || fail "could not read random bytes"
    [[ $hex =~ ^[0-9a-f]{32}$ ]] || fail "could not read random bytes"
    delimiters+="ghadelimiter_$hex "
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
  files_dir=$(mktemp -d "$temp_root/kilo-credentials-files.XXXXXX") || fail "could not create the key file directory"
  [[ $files_dir != *$'\n'* ]] || fail "the temporary directory path holds a line break"
  for key in "${file_keys[@]}"; do
    { jq -j --arg key "$key" '.secrets[$key].value' "$tmp/bundle.json" >"$files_dir/$key"; } 2>/dev/null ||
      fail "could not write the file of $key"
    printf '%s_FILE=%s\n' "$key" "$files_dir/$key" >>"$tmp/outputs"
  done
fi
{ cat "$tmp/outputs" >>"$GITHUB_OUTPUT"; } 2>/dev/null || fail "could not set the outputs"
keep_files=1
printf 'kilo-credentials: set outputs for %s from the %s bundle\n' "${bundle_keys[*]}" "$workload"
