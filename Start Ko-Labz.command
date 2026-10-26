#!/bin/zsh
# Double-click to start Ko-Labz and open it in Chrome.
# It asks the port who it is before using it, and never takes a port that belongs to another project.
cd "${0:A:h}"
PORT=${KOLABZ_PORT:-8350}
URL="http://127.0.0.1:$PORT"
NODE=$(command -v node || echo /usr/local/bin/node)
mkdir -p logs
who=$(curl -s --max-time 1 "$URL/api/whoami")
if [[ "$who" == *'"app":"ko-labz"'* ]]; then
  echo "Ko-Labz is already running."
elif [[ -n "$who" ]] || lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT belongs to something else. Ko-Labz will not share it."; exit 3
else
  [[ -d node_modules ]] || "$(command -v npm || echo /usr/local/bin/npm)" install --no-audit --no-fund
  nohup env KOLABZ_HOST="${KOLABZ_HOST:-127.0.0.1}" "$NODE" server.mjs >> logs/server.log 2>&1 &
  for i in {1..30}; do curl -s --max-time 1 "$URL/api/whoami" | grep -q ko-labz && break; sleep 0.2; done
fi
open -a "Google Chrome" "$URL" || "$HOME/.local/bin/open-page" "$URL"
