import { Component } from "solid-js";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface SettingsProps {
  port: number | null;
  connectionState: ConnectionState;
}

const Settings: Component<SettingsProps> = (props) => {
  const getStatusColor = () => {
    switch (props.connectionState) {
      case "connected":
        return "var(--vscode-testing-iconPassed, #89d185)";
      case "connecting":
        return "var(--vscode-testing-iconQueued, #cca700)";
      case "disconnected":
        return "var(--vscode-testing-iconFailed, #f14c4c)";
    }
  };

  const getStatusText = () => {
    switch (props.connectionState) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting...";
      case "disconnected":
        return "Disconnected";
    }
  };

  return (
    <div style={{
      padding: "16px",
      color: "var(--vscode-foreground)",
      "font-family": "var(--vscode-font-family)",
    }}>
      <h2 style={{
        "font-size": "16px",
        "font-weight": "600",
        "margin-bottom": "20px",
        color: "var(--vscode-foreground)",
      }}>
        Settings
      </h2>

      <div style={{
        background: "var(--vscode-editor-background)",
        border: "1px solid var(--vscode-panel-border)",
        "border-radius": "4px",
        padding: "16px",
      }}>
        <h3 style={{
          "font-size": "13px",
          "font-weight": "600",
          "margin-bottom": "12px",
          color: "var(--vscode-foreground)",
        }}>
          CLI Server
        </h3>

        {/* Connection Status */}
        <div style={{
          display: "flex",
          "align-items": "center",
          "margin-bottom": "12px",
        }}>
          <span style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            width: "100px",
          }}>
            Status:
          </span>
          <div style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
          }}>
            <span style={{
              width: "8px",
              height: "8px",
              "border-radius": "50%",
              background: getStatusColor(),
              display: "inline-block",
            }} />
            <span style={{
              "font-size": "12px",
              color: "var(--vscode-foreground)",
            }}>
              {getStatusText()}
            </span>
          </div>
        </div>

        {/* Port Number */}
        <div style={{
          display: "flex",
          "align-items": "center",
        }}>
          <span style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            width: "100px",
          }}>
            Port:
          </span>
          <span style={{
            "font-size": "12px",
            color: "var(--vscode-foreground)",
            "font-family": "var(--vscode-editor-font-family, monospace)",
          }}>
            {props.port !== null ? props.port : "—"}
          </span>
        </div>
      </div>
    </div>
  );
};

export default Settings;
