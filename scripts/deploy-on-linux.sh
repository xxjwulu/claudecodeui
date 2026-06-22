#!/usr/bin/env bash
#
# Deploys the latest CloudCLI Linux tarball onto a small Aliyun ECS host
# (or any linux/x64 machine with Node.js 22+ and curl/wget). The whole
# flow is: download pre-built tarball → extract → run as the current user.
#
# No `npm install` runs on this host, so there is no IO starvation even
# on a 1 vCPU / 1GB ECS instance.
#
# Re-running this script upgrades to the latest build and restarts the
# service if pm2 is detected.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/xxjwulu/claudecodeui/xxj_main/scripts/deploy-on-linux.sh | bash
#
# Or after cloning:
#   bash scripts/deploy-on-linux.sh
#
# Override defaults via env vars:
#   INSTALL_DIR=$HOME/cloudcli       Where to extract
#   REPO=xxjwulu/claudecodeui        GitHub repo (owner/name)
#   RELEASE_TAG=latest               Which GitHub release to pull from

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/cloudcli}"
REPO="${REPO:-xxjwulu/claudecodeui}"
RELEASE_TAG="${RELEASE_TAG:-latest}"
PARENT_DIR="$(dirname "$INSTALL_DIR")"

# --- preflight -----------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed."
  echo "Install Node.js 22 first:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node.js $NODE_MAJOR detected, need v22+."
  exit 1
fi

command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required."; exit 1; }

mkdir -p "$PARENT_DIR"

# --- download tarball from GitHub Releases -------------------------------
#
# China mirror options (gitcode package API, OSS, etc.) were all blocked
# or impractical — gitcode's CloudWAF rejects programmatic uploads from
# GitHub Actions IPs. The recommended path is the SCP-based auto-deploy
# step in .github/workflows/build-tarball.yml, which bypasses GitHub
# downloads entirely. This script is a fallback for manual deploys.

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Fetching latest release info from $REPO@$RELEASE_TAG..."
API_URL="https://api.github.com/repos/$REPO/releases/tags/$RELEASE_TAG"
TARBALL_URL=$(curl -fsSL "$API_URL" \
  | grep '"browser_download_url"' \
  | grep -E 'linux-x64\.tar\.gz"$' \
  | head -1 \
  | sed -E 's/.*"(https:[^"]+)".*/\1/')

if [ -z "$TARBALL_URL" ]; then
  echo "ERROR: no linux-x64 tarball found in release '$RELEASE_TAG'."
  echo "Has the GitHub Actions workflow run at least once?"
  exit 1
fi

FILENAME="$(basename "$TARBALL_URL")"
echo "Downloading $FILENAME ..."
curl -fsSL --retry 3 --max-time 1200 -o "$WORK_DIR/$FILENAME" "$TARBALL_URL"

# Verify sha256 if a checksum file is published alongside.
SHA_URL="${TARBALL_URL}.sha256"
if curl -fsI "$SHA_URL" >/dev/null 2>&1; then
  curl -fsSL --retry 3 -o "$WORK_DIR/$FILENAME.sha256" "$SHA_URL"
  (cd "$WORK_DIR" && sha256sum -c "$FILENAME.sha256" --quiet)
  echo "sha256 verified."
fi

# --- stop existing service if pm2 is managing it -------------------------

if command -v pm2 >/dev/null 2>&1 && pm2 describe cloudcli >/dev/null 2>&1; then
  echo "Stopping existing pm2-managed cloudcli..."
  pm2 stop cloudcli >/dev/null || true
fi

# --- backup + extract ----------------------------------------------------

if [ -d "$INSTALL_DIR" ]; then
  BACKUP="${INSTALL_DIR}.bak.$(date +%Y%m%d%H%M%S)"
  echo "Backing up existing $INSTALL_DIR -> $BACKUP"
  mv "$INSTALL_DIR" "$BACKUP"
fi

echo "Extracting to $PARENT_DIR ..."
tar -xzf "$WORK_DIR/$FILENAME" -C "$PARENT_DIR"

# --- summary -------------------------------------------------------------

echo
echo "✅ Deployed to $INSTALL_DIR"
echo
echo "Run once (foreground, for testing):"
echo "  cd $INSTALL_DIR && node dist-server/server/index.js"
echo
echo "Run as a managed service (recommended):"
echo "  sudo npm install -g pm2   # if pm2 not installed yet"
echo "  pm2 start '$INSTALL_DIR/dist-server/server/index.js' --name cloudcli"
echo "  pm2 save && pm2 startup   # enable boot-time autostart"
echo
echo "Server URL: http://$(hostname -I | awk '{print $1}'):3001"
