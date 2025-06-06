#!/bin/sh

echo "Kilocode state is being reset.  This probably doesn't work while VS Code is running."

# Reset the secrets:
sqlite3 ~/Library/Application\ Support/Code/User/globalStorage/state.vscdb \
"DELETE FROM ItemTable WHERE \
    key = 'kilocode.kilo-code' OR \
    key LIKE 'workbench.view.extension.kilo-code%' OR \
    key LIKE 'secret://{\"extensionId\":\"kilocode.kilo-code\",%';"

# delete all kilocode state files:
rm -rf ~/Library/Application\ Support/Code/User/globalStorage/kilocode.kilo-code/

# clear some of the vscode cache that I've observed contains kilocode related entries:
rm -f ~/Library/Application\ Support/Code/CachedProfilesData/__default__profile__/extensions.user.cache
