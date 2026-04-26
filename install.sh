#!/usr/bin/env bash
# install.sh — One-shot installer for `ccb` (Icarus's Claude Code).
#
# Detects platform, downloads the matching standalone binary from GitHub
# Releases, installs it to ~/.ccb/bin/ccb, and offers to add ~/.ccb/bin
# to PATH. Zero dependencies on Node, Bun, npm — the binary is fully
# self-contained.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | CCB_VERSION=v2.1.888 bash
#   curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | CCB_PREFIX=/usr/local bash

set -euo pipefail

readonly REPO="Icarus603/claude-code"
readonly VERSION="${CCB_VERSION:-latest}"
readonly PREFIX="${CCB_PREFIX:-$HOME/.ccb}"
readonly BIN_DIR="$PREFIX/bin"

# Detect platform
detect_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *)
      echo "Unsupported OS: $(uname -s)" >&2
      exit 1
      ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
  # Bun supports darwin-{x64,arm64}, linux-{x64,arm64}, windows-x64.
  if [ "$os" = "windows" ] && [ "$arch" = "arm64" ]; then
    echo "Windows arm64 is not supported — Bun has no compile target for it." >&2
    exit 1
  fi
  echo "${os}-${arch}"
}

# Resolve download URL
resolve_url() {
  local platform="$1"
  local ext=""
  if [[ "$platform" == windows-* ]]; then
    ext=".exe"
  fi
  local filename="ccb-${platform}${ext}"
  if [ "$VERSION" = "latest" ]; then
    echo "https://github.com/${REPO}/releases/latest/download/${filename}"
  else
    echo "https://github.com/${REPO}/releases/download/${VERSION}/${filename}"
  fi
}

# Download with progress
download() {
  local url="$1"
  local dest="$2"
  echo "Downloading $url"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget --show-progress "$url" -O "$dest"
  else
    echo "Need curl or wget to download." >&2
    exit 1
  fi
}

# PATH setup hint
suggest_path_setup() {
  local shell_name shell_rc
  shell_name="$(basename "${SHELL:-bash}")"
  case "$shell_name" in
    zsh)  shell_rc="$HOME/.zshrc" ;;
    bash) shell_rc="$HOME/.bashrc" ;;
    fish) shell_rc="$HOME/.config/fish/config.fish" ;;
    *)    shell_rc="$HOME/.profile" ;;
  esac
  case ":$PATH:" in
    *":$BIN_DIR:"*)
      echo "✓ $BIN_DIR is already in your PATH"
      ;;
    *)
      echo
      echo "Add $BIN_DIR to your PATH:"
      if [ "$shell_name" = "fish" ]; then
        echo "  fish_add_path $BIN_DIR"
      else
        echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> $shell_rc"
        echo "  source $shell_rc"
      fi
      ;;
  esac
}

main() {
  local platform url dest
  platform="$(detect_platform)"
  url="$(resolve_url "$platform")"

  mkdir -p "$BIN_DIR"
  if [[ "$platform" == windows-* ]]; then
    dest="$BIN_DIR/ccb.exe"
  else
    dest="$BIN_DIR/ccb"
  fi

  download "$url" "$dest"
  chmod +x "$dest"

  echo
  echo "Installed: $dest"
  "$dest" --version 2>/dev/null || true

  suggest_path_setup
}

main "$@"
