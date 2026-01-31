/**
 * Shell completion script generator
 * Generates completion scripts for bash, zsh, fish, and powershell
 */

const SHELLS = ["bash", "zsh", "fish", "powershell"] as const
type Shell = (typeof SHELLS)[number]

export function generateCompletionScript(shell: Shell): string {
	switch (shell) {
		case "bash":
			return generateBashCompletion()
		case "zsh":
			return generateZshCompletion()
		case "fish":
			return generateFishCompletion()
		case "powershell":
			return generatePowershellCompletion()
	}
}

function generateBashCompletion(): string {
	return `# kilocode bash completion
# Add to ~/.bashrc: eval "$(kilocode completion bash)"

_kilocode_completions() {
    local cur prev opts commands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    commands="auth config debug models completion"
    opts="-m --mode -w --workspace -a --auto --yolo -j --json -i --json-io -c --continue -t --timeout -p --parallel -e --existing-branch -P --provider -M --model -s --session -f --fork --nosplash --append-system-prompt --append-system-prompt-file --on-task-completed --attach -h --help -V --version"

    case "\${prev}" in
        -m|--mode)
            COMPREPLY=( $(compgen -W "code architect ask debug orchestrator" -- "\${cur}") )
            return 0
            ;;
        -w|--workspace)
            COMPREPLY=( $(compgen -d -- "\${cur}") )
            return 0
            ;;
        --append-system-prompt-file|--attach)
            COMPREPLY=( $(compgen -f -- "\${cur}") )
            return 0
            ;;
        debug)
            COMPREPLY=( $(compgen -W "os keyboard" -- "\${cur}") )
            return 0
            ;;
        completion)
            COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "\${cur}") )
            return 0
            ;;
    esac

    if [[ \${cur} == -* ]]; then
        COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
    elif [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    fi
}

complete -F _kilocode_completions kilocode
complete -F _kilocode_completions kilo
`
}

function generateZshCompletion(): string {
	return `#compdef kilocode kilo
# kilocode zsh completion
# Add to ~/.zshrc: eval "$(kilocode completion zsh)"

_kilocode() {
    local -a commands opts

    commands=(
        'auth:Manage authentication'
        'config:Open configuration file'
        'debug:Run system compatibility check'
        'models:List available models'
        'completion:Generate shell completion script'
    )

    opts=(
        '-m[Set mode]:mode:(code architect ask debug orchestrator)'
        '--mode[Set mode]:mode:(code architect ask debug orchestrator)'
        '-w[Workspace path]:path:_files -/'
        '--workspace[Workspace path]:path:_files -/'
        '-a[Autonomous mode]'
        '--auto[Autonomous mode]'
        '--yolo[Auto-approve all permissions]'
        '-j[JSON output]'
        '--json[JSON output]'
        '-i[Bidirectional JSON mode]'
        '--json-io[Bidirectional JSON mode]'
        '-c[Resume last conversation]'
        '--continue[Resume last conversation]'
        '-t[Timeout in seconds]:seconds:'
        '--timeout[Timeout in seconds]:seconds:'
        '-p[Parallel mode]'
        '--parallel[Parallel mode]'
        '-e[Existing branch]:branch:'
        '--existing-branch[Existing branch]:branch:'
        '-P[Provider ID]:provider:'
        '--provider[Provider ID]:provider:'
        '-M[Model override]:model:'
        '--model[Model override]:model:'
        '-s[Session ID]:session:'
        '--session[Session ID]:session:'
        '-f[Fork session ID]:fork:'
        '--fork[Fork session ID]:fork:'
        '--nosplash[Disable welcome message]'
        '--append-system-prompt[Custom instructions]:text:'
        '--append-system-prompt-file[Custom instructions file]:file:_files'
        '--on-task-completed[Prompt on task completion]:prompt:'
        '--attach[Attach file]:file:_files'
        '-h[Show help]'
        '--help[Show help]'
        '-V[Show version]'
        '--version[Show version]'
    )

    _arguments -s \\
        '1: :->command' \\
        '*: :->args' && return 0

    case "$state" in
        command)
            _describe -t commands 'kilocode commands' commands
            _arguments -s "\${opts[@]}"
            ;;
        args)
            case "$words[2]" in
                debug)
                    _values 'debug mode' os keyboard
                    ;;
                completion)
                    _values 'shell' bash zsh fish powershell
                    ;;
            esac
            ;;
    esac
}

# Register completion (required for eval usage; no-op if loaded via fpath)
compdef _kilocode kilocode kilo
`
}

