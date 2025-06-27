#!/bin/bash

# no set -e here; if either command fails we still want to do the rest

# we have our own readme/changelog and github scripting
git checkout origin/main README.md CHANGELOG.md .github

# We disabled telemetry, so we do not test it
git rm "webview-ui/src/__tests__/TelemetryClient.spec.ts"
git rm "webview-ui/src/utils/__tests__/TelemetryClient.spec.ts"

# we have no localized readmes
git status | grep 'deleted by us' | perl -pe 's/.*?://' | grep README.md | xargs -n1 -I{} git rm "{}"  

# remove github and roo config whe have deleted previously
git status | grep 'deleted by us' | perl -pe 's/.*?://' | grep ".github/" | xargs -n1 -I{} git rm "{}"  
git status | grep 'deleted by us' | perl -pe 's/.*?://' | grep ".roo/" | xargs -n1 -I{} git rm "{}"  
git rm .roomodes