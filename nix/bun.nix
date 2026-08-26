{
  lib,
  stdenv,
  fetchurl,
  unzip,
  autoPatchelfHook,
}:
let
  package = lib.pipe ../package.json [
    builtins.readFile
    builtins.fromJSON
  ];
  version = lib.removePrefix "bun@" package.packageManager;
  sources = {
    "aarch64-linux" = {
      name = "bun-linux-aarch64";
      hash = "sha256-on/7Y6gxA3WDbg1vZorhf6jY0YuIw3yCHGUzGXOhmjs=";
    };
    "x86_64-linux" = {
      name = "bun-linux-x64";
      hash = "sha256-lR7iruhV8IWVruxiJSJqKY0/6oOj3NZGXAnLzN9+hI8=";
    };
    "aarch64-darwin" = {
      name = "bun-darwin-aarch64";
      hash = "sha256-2LliIYKK1vl6x6wKt+lYcjQa92MAHogD6CZ2UsJlJiA=";
    };
    "x86_64-darwin" = {
      name = "bun-darwin-x64";
      hash = "sha256-QYPfM3RiPlurMVxUfPoJdFM81FfYa3O2OfeoeXTNZjM=";
    };
  };
  source =
    sources.${stdenv.hostPlatform.system}
      or (throw "Unsupported system for bun: ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation {
  pname = "bun";
  inherit version;
  src = fetchurl {
    url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/${source.name}.zip";
    inherit (source) hash;
  };
  nativeBuildInputs = [ unzip ] ++ lib.optional stdenv.isLinux autoPatchelfHook;
  buildInputs = lib.optionals stdenv.isLinux [ stdenv.cc.cc.lib ];
  dontConfigure = true;
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    install -Dm755 bun $out/bin/bun
    ln -s $out/bin/bun $out/bin/bunx
    runHook postInstall
  '';
  meta = {
    description = "Fast all-in-one JavaScript runtime";
    homepage = "https://bun.sh";
    license = lib.licenses.mit;
    mainProgram = "bun";
    platforms = builtins.attrNames sources;
  };
}
