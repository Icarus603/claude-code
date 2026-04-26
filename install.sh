#!/usr/bin/env bash
# install.sh — One-shot installer for `ccb` (Claude Code by Icarus603).
#
# Mirrors Anthropic's official Claude Code install layout (XDG Base Dir):
#   ~/.local/share/ccb/versions/<version>   ← actual binary
#   ~/.local/bin/ccb                        ← symlink → versions/<current>
#
# `~/.local/bin` is in PATH on virtually every modern shell setup
# (zsh/bash/fish all read it from XDG_BIN_HOME), so no manual `export PATH`
# step is required.
#
# Multi-version: keeping past versions under versions/ lets you roll back by
# re-pointing the symlink. Reinstalling overwrites the same version slot.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | bash
#   curl -fsSL .../install.sh | CCB_VERSION=v1.carus.000 bash    # pin version
#   curl -fsSL .../install.sh | CCB_PREFIX=/usr/local bash       # system-wide

set -euo pipefail

readonly REPO="Icarus603/claude-code"
readonly REQUESTED_VERSION="${CCB_VERSION:-latest}"

# Default install location: XDG Base Dir layout under $HOME.
# CCB_PREFIX overrides the parent (e.g. /usr/local installs to
# /usr/local/share/ccb + /usr/local/bin).
readonly PREFIX="${CCB_PREFIX:-$HOME/.local}"
readonly BIN_DIR="$PREFIX/bin"
readonly VERSIONS_DIR="$PREFIX/share/ccb/versions"

# ANSI colors (skipped if not a tty).
if [ -t 1 ]; then
  readonly C_BLUE=$'\033[34m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_DIM=$'\033[2m' C_RESET=$'\033[0m'
else
  readonly C_BLUE='' C_GREEN='' C_YELLOW='' C_DIM='' C_RESET=''
fi

log()   { printf '%s%s%s\n' "$C_BLUE" "$1" "$C_RESET" >&2; }
ok()    { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1" >&2; }
warn()  { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$1" >&2; }
fatal() { printf '%serror:%s %s\n' "$C_YELLOW" "$C_RESET" "$1" >&2; exit 1; }

# Detect platform → bun-compile target string.
detect_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) fatal "Unsupported OS: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *) fatal "Unsupported architecture: $(uname -m)" ;;
  esac
  if [ "$os" = "windows" ] && [ "$arch" = "arm64" ]; then
    fatal "windows-arm64 is unsupported (Bun has no compile target for it)."
  fi
  printf '%s' "${os}-${arch}"
}

# Resolve the actual version string (handle "latest").
resolve_version() {
  if [ "$REQUESTED_VERSION" != "latest" ]; then
    printf '%s' "$REQUESTED_VERSION"
    return
  fi
  # Hit GitHub's latest-release redirect; the Location header carries the tag.
  local headers tag
  if command -v curl >/dev/null 2>&1; then
    headers="$(curl -sI "https://github.com/${REPO}/releases/latest")"
  elif command -v wget >/dev/null 2>&1; then
    headers="$(wget -qS --spider "https://github.com/${REPO}/releases/latest" 2>&1)"
  else
    fatal "Need curl or wget."
  fi
  tag="$(printf '%s' "$headers" | awk -F/ '/^[[:space:]]*[Ll]ocation:/ { sub(/[\r\n]+$/,"",$NF); print $NF; exit }')"
  if [ -z "$tag" ]; then
    fatal "Could not resolve latest version. Try: CCB_VERSION=vX.Y.Z bash ..."
  fi
  printf '%s' "$tag"
}

# Build the binary download URL for a (version, platform) pair.
download_url() {
  local version="$1" platform="$2"
  local ext=""
  [[ "$platform" == windows-* ]] && ext=".exe"
  printf 'https://github.com/%s/releases/download/%s/ccb-%s%s' "$REPO" "$version" "$platform" "$ext"
}

download() {
  local url="$1" dest="$2"
  log "Downloading $url"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget --show-progress -q "$url" -O "$dest"
  else
    fatal "Need curl or wget to download."
  fi
}

# Like download() but silent + non-fatal on 404. Used for optional sidecar
# files (.sha256). Returns 0 on success, non-zero if the file isn't there.
download_quiet() {
  local url="$1" dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$dest" 2>/dev/null
  else
    return 1
  fi
}

# Warn if the bin dir isn't on PATH (rare on modern setups but possible).
check_path() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) return 0 ;;
  esac
  warn "$BIN_DIR is not on your PATH."
  printf '%s\n' "$C_DIM"
  printf '  Most shells read it from XDG_BIN_HOME automatically. If yours does not,\n'
  printf '  add this to your shell rc file:\n'
  printf '\n'
  case "$(basename "${SHELL:-bash}")" in
    fish) printf '    fish_add_path %s\n' "$BIN_DIR" ;;
    *)    printf '    export PATH="%s:$PATH"\n' "$BIN_DIR" ;;
  esac
  printf '%s' "$C_RESET"
}

main() {
  local platform version url ext bin_name versioned_path symlink_path

  platform="$(detect_platform)"
  version="$(resolve_version)"
  url="$(download_url "$version" "$platform")"

  ext=""
  [[ "$platform" == windows-* ]] && ext=".exe"
  bin_name="ccb${ext}"

  versioned_path="$VERSIONS_DIR/$version$ext"
  symlink_path="$BIN_DIR/$bin_name"

  log "Installing ccb $version for $platform"
  log "  binary  → $versioned_path"
  log "  symlink → $symlink_path"

  mkdir -p "$VERSIONS_DIR" "$BIN_DIR"

  # Download to a temp file then rename — avoids a half-written binary if
  # the network drops mid-download.
  local tmp="$versioned_path.partial"
  download "$url" "$tmp"

  # Verify SHA256 if a sibling .sha256 was published. Releases since
  # the auto-updater landing point all carry these; older releases
  # fall through silently (TLS still pinned the wire).
  local sha_url="${url}.sha256"
  local sha_tmp="$tmp.sha256"
  if download_quiet "$sha_url" "$sha_tmp"; then
    local expected actual
    expected="$(awk '{print $1; exit}' "$sha_tmp")"
    actual="$(shasum -a 256 "$tmp" | awk '{print $1}')"
    if [ "$expected" != "$actual" ]; then
      rm -f "$tmp" "$sha_tmp"
      fatal "checksum mismatch: expected $expected, got $actual"
    fi
    rm -f "$sha_tmp"
    ok "checksum verified"
  else
    warn "no .sha256 published for this release — skipping content verify"
  fi

  chmod +x "$tmp"
  mv -f "$tmp" "$versioned_path"

  # Atomic symlink swap: write to a new name then rename over the old one.
  # Plain `ln -sf` is two syscalls (unlink then symlink) and races with a
  # concurrent invocation.
  local link_tmp="$symlink_path.new.$$"
  ln -s "$versioned_path" "$link_tmp"
  mv -f "$link_tmp" "$symlink_path"

  ok "Installed: $symlink_path"
  "$symlink_path" --version 2>/dev/null || true

  check_path

  printf '\n'
  printf '%sQuick start:%s\n' "$C_GREEN" "$C_RESET"
  printf '  ccb              # interactive REPL\n'
  printf '  ccb --help       # full command reference\n'
  printf '\n'
  printf '%sUpgrade:%s   curl -fsSL https://raw.githubusercontent.com/%s/main/install.sh | bash\n' "$C_DIM" "$C_RESET" "$REPO"
  printf '%sUninstall:%s rm -rf %s %s\n' "$C_DIM" "$C_RESET" "$VERSIONS_DIR/.." "$symlink_path"
}

main "$@"
