{ self }:

{ config, pkgs, lib, ... }:

with lib;

let
  cfg = config.services.herdr-agent-gateway;

in
{
  options.services.herdr-agent-gateway = {
    enable = mkEnableOption "Herdr multi-machine agent overview plugin and CLI integration";

    overviewPlugin = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Whether to link the herdr-agents-overview plugin into ~/.config/herdr/plugins/agents-overview.";
      };
      package = mkOption {
        type = types.package;
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.herdr-agents-overview;
        description = "Package providing the Herdr Agents Overview CLI and plugin assets.";
      };
    };

    client = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Whether to install the agent-spawn-remote CLI client into home.packages.";
      };
      package = mkOption {
        type = types.package;
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.agent-spawn-remote;
        description = "Package to use for agent-spawn-remote CLI.";
      };
    };

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.herdr-agents-overview;
      description = "Package providing the Herdr Agents Overview plugin.";
    };

    # Backwards-compatibility options (retained as no-ops so existing NixOS modules evaluate cleanly)
    mcpServer = {
      enable = mkOption {
        type = types.bool;
        default = false;
        description = "Deprecated / no-op. Herdr multi-machine coordination uses native SSH forwarding.";
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
      description = "Deprecated / no-op. Node discovery is handled by Herdr's native SSH machine catalog.";
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
    home.packages =
      optional (cfg.overviewPlugin.enable) cfg.overviewPlugin.package
      ++ optional (cfg.client.enable) cfg.client.package;

    xdg.configFile = mkIf (cfg.overviewPlugin.enable) {
      "herdr/plugins/agents-overview".source = "${cfg.overviewPlugin.package}/share/herdr/plugins/agents-overview";
    };
  };
}
