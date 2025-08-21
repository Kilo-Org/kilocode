{
  description = "Kilo Code development environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.05";
  };

  outputs = { self, nixpkgs, ... }: let
    systems = [ "aarch64-darwin" "x86_64-linux" ];

    forAllSystems = nixpkgs.lib.genAttrs systems;

    mkDevShell = system: let
      pkgs = import nixpkgs { inherit system; };
    in pkgs.mkShell {
      name = "kilo-code";

      packages = with pkgs; [
        nodejs_20
        corepack_20
        libnotify
        jetbrains.idea-community
        jetbrains.jdk-no-jcef-17
        gradle
        # Libraries
        libsecret
        # X11 libraries for JetBrains IDEs
        xorg.libX11
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
        # Additional GUI libraries
        freetype
        fontconfig
        glib
        gtk3
        cairo
        pango
        gdk-pixbuf
        atk
      ];

      # Set library path for dynamic linking
      shellHook = ''
        export JAVA_HOME="${pkgs.jetbrains.jdk-no-jcef-17}"
        export PATH="$JAVA_HOME/bin:$PATH"
        export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [
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
          pkgs.freetype
          pkgs.fontconfig
          pkgs.glib
          pkgs.gtk3
          pkgs.cairo
          pkgs.pango
          pkgs.gdk-pixbuf
          pkgs.atk
          pkgs.libsecret
          pkgs.jetbrains.jdk-no-jcef-17
        ]}:$LD_LIBRARY_PATH"
      '';
    };
  in {
    devShells = forAllSystems (system: {
      default = mkDevShell system;
    });
  };
}