function generateFishCompletion(): string {
	return `# kilocode fish completion
# Add to ~/.config/fish/completions/kilocode.fish

# Disable file completion by default
complete -c kilocode -f
complete -c kilo -f

# Commands
complete -c kilocode -n "__fish_use_subcommand" -a "auth" -d "Manage authentication"
complete -c kilocode -n "__fish_use_subcommand" -a "config" -d "Open configuration file"
complete -c kilocode -n "__fish_use_subcommand" -a "debug" -d "Run system compatibility check"
complete -c kilocode -n "__fish_use_subcommand" -a "models" -d "List available models"
complete -c kilocode -n "__fish_use_subcommand" -a "completion" -d "Generate shell completion script"
complete -c kilo -n "__fish_use_subcommand" -a "auth" -d "Manage authentication"
complete -c kilo -n "__fish_use_subcommand" -a "config" -d "Open configuration file"
complete -c kilo -n "__fish_use_subcommand" -a "debug" -d "Run system compatibility check"
complete -c kilo -n "__fish_use_subcommand" -a "models" -d "List available models"
complete -c kilo -n "__fish_use_subcommand" -a "completion" -d "Generate shell completion script"

# Debug subcommand
complete -c kilocode -n "__fish_seen_subcommand_from debug" -a "os keyboard"
complete -c kilo -n "__fish_seen_subcommand_from debug" -a "os keyboard"

# Completion subcommand
complete -c kilocode -n "__fish_seen_subcommand_from completion" -a "bash zsh fish powershell"
complete -c kilo -n "__fish_seen_subcommand_from completion" -a "bash zsh fish powershell"

# Options
complete -c kilocode -s m -l mode -d "Set mode" -xa "code architect ask debug orchestrator"
complete -c kilocode -s w -l workspace -d "Workspace path" -xa "(__fish_complete_directories)"
complete -c kilocode -s a -l auto -d "Autonomous mode"
complete -c kilocode -l yolo -d "Auto-approve all permissions"
complete -c kilocode -s j -l json -d "JSON output"
complete -c kilocode -s i -l json-io -d "Bidirectional JSON mode"
complete -c kilocode -s c -l continue -d "Resume last conversation"
complete -c kilocode -s t -l timeout -d "Timeout in seconds"
complete -c kilocode -s p -l parallel -d "Parallel mode"
complete -c kilocode -s e -l existing-branch -d "Existing branch"
complete -c kilocode -s P -l provider -d "Provider ID"
complete -c kilocode -s M -l model -d "Model override"
complete -c kilocode -s s -l session -d "Session ID"
complete -c kilocode -s f -l fork -d "Fork session ID"
complete -c kilocode -l nosplash -d "Disable welcome message"
complete -c kilocode -l append-system-prompt -d "Custom instructions"
complete -c kilocode -l append-system-prompt-file -d "Custom instructions file" -xa "(__fish_complete_path)"
complete -c kilocode -l on-task-completed -d "Prompt on task completion"
complete -c kilocode -l attach -d "Attach file" -xa "(__fish_complete_path)"
complete -c kilocode -s h -l help -d "Show help"
complete -c kilocode -s V -l version -d "Show version"
complete -c kilo -s m -l mode -d "Set mode" -xa "code architect ask debug orchestrator"
complete -c kilo -s w -l workspace -d "Workspace path" -xa "(__fish_complete_directories)"
complete -c kilo -s a -l auto -d "Autonomous mode"
complete -c kilo -l yolo -d "Auto-approve all permissions"
complete -c kilo -s j -l json -d "JSON output"
complete -c kilo -s i -l json-io -d "Bidirectional JSON mode"
complete -c kilo -s c -l continue -d "Resume last conversation"
complete -c kilo -s t -l timeout -d "Timeout in seconds"
complete -c kilo -s p -l parallel -d "Parallel mode"
complete -c kilo -s e -l existing-branch -d "Existing branch"
complete -c kilo -s P -l provider -d "Provider ID"
complete -c kilo -s M -l model -d "Model override"
complete -c kilo -s s -l session -d "Session ID"
complete -c kilo -s f -l fork -d "Fork session ID"
complete -c kilo -l nosplash -d "Disable welcome message"
complete -c kilo -l append-system-prompt -d "Custom instructions"
complete -c kilo -l append-system-prompt-file -d "Custom instructions file" -xa "(__fish_complete_path)"
complete -c kilo -l on-task-completed -d "Prompt on task completion"
complete -c kilo -l attach -d "Attach file" -xa "(__fish_complete_path)"
complete -c kilo -s h -l help -d "Show help"
complete -c kilo -s V -l version -d "Show version"
`
}

