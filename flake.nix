{
  description = "Herdr Agent Gateway — Authenticated remote dispatch plugin, client CLI, and MCP server for Herdr";

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
            drv = herdrPackages.herdr-remote-gateway;
            name = "herdr-remote-gateway";
          };
          server = flake-utils.lib.mkApp {
            drv = herdrPackages.herdr-remote-gateway;
            name = "herdr-remote-gateway";
          };
          client = flake-utils.lib.mkApp {
            drv = herdrPackages.agent-spawn-remote;
            name = "agent-spawn-remote";
          };
          mcp-server = flake-utils.lib.mkApp {
            drv = herdrPackages.herdr-mcp-server;
            name = "herdr-mcp-server";
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            nodejs
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
        herdr-remote-gateway = (import ./nix/packages.nix { pkgs = final; lib = final.lib; }).herdr-remote-gateway;
        herdr-agent-spawn-remote = (import ./nix/packages.nix { pkgs = final; lib = final.lib; }).agent-spawn-remote;
        herdr-mcp-server = (import ./nix/packages.nix { pkgs = final; lib = final.lib; }).herdr-mcp-server;
        herdr-hermes-plugin = (import ./nix/packages.nix { pkgs = final; lib = final.lib; }).hermes-plugin;
      };

      # Home Manager Modules
      homeManagerModules.default = import ./nix/home-manager-module.nix { inherit self; };
      homeManagerModules.herdr-agent-gateway = self.homeManagerModules.default;
    };
}
