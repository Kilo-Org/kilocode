{
  description = "Kilo Code development environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.05";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;

      mkDevShell =
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        pkgs.mkShell {
          name = "kilo-code";

          packages = with pkgs; [
            nodejs_20
            corepack_20
            libnotify
            jetbrains.idea-community
            jetbrains.jdk
            jdk21
            gradle
            unzip
            # Build tools for native modules
            pkg-config
            python3
            gcc
            gnumake
            # Libraries
            libsecret
            # X11 libraries for JetBrains IDEs and native-keymap
            xorg.libX11
            xorg.libX11.dev
            xorg.libXext
            xorg.libXi
            xorg.libXrender
            xorg.libXtst
            xorg.libXrandr
            xorg.libXinerama
            xorg.libXcursor
            xorg.libXdamage
            xorg.libXfixes
            xorg.libXcomposite
            xorg.libxkbfile
            xorg.libxkbfile.dev
            xorg.libxcb
            # Additional GUI libraries
            freetype
            fontconfig
            glib
            gtk3
            cairo
            pango
            gdk-pixbuf
            atk
            # JCEF dependencies
            nspr
            nss
            cups
            dbus
            at-spi2-atk
            at-spi2-core
            libdrm
            mesa
            expat
            alsa-lib
            pulseaudio
            # Github
            act
            # Microphone support
            ffmpeg_7-full
          ];

          # Set library path for dynamic linking
          shellHook = ''
            export DEVENV="nix"
            export JAVA_HOME="${pkgs.jetbrains.jdk}"
            export PATH="$JAVA_HOME/bin:$PATH"
            export LD_LIBRARY_PATH="${
              pkgs.lib.makeLibraryPath [
                pkgs.xorg.libX11
                pkgs.xorg.libXext
                pkgs.xorg.libXi
                pkgs.xorg.libXrender
                pkgs.xorg.libXtst
                pkgs.xorg.libXrandr
                pkgs.xorg.libXinerama
                pkgs.xorg.libXcursor
                pkgs.xorg.libXdamage
                pkgs.xorg.libXfixes
                pkgs.xorg.libXcomposite
                pkgs.xorg.libxkbfile
                pkgs.xorg.libxcb
                pkgs.freetype
                pkgs.fontconfig
                pkgs.glib
                pkgs.gtk3
                pkgs.cairo
                pkgs.pango
                pkgs.gdk-pixbuf
                pkgs.atk
                pkgs.libsecret
                pkgs.jetbrains.jdk
                # JCEF-specific libraries
                pkgs.nspr
                pkgs.nss
                pkgs.cups
                pkgs.dbus
                pkgs.at-spi2-atk
                pkgs.at-spi2-core
                pkgs.libdrm
                pkgs.mesa
                pkgs.expat
                pkgs.alsa-lib
                pkgs.pulseaudio
              ]
            }:$LD_LIBRARY_PATH"
          '';
        };
    in
    {
      devShells = forAllSystems (system: {
        default = mkDevShell system;
      });
    };
}
