#!/usr/bin/env bash
# Upgrade an existing Kako install to a pinned release.
#
# curl | bash install:
#   curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/v0.2.1/scripts/upgrade.sh | bash
#
# Or override target version:
#   KAKO_VERSION=v0.2.1 curl -fsSL .../main/scripts/upgrade.sh | bash
set -euo pipefail

KAKO_VERSION="${KAKO_VERSION:-v0.2.1}"
export KAKO_BRANCH="$KAKO_VERSION"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/install.sh"
