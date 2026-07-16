#!/usr/bin/env bash
# Upgrade an existing Kako install to a pinned release.
#
# curl | bash (works when piped — does not rely on BASH_SOURCE):
#   curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/v0.2.2/scripts/upgrade.sh | bash
#
# Or override target version:
#   KAKO_VERSION=v0.2.2 curl -fsSL .../main/scripts/upgrade.sh | bash
set -euo pipefail

KAKO_VERSION="${KAKO_VERSION:-v0.2.2}"
KAKO_RAW="${KAKO_RAW:-https://raw.githubusercontent.com/hegeng1212/Kako-Code}"

export KAKO_BRANCH="$KAKO_VERSION"

echo "==> Kako upgrade to ${KAKO_VERSION}"
curl -fsSL "${KAKO_RAW}/${KAKO_VERSION}/scripts/install.sh" | bash
