#!/usr/bin/env bash
# Kako installer — Claude Code-style curl | bash
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/main/scripts/install.sh | bash
set -euo pipefail

KAKO_REPO="${KAKO_REPO:-https://github.com/hegeng1212/Kako-Code.git}"
KAKO_BRANCH="${KAKO_BRANCH:-main}"
KAKO_HOME="${KAKO_HOME:-$HOME/.kako}"
KAKO_INSTALL="${KAKO_INSTALL:-$KAKO_HOME/app}"
KAKO_SRC="${KAKO_SRC:-$KAKO_HOME/src/Kako-Code}"
BIN_DIR="${KAKO_BIN_DIR:-$HOME/.local/bin}"
PNPM_STORE="${PNPM_STORE:-$KAKO_HOME/.pnpm-store}"

echo "==> Kako installer"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 20 is required. Install from https://nodejs.org/" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.version.slice(1).split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Node.js >= 20 is required (found $(node -v))." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> Enabling pnpm via corepack"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@10.12.1 --activate
  else
    echo "Install pnpm: npm install -g pnpm" >&2
    exit 1
  fi
fi

mkdir -p "$KAKO_HOME" "$BIN_DIR" "$PNPM_STORE"

if [[ -d "$KAKO_SRC/.git" ]]; then
  echo "==> Updating source at $KAKO_SRC"
  git -C "$KAKO_SRC" fetch origin "$KAKO_BRANCH"
  git -C "$KAKO_SRC" checkout "$KAKO_BRANCH"
  git -C "$KAKO_SRC" pull --ff-only origin "$KAKO_BRANCH" || true
else
  echo "==> Cloning $KAKO_REPO"
  rm -rf "$KAKO_SRC"
  git clone --depth 1 --branch "$KAKO_BRANCH" "$KAKO_REPO" "$KAKO_SRC"
fi

cd "$KAKO_SRC"
export PNPM_HOME="${PNPM_HOME:-$KAKO_HOME/.pnpm-home}"
export PATH="$PNPM_HOME:$PATH"

echo "==> Installing dependencies"
pnpm install --store-dir "$PNPM_STORE"

echo "==> Building"
pnpm --filter @kako/shared build
pnpm --filter @kako/core build
pnpm --filter @kako/cli build
pnpm --filter @kako/server build
pnpm --filter @kako/web build

echo "==> Deploying CLI to $KAKO_INSTALL"
rm -rf "$KAKO_INSTALL"
pnpm --filter @kako/cli deploy "$KAKO_INSTALL" --prod --legacy

echo "==> Bundling settings UI and server"
rm -rf "$KAKO_INSTALL/web" "$KAKO_INSTALL/server-app"
cp -R apps/web/dist "$KAKO_INSTALL/web"
pnpm --filter @kako/server deploy "$KAKO_INSTALL/server-app" --prod --legacy
cp -R agents "$KAKO_INSTALL/agents"
cp -R skills "$KAKO_INSTALL/skills"

cat > "$BIN_DIR/kako" <<EOF
#!/usr/bin/env bash
export KAKO_INSTALL="$KAKO_INSTALL"
CLI="\$KAKO_INSTALL/dist/index.js"
if ! command -v node >/dev/null 2>&1; then
  echo "Kako requires Node.js >= 20." >&2
  exit 1
fi
exec node "\$CLI" "\$@"
EOF
chmod +x "$BIN_DIR/kako"

echo ""
echo "Kako installed."
echo "  CLI:       kako"
echo "  Settings:  kako web"
echo "  Bin dir:   $BIN_DIR"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo "Add to your shell profile (~/.zshrc or ~/.bashrc):"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi
echo ""
echo "Next:"
echo "  1. kako web          # configure providers / MCP / skills"
echo "  2. cd your-project && kako"
