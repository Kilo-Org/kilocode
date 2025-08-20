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
        jetbrains.jdk-no-jcef
        gradle
      ];
    };
  in {
    devShells = forAllSystems (system: {
      default = mkDevShell system;
    });
  };
}
