#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

for command in curl node df git; do require_command "$command"; done
issues=0

check_url() {
  local label="$1" url="$2" expected="$3" payload
  if payload="$(curl --silent --show-error --max-time 6 --fail "$url" 2>/dev/null)" && printf '%s' "$payload" | node -e '
    let value=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", c => value += c);
    process.stdin.on("end", () => { try { const body=JSON.parse(value); process.exit(body.status === process.argv[1] ? 0 : 1); } catch { process.exit(1); } });
  ' "$expected"; then
    log "$label: OK"
  else
    log "$label: FALHA"
    issues=$((issues + 1))
  fi
}

check_url "API" "$API_HEALTH_URL" "ok"
check_url "Prontidão" "$API_READY_URL" "ready"
check_url "Leitor de plantas" "$PLANT_HEALTH_URL" "ok"

if [[ -f "$STATE_DIR/last-successful-release" ]]; then
  active="$(tr -d '[:space:]' <"$STATE_DIR/last-successful-release")"
  current="$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$active" == "$current" ]]; then log "Release: ${active:0:12}"; else log "Release: divergente (activa ${active:0:12}, Git ${current:0:12})"; issues=$((issues + 1)); fi
fi

used_percent="$(df -P "$PROJECT_DIR" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
log "Disco utilizado: ${used_percent}%"
if [[ "${used_percent:-100}" -ge 92 ]]; then issues=$((issues + 1)); fi

latest_backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'sigo-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2- || true)"
if [[ -z "$latest_backup" ]]; then
  log "Backup: não encontrado"
  issues=$((issues + 1))
else
  age_hours="$(( ($(date +%s) - $(stat -c %Y "$latest_backup")) / 3600 ))"
  log "Backup: ${age_hours}h"
  if [[ "$age_hours" -ge 54 ]]; then issues=$((issues + 1)); fi
fi

if [[ "$issues" -gt 0 ]]; then log "$issues problema(s) encontrado(s)."; exit 1; fi
log "Estado operacional normal."
