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
GITCODE_HOST="${GITCODE_HOST:-gitcode.com}"
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

# --- download tarball (China mirror first, GitHub fallback) ----------------
#
# gitcode.com hosts the tarball via GitLab's Generic Packages API, split
# into ~20MB chunks because gitcode's reverse proxy caps single-request
# body size (413 Request Entity Too Large on the full 260MB upload).
# The deploy script downloads the manifest, fetches each chunk, and
# concatenates them into the original tarball.
#
# For private repos, set GITCODE_TOKEN env var (a Personal Access Token
# with at least read_api scope) to authenticate.

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

PROJECT_ID=$(printf '%s' "$REPO" | sed 's,/,%2F,g')
GITCODE_API_BASE="https://${GITCODE_HOST}/api/v4/projects/${PROJECT_ID}"
PKG_URL="${GITCODE_API_BASE}/packages/generic/cloudcli/latest"

STABLE="cloudcli-linux-x64.tar.gz"
TARBALL_PATH="$WORK_DIR/$STABLE"
SHA_PATH="$TARBALL_PATH.sha256"

# gitcode auth header (only if token provided).
auth_args=()
if [ -n "$GITCODE_TOKEN" ]; then
  auth_args=(--header "PRIVATE-TOKEN: $GITCODE_TOKEN")
fi

download_url() {
  local url="$1" dest="$2"
  curl -fsSL --retry 3 --max-time 600 "${auth_args[@]}" -o "$dest" "$url"
}

# Try the chunked gitcode path first.
gitcode_chunked_download() {
  echo "Downloading manifest from gitcode ..."
  local manifest_url="$PKG_URL/$STABLE.manifest"
  local total
  total=$(download_url "$manifest_url" "$WORK_DIR/manifest" && cat "$WORK_DIR/manifest")
  if [ -z "$total" ]; then
    echo "  manifest fetch failed or empty."
    return 1
  fi
  echo "  manifest says $total chunks."

  # Pre-flight: probe one chunk to make sure they exist. If the very
  # first chunk 404s the gitcode sync hasn't completed; fall back to GitHub.
  if ! download_url "$PKG_URL/$STABLE.part000" "$WORK_DIR/$STABLE.part000" 2>/dev/null; then
    echo "  chunk 000 fetch failed; gitcode sync likely hasn't run."
    return 1
  fi

  # Download remaining chunks (001..total-1) — 000 is already on disk.
  # Use printf to zero-pad to 3 digits (matches `split -d -a 3` on the
  # build side). `seq -f %03d` would also work but isn't portable to
  # BusyBox seq.
  local max=$((total - 1))
  local i=1
  while [ "$i" -le "$max" ]; do
    local padded
    printf -v padded "%03d" "$i"
    local chunk="$STABLE.part$padded"
    echo "  downloading $chunk ..."
    download_url "$PKG_URL/$chunk" "$WORK_DIR/$chunk" || return 1
    i=$((i + 1))
  done

  # Reassemble. Globs are sorted lexically by the shell, so part000 < part001
  # < ... < partNNN regardless of how many chunks there are.
  echo "  concatenating chunks ..."
  cat "$WORK_DIR"/$STABLE.part* > "$TARBALL_PATH"
  rm -f "$WORK_DIR"/$STABLE.part*

  # Pull sha256 if available.
  download_url "$PKG_URL/$STABLE.sha256" "$SHA_PATH" 2>/dev/null || true
  return 0
}

# GitHub Releases fallback (single tarball, no chunking).
github_release_download() {
  echo "Falling back to GitHub Releases ..."
  local api_url="https://api.github.com/repos/$REPO/releases/tags/$RELEASE_TAG"
  local gh_url
  gh_url=$(curl -fsSL "$api_url" \
    | grep '"browser_download_url"' \
    | grep -E 'linux-x64\.tar\.gz"$' \
    | head -1 \
    | sed -E 's/.*"(https:[^"]+)".*/\1/')
  if [ -z "$gh_url" ]; then
    echo "ERROR: no linux-x64 tarball in GitHub release '$RELEASE_TAG'."
    return 1
  fi
  echo "  downloading $(basename "$gh_url") ..."
  curl -fsSL --retry 3 --max-time 600 -o "$TARBALL_PATH" "$gh_url" || return 1
  curl -fsSL --retry 3 --max-time 60 -o "$SHA_PATH" "$gh_url.sha256" 2>/dev/null || true
}

if ! gitcode_chunked_download; then
  github_release_download || {
    echo "ERROR: download failed from both gitcode and GitHub."
    exit 1
  }
fi

# Verify sha256 if we got a checksum file.
if [ -s "$SHA_PATH" ]; then
  (cd "$WORK_DIR" \
    && sed -E "s,  [^ ]+$,  $STABLE," "$(basename "$SHA_PATH")" > checksum.fixed \
    && sha256sum -c checksum.fixed --quiet) \
    && echo "sha256 verified." \
    || echo "WARNING: sha256 verification skipped or failed."
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
