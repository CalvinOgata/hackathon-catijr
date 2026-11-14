#!/usr/bin/env bash
# Installs Arremate as a systemd service running from this checkout (RNF01): it starts on boot,
# restarts if it ever stops, and serves the web app and the API on one port.
# Run `make build` first (or use `make service`, which does both).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUN_AS=${SUDO_USER:-$(id -un)}
NODE=$(command -v node || true)

if [ -z "$NODE" ]; then echo "Error: Node.js not found in PATH." >&2; exit 1; fi
if [ ! -f "$ROOT/server/dist/index.js" ] || [ ! -f "$ROOT/client/build/index.html" ]; then
  echo "Error: build not found. Run 'make build' first." >&2; exit 1
fi

sudo tee /etc/systemd/system/arremate.service >/dev/null <<UNIT
[Unit]
Description=Arremate - leilões em tempo real
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_AS
WorkingDirectory=$ROOT/server
Environment=NODE_ENV=production
# Port, data folder and limits come from $ROOT/server/.env
ExecStart=$NODE dist/index.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable arremate >/dev/null
sudo systemctl restart arremate
echo "Arremate is running as the 'arremate' service (user $RUN_AS, from $ROOT)."
echo "  Status: systemctl status arremate"
echo "  Logs:   journalctl -u arremate -f"
