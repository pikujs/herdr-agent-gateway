{ pkgs, lib ? pkgs.lib }:

let
  # Primary Unified CLI and Skill Package
  herdr-agent-gateway = pkgs.stdenv.mkDerivation {
    pname = "herdr-agent-gateway";
    version = "0.3.0";
    src = ../.;

    nativeBuildInputs = [ pkgs.makeWrapper ];

    installPhase = ''
      mkdir -p $out/bin $out/share/agents/skills/herdr-agent-gateway

      # Install unified CLI executable
      cp bin/herdr-agent-gateway $out/bin/herdr-agent-gateway
      chmod +x $out/bin/herdr-agent-gateway

      # Wrap with python3 runtime
      wrapProgram $out/bin/herdr-agent-gateway \
        --prefix PATH : ${lib.makeBinPath [ pkgs.python3 pkgs.coreutils ]}

      # Install universal skill
      cp -r skills/herdr-agent-gateway/* $out/share/agents/skills/herdr-agent-gateway/

      # Backwards-compatibility symlinks
      ln -s $out/bin/herdr-agent-gateway $out/bin/herdr-agents-overview
      ln -s $out/bin/herdr-agent-gateway $out/bin/agent-spawn-remote
    '';

    meta = with lib; {
      description = "Unified CLI and universal skill for Herdr multi-machine agent coordination";
      mainProgram = "herdr-agent-gateway";
    };
  };

in {
  default = herdr-agent-gateway;
  inherit herdr-agent-gateway;

  # Backwards-compatibility package aliases
  herdr-agents-overview = herdr-agent-gateway;
  agent-spawn-remote = herdr-agent-gateway;
  herdr-remote-gateway = herdr-agent-gateway;
  hermes-plugin = herdr-agent-gateway;
}
