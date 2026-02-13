#!/usr/bin/env bash
set -euo pipefail

# Build script for move_eval circuit
# Uses Docker to run bb (bb requires GLIBC 2.38+, Docker provides it)
# Prerequisites:
#   - nargo 1.0.0-beta.9  (noirup -v 1.0.0-beta.9)
#   - bb v0.87.0 at ~/.bb/bin/bb
#   - Docker

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PROJECT_NAME="move_eval"
export PATH="$HOME/.nargo/bin:$PATH"

BB_BIN="$HOME/.bb/bin/bb"
[[ -f "$BB_BIN" ]] || { echo "[!] bb not found at $BB_BIN"; exit 1; }

echo "► [1/4] nargo compile"
nargo compile

echo "► [2/4] nargo execute (generate witness)"
nargo execute

ACIR="target/${PROJECT_NAME}.json"
WIT="target/${PROJECT_NAME}.gz"
[[ -f "$ACIR" ]] || { echo "[!] ACIR not found: $ACIR"; exit 1; }
[[ -f "$WIT" ]]  || { echo "[!] Witness not found: $WIT"; exit 1; }

# Docker wrapper: mounts bb binary + target dir, installs jq+curl (bb needs both)
run_bb() {
  docker run --rm \
    -v "$SCRIPT_DIR/target:/work" \
    -v "$BB_BIN:/usr/local/bin/bb:ro" \
    ubuntu:24.04 bash -c "
      apt-get update -qq && apt-get install -y -qq jq curl > /dev/null 2>&1
      bb $*
    "
}

echo "► [3/4] bb write_vk"
run_bb "write_vk -b /work/${PROJECT_NAME}.json -o /work \
  --scheme ultra_honk --oracle_hash keccak --output_format bytes_and_fields"

# Flatten directories bb may create
for f in vk vk_fields.json; do
  if [[ -d "target/$f" && -f "target/$f/$f" ]]; then
    mv "target/$f/$f" "target/${f}.tmp"
    rmdir "target/$f"
    mv "target/${f}.tmp" "target/$f"
  fi
done

echo "► [4/4] bb prove"
run_bb "prove -b /work/${PROJECT_NAME}.json -w /work/${PROJECT_NAME}.gz -o /work \
  --scheme ultra_honk --oracle_hash keccak --output_format bytes_and_fields"

echo ""
echo "✓ Artifacts:"
ls -la target/
