{ self }:

{ config, pkgs, lib, ... }:

with lib;

let
  cfg = config.services.herdr-agent-gateway;

in
{
  options.services.herdr-agent-gateway = {
    enable = mkEnableOption "Herdr Agent Gateway unified CLI and universal agent skill";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.herdr-agent-gateway;
      description = "Package providing the herdr-agent-gateway executable and skill assets.";
    };

    skill = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Whether to provision the universal agent skill into ~/.agents/skills/herdr-agent-gateway.";
      };
    };

    # Backwards-compatibility options (retained as no-ops so existing NixOS modules evaluate cleanly)
    client = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Deprecated / no-op. CLI is included in default package.";
      };
      package = mkOption {
        type = types.nullOr types.package;
        default = null;
        description = "Deprecated / no-op.";
      };
    };

    overviewPlugin = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Deprecated / no-op. Overview is built into the herdr-agent-gateway CLI.";
      };
      package = mkOption {
        type = types.nullOr types.package;
        default = null;
        description = "Deprecated / no-op.";
      };
    };

    mcpServer = {
      enable = mkOption {
        type = types.bool;
        default = false;
        description = "Deprecated / no-op.";
      };
      package = mkOption {
        type = types.nullOr types.package;
        default = null;
        description = "Deprecated / no-op.";
      };
    };

    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = "Deprecated / no-op.";
    };

    port = mkOption {
      type = types.port;
      default = 9480;
      description = "Deprecated / no-op.";
    };

    token = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "Deprecated / no-op.";
    };

    tokenFile = mkOption {
      type = types.nullOr (types.either types.path types.str);
      default = null;
      description = "Deprecated / no-op.";
    };

    defaultWorkspace = mkOption {
      type = types.str;
      default = "spawned-agents";
      description = "Deprecated / no-op.";
    };

    defaultNode = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "Deprecated / no-op.";
    };

    fallbackOrder = mkOption {
      type = types.listOf types.str;
      default = [];
      description = "Deprecated / no-op.";
    };

    nodes = mkOption {
      type = types.attrsOf types.attrs;
      default = {};
      description = "Deprecated / no-op.";
    };

    machines = mkOption {
      type = types.listOf types.attrs;
      default = [];
      description = "Deprecated / no-op. Configure machines directly in your Herdr dotfiles module.";
    };

    ssh = mkOption {
      type = types.attrs;
      default = {};
      description = "Deprecated / no-op. Configure SSH keys in your SSH / host module.";
    };

    yoloArgs = mkOption {
      type = types.attrsOf (types.listOf types.str);
      default = {};
      description = "Deprecated / no-op.";
    };

    maxPanes = mkOption {
      type = types.int;
      default = 8;
      description = "Deprecated / no-op.";
    };

    herdrBinPath = mkOption {
      type = types.str;
      default = "herdr";
      description = "Deprecated / no-op.";
    };

    herdrSocketPath = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "Deprecated / no-op.";
    };

    extraEnvironment = mkOption {
      type = types.attrsOf types.str;
      default = {};
      description = "Deprecated / no-op.";
    };
  };

  config = mkIf cfg.enable {
    home.packages = [ cfg.package ];

    # Link universal skill to ~/.agents/skills/herdr-agent-gateway
    home.file = mkIf cfg.skill.enable {
      ".agents/skills/herdr-agent-gateway".source = "${cfg.package}/share/agents/skills/herdr-agent-gateway";
    };
  };
}
