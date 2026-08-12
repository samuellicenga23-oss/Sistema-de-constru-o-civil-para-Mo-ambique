#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${SIGO_PROJECT_DIR:-/home/sigo/htdocs/sud30s.org}"
BACKUP_DIR="${SIGO_BACKUP_DIR:-/home/sigo/backups}"
STATE_DIR="${PROJECT_DIR}/.deploy"
API_ENV_FILE="${PROJECT_DIR}/apps/api/.env"
API_HEALTH_URL="${SIGO_HEALTH_URL:-http://127.0.0.1:4100/api/health}"
API_READY_URL="${SIGO_READY_URL:-http://127.0.0.1:4100/api/ready}"
PLANT_HEALTH_URL="${SIGO_PLANT_HEALTH_URL:-http://127.0.0.1:8001/health}"

log() { printf '[SIGO] %s\n' "$*"; }
fail() { printf '[SIGO] ERRO: %s\n' "$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || fail "Comando obrigatório não encontrado: $1"; }

load_api_environment() {
  [[ -f "$API_ENV_FILE" ]] || fail "Ambiente da API não encontrado: $API_ENV_FILE"
  # Parsear como dotenv, nunca como código shell. O valor fica apenas na variável do processo e
  # não é escrito no terminal nem passado como argumento visível na lista de processos.
  DATABASE_URL="$(cd "$PROJECT_DIR" && API_ENV_FILE="$API_ENV_FILE" node --input-type=module -e '
    import fs from "node:fs";
    import dotenv from "dotenv";
    const values = dotenv.parse(fs.readFileSync(process.env.API_ENV_FILE));
    if (!values.DATABASE_URL) process.exit(2);
    process.stdout.write(values.DATABASE_URL);
  ')" || fail "Não foi possível ler DATABASE_URL do ambiente da API."
  export DATABASE_URL
  [[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL não está definida em apps/api/.env"
  PUBLIC_URL="$(cd "$PROJECT_DIR" && API_ENV_FILE="$API_ENV_FILE" node --input-type=module -e '
    import fs from "node:fs";
    import dotenv from "dotenv";
    const values = dotenv.parse(fs.readFileSync(process.env.API_ENV_FILE));
    process.stdout.write(values.PUBLIC_URL || values.FRONTEND_URL || "");
  ')" || fail "Não foi possível ler PUBLIC_URL do ambiente da API."
  export PUBLIC_URL
  [[ "$PUBLIC_URL" =~ ^https:// ]] || fail "PUBLIC_URL de produção deve usar HTTPS."
}

validate_production_environment() {
  (cd "$PROJECT_DIR" && API_ENV_FILE="$API_ENV_FILE" node --input-type=module -e '
    import fs from "node:fs";
    import dotenv from "dotenv";
    const values = dotenv.parse(fs.readFileSync(process.env.API_ENV_FILE));
    const missing = ["SESSION_COOKIE_SECRET", "PLANT_SERVICE_TOKEN", "PUBLIC_URL"].filter(key => !values[key]);
    if ((values.NODE_ENV || "") !== "production" || missing.length) process.exit(1);
  ') || fail "Ambiente de produção incompleto (NODE_ENV, SESSION_COOKIE_SECRET, PLANT_SERVICE_TOKEN ou PUBLIC_URL)."
}

load_postgres_client_environment() {
  load_api_environment
  local encoded
  mapfile -t encoded < <(DATABASE_URL="$DATABASE_URL" node --input-type=module -e '
    const url = new URL(process.env.DATABASE_URL);
    const values = [url.hostname, url.port || "5432", decodeURIComponent(url.username), decodeURIComponent(url.password), decodeURIComponent(url.pathname.replace(/^\//, ""))];
    for (const value of values) console.log(Buffer.from(value).toString("base64"));
  ')
  [[ "${#encoded[@]}" -eq 5 ]] || fail "DATABASE_URL PostgreSQL inválida."
  PGHOST="$(printf '%s' "${encoded[0]}" | base64 --decode)"
  PGPORT="$(printf '%s' "${encoded[1]}" | base64 --decode)"
  PGUSER="$(printf '%s' "${encoded[2]}" | base64 --decode)"
  PGPASSWORD="$(printf '%s' "${encoded[3]}" | base64 --decode)"
  PGDATABASE="$(printf '%s' "${encoded[4]}" | base64 --decode)"
  export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
  unset DATABASE_URL
}

active_release() {
  local recorded="$STATE_DIR/last-successful-release"
  if [[ -f "$recorded" ]]; then
    local value
    value="$(tr -d '[:space:]' <"$recorded")"
    if [[ "$value" =~ ^[0-9a-fA-F]{7,40}$ ]]; then printf '%s' "$value"; return 0; fi
  fi
  git -C "$PROJECT_DIR" rev-parse HEAD
}

reload_previous_api() {
  local release="$1"
  export SIGO_RELEASE="${release:0:12}"
  pm2 reload sigo-api --update-env || true
}

safe_remove_deploy_dir() {
  local target="$1"
  [[ -n "$target" && "$target" == "$STATE_DIR"/* && "$target" != "$STATE_DIR" ]] || fail "Recusa de remoção fora de $STATE_DIR"
  rm -rf -- "$target"
}

wait_for_url() {
  local url="$1" attempts="${2:-20}" delay="${3:-2}"
  local response
  for ((i = 1; i <= attempts; i++)); do
    if response="$(curl --silent --show-error --max-time 6 --fail "$url" 2>/dev/null)"; then
      printf '%s' "$response"
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

assert_ready_payload() {
  node -e '
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => body += chunk);
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        if (parsed.status !== "ready") process.exit(1);
      } catch { process.exit(1); }
    });
  '
}

atomic_install_build() {
  local build_dir="$1" release="$2"
  local archive_dir="$STATE_DIR/builds/$release"
  safe_remove_deploy_dir "$archive_dir"
  mkdir -p "$archive_dir"
  for app in api web supplier; do [[ -d "$build_dir/$app" ]] || fail "Build em falta: $build_dir/$app"; done

  # A API só muda quando o PM2 recarrega e pode ser trocada como directório completo.
  if [[ -d "$PROJECT_DIR/apps/api/dist" ]]; then mv "$PROJECT_DIR/apps/api/dist" "$archive_dir/api"; fi
  mv "$build_dir/api" "$PROJECT_DIR/apps/api/dist"

  # Nos SPAs, preservar assets com hash da versão anterior mantém abas abertas funcionais.
  # O index é copiado por último e renomeado atomicamente no mesmo filesystem.
  for app in web supplier; do
    local live="$PROJECT_DIR/apps/$app/dist" incoming="$build_dir/$app"
    if [[ -d "$live" ]]; then cp -a "$live" "$archive_dir/$app"; else mkdir -p "$live"; fi
    find "$incoming" -mindepth 1 -maxdepth 1 ! -name index.html -exec cp -a {} "$live/" \;
    cp "$incoming/index.html" "$live/.index.html.$release"
    mv -f "$live/.index.html.$release" "$live/index.html"
  done

  # Limitar o espaço dos rollbacks: conservar apenas os três arquivos mais recentes.
  mapfile -t old_archives < <(find "$STATE_DIR/builds" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +4 | cut -d' ' -f2-)
  for old_archive in "${old_archives[@]:-}"; do
    [[ -n "$old_archive" ]] && safe_remove_deploy_dir "$old_archive"
  done
}

restore_archived_build() {
  local release="$1" archive_dir="$STATE_DIR/builds/$release"
  [[ -d "$archive_dir" ]] || return 1
  for app in api web supplier; do
    [[ -d "$archive_dir/$app" ]] || return 1
  done
  for app in api web supplier; do
    [[ "$PROJECT_DIR/apps/$app/dist" == "$PROJECT_DIR"/apps/*/dist ]] || fail "Caminho de dist inválido."
    rm -rf -- "$PROJECT_DIR/apps/$app/dist"
    mv "$archive_dir/$app" "$PROJECT_DIR/apps/$app/dist"
  done
}
