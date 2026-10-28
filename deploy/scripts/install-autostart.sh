#!/usr/bin/env bash
# One-time: install autostart.sh as a user LaunchAgent on the Mac mini.
# Runs at login and every 5 minutes, as the Docker Desktop user (not root).
# Remove with: ./deploy/scripts/install-autostart.sh --uninstall
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/deploy/scripts/autostart.sh"
LABEL="com.wetestcase.autostart"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG="${HOME}/Library/Logs/wetestcase-autostart.log"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this as the user who runs Docker Desktop, not with sudo." >&2
  exit 1
fi

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$PLIST"
  echo "Removed ${LABEL}"
  exit 0
fi

chmod +x "$SCRIPT"
mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>${SCRIPT}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>StandardOutPath</key>
    <string>${LOG}</string>
    <key>StandardErrorPath</key>
    <string>${LOG}</string>
  </dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed ${LABEL}: runs at login and every 5 minutes."
echo "Log: ${LOG}"
