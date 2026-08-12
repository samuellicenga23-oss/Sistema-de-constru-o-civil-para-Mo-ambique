#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || fail "Já existe um deploy SIGO em curso."

bash "$SCRIPT_DIR/preflight.sh"
previous_release="$(active_release)"
log "Release actual: ${previous_release:0:12}"

restore_previous_release() {
  log "A repor integralmente a release ${previous_release:0:12}…"
  restore_archived_build "$previous_release" || true
  git -C "$PROJECT_DIR" reset --hard "$previous_release" >/dev/null
  reload_previous_api "$previous_release"
  sudo systemctl restart sigo-plant-service || true
}

git -C "$PROJECT_DIR" fetch --prune origin main
target_release="$(git -C "$PROJECT_DIR" rev-parse origin/main)"
if [[ "$target_release" == "$previous_release" ]]; then
  log "A VPS já está na versão mais recente. Será validada sem alterar código."
else
  git -C "$PROJECT_DIR" merge --ff-only origin/main
fi

bash "$SCRIPT_DIR/backup.sh"
load_api_environment
export SIGO_RELEASE="${target_release:0:12}"

cd "$PROJECT_DIR"
build_dir="$STATE_DIR/build-${SIGO_RELEASE}-$$"
safe_remove_deploy_dir "$build_dir"
mkdir -p "$build_dir"
trap 'safe_remove_deploy_dir "$build_dir"' EXIT

log "Instalação reproduzível e build isolado da release $SIGO_RELEASE…"
npm ci
npm run build:shared
(cd apps/api && ../../node_modules/.bin/tsc -p tsconfig.json --outDir "$build_dir/api")
(cd apps/web && ../../node_modules/.bin/tsc -b && ../../node_modules/.bin/vite build --outDir "$build_dir/web" --emptyOutDir)
(cd apps/supplier && ../../node_modules/.bin/tsc -b && ../../node_modules/.bin/vite build --outDir "$build_dir/supplier" --emptyOutDir)
npm run db:migrate

log "A activar os três builds numa única troca local…"
atomic_install_build "$build_dir" "$previous_release"

log "A recarregar serviços…"
if ! pm2 reload sigo-api --update-env || ! sudo systemctl restart sigo-plant-service; then
  restore_previous_release
  fail "Serviços não reiniciaram. Release anterior reposta; confirme os logs."
fi

health_payload="$(wait_for_url "$API_HEALTH_URL" 20 2)" || {
  restore_previous_release
  fail "A API não voltou a responder; a release anterior foi reposta."
}
ready_payload="$(wait_for_url "$API_READY_URL" 20 2)" || {
  restore_previous_release
  fail "A API não ficou pronta; a release anterior foi reposta. Consulte os logs."
}
printf '%s' "$ready_payload" | assert_ready_payload || {
  restore_previous_release
  fail "A release ficou degradada; a release anterior foi reposta. Consulte /api/ready."
}

log "A validar website, segurança, autenticação e portal do fornecedor…"
if ! node scripts/production-smoke.mjs "$PUBLIC_URL" "--expected-release=${target_release:0:12}"; then
  restore_previous_release
  fail "O smoke test público falhou; a release anterior foi reposta. Consulte a saída acima."
fi

printf '%s\n' "$previous_release" >"$STATE_DIR/previous-release"
printf '%s\n' "$target_release" >"$STATE_DIR/last-successful-release"
printf '%s\n' "$(date -u +%FT%TZ)" >"$STATE_DIR/last-successful-at"
pm2 save
log "Deploy concluído e validado: ${target_release:0:12}"
