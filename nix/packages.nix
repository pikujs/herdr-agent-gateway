{ pkgs, lib ? pkgs.lib }:

let
  # 1. Agent Spawn Remote (POSIX Client)
  agent-spawn-remote = pkgs.stdenv.mkDerivation {
    pname = "agent-spawn-remote";
    version = "0.1.0";
    src = ../skills/spawn_herdr_agent/scripts;

    nativeBuildInputs = [ pkgs.makeWrapper ];

    installPhase = ''
      mkdir -p $out/bin
      cp agent-spawn-remote $out/bin/agent-spawn-remote
      chmod +x $out/bin/agent-spawn-remote
      wrapProgram $out/bin/agent-spawn-remote \
        --prefix PATH : ${lib.makeBinPath [ pkgs.curl pkgs.jq pkgs.coreutils pkgs.openssl ]}
    '';

    meta = with lib; {
      description = "Portable POSIX bash client for Herdr Agent Gateway";
      mainProgram = "agent-spawn-remote";
    };
  };

  # 2. Herdr MCP Server
  herdr-mcp-server = pkgs.stdenv.mkDerivation {
    pname = "herdr-mcp-server";
    version = "0.1.0";
    src = ../packages/mcp-server;

    nativeBuildInputs = [ pkgs.makeWrapper ];

    installPhase = ''
      mkdir -p $out/lib/herdr-mcp-server $out/bin
      cp -r . $out/lib/herdr-mcp-server/
      makeWrapper ${pkgs.bun}/bin/bun $out/bin/herdr-mcp-server \
        --add-flags "run" \
        --add-flags "$out/lib/herdr-mcp-server/bundle.js" \
        --prefix PATH : ${lib.makeBinPath [ pkgs.curl pkgs.jq pkgs.coreutils ]}
    '';

    meta = with lib; {
      description = "Model Context Protocol (MCP) server for Herdr Agent Gateway";
      mainProgram = "herdr-mcp-server";
    };
  };

  # 3. Herdr Remote Gateway (In-Daemon HTTP Server & Herdr Plugin)
  herdr-remote-gateway = pkgs.stdenv.mkDerivation {
    pname = "herdr-remote-gateway";
    version = "0.1.0";
    src = ../.;

    nativeBuildInputs = [ pkgs.makeWrapper ];

    installPhase = ''
      mkdir -p $out/lib/herdr-remote-gateway $out/bin $out/share/herdr-agent-gateway

      # Copy plugin files
      cp -r plugins/herdr-remote-gateway/* $out/lib/herdr-remote-gateway/
      cp -r templates $out/lib/herdr-remote-gateway/
      cp -r schemas $out/share/herdr-agent-gateway/
      cp -r templates $out/share/herdr-agent-gateway/

      # Wrapper for server daemon
      makeWrapper ${pkgs.bun}/bin/bun $out/bin/herdr-remote-gateway \
        --add-flags "run" \
        --add-flags "$out/lib/herdr-remote-gateway/src/server.ts" \
        --prefix PATH : ${lib.makeBinPath [ pkgs.coreutils pkgs.bun ]}

      # Wrapper for CLI helper (setup, status, restart)
      makeWrapper ${pkgs.bun}/bin/bun $out/bin/herdr-remote-gateway-cli \
        --add-flags "run" \
        --add-flags "$out/lib/herdr-remote-gateway/src/cli.ts" \
        --prefix PATH : ${lib.makeBinPath [ pkgs.coreutils pkgs.systemd pkgs.bun ]}
    '';

    meta = with lib; {
      description = "Herdr in-daemon gateway plugin and HTTP listener";
      mainProgram = "herdr-remote-gateway";
    };
  };

  # 4. Default / Combined Package
  default = pkgs.symlinkJoin {
    name = "herdr-agent-gateway";
    paths = [
      herdr-remote-gateway
      agent-spawn-remote
      herdr-mcp-server
    ];
    postBuild = ''
      mkdir -p $out/share/herdr-agent-gateway/skills
      cp -r ${../skills/spawn_herdr_agent} $out/share/herdr-agent-gateway/skills/spawn_herdr_agent
    '';
    meta = with lib; {
      description = "Herdr Agent Gateway — complete suite (server, client, MCP server, skill)";
      mainProgram = "herdr-remote-gateway";
    };
  };

  # 5. Hermes Agent Plugin
  hermes-plugin = pkgs.stdenv.mkDerivation {
    pname = "herdr-agent-gateway";
    version = "0.1.0";
    src = ../.;

    installPhase = ''
      mkdir -p $out
      cp plugin.yaml $out/
      cp after-install.md $out/
      cp __init__.py $out/
      cp -r hermes_herdr $out/
      mkdir -p $out/skills
      cp -r skills/spawn_herdr_agent $out/skills/
    '';

    meta = with lib; {
      description = "Herdr Hermes Agent Plugin";
    };
  };

in {
  inherit herdr-remote-gateway agent-spawn-remote herdr-mcp-server hermes-plugin default;
}
