#!/usr/bin/env bash
# Install cloudflared as a macOS LaunchDaemon (host process, not Docker).
# Use this OR the compose --profile tunnel — not both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="${ROOT}/deploy/cloudflared/config.yml"
LABEL="com.wetestcase.cloudflared"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing ${CONFIG} — copy config.example.yml and fill tunnel UUID + hostname." >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install with: brew install cloudflared" >&2
  exit 1
fi

CLOUDFLARED="$(command -v cloudflared)"

# Host-side tunnel must hit localhost (app port is published on 127.0.0.1:3000).
if grep -q 'service: http://app:3000' "$CONFIG"; then
  echo "Note: config.yml still points at http://app:3000 (Docker network)."
  echo "      For LaunchDaemon, change ingress service to http://127.0.0.1:3000"
  echo "      and set credentials-file to an absolute path under ${ROOT}/deploy/cloudflared/"
  read -r -p "Continue anyway? [y/N] " ans
  [[ "${ans:-}" =~ ^[Yy]$ ]] || exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-running with sudo to install ${PLIST}"
  exec sudo "$0" "$@"
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${CLOUDFLARED}</string>
      <string>tunnel</string>
      <string>--config</string>
      <string>${CONFIG}</string>
      <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/wetestcase-cloudflared.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/wetestcase-cloudflared.err</string>
  </dict>
</plist>
EOF

chmod 644 "$PLIST"
launchctl bootout system/"$LABEL" 2>/dev/null || true
launchctl bootstrap system "$PLIST"
launchctl enable system/"$LABEL"
launchctl kickstart -k system/"$LABEL"

echo "Installed and started ${LABEL}"
echo "  config: ${CONFIG}"
echo "  logs:   /var/log/wetestcase-cloudflared.log"
echo "  stop:   sudo launchctl bootout system/${LABEL}"
