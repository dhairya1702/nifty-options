#!/bin/zsh

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$ROOT_DIR/scripts/launch_dashboard.sh"
launch_exit_code=$?

echo
if [[ $launch_exit_code -eq 0 ]]; then
  read '?Launch finished. Press Enter to close this window...'
else
  read '?Launch failed. Press Enter to close...'
fi

exit $launch_exit_code
