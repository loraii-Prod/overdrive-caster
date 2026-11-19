#!/bin/bash
# Fresh server + mock OBS (scenes built), the realistic Major seed, then the Producer Control Room e2e.
# Usage: bash e2e-rig/room/run.sh <build dir with dist/ and mockobs.mjs>
D=${1:-/home/claude/build}; R=$(cd "$(dirname "$0")/../.." && pwd)
bash "$R/e2e-rig/track/run.sh" "$D"
python3 -I "$R/e2e-rig/producer/seed.py"
python3 -I -u "$R/e2e-rig/room/room_e2e.py"
