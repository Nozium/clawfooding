{
  description = "ClawFooding - AI cognitive pattern testing CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems =
        f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: {
        default = pkgs.buildNpmPackage {
          pname = "clawfooding";
          version = "0.1.0";
          src = ./.;
          npmDepsHash = "";
          npmPackFlags = [ "--ignore-scripts" ];
          buildPhase = ''
            pnpm run build
          '';
          installPhase = ''
            mkdir -p $out/bin
            cp -r apps/clawfooding/dist/* $out/
            chmod +x $out/index.js
            ln -s $out/index.js $out/bin/clawfooding
          '';
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShellNoCC {
          buildInputs = with pkgs; [
            pnpm_10
            bun
            jq
            git
            gh
          ];

          shellHook = ''
            if [ ! -f node_modules/.pnpm/lock.yaml ] || [ pnpm-lock.yaml -nt node_modules/.pnpm/lock.yaml ]; then
              pnpm install --frozen-lockfile 2>/dev/null || pnpm install
            fi
          '';
        };
      });
    };
}
