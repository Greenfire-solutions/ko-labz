#!/bin/bash
# Starts Ko-Labz so phones and laptops on the same Wi-Fi can join the hub, and
# shows the address to type on them. Anyone on that network can play and edit,
# so use it on a network you trust. Same steps as Start Ko-Labz, plus --wifi.
exec /bin/bash "$(cd "$(dirname "$0")" && pwd -P)/scripts/start-kolabz.sh" --via-terminal --wifi
