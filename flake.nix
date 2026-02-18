{
  description = "Kilo development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      rev = self.shortRev or self.dirtyShortRev or "dirty";
    in
    {
      devShells = forEachSystem (pkgs: {
        default =
          let
            kilo-dev = pkgs.writeShellScriptBin "kilo-dev" ''
              cd "$KILO_ROOT"
              exec ${pkgs.bun}/bin/bun dev "$@"
            '';

            kilo-install-bin = pkgs.writeShellScriptBin "kilo-install" ''
              set -euo pipefail

              CACHE_DIR="$HOME/.cache/kilo-nix"
              VERSION="''${1:-latest}"

              # Platform detection
              os=$(uname -s | tr '[:upper:]' '[:lower:]')
              case "$os" in
                darwin) os="darwin" ;;
                linux) os="linux" ;;
                *) echo "Unsupported OS: $os" >&2; exit 1 ;;
              esac

              arch=$(uname -m)
              case "$arch" in
                aarch64) arch="arm64" ;;
                x86_64) arch="x64" ;;
                *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
              esac

              # Rosetta 2 detection on macOS
              if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
                rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
                if [ "$rosetta_flag" = "1" ]; then
                  arch="arm64"
                fi
              fi

              # Musl detection on Linux
              is_musl=""
              if [ "$os" = "linux" ]; then
                if [ -f /etc/alpine-release ] || (command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl); then
                  is_musl="-musl"
                fi
              fi

              # AVX2 detection for baseline builds
              needs_baseline=""
              if [ "$arch" = "x64" ]; then
                if [ "$os" = "linux" ] && ! grep -qi avx2 /proc/cpuinfo 2>/dev/null; then
                  needs_baseline="-baseline"
                elif [ "$os" = "darwin" ]; then
                  avx2=$(sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0)
                  if [ "$avx2" != "1" ]; then
                    needs_baseline="-baseline"
                  fi
                fi
              fi

              # Determine archive extension
              if [ "$os" = "linux" ]; then
                ext=".tar.gz"
              else
                ext=".zip"
              fi

              # Build filename and URL
              target="$os-$arch$needs_baseline$is_musl"
              filename="kilo-$target$ext"

              if [ "$VERSION" = "latest" ]; then
                url="https://github.com/Kilo-Org/kilo/releases/latest/download/$filename"
                echo "Installing latest version of kilo..." >&2
              else
                # Strip leading 'v' if present
                VERSION="''${VERSION#v}"
                url="https://github.com/Kilo-Org/kilo/releases/download/v''${VERSION}/$filename"
                echo "Installing kilo version $VERSION..." >&2
              fi

              # Create cache directory
              mkdir -p "$CACHE_DIR"

              # Download to temporary directory
              tmp_dir=$(mktemp -d)
              trap "rm -rf $tmp_dir" EXIT

              echo "Downloading from $url..." >&2
              if ! ${pkgs.curl}/bin/curl -fsSL -o "$tmp_dir/$filename" "$url"; then
                echo "Error: Failed to download kilo from $url" >&2
                echo "Please check your internet connection or visit https://github.com/Kilo-Org/kilo/releases" >&2
                exit 1
              fi

              # Extract the archive
              echo "Extracting..." >&2
              if [ "$os" = "linux" ]; then
                ${pkgs.gnutar}/bin/tar -xzf "$tmp_dir/$filename" -C "$tmp_dir"
              else
                ${pkgs.unzip}/bin/unzip -q "$tmp_dir/$filename" -d "$tmp_dir"
              fi

              # Install the binary
              KILO_BIN="$CACHE_DIR/kilo"
              mv "$tmp_dir/kilo" "$KILO_BIN"
              chmod +x "$KILO_BIN"

              # Get the installed version
              installed_version=$("$KILO_BIN" --version 2>/dev/null || echo "unknown")
              echo "Successfully installed kilo $installed_version to $KILO_BIN" >&2
            '';

            kilo-bin = pkgs.writeShellScriptBin "kilo" ''
              set -euo pipefail

              CACHE_DIR="$HOME/.cache/kilo-nix"
              KILO_BIN="$CACHE_DIR/kilo"

              if [ ! -f "$KILO_BIN" ]; then
                echo "Error: kilo is not installed in the cache." >&2
                echo "Please run 'kilo-install' first to download and install kilo." >&2
                echo "" >&2
                echo "Examples:" >&2
                echo "  kilo-install          # Install latest version" >&2
                echo "  kilo-install 1.0.180  # Install specific version" >&2
                exit 1
              fi

              # Execute the cached binary with all arguments
              exec "$KILO_BIN" "$@"
            '';
          in
          pkgs.mkShell {
            packages = with pkgs; [
              bun
              nodejs_20
              pkg-config
              openssl
              git
              gh
              playwright-driver.browsers
              vsce
              unzip
              gnutar
              gzip
              kilo-dev
              kilo-install-bin
              kilo-bin
            ];
            shellHook = ''
              export KILO_ROOT="$PWD"
              export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
              export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
            '';
          };
      });

      overlays = {
        default =
          final: _prev:
          let
            node_modules = final.callPackage ./nix/node_modules.nix {
              inherit rev;
            };
            opencode = final.callPackage ./nix/opencode.nix {
              inherit node_modules;
            };
            desktop = final.callPackage ./nix/desktop.nix {
              inherit opencode;
            };
          in
          {
            inherit opencode;
            opencode-desktop = desktop;
          };
      };

      packages = forEachSystem (
        pkgs:
        let
          node_modules = pkgs.callPackage ./nix/node_modules.nix {
            inherit rev;
          };
          kilo = pkgs.callPackage ./nix/kilo.nix {
            inherit node_modules;
          };
          desktop = pkgs.callPackage ./nix/desktop.nix {
            inherit kilo;
          };
        in
        {
          default = kilo;
          inherit kilo desktop;
          # Updater derivation with fakeHash - build fails and reveals correct hash
          node_modules_updater = node_modules.override {
            hash = pkgs.lib.fakeHash;
          };
        }
      );
    };
}
