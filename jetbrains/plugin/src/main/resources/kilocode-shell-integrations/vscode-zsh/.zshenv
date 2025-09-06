# ---------------------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License. See License.txt in the project root for license information.
# ---------------------------------------------------------------------------------------------

# Ensure USER_ZDOTDIR exists and is valid
if [[ -z "$USER_ZDOTDIR" ]]; then
    USER_ZDOTDIR=${ZDOTDIR:-$HOME}
fi

# Only process when the user config file exists
if [[ -f "$USER_ZDOTDIR/.zshenv" ]]; then
    VSCODE_ZDOTDIR=$ZDOTDIR
    ZDOTDIR=$USER_ZDOTDIR

    # Prevent recursive calls
    if [[ "$USER_ZDOTDIR" != "$VSCODE_ZDOTDIR" ]]; then
        source "$USER_ZDOTDIR/.zshenv"
    fi

    # Restore settings
    USER_ZDOTDIR=$ZDOTDIR
    ZDOTDIR=$VSCODE_ZDOTDIR
fi
