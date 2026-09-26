{
  description = "Herdr Agent Gateway — Multi-machine fleet CLI and universal agent skill for Herdr";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        herdrPackages = import ./nix/packages.nix { inherit pkgs; lib = pkgs.lib; };
      in
      {
        packages = herdrPackages;

        apps = {
          default = flake-utils.lib.mkApp {
            drv = herdrPackages.herdr-agent-gateway;
            name = "herdr-agent-gateway";
          };
          overview = flake-utils.lib.mkApp {
            drv = herdrPackages.herdr-agent-gateway;
            name = "herdr-agent-gateway";
          };
          client = flake-utils.lib.mkApp {
            drv = herdrPackages.herdr-agent-gateway;
            name = "herdr-agent-gateway";
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            python3
            jq
            curl
            git
          ];
        };
      }
    ) // {
      # Overlays
      overlays.default = final: prev: {
        herdr-agent-gateway = (import ./nix/packages.nix { pkgs = final; lib = final.lib; }).default;
      };

      # Home Manager Modules
      homeManagerModules.default = import ./nix/home-manager-module.nix { inherit self; };
      homeManagerModules.herdr-agent-gateway = self.homeManagerModules.default;
    };
}
