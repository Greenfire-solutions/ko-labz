#!/bin/zsh
# Starts Ko-Labz so phones and laptops on the same Wi-Fi can join the hub.
# Anyone on the network can play and edit, so use it on a network you trust.
cd "${0:A:h}"
URL="http://127.0.0.1:8350"
who=$(curl -s --max-time 1 "$URL/api/whoami")
if [[ "$who" == *'"app":"ko-labz"'* ]]; then
  pid=$(echo "$who" | sed -E 's/.*"pid":([0-9]+).*/\1/')
  echo "Restarting Ko-Labz (pid $pid) so it listens on Wi-Fi..."
  kill "$pid"; sleep 1
fi
KOLABZ_HOST=0.0.0.0 "./Start Ko-Labz.command"
sleep 1
echo ""
echo "Crew on this Wi-Fi can join at:"
for ip in $(ifconfig | awk '/inet / && $2 != "127.0.0.1" {print $2}'); do echo "   http://$ip:8350"; done
echo ""
echo "(The same addresses are listed in Ko-Labz under Systems.)"
