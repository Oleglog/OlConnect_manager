#!/usr/bin/env bash
# Quick standalone updater for OpenFlux exit node and olcrtc-launcher
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Oleglog/OlConnect_manager/master/server-install/update-openflux.sh | sudo bash

set -euo pipefail

echo "=== OpenFlux Exit-Node Quick Updater ==="

if [ "$(id -u)" -ne 0 ]; then
    echo "[!] Must run as root (try: sudo bash $0)" >&2
    exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|amd64) OPENFLUX_ARCH="amd64" ;;
    aarch64|arm64) OPENFLUX_ARCH="arm64" ;;
    *) echo "[!] Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
echo "[*] Architecture: $OPENFLUX_ARCH"

echo "[*] Fetching latest OpenFlux release info from GitHub..."
EFFECTIVE_URL="$(curl -fsSLI -H "User-Agent: olcrtc-updater" -o /dev/null -w '%{url_effective}' --max-time 10 "https://github.com/Oleglog/OpenFlux-Android/releases/latest" 2>/dev/null || true)"
LATEST_TAG="${EFFECTIVE_URL##*/tag/}"
if [ -z "$LATEST_TAG" ] || [ "$LATEST_TAG" = "$EFFECTIVE_URL" ]; then
    LATEST_TAG="latest"
fi
echo "[*] Target OpenFlux version: $LATEST_TAG"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

DL_URL="https://github.com/Oleglog/OpenFlux-Android/releases/latest/download/openflux-linux-${OPENFLUX_ARCH}"
if [ "$LATEST_TAG" != "latest" ]; then
    DL_URL="https://github.com/Oleglog/OpenFlux-Android/releases/download/${LATEST_TAG}/openflux-linux-${OPENFLUX_ARCH}"
fi

echo "[*] Downloading OpenFlux binary: $DL_URL..."
if ! curl -fsSL --retry 2 --retry-delay 2 --max-time 180 "$DL_URL" -o "$TMPDIR/openflux"; then
    echo "[!] Failed to download OpenFlux binary" >&2
    exit 1
fi

# ELF header check
if [ "$(head -c 4 "$TMPDIR/openflux" | od -An -tx1 | tr -d ' \n')" != "7f454c46" ]; then
    echo "[!] Downloaded file is not an ELF binary" >&2
    exit 1
fi

echo "[*] Installing binary to /usr/local/bin/openflux..."
install -m 0755 "$TMPDIR/openflux" /usr/local/bin/openflux
mkdir -p /etc/olcrtc
if [ "$LATEST_TAG" != "latest" ]; then
    echo "$LATEST_TAG" > /etc/olcrtc/openflux.version
fi

echo "[*] Updating olcrtc-launcher from master..."
curl -fsSL --retry 2 --max-time 30 "https://raw.githubusercontent.com/Oleglog/OlConnect_manager/master/server-install/systemd/olcrtc-launcher" -o /usr/local/bin/olcrtc-launcher && chmod +x /usr/local/bin/olcrtc-launcher || echo "[!] Failed to update launcher, keeping existing"

echo "[*] Ensuring systemd permissions (root + network capabilities)..."
sed -i 's/User=olcrtc/User=root/' /etc/systemd/system/olcrtc-server.service /etc/systemd/system/olcrtc-server@.service 2>/dev/null || true
sed -i 's/Group=olcrtc/Group=root/' /etc/systemd/system/olcrtc-server.service /etc/systemd/system/olcrtc-server@.service 2>/dev/null || true
sed -i '/ProtectSystem=strict/d' /etc/systemd/system/olcrtc-server.service /etc/systemd/system/olcrtc-server@.service 2>/dev/null || true
sed -i '/NoNewPrivileges=true/d' /etc/systemd/system/olcrtc-server.service /etc/systemd/system/olcrtc-server@.service 2>/dev/null || true
sed -i '/RestrictAddressFamilies/d' /etc/systemd/system/olcrtc-server.service /etc/systemd/system/olcrtc-server@.service 2>/dev/null || true
echo "[*] Ensuring IP forwarding and system capabilities..."
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
grep -q AmbientCapabilities /etc/systemd/system/olcrtc-server.service 2>/dev/null || sed -i '/\[Service\]/a AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW\nCapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW' /etc/systemd/system/olcrtc-server.service 2>/dev/null || true
grep -q AmbientCapabilities /etc/systemd/system/olcrtc-server@.service 2>/dev/null || sed -i '/\[Service\]/a AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW\nCapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW' /etc/systemd/system/olcrtc-server@.service 2>/dev/null || true
systemctl daemon-reload 2>/dev/null || true

# Clear update check throttle so launcher picks it up fresh
rm -f /tmp/.openflux_update_check

echo "[*] Restarting services..."
systemctl restart olcrtc-server.service 2>/dev/null || true
for svc in $(systemctl list-units --type=service --all "olcrtc-server@*" --no-legend 2>/dev/null | awk '{print $1}'); do
    if [ -n "$svc" ]; then
        echo "    Restarting $svc..."
        systemctl restart "$svc" 2>/dev/null || true
    fi
done

echo ""
echo "=== [✓] OpenFlux ($LATEST_TAG) успешно обновлен и запущен! ==="
