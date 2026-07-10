#!/usr/bin/env bash
# Build a macOS .pkg installer for the Kako CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${KAKO_VERSION:-0.2.1}"
PKG_ID="${KAKO_PKG_ID:-com.kako.cli}"
INSTALL_ROOT="/opt/kako"
BIN_PATH="/usr/local/bin/kako"

STAGING="$ROOT/release/macos/staging"
PKGROOT="$STAGING/pkgroot"
PAYLOAD="$PKGROOT$INSTALL_ROOT"
WORK="$ROOT/release/macos/work"
OUT_DIR="$ROOT/release/macos"
PKG_FILE="$OUT_DIR/kako-${VERSION}-macos.pkg"

echo "==> Kako macOS installer (v${VERSION})"

command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required" >&2; exit 1; }
command -v pkgbuild >/dev/null 2>&1 || { echo "pkgbuild is required (Xcode CLT)" >&2; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to build the installer" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.version.slice(1).split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Node.js >= 20 is required (found $(node -v))" >&2
  exit 1
fi

echo "==> Building packages"
pnpm --filter @kako/shared build
pnpm --filter @kako/core build
pnpm --filter @kako/cli build
pnpm --filter @kako/server build
pnpm --filter @kako/web build

echo "==> Preparing staging"
rm -rf "$STAGING" "$WORK"
mkdir -p "$PAYLOAD" "$WORK" "$OUT_DIR"

echo "==> Deploying production dependencies to ${INSTALL_ROOT}"
pnpm --filter @kako/cli deploy "$PAYLOAD" --prod --legacy

echo "==> Bundling agents, skills, settings UI, and server"
cp -R "$ROOT/agents" "$PAYLOAD/agents"
cp -R "$ROOT/skills" "$PAYLOAD/skills"
cp -R "$ROOT/workflows" "$PAYLOAD/workflows"
cp -R "$ROOT/apps/web/dist" "$PAYLOAD/web"
pnpm --filter @kako/server deploy "$PAYLOAD/server-app" --prod --legacy

cat > "$PAYLOAD/README.txt" <<EOF
Kako CLI ${VERSION}
Install location: ${INSTALL_ROOT}
Commands:
  kako              Start chat in current directory
  kako web          Open settings (providers, MCP, skills)

Requires Node.js >= 20 (https://nodejs.org/)

User data: ~/.kako
EOF

mkdir -p "$PKGROOT/usr/local/bin"
cat > "$PKGROOT/usr/local/bin/kako" <<'WRAPPER'
#!/usr/bin/env bash
export KAKO_INSTALL="/opt/kako"
CLI="$KAKO_INSTALL/dist/index.js"

if ! command -v node >/dev/null 2>&1; then
  echo "Kako requires Node.js >= 20." >&2
  echo "Install from https://nodejs.org/ then run: kako" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.version.slice(1).split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Kako requires Node.js >= 20 (found $(node -v))." >&2
  exit 1
fi

if [[ ! -f "$CLI" ]]; then
  echo "Kako installation is incomplete: missing $CLI" >&2
  exit 1
fi

exec node "$CLI" "$@"
WRAPPER
chmod 755 "$PKGROOT/usr/local/bin/kako"

SCRIPTS_DIR="$WORK/scripts"
mkdir -p "$SCRIPTS_DIR"
cat > "$SCRIPTS_DIR/postinstall" <<'POSTINSTALL'
#!/bin/bash
# Ensure launcher is executable after install.
chmod 755 /usr/local/bin/kako 2>/dev/null || true
exit 0
POSTINSTALL
chmod 755 "$SCRIPTS_DIR/postinstall"

echo "==> Building component pkg"
COMPONENT_PKG="$WORK/kako-component.pkg"
pkgbuild \
  --root "$PKGROOT" \
  --identifier "${PKG_ID}.app" \
  --version "$VERSION" \
  --install-location "/" \
  --scripts "$SCRIPTS_DIR" \
  "$COMPONENT_PKG"

echo "==> Building product pkg"
cat > "$WORK/distribution.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Kako ${VERSION}</title>
  <organization>${PKG_ID}</organization>
  <domains enable_localSystem="true"/>
  <options customize="never" require-scripts="false" rootVolumeOnly="true"/>
  <choices-outline>
    <line choice="default">
      <line choice="kako"/>
    </line>
  </choices-outline>
  <choice id="default"/>
  <choice id="kako" visible="false">
    <pkg-ref id="${PKG_ID}.app"/>
  </choice>
  <pkg-ref id="${PKG_ID}.app" version="${VERSION}" onConclusion="none">kako-component.pkg</pkg-ref>
</installer-gui-script>
EOF

productbuild \
  --distribution "$WORK/distribution.xml" \
  --package-path "$WORK" \
  --version "$VERSION" \
  "$PKG_FILE"

echo ""
echo "Done: $PKG_FILE"
echo "Size: $(du -h "$PKG_FILE" | awk '{print $1}')"
echo ""
echo "Install: open \"$PKG_FILE\"  (or: sudo installer -pkg \"$PKG_FILE\" -target /)"
