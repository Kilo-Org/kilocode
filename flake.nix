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
            kilo = pkgs.writeShellScriptBin "kilo" ''
              cd "$KILO_ROOT"
              exec ${pkgs.bun}/bin/bun dev "$@"
            '';
          in
          pkgs.mkShell {
            packages =
              with pkgs;
              [
                bun
                nodejs_20
                pkg-config
                openssl
                git
                jetbrains.jdk
                jdk21
                kilo
              ]
              ++ lib.optionals stdenv.isLinux [
                xorg.libX11
                xorg.libXext
                xorg.libXrender
                xorg.libXtst
                xorg.libXi
                fontconfig
                freetype
              ];
            shellHook = ''
              export KILO_ROOT="$PWD"
            ''
            + pkgs.lib.optionalString pkgs.stdenv.isLinux ''
              export LD_LIBRARY_PATH="${
                pkgs.lib.makeLibraryPath [
                  pkgs.xorg.libX11
                  pkgs.xorg.libXext
                  pkgs.xorg.libXrender
                  pkgs.xorg.libXtst
                  pkgs.xorg.libXi
                  pkgs.fontconfig
                  pkgs.freetype
                ]
              }:$LD_LIBRARY_PATH"
            '';
          };
      });

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
          # nixpkgs cpu naming to bun cpu naming
          cpuMap = {
            x86_64 = "x64";
            aarch64 = "arm64";
          };
          # matrix of node_modules builds - these will always fail due to fakeHash usage
          # but allow computation of the correct hash from any build machine for any cpu/os
          # see the update-nix-hashes workflow for usage
          moduleUpdaters = pkgs.lib.listToAttrs (
            pkgs.lib.concatMap
              (
                cpu:
                map
                  (os: {
                    name = "${cpu}-${os}_node_modules";
                    value = node_modules.override {
                      bunCpu = cpuMap.${cpu};
                      bunOs = os;
                      hash = pkgs.lib.fakeHash;
                    };
                  })
                  [
                    "linux"
                    "darwin"
                  ]
              )
              [
                "x86_64"
                "aarch64"
              ]
          );
        in
        {
          default = kilo;
          inherit kilo desktop;
        }
        // moduleUpdaters
      );
    };
}
