#!/bin/bash
# Backup launcher: double-click this if the Start Ko-Labz icon is ever blocked
# by macOS. It runs exactly the same steps (scripts/start-kolabz.sh).
exec /bin/bash "$(cd "$(dirname "$0")" && pwd -P)/scripts/start-kolabz.sh" --via-terminal
