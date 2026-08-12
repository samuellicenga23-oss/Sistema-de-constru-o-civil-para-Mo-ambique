#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

target_release="${1:-}"
confirmation="${2:-}"
[[ -n "$target_release" ]] || fail "Uso: deploy/rollback.sh <commit> --confirm"
[[ "$confirmation" == "--confirm" ]] || fail "Rollback requer confirmação explícita: --confirm"

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || fail "Já existe um deploy ou rollback em curso."

for command in git node npm pg_dump pg_restore curl flock; do require_command "$command"; done
[[ -z "$(git -C "$PROJECT_DIR" status --porcelain --untracked-files=normal)" ]] || fail "Existem alterações ou ficheiros não rastreados na VPS."
git -C "$PROJECT_DIR" cat-file -e "${target_release}^{commit}" 2>/dev/null || fail "Commit não encontrado: $target_release"

current_release="$(active_release)"
bash "$SCRIPT_DIR/backup.sh"
log "Rollback de código ${current_release:0:12} → $target_release. A base NÃO será restaurada automaticamente."

git -C "$PROJECT_DIR" switch main
# O rollback é explicitamente confirmado e limitado ao repositório de produção. Mantém `main`
# como branch activa para que o deploy seguinte possa avançar novamente por fast-forward.
git -C "$PROJECT_DIR" reset --hard "$target_release"
load_api_environment
export SIGO_RELEASE="$(git -C "$PROJECT_DIR" rev-parse --short=12 HEAD)"
cd "$PROJECT_DIR"
build_dir="$STATE_DIR/rollback-${SIGO_RELEASE}-$$"
safe_remove_deploy_dir "$build_dir"
mkdir -p "$build_dir"
trap 'safe_remove_deploy_dir "$build_dir"' EXIT
npm ci
npm run build:shared
(cd apps/api && ../../node_modules/.bin/tsc -p tsconfig.json --outDir "$build_dir/api")
(cd apps/web && ../../node_modules/.bin/tsc -b && ../../node_modules/.bin/vite build --outDir "$build_dir/web" --emptyOutDir)
(cd apps/supplier && ../../node_modules/.bin/tsc -b && ../../node_modules/.bin/vite build --outDir "$build_dir/supplier" --emptyOutDir)
atomic_install_build "$build_dir" "$current_release"
pm2 reload sigo-api --update-env
sudo systemctl restart sigo-plant-service

ready_payload="$(wait_for_url "$API_READY_URL" 20 2)" || fail "Rollback carregado, mas a API não ficou pronta. Consulte os logs; o backup pré-rollback foi preservado."
printf '%s' "$ready_payload" | assert_ready_payload || fail "Rollback ficou degradado. Consulte /api/ready e os logs."
printf '%s\n' "$target_release" >"$STATE_DIR/last-successful-release"
printf '%s\n' "$(date -u +%FT%TZ)" >"$STATE_DIR/last-successful-at"
pm2 save
log "Rollback validado. Produção está em main / $(git -C "$PROJECT_DIR" rev-parse --short=12 HEAD)."
