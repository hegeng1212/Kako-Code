#!/usr/bin/env bash
# Link repo-built CLI to ~/.local/bin/kako for local development.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="${KAKO_BIN_DIR:-$HOME/.local/bin}"

echo "==> Building @kako/cli"
pnpm --filter @kako/shared build
pnpm --filter @kako/core build
pnpm --filter @kako/cli build

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/kako" <<EOF
#!/usr/bin/env bash
exec node "$ROOT/packages/cli/dist/index.js" "\$@"
EOF
chmod +x "$BIN_DIR/kako"

echo ""
echo "Dev CLI linked:"
echo "  $BIN_DIR/kako -> $ROOT/packages/cli/dist/index.js"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo "Add to PATH (~/.zshrc):"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi
echo ""
echo "Settings UI (dev):  pnpm dev:web"
echo "Settings UI (built): pnpm --filter @kako/server build && pnpm --filter @kako/web build && kako web"
