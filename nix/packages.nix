{ pkgs, lib ? pkgs.lib }:

let
  # 1. Agent Spawn Remote (POSIX Client)
  agent-spawn-remote = pkgs.stdenv.mkDerivation {
    pname = "agent-spawn-remote";
    version = "0.2.0";
    src = ../.;

    nativeBuildInputs = [ pkgs.makeWrapper ];

    installPhase = ''
      mkdir -p $out/bin $out/share/herdr-agent-gateway/bin
      cp scripts/agent-spawn-remote $out/bin/agent-spawn-remote
      chmod +x $out/bin/agent-spawn-remote
      cp bin/agents-overview.py $out/share/herdr-agent-gateway/bin/agents-overview.py
      chmod +x $out/share/herdr-agent-gateway/bin/agents-overview.py

      wrapProgram $out/bin/agent-spawn-remote \
        --prefix PATH : ${lib.makeBinPath [ pkgs.bash pkgs.python3 pkgs.jq pkgs.coreutils ]}
    '';

    meta = with lib; {
      description = "Portable POSIX bash client for Herdr multi-machine agent coordination";
      mainProgram = "agent-spawn-remote";
    };
  };

  # 2. Herdr Agents Overview CLI and Herdr Plugin
  herdr-agents-overview = pkgs.stdenv.mkDerivation {
    pname = "herdr-agents-overview";
    version = "0.2.0";
    src = ../.;

    nativeBuildInputs = [ pkgs.makeWrapper ];

    installPhase = ''
      mkdir -p $out/bin $out/share/herdr/plugins/agents-overview
      cp bin/agents-overview.py $out/bin/herdr-agents-overview
      chmod +x $out/bin/herdr-agents-overview

      wrapProgram $out/bin/herdr-agents-overview \
        --prefix PATH : ${lib.makeBinPath [ pkgs.python3 pkgs.coreutils ]}

      # Install plugin files for Herdr
      cp herdr-plugin.toml $out/share/herdr/plugins/agents-overview/
      mkdir -p $out/share/herdr/plugins/agents-overview/bin
      cp bin/agents-overview.py $out/share/herdr/plugins/agents-overview/bin/
    '';

    meta = with lib; {
      description = "Cluster-wide active agents overview for Herdr";
      mainProgram = "herdr-agents-overview";
    };
  };

  # 3. Hermes Agent Plugin
  hermes-plugin = pkgs.stdenv.mkDerivation {
    pname = "herdr-agent-gateway";
    version = "0.2.0";
    src = ../.;

    installPhase = ''
      mkdir -p $out
      cp plugin.yaml $out/
      cp after-install.md $out/
      cp __init__.py $out/
      cp -r hermes_herdr $out/
      mkdir -p $out/bin
      cp bin/agents-overview.py $out/bin/
      mkdir -p $out/skills
      cp -r skills/spawn_herdr_agent $out/skills/
    '';

    meta = with lib; {
      description = "Herdr Hermes Agent Plugin";
    };
  };

  # 4. Combined Default Package
  default = pkgs.symlinkJoin {
    name = "herdr-agent-gateway";
    paths = [
      agent-spawn-remote
      herdr-agents-overview
    ];
    postBuild = ''
      mkdir -p $out/share/herdr-agent-gateway/skills
      cp -r ${../skills/spawn_herdr_agent} $out/share/herdr-agent-gateway/skills/spawn_herdr_agent
    '';
    meta = with lib; {
      description = "Herdr Agent Gateway — multi-machine agent coordination and overview suite";
      mainProgram = "herdr-agents-overview";
    };
  };

in {
  inherit agent-spawn-remote herdr-agents-overview hermes-plugin default;
  # Compatibility alias
  herdr-remote-gateway = herdr-agents-overview;
}
