#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

for command in git node npm pg_dump pg_restore curl flock; do require_command "$command"; done
[[ "$(uname -s)" == "Linux" ]] || fail "Este preflight de produção destina-se à VPS Linux."
[[ -d "$PROJECT_DIR/.git" ]] || fail "Repositório não encontrado em $PROJECT_DIR"
[[ -f "$API_ENV_FILE" ]] || fail "Falta $API_ENV_FILE"

branch="$(git -C "$PROJECT_DIR" branch --show-current)"
[[ "$branch" == "main" ]] || fail "A produção deve estar na branch main; actual: ${branch:-detached}"
[[ -z "$(git -C "$PROJECT_DIR" status --porcelain --untracked-files=normal)" ]] || fail "Existem alterações ou ficheiros não rastreados na VPS. Resolva-os antes do deploy."
git -C "$PROJECT_DIR" remote get-url origin >/dev/null 2>&1 || fail "Remote origin não configurado."

available_kb="$(df -Pk "$PROJECT_DIR" | awk 'NR==2 {print $4}')"
[[ "${available_kb:-0}" -ge 1048576 ]] || fail "Menos de 1 GB livre no volume do projecto."

permissions="$(stat -c '%a' "$API_ENV_FILE")"
if (( 10#$permissions > 640 )); then
  fail "Permissões inseguras em apps/api/.env ($permissions). Use chmod 600."
fi

load_api_environment
validate_production_environment

pm2 describe sigo-api >/dev/null 2>&1 || fail "Processo PM2 sigo-api não encontrado."
systemctl is-enabled sigo-plant-service >/dev/null 2>&1 || fail "sigo-plant-service não está activado no systemd."

log "Preflight aprovado: branch, ambiente, permissões, disco e supervisores."
