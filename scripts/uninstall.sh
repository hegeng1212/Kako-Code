#!/usr/bin/env bash
# Kako uninstaller — removes curl | bash and macOS .pkg installs.
#
# Latest:
#   curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/main/scripts/uninstall.sh | bash
#
# Keep user config / memory (~/.kako/config, etc.) by default.
# To remove all user data as well:
#   KAKO_PURGE=1 curl -fsSL .../uninstall.sh | bash
#
# Non-interactive:
#   KAKO_YES=1 curl -fsSL .../uninstall.sh | bash
#
# Same path overrides as install.sh:
#   KAKO_HOME KAKO_BIN_DIR KAKO_INSTALL KAKO_SRC PNPM_STORE PNPM_HOME
set -euo pipefail

KAKO_HOME="${KAKO_HOME:-$HOME/.kako}"
KAKO_INSTALL="${KAKO_INSTALL:-$KAKO_HOME/app}"
KAKO_SRC="${KAKO_SRC:-$KAKO_HOME/src/Kako-Code}"
BIN_DIR="${KAKO_BIN_DIR:-$HOME/.local/bin}"
PNPM_STORE="${PNPM_STORE:-$KAKO_HOME/.pnpm-store}"
PNPM_HOME="${PNPM_HOME:-$KAKO_HOME/.pnpm-home}"
PKG_INSTALL_ROOT="${KAKO_PKG_ROOT:-/opt/kako}"
PKG_BIN="${KAKO_PKG_BIN:-/usr/local/bin/kako}"
PKG_ID="${KAKO_PKG_ID:-com.kako.cli.app}"

PURGE="${KAKO_PURGE:-0}"
YES="${KAKO_YES:-0}"

CURL_BIN=""
PKG_FOUND=0
CURL_FOUND=0

is_kako_launcher() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  grep -q 'KAKO_INSTALL\|/opt/kako\|dist/index.js' "$file" 2>/dev/null
}

find_curl_launcher() {
  local candidate
  for candidate in "$BIN_DIR/kako" "$HOME/.local/bin/kako"; do
    if is_kako_launcher "$candidate"; then
      CURL_BIN="$candidate"
      return 0
    fi
  done
  return 1
}

detect_installs() {
  if [[ -d "$PKG_INSTALL_ROOT" ]] || is_kako_launcher "$PKG_BIN"; then
    PKG_FOUND=1
  fi

  if [[ -d "$KAKO_INSTALL" ]] || [[ -d "$KAKO_SRC" ]] || find_curl_launcher; then
    CURL_FOUND=1
  fi
}

remove_path() {
  local path="$1"
  local use_sudo="${2:-0}"

  if [[ ! -e "$path" ]]; then
    return 0
  fi

  if [[ "$use_sudo" == "1" ]]; then
    if [[ "$EUID" -eq 0 ]]; then
      rm -rf "$path"
    else
      sudo rm -rf "$path"
    fi
  else
    rm -rf "$path"
  fi
}

confirm() {
  if [[ "$YES" == "1" ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    echo "Non-interactive shell detected. Set KAKO_YES=1 to confirm uninstall." >&2
    exit 1
  fi
  read -r -p "Proceed with uninstall? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

print_plan() {
  echo "==> Kako uninstall plan"
  echo ""

  if [[ "$PKG_FOUND" == "1" ]]; then
    echo "macOS .pkg install:"
    [[ -d "$PKG_INSTALL_ROOT" ]] && echo "  - $PKG_INSTALL_ROOT"
    [[ -e "$PKG_BIN" ]] && echo "  - $PKG_BIN"
    if pkgutil --pkgs 2>/dev/null | grep -qx "$PKG_ID"; then
      echo "  - pkg receipt: $PKG_ID (will forget)"
    fi
    echo ""
  fi

  if [[ "$CURL_FOUND" == "1" ]]; then
    echo "curl | bash install:"
    [[ -n "$CURL_BIN" ]] && echo "  - $CURL_BIN"
    [[ -d "$KAKO_INSTALL" ]] && echo "  - $KAKO_INSTALL"
    [[ -d "$KAKO_SRC" ]] && echo "  - $KAKO_SRC"
    [[ -d "$PNPM_STORE" ]] && echo "  - $PNPM_STORE"
    [[ -d "$PNPM_HOME" ]] && echo "  - $PNPM_HOME"
    echo ""
  fi

  if [[ "$PURGE" == "1" ]]; then
    echo "User data (purge):"
    echo "  - $KAKO_HOME"
    echo ""
  else
    echo "User data (kept):"
    echo "  - $KAKO_HOME/config, memory, agents, skills, ..."
    echo "  To remove all user data: KAKO_PURGE=1"
    echo ""
  fi
}

uninstall_pkg() {
  echo "==> Removing macOS .pkg install"
  remove_path "$PKG_INSTALL_ROOT" 1
  remove_path "$PKG_BIN" 1

  if pkgutil --pkgs 2>/dev/null | grep -qx "$PKG_ID"; then
    if [[ "$EUID" -eq 0 ]]; then
      pkgutil --forget "$PKG_ID" >/dev/null
    else
      sudo pkgutil --forget "$PKG_ID" >/dev/null
    fi
    echo "  forgot pkg receipt: $PKG_ID"
  fi
}

uninstall_curl() {
  echo "==> Removing curl | bash install"
  if [[ -n "$CURL_BIN" ]]; then
    remove_path "$CURL_BIN" 0
  fi
  remove_path "$KAKO_INSTALL" 0
  remove_path "$KAKO_SRC" 0
  remove_path "$PNPM_STORE" 0
  remove_path "$PNPM_HOME" 0
}

maybe_stop_server() {
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti :3721 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      echo "==> Stopping process on port 3721"
      kill $pids 2>/dev/null || true
    fi
  fi
}

main() {
  echo "==> Kako uninstaller"
  detect_installs

  if [[ "$PKG_FOUND" == "0" && "$CURL_FOUND" == "0" ]]; then
    echo "No Kako installation detected."
    echo ""
    echo "Checked:"
    echo "  pkg:  $PKG_INSTALL_ROOT, $PKG_BIN"
    echo "  curl: $KAKO_INSTALL, $KAKO_SRC, $BIN_DIR/kako"
    if [[ "$PURGE" == "1" && -d "$KAKO_HOME" ]]; then
      echo ""
      echo "User data directory exists: $KAKO_HOME"
      print_plan
      if confirm; then
        remove_path "$KAKO_HOME" 0
        echo "Removed user data at $KAKO_HOME"
      fi
    fi
    exit 0
  fi

  print_plan
  confirm || { echo "Cancelled."; exit 0; }

  maybe_stop_server

  if [[ "$PKG_FOUND" == "1" ]]; then
    uninstall_pkg
  fi

  if [[ "$CURL_FOUND" == "1" ]]; then
    uninstall_curl
  fi

  if [[ "$PURGE" == "1" ]]; then
    echo "==> Removing user data"
    remove_path "$KAKO_HOME" 0
  fi

  echo ""
  echo "Kako uninstalled."
  if [[ "$PURGE" != "1" && -d "$KAKO_HOME" ]]; then
    echo "User data kept at: $KAKO_HOME"
    echo "To remove it: KAKO_PURGE=1 bash $0"
  fi
}

main "$@"