function generatePowershellCompletion(): string {
	return `# kilocode PowerShell completion
# Add to $PROFILE: kilocode completion powershell | Out-String | Invoke-Expression

Register-ArgumentCompleter -Native -CommandName kilocode,kilo -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = @('auth', 'config', 'debug', 'models', 'completion')
    $modes = @('code', 'architect', 'ask', 'debug', 'orchestrator')
    $debugModes = @('os', 'keyboard')
    $shells = @('bash', 'zsh', 'fish', 'powershell')

    $opts = @(
        @{Name='-m'; Tooltip='Set mode'}
        @{Name='--mode'; Tooltip='Set mode'}
        @{Name='-w'; Tooltip='Workspace path'}
        @{Name='--workspace'; Tooltip='Workspace path'}
        @{Name='-a'; Tooltip='Autonomous mode'}
        @{Name='--auto'; Tooltip='Autonomous mode'}
        @{Name='--yolo'; Tooltip='Auto-approve all permissions'}
        @{Name='-j'; Tooltip='JSON output'}
        @{Name='--json'; Tooltip='JSON output'}
        @{Name='-i'; Tooltip='Bidirectional JSON mode'}
        @{Name='--json-io'; Tooltip='Bidirectional JSON mode'}
        @{Name='-c'; Tooltip='Resume last conversation'}
        @{Name='--continue'; Tooltip='Resume last conversation'}
        @{Name='-t'; Tooltip='Timeout in seconds'}
        @{Name='--timeout'; Tooltip='Timeout in seconds'}
        @{Name='-p'; Tooltip='Parallel mode'}
        @{Name='--parallel'; Tooltip='Parallel mode'}
        @{Name='-e'; Tooltip='Existing branch'}
        @{Name='--existing-branch'; Tooltip='Existing branch'}
        @{Name='-P'; Tooltip='Provider ID'}
        @{Name='--provider'; Tooltip='Provider ID'}
        @{Name='-M'; Tooltip='Model override'}
        @{Name='--model'; Tooltip='Model override'}
        @{Name='-s'; Tooltip='Session ID'}
        @{Name='--session'; Tooltip='Session ID'}
        @{Name='-f'; Tooltip='Fork session ID'}
        @{Name='--fork'; Tooltip='Fork session ID'}
        @{Name='--nosplash'; Tooltip='Disable welcome message'}
        @{Name='--append-system-prompt'; Tooltip='Custom instructions'}
        @{Name='--append-system-prompt-file'; Tooltip='Custom instructions file'}
        @{Name='--on-task-completed'; Tooltip='Prompt on task completion'}
        @{Name='--attach'; Tooltip='Attach file'}
        @{Name='-h'; Tooltip='Show help'}
        @{Name='--help'; Tooltip='Show help'}
        @{Name='-V'; Tooltip='Show version'}
        @{Name='--version'; Tooltip='Show version'}
    )

    $elements = $commandAst.CommandElements
    $command = $null
    if ($elements.Count -gt 1) {
        $command = $elements[1].Extent.Text
    }

    # Handle subcommand completions
    if ($command -eq 'debug') {
        $debugModes | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
        return
    }

    if ($command -eq 'completion') {
        $shells | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
        return
    }

    # Handle mode completion
    # Check if previous word is -m/--mode
    # Case 1: "kilocode -m <Tab>" - elements = [kilocode, -m], wordToComplete is empty
    # Case 2: "kilocode -m ar<Tab>" - elements = [kilocode, -m, ar], wordToComplete is "ar"
    $prevWord = $null
    if ($wordToComplete -eq '' -and $elements.Count -ge 2) {
        $prevWord = $elements[-1].Extent.Text
    } elseif ($elements.Count -gt 2) {
        $prevWord = $elements[-2].Extent.Text
    }

    if ($prevWord -eq '-m' -or $prevWord -eq '--mode') {
        $modes | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
        return
    }

    # Handle options
    if ($wordToComplete -like '-*') {
        $opts | Where-Object { $_.Name -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ParameterName', $_.Tooltip)
        }
        return
    }

    # Handle commands
    if ($elements.Count -le 2) {
        $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'Command', $_)
        }
    }
}
`
}

export function isValidShell(shell: string): shell is Shell {
	return SHELLS.includes(shell as Shell)
}

export { SHELLS }
