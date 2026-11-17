#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED_AGENTS="$(cd "${SCRIPT_DIR}/../shared" && pwd)/AGENTS.md"
AGY_GEMINI="${SCRIPT_DIR}/GEMINI.md"
AGY_LEAN_AGENT="${SCRIPT_DIR}/agents/lean.md"
AGY_T3_WRAPPER="${SCRIPT_DIR}/bin/antigravity"
GEMINI_HOME="${HOME}/.gemini"
T3_USERDATA="${HOME}/.t3/userdata"
T3_AGY_ROOT="${T3_USERDATA}/providers/antigravity"

APPLY_T3_BINARY=0
for arg in "$@"; do
  case "$arg" in
    --apply-t3-binary) APPLY_T3_BINARY=1 ;;
    *)
      echo "Usage: $0 [--apply-t3-binary]" >&2
      exit 2
      ;;
  esac
done

link_force() {
  local src="$1"
  local dst="$2"
  mkdir -p "$(dirname "$dst")"
  ln -sfn "$src" "$dst"
}

disable_swarm_plugin() {
  local cfg="$1"
  mkdir -p "$(dirname "$cfg")"
  python3 - "$cfg" <<'PY'
import json, os, sys
path = sys.argv[1]
data = {}
if os.path.exists(path) and os.path.getsize(path) > 0:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
plugins = data.setdefault("plugins", {})
plugins["swarm"] = {"enabled": False}
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY
}

# 1. Global ~/.gemini (CLI & Herdr)
link_force "$AGY_GEMINI" "${GEMINI_HOME}/GEMINI.md"
link_force "$SHARED_AGENTS" "${GEMINI_HOME}/config/AGENTS.md"
link_force "$AGY_LEAN_AGENT" "${GEMINI_HOME}/config/agents/lean.md"
rm -f "${GEMINI_HOME}/config/skills/ryugi-using-ryugi"
disable_swarm_plugin "${GEMINI_HOME}/config/config.json"

# 2. T3 Code isolated Antigravity profiles
if [ -d "$T3_AGY_ROOT" ]; then
  for profile in "$T3_AGY_ROOT"/*; do
    [ -d "$profile" ] || continue
    link_force "$AGY_GEMINI" "${profile}/GEMINI.md"
    link_force "$SHARED_AGENTS" "${profile}/config/AGENTS.md"
    link_force "${GEMINI_HOME}/config/skills" "${profile}/config/skills"
    # Keep hooks out: non-empty profile hooks.json disables T3 Antigravity text generation.
    if [ -L "${profile}/config/hooks.json" ]; then
      rm -f "${profile}/config/hooks.json"
    fi
    disable_swarm_plugin "${profile}/config/config.json"
  done
fi

# 3. Optional: set T3 Code Antigravity custom binary path (run when no Antigravity turn is active)
if [ "$APPLY_T3_BINARY" -eq 1 ] && [ -f "${T3_USERDATA}/settings.json" ]; then
  python3 - "${T3_USERDATA}/settings.json" "$AGY_T3_WRAPPER" <<'PY'
import json, os, sys
settings_path, wrapper_path = sys.argv[1], sys.argv[2]
with open(settings_path, "r", encoding="utf-8") as f:
    data = json.load(f)
instances = data.setdefault("providerInstances", {})
agy = instances.setdefault("antigravity", {"driver": "antigravity", "displayName": "Antigravity", "enabled": True})
cfg = agy.setdefault("config", {})
cfg["binaryPath"] = wrapper_path
tmp = settings_path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(tmp, settings_path)
PY
  echo "Configured T3 Antigravity binaryPath -> ${AGY_T3_WRAPPER}"
fi

echo "Synced Antigravity global and T3 profiles."
