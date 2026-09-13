{ self }:

{ config, pkgs, lib, ... }:

with lib;

let
  cfg = config.services.herdr-agent-gateway;

  hasNodesConfig = cfg.nodes != {} || cfg.defaultNode != null || cfg.fallbackOrder != [] || cfg.yoloArgs != {};

  defaultLocalNode = {
    local-workstation = {
      endpoint = "http://${cfg.host}:${toString cfg.port}";
      auth_token = if cfg.token != null then cfg.token else "env:HERDR_GATEWAY_TOKEN";
      default_workspace = cfg.defaultWorkspace;
      default_agent = "pi";
      priority = 10;
    };
  };

  nodesJson = {
    "$schema" = "https://raw.githubusercontent.com/pikujs/herdr-agent-gateway/main/schemas/herdr_nodes.schema.json";
  } // optionalAttrs (cfg.defaultNode != null) {
    default_node = cfg.defaultNode;
  } // optionalAttrs (cfg.fallbackOrder != []) {
    fallback_order = cfg.fallbackOrder;
  } // optionalAttrs (cfg.yoloArgs != {}) {
    yolo_args = cfg.yoloArgs;
  } // {
    nodes = if cfg.nodes != {} then cfg.nodes else defaultLocalNode;
  };

  # Environment list for systemd
  systemdEnv = [
    "HERDR_GATEWAY_HOST=${cfg.host}"
    "HERDR_GATEWAY_PORT=${toString cfg.port}"
    "HERDR_GATEWAY_DEFAULT_WORKSPACE=${cfg.defaultWorkspace}"
    "HERDR_GATEWAY_MAX_PANES=${toString cfg.maxPanes}"
    "HERDR_BIN_PATH=${cfg.herdrBinPath}"
  ]
  ++ optional (cfg.herdrSocketPath != null) "HERDR_SOCKET_PATH=${cfg.herdrSocketPath}"
  ++ optional (cfg.token != null) "HERDR_GATEWAY_TOKEN=${cfg.token}"
  ++ optional (cfg.tokenFile != null) "HERDR_GATEWAY_TOKEN_FILE=${toString cfg.tokenFile}"
  ++ mapAttrsToList (k: v: "${k}=${v}") cfg.extraEnvironment;

in
{
  options.services.herdr-agent-gateway = {
    enable = mkEnableOption "Herdr Agent Gateway HTTP daemon service";

    client = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Whether to install the agent-spawn-remote CLI client into home.packages for local/remote agent invocation.";
      };
      package = mkOption {
        type = types.package;
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.agent-spawn-remote;
        description = "Package to use for agent-spawn-remote CLI.";
      };
    };

    mcpServer = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Whether to install the herdr-mcp-server tool runner into home.packages for MCP clients (OpenCode, Claude, Codex).";
      };
      package = mkOption {
        type = types.package;
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.herdr-mcp-server;
        description = "Package to use for herdr-mcp-server.";
      };
    };

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.herdr-remote-gateway;
      description = "Package providing the Herdr Agent Gateway server daemon.";
    };

    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = "IP address or hostname to bind the HTTP gateway server to. Set to 0.0.0.0 or LAN IP if remote agent access is desired.";
    };

    port = mkOption {
      type = types.port;
      default = 9480;
      description = "TCP port for the HTTP gateway listener.";
    };

    tokenFile = mkOption {
      type = types.nullOr (types.either types.path types.str);
      default = null;
      description = "Path to file containing Bearer token secret. If null, server defaults to ~/.config/herdr/plugins/config/herdr-remote-gateway/gateway.token";
    };

    token = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "Direct Bearer token string (warning: written to Nix store; prefer tokenFile for secrecy).";
    };

    defaultWorkspace = mkOption {
      type = types.str;
      default = "spawned-agents";
      description = "Default Herdr workspace name to allocate tabs in if not specified by caller.";
    };

    maxPanes = mkOption {
      type = types.int;
      default = 16;
      description = "Maximum concurrent active terminal panes before returning 429 Too Many Requests.";
    };

    herdrSocketPath = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "Explicit path to Herdr Unix domain socket (default: ~/.config/herdr/herdr.sock).";
    };

    herdrBinPath = mkOption {
      type = types.str;
      default = "herdr";
      description = "Path or command name for the herdr executable used for CLI fallback.";
    };

    defaultNode = mkOption {
      type = types.nullOr types.str;
      default = "local-workstation";
      description = "Default node ID in herdr_nodes.json.";
    };

    fallbackOrder = mkOption {
      type = types.listOf types.str;
      default = [ "local-workstation" ];
      description = "Sequential fallback order of machine nodes when default_node is unavailable.";
    };

    yoloArgs = mkOption {
      type = types.attrsOf (types.listOf types.str);
      default = {
        pi = [ "--yolo" ];
        claude = [ "--dangerously-skip-permissions" ];
        opencode = [ "--yolo" ];
        codex = [ "--yolo" ];
        dsh = [ "--yolo" ];
        antigravity = [ "--yolo" ];
      };
      description = "CLI arguments automatically injected per agent kind when approval_mode is 'yolo' or 'off'.";
    };

    nodes = mkOption {
      type = types.attrsOf types.attrs;
      default = {};
      example = literalExpression ''
        {
          local-workstation = {
            endpoint = "http://127.0.0.1:9480";
            auth_token = "env:HERDR_GATEWAY_TOKEN";
            default_workspace = "spawned-agents";
            default_agent = "pi";
            priority = 10;
          };
        }
      '';
      description = "Declarative machine profiles mapped into herdr_nodes.json.";
    };

    extraEnvironment = mkOption {
      type = types.attrsOf types.str;
      default = {};
      description = "Additional environment variables to pass to the systemd user service.";
    };
  };

  config = mkMerge [
    # 1. Client package in home.packages
    (mkIf cfg.client.enable {
      home.packages = [ cfg.client.package ];
    })

    # 2. MCP Server package in home.packages
    (mkIf cfg.mcpServer.enable {
      home.packages = [ cfg.mcpServer.package ];
    })

    # 3. Gateway Daemon & Service
    (mkIf cfg.enable {
      home.packages = [ cfg.package ];

      # Declarative herdr_nodes.json in Herdr config dir
      xdg.configFile."herdr/plugins/config/herdr-remote-gateway/herdr_nodes.json" = mkIf hasNodesConfig {
        text = builtins.toJSON nodesJson;
      };

      systemd.user.services.herdr-agent-gateway = {
        Unit = {
          Description = "Herdr Agent Gateway HTTP Daemon";
          After = [ "network.target" ];
        };

        Service = {
          Type = "simple";
          ExecStart = "${cfg.package}/bin/herdr-remote-gateway";
          Restart = "on-failure";
          RestartSec = "3s";
          Environment = systemdEnv;
        };

        Install = {
          WantedBy = [ "default.target" ];
        };
      };
    })
  ];
}
