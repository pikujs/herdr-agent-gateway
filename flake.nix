{
  description = "Herdr Agent Gateway — Multi-machine agent overview, dispatch skill, and Hermes plugin for Herdr";

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
            drv = herdrPackages.herdr-agents-overview;
            name = "herdr-agents-overview";
          };
          overview = flake-utils.lib.mkApp {
            drv = herdrPackages.herdr-agents-overview;
            name = "herdr-agents-overview";
          };
          client = flake-utils.lib.mkApp {
            drv = herdrPackages.agent-spawn-remote;
            name = "agent-spawn-remote";
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
        herdr-agents-overview = (import ./nix/packages.nix { pkgs = final; lib = final.lib; }).herdr-agents-overview;
        herdr-agent-spawn-remote = (import ./nix/packages.nix { pkgs = final; lib = final.lib; }).agent-spawn-remote;
        herdr-hermes-plugin = (import ./nix/packages.nix { pkgs = final; lib = final.lib; }).hermes-plugin;
      };

      # Home Manager Modules
      homeManagerModules.default = import ./nix/home-manager-module.nix { inherit self; };
      homeManagerModules.herdr-agent-gateway = self.homeManagerModules.default;
    };
}
