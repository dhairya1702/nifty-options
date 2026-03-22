#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_PID_FILE="$RUNTIME_DIR/backend.pid"
FRONTEND_PID_FILE="$RUNTIME_DIR/frontend.pid"
BACKEND_VENV="$BACKEND_DIR/.venv"
BACKEND_PORT=8000
FRONTEND_PORT=3000
BACKEND_URL="http://127.0.0.1:$BACKEND_PORT/health"
FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT"

mkdir -p "$LOG_DIR"

require_command() {
  local name="$1"
  local help_text="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "$help_text"
    exit 1
  fi
}

append_common_paths() {
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
}

ensure_xcode_tools() {
  if xcode-select -p >/dev/null 2>&1; then
    return 0
  fi

  echo "Installing Apple Command Line Tools..."
  xcode-select --install >/dev/null 2>&1 || true
  echo "Apple Command Line Tools are required before continuing."
  echo "If a macOS install window opened, finish that install and then launch the app again."
  exit 1
}

ensure_homebrew() {
  append_common_paths
  if command -v brew >/dev/null 2>&1; then
    return 0
  fi

  ensure_xcode_tools
  echo "Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  append_common_paths

  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew installation did not complete successfully."
    exit 1
  fi
}

ensure_formula_command() {
  local command_name="$1"
  local formula_name="$2"

  append_common_paths
  if command -v "$command_name" >/dev/null 2>&1; then
    return 0
  fi

  ensure_homebrew
  echo "Installing $formula_name..."
  brew install "$formula_name"
  append_common_paths

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Failed to install $formula_name."
    exit 1
  fi
}

copy_if_missing() {
  local source_file="$1"
  local target_file="$2"
  if [[ ! -f "$target_file" && -f "$source_file" ]]; then
    cp "$source_file" "$target_file"
  fi
}

stop_pid_file() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
    fi
    rm -f "$pid_file"
  fi
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local max_attempts=60
  local attempt=1
  while (( attempt <= max_attempts )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    ((attempt++))
  done

  echo "$label did not become ready. Check logs:"
  echo "  $BACKEND_LOG"
  echo "  $FRONTEND_LOG"
  exit 1
}

frontend_build_needed() {
  if [[ ! -f "$FRONTEND_DIR/.next/BUILD_ID" ]]; then
    return 0
  fi

  if [[ "$FRONTEND_DIR/package.json" -nt "$FRONTEND_DIR/.next/BUILD_ID" || "$FRONTEND_DIR/package-lock.json" -nt "$FRONTEND_DIR/.next/BUILD_ID" ]]; then
    return 0
  fi

  if find "$FRONTEND_DIR/app" "$FRONTEND_DIR/components" "$FRONTEND_DIR/lib" "$FRONTEND_DIR/app/components" -type f -newer "$FRONTEND_DIR/.next/BUILD_ID" | grep -q .; then
    return 0
  fi

  return 1
}

ensure_formula_command python3 python
ensure_formula_command node node
ensure_formula_command npm node
require_command curl "curl is required. Install curl and try again."
require_command open "The macOS 'open' command is required."

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "Missing $BACKEND_DIR/.env"
  echo "Add your Zerodha and Supabase credentials first, then launch again."
  exit 1
fi

copy_if_missing "$FRONTEND_DIR/.env.local.example" "$FRONTEND_DIR/.env.local"

if [[ ! -d "$BACKEND_VENV" ]]; then
  echo "Creating Python environment..."
  python3 -m venv "$BACKEND_VENV"
fi

if [[ ! -f "$BACKEND_VENV/.requirements_installed" || "$BACKEND_DIR/requirements.txt" -nt "$BACKEND_VENV/.requirements_installed" ]]; then
  echo "Installing backend packages..."
  "$BACKEND_VENV/bin/pip" install --upgrade pip >/dev/null
  "$BACKEND_VENV/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
  touch "$BACKEND_VENV/.requirements_installed"
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" || ! -f "$FRONTEND_DIR/.npm_installed" || "$FRONTEND_DIR/package-lock.json" -nt "$FRONTEND_DIR/.npm_installed" ]]; then
  echo "Installing frontend packages..."
  (cd "$FRONTEND_DIR" && npm install)
  touch "$FRONTEND_DIR/.npm_installed"
fi

if frontend_build_needed; then
  echo "Building frontend..."
  (cd "$FRONTEND_DIR" && npm run build)
fi

stop_pid_file "$BACKEND_PID_FILE"
stop_pid_file "$FRONTEND_PID_FILE"

if ! curl -fsS "$BACKEND_URL" >/dev/null 2>&1; then
  echo "Starting backend..."
  (
    cd "$BACKEND_DIR"
    nohup "$BACKEND_VENV/bin/uvicorn" main:app --host 127.0.0.1 --port "$BACKEND_PORT" >"$BACKEND_LOG" 2>&1 &
    echo $! >"$BACKEND_PID_FILE"
  )
fi

if ! curl -I -fsS "$FRONTEND_URL" >/dev/null 2>&1; then
  echo "Starting frontend..."
  (
    cd "$FRONTEND_DIR"
    nohup ./node_modules/.bin/next start -H 127.0.0.1 -p "$FRONTEND_PORT" >"$FRONTEND_LOG" 2>&1 &
    echo $! >"$FRONTEND_PID_FILE"
  )
fi

wait_for_url "$BACKEND_URL" "Backend"
wait_for_url "$FRONTEND_URL" "Frontend"

echo "Opening dashboard..."
open "$FRONTEND_URL"

echo
echo "Options Dashboard is running."
echo "Open the dashboard here:"
echo "  $FRONTEND_URL"
echo
echo "Backend health:"
echo "  http://127.0.0.1:$BACKEND_PORT/health"
echo
echo "Logs:"
echo "  $BACKEND_LOG"
echo "  $FRONTEND_LOG"
