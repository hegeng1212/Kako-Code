#!/usr/bin/env bash
# Start / stop / restart Kako dev API + Web UI.
#
# Usage:
#   ./scripts/dev-services.sh start      # API :3721 + Vite :5173 (background)
#   ./scripts/dev-services.sh restart    # stop then start (background)
#   ./scripts/dev-services.sh stop
#   ./scripts/dev-services.sh status
#   ./scripts/dev-services.sh fg         # foreground (logs in terminal)
#   ./scripts/dev-services.sh api        # API only (background)
#
# Env:
#   KAKO_SERVER_PORT  default 3721
#   KAKO_WEB_PORT     default 5173
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${KAKO_SERVER_PORT:-3721}"
WEB_PORT="${KAKO_WEB_PORT:-5173}"
KAKO_HOME="${KAKO_HOME:-$HOME/.kako}"
LOG_DIR="$KAKO_HOME/dev/logs"
PID_FILE="$KAKO_HOME/dev/services.pid"
LOG_FILE="$LOG_DIR/dev-services.log"

usage() {
  cat <<EOF
Kako dev services

  start      Start API + Web in background (default)
  restart    Stop, then start API + Web in background
  stop       Stop processes on ports ${API_PORT} and ${WEB_PORT}
  status     Show port / health status
  fg         Start API + Web in foreground (blocking)
  api        Start API only in background

  API:  http://localhost:${API_PORT}
  Web:  http://localhost:${WEB_PORT}

  Logs (background): ${LOG_FILE}
EOF
}

port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti :"$port" 2>/dev/null || true
    return
  fi
  echo ""
}

stop_port() {
  local port="$1"
  local pids
  pids="$(port_pids "$port")"
  if [[ -z "$pids" ]]; then
    return 0
  fi
  echo "==> Stopping port ${port} (pid: ${pids//$'\n'/ })"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  pids="$(port_pids "$port")"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

stop_services() {
  if [[ -f "$PID_FILE" ]]; then
    local parent_pid
    parent_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$parent_pid" ]] && kill -0 "$parent_pid" 2>/dev/null; then
      echo "==> Stopping dev launcher (pid ${parent_pid})"
      kill "$parent_pid" 2>/dev/null || true
      sleep 1
      kill -9 "$parent_pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
  stop_port "$API_PORT"
  stop_port "$WEB_PORT"
}

port_listening() {
  local port="$1"
  [[ -n "$(port_pids "$port")" ]]
}

api_healthy() {
  curl -fsS "http://localhost:${API_PORT}/api/health" >/dev/null 2>&1
}

wait_for_services() {
  local i
  for i in $(seq 1 90); do
    if api_healthy && port_listening "$WEB_PORT"; then
      echo "==> Ready"
      echo "    API  http://localhost:${API_PORT}/api/health"
      echo "    Web  http://localhost:${WEB_PORT}"
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for services. Check ${LOG_FILE}" >&2
  return 1
}

start_background() {
  local mode="${1:-web}"
  mkdir -p "$LOG_DIR"
  cd "$ROOT"

  if [[ "$mode" == "api" ]]; then
    echo "==> Starting API on :${API_PORT} (background)"
    nohup pnpm dev:server >>"$LOG_FILE" 2>&1 &
  else
    echo "==> Starting API + Web on :${API_PORT} / :${WEB_PORT} (background)"
    nohup pnpm dev:web >>"$LOG_FILE" 2>&1 &
  fi

  echo $! >"$PID_FILE"
  echo "==> Logs: ${LOG_FILE}"
  wait_for_services
}

start_foreground() {
  local mode="${1:-web}"
  cd "$ROOT"
  if [[ "$mode" == "api" ]]; then
    echo "==> Starting API on :${API_PORT} (foreground)"
    exec pnpm dev:server
  fi
  echo "==> Starting API + Web on :${API_PORT} / :${WEB_PORT} (foreground)"
  exec pnpm dev:web
}

show_status() {
  echo "Kako dev services"
  echo "  API port ${API_PORT}: $(port_listening "$API_PORT" && echo up || echo down)"
  echo "  Web port ${WEB_PORT}: $(port_listening "$WEB_PORT" && echo up || echo down)"
  if api_healthy; then
    echo "  API health: ok"
  else
    echo "  API health: unavailable"
  fi
  if [[ -f "$PID_FILE" ]]; then
    echo "  Launcher pid: $(cat "$PID_FILE")"
  fi
  echo "  Log file: ${LOG_FILE}"
}

main() {
  local cmd="${1:-start}"
  case "$cmd" in
    start|up)
      stop_services
      start_background web
      ;;
    restart)
      echo "==> Restarting dev services"
      stop_services
      start_background web
      ;;
    stop|down)
      stop_services
      echo "==> Stopped"
      ;;
    status)
      show_status
      ;;
    fg|foreground)
      stop_services
      start_foreground web
      ;;
    api)
      stop_services
      start_background api
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
