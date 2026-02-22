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
      packages = forAllSystems (pkgs:
        let
          nodejs = pkgs.nodejs_22;
          pnpm = pkgs.pnpm_10;
        in
        {
          default = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "clawfooding";
            version = "0.1.0";
            src = ./.;

            nativeBuildInputs = [
              nodejs
              pnpm
              pkgs.pnpmConfigHook
              pkgs.makeWrapper
            ];

            buildInputs = [
              pkgs.playwright-driver.browsers
            ];

            # TODO: Run `nix build` once — it will fail and print the correct hash.
            #       Replace this placeholder with that sha256-... value.
            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              hash = "sha256-Loim/LoCvthhiNT0Q9hqgCB4wuqwXAuxVKKkfOhYsso=";
              fetcherVersion = 2;
            };

            buildPhase = ''
              runHook preBuild
              pnpm --filter clawfooding run build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              # Copy the self-contained bundle (index.mjs + split chunks)
              mkdir -p $out/lib/clawfooding
              cp apps/clawfooding/dist/*.mjs $out/lib/clawfooding/

              # Copy persona and example data
              cp -r personas $out/lib/clawfooding/personas
              cp -r examples $out/lib/clawfooding/examples

              # Copy playwright node module for dynamic import
              mkdir -p $out/lib/clawfooding/node_modules
              if [ -d "node_modules/playwright" ]; then
                cp -r node_modules/playwright $out/lib/clawfooding/node_modules/
              fi

              # Create wrapper that ensures node is on PATH and sets Playwright browser path
              mkdir -p $out/bin
              makeWrapper ${nodejs}/bin/node $out/bin/clawfooding \
                --add-flags "$out/lib/clawfooding/index.mjs" \
                --set PLAYWRIGHT_BROWSERS_PATH "${pkgs.playwright-driver.browsers}" \
                --set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD "1" \
                --set NODE_PATH "$out/lib/clawfooding/node_modules"

              runHook postInstall
            '';

            meta = {
              description = "AI cognitive pattern testing CLI";
              mainProgram = "clawfooding";
            };
          });
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
