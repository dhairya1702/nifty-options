#!/bin/zsh

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$ROOT_DIR/scripts/stop_dashboard.sh"
status=$?

if [[ $status -ne 0 ]]; then
  echo
  read '?Stop failed. Press Enter to close...'
fi

exit $status
