# SIGO Control Center — Inventário técnico

> Inventário técnico do **SIGO — Sistema Integrado de Gestão de Obras**  
> Data da verificação: **29 de Julho de 2026**  
> Projecto local: `C:\Users\Expert Sam\Documents\MediObra`  
> Produção: `https://sud30s.org`

## 0. Regras de leitura e segurança deste inventário

Este documento foi preparado para servir de fonte a um futuro **SIGO Control Center em HTML**. Os dados estão separados entre:

| Estado | Significado |
|---|---|
| **Confirmado no código** | Lido directamente dos ficheiros versionados do projecto. |
| **Confirmado localmente** | Verificado no computador de desenvolvimento em 29-07-2026. |
| **Confirmado na VPS** | Verificado por SSH, sem alterar dados ou serviços, em 29-07-2026. |
| **Documentado** | Existe num guia do projecto, mas pode não representar o estado actual. |
| **Não confirmado** | Exige acesso administrativo, uma decisão operacional ou uma verificação posterior. |

Por segurança, este inventário:

- não contém passwords, tokens, chaves privadas, cookies, segredos OAuth ou valores completos de `.env`;
- indica somente **nomes de variáveis** e **caminhos onde os valores estão guardados**;
- não imprime a parte de utilizador/password de `DATABASE_URL`;
- não deve ser usado para guardar futuras credenciais;
- pode ser versionado apenas enquanto continuar sem valores secretos.

## 1. Informações gerais e resumo executivo

| Item | Valor | Estado |
|---|---|---|
| Nome comercial | SIGO — Sistema Integrado de Gestão de Obras | Confirmado |
| Nome técnico npm | `sigo` | Confirmado no `package.json` raiz |
| Versão do workspace | `0.1.0` | Confirmado no código |
| Caminho local | `C:\Users\Expert Sam\Documents\MediObra` | Confirmado localmente |
| Branch local actual | `codex/siga-visual-refresh` | Confirmado localmente |
| Branch remota acompanhada localmente | `origin/codex/siga-visual-refresh` | Confirmado localmente |
| Branch principal/remota | `main` / `origin/main` | Confirmado no Git |
| Repositório GitHub | `git@github.com:samuellicenga23-oss/Sistema-de-constru-o-civil-para-Mo-ambique.git` | Confirmado localmente e na VPS |
| URL GitHub | `https://github.com/samuellicenga23-oss/Sistema-de-constru-o-civil-para-Mo-ambique` | Derivada do remoto confirmado |
| Domínio de produção | `https://sud30s.org` | Confirmado |
| Servidor | `187.127.95.179` | Confirmado |
| SSH | utilizador `sigo`, porta `22` | Confirmado |
| Caminho na VPS | `/home/sigo/htdocs/sud30s.org` | Confirmado na VPS |
| Branch de produção | `main` | Confirmado na VPS |
| Commit em produção | `fda1cc4` — igual a `origin/main` durante a auditoria | Confirmado na VPS |
| Arquitectura | Monorepo npm workspaces: React + Fastify + pacote partilhado; serviço Python fora dos workspaces npm | Confirmado no código |

### Estado actual dos serviços

| Serviço | Desenvolvimento | Produção em 29-07-2026 |
|---|---|---|
| Frontend React/Vite | Configurado em `127.0.0.1:5273`; não estava iniciado | Build servido pela própria API Node no domínio HTTPS |
| API Fastify | Configurada em `127.0.0.1:4100` através do `.env`; não estava iniciada | `sigo-api` online no PM2; `0.0.0.0:4100`; health OK |
| Leitor de plantas | Configurado em `127.0.0.1:8001`; não estava iniciado | `sigo-plant-service` online no PM2; `127.0.0.1:8001`; health OK |
| PostgreSQL | Serviço Windows `postgresql-17` activo, mas não foi observado listener em `5432` | PostgreSQL 16 activo; `127.0.0.1:5432`; base `sigo` |
| CloudPanel | Não aplicável | CloudPanel CLI `6.0.8`; HTTPS público em `80/443` |

### Avisos críticos encontrados

1. **Árvore de produção com alteração local:** `/home/sigo/htdocs/sud30s.org/package-lock.json` está modificado. Isto pode bloquear ou contaminar um futuro `git pull`. Não apagar a alteração sem primeiro identificar a diferença e guardar uma cópia.
2. **Dupla estratégia de supervisão do leitor:** o serviço systemd `sigo-plant-service.service` está `enabled`, mas `inactive`; o processo está actualmente online no PM2. O dump de arranque do PM2 só mostrou a API, portanto o leitor pode não regressar automaticamente após reboot.
3. **Porta da API ligada a todas as interfaces:** a API escuta em `0.0.0.0:4100`. O teste externo indicou que a porta 4100 está bloqueada, mas é preferível ligar a API a `127.0.0.1` e manter a firewall como segunda barreira.
4. **Documentação antiga divergente:** `ACESSO_TECNICO.md` ainda refere o frontend em `5173`, mas o Vite está configurado em `5273`. `deploy/README.md` descreve `/var/www/sigo` e Nginx estático, enquanto a produção real usa CloudPanel e `/home/sigo/htdocs/sud30s.org`.
5. **Sem deploy automático:** GitHub Actions faz CI, mas não publica. O deploy real é manual por SSH.
6. **Sem rollback de migrações:** as migrações Drizzle existentes são de avanço; não existem scripts `down`. Um rollback com alteração de schema depende de backup ou de uma nova migração correctiva.

## 2. Estrutura do projecto e workspace

### Estrutura principal

```text
C:\Users\Expert Sam\Documents\MediObra
├── .github/
│   └── workflows/
│       └── ci.yml
├── apps/
│   ├── web/                    # React, Vite, Tailwind e PWA
│   │   ├── src/
│   │   │   ├── api/
│   │   │   ├── auth/
│   │   │   ├── components/
│   │   │   └── pages/
│   │   └── vite.config.ts
│   ├── api/                    # Node.js, TypeScript, Fastify e Drizzle
│   │   ├── src/
│   │   │   ├── auth/
│   │   │   ├── db/
│   │   │   ├── routes/
│   │   │   └── services/
│   │   ├── drizzle/            # Migrações SQL 0000–0027
│   │   ├── test/
│   │   ├── uploads/            # Dados privados; ignorado pelo Git
│   │   ├── .env                # Configuração privada; ignorada pelo Git
│   │   └── drizzle.config.ts
│   └── plant-service/          # FastAPI, Uvicorn e PyMuPDF
│       ├── main.py
│       ├── parser.py
│       ├── test_parser.py
│       ├── requirements.txt
│       └── .venv/              # Ambiente Python local; ignorado pelo Git
├── packages/
│   └── shared/                 # Schemas/tipos Zod partilhados
├── deploy/
│   ├── ecosystem.config.cjs
│   ├── sigo-plant-service.service
│   ├── nginx.sigo.conf
│   └── README.md
├── ACESSO_TECNICO.md
├── CHANGELOG_DEV.md
├── package.json
├── package-lock.json
└── .gitignore
```

### Tipo de monorepo

O projecto usa **npm workspaces**, sem Nx, Turborepo, Yarn ou pnpm. Os workspaces declarados são:

- `apps/web`
- `apps/api`
- `packages/shared`

O serviço `apps/plant-service` pertence ao mesmo repositório, mas é gerido por `venv`/`pip`, não pelo npm workspace.

O pacote `@sigo/shared` deve ser compilado antes da API e do frontend. O script raiz `npm run build` já respeita esta ordem.

## 3. Comandos e scripts disponíveis

### Instalação de dependências

Na raiz do projecto:

```powershell
Set-Location "C:\Users\Expert Sam\Documents\MediObra"
npm ci
```

`npm ci` é recomendado quando `package-lock.json` está limpo e sincronizado. Durante desenvolvimento, quando se pretende alterar dependências:

```powershell
npm install
```

Leitor de plantas, numa instalação Windows nova:

```powershell
Set-Location "C:\Users\Expert Sam\Documents\MediObra\apps\plant-service"
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

> Na verificação actual, `python`, `py` e `psql` não estavam no `PATH` do PowerShell. O executável da `.venv` existente também devolveu “Access is denied”; a `.venv` local deve ser recriada se o problema persistir.

### Scripts do `package.json` raiz

| Script | Comando interno | Finalidade |
|---|---|---|
| `npm run dev:api` | `npm run dev --workspace=apps/api` | API com `tsx watch` |
| `npm run dev:web` | `npm run dev --workspace=apps/web` | Frontend Vite |
| `npm run build:shared` | build de `packages/shared` | Compilar tipos/schemas partilhados |
| `npm run build:api` | shared + API | Compilar backend |
| `npm run build:web` | shared + web | Compilar frontend |
| `npm run build` | shared + API + web | Build completo e ordenado |
| `npm run db:generate` | script da API | Gerar nova migração Drizzle a partir do schema |
| `npm run db:migrate` | script da API | Aplicar migrações pendentes |
| `npm run db:seed` | script da API | Semear catálogo e zonas nacionais |
| `npm run bootstrap:admin -- ...` | script da API | Criar primeiro super-administrador sem credenciais fixas no repositório |
| `npm test` | testes API e depois web | Executar a suite npm completa |

### Scripts do frontend `apps/web/package.json`

| Script | Acção |
|---|---|
| `npm run dev --workspace=apps/web` | Vite dev server |
| `npm run build --workspace=apps/web` | `tsc -b` e build Vite |
| `npm run preview --workspace=apps/web` | Pré-visualizar o build |
| `npm run test --workspace=apps/web` | Vitest |

### Scripts da API `apps/api/package.json`

| Script | Acção |
|---|---|
| `npm run dev --workspace=apps/api` | `tsx watch src/index.ts` |
| `npm run build --workspace=apps/api` | TypeScript para `dist` |
| `npm run start --workspace=apps/api` | `node dist/index.js` |
| `npm run db:generate --workspace=apps/api` | `drizzle-kit generate` |
| `npm run db:migrate --workspace=apps/api` | executar `src/db/migrate.ts` |
| `npm run db:seed --workspace=apps/api` | executar `src/db/seed.ts` |
| `npm run plant:reprocess --workspace=apps/api -- <id-ou-ficheiro>` | reprocessar uma planta |
| `npm run bootstrap:admin --workspace=apps/api -- ...` | criar administrador inicial |
| `npm run test --workspace=apps/api` | Vitest |

### Scripts do pacote partilhado

| Script | Acção |
|---|---|
| `npm run build --workspace=packages/shared` | Compilar TypeScript |
| `npm run typecheck --workspace=packages/shared` | Verificar tipos sem gerar ficheiros |

### Outros executáveis existentes fora do `package.json`

| Ficheiro/comando | Finalidade | Cuidado |
|---|---|---|
| `node apps/api/export_catalog.mjs` | Exporta catálogo global para `catalog_export.json` | O JSON gerado não está explicitamente no `.gitignore`; rever antes de executar |
| `node apps/api/import_catalog.mjs` | Importa o `catalog_export.json` para a base configurada | **Escreve na base**; confirmar ambiente e criar backup |
| `apps/plant-service/test_parser.py` | Testes directos do parser Python | Executar com o Python da `.venv` |

Os scripts de catálogo carregam `DATABASE_URL` do ambiente. Devem ser executados num contexto em que `apps/api/.env` seja carregado deliberadamente e nunca contra produção sem backup e revisão do ficheiro de entrada.

### Operações pedidas que não têm script nativo

| Operação | Estado actual | Alternativa segura |
|---|---|---|
| Iniciar todos os serviços | Não existe script raiz `dev`/`start:all` | Iniciar PostgreSQL e abrir três terminais, conforme abaixo |
| Lint | Não existe configuração ou script de lint | Usar build, typecheck e testes até ser adoptado ESLint/Biome |
| Limpar/recriar a base local | Não existe script | Fazer backup, recriar manualmente a base e aplicar migrações |
| Deploy | Não existe script nem workflow de deploy | Procedimento SSH manual da secção 7 |
| Rollback de migração | Não existe | Backup/restore ou migração correctiva |

### Build e validação

```powershell
npm run build
npm run typecheck --workspace=packages/shared
npm test
```

Não usar `npm run lint`: esse script não existe.

## 4. Serviços locais

| Serviço | Tecnologia | Comando | Porta configurada | URL/health |
|---|---|---|---:|---|
| Frontend | React 18, TypeScript, Vite 5, Tailwind 4, PWA | `npm run dev:web` | `5273` | `http://127.0.0.1:5273` |
| API | Node.js, TypeScript, Fastify 5 | `npm run dev:api` | `4100` no `.env`; fallback do código `4000` | `http://127.0.0.1:4100/api/health` |
| PostgreSQL | PostgreSQL 17 local | serviço Windows | `5432` configurada | base local `mediobra` |
| Leitor de plantas | Python, FastAPI, Uvicorn, PyMuPDF | `.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8001` | `8001` | `http://127.0.0.1:8001/health` |
| Proxy de desenvolvimento | Vite | incluído em `dev:web` | `5273` | `/api` e `/uploads` → `http://localhost:4100` |

### Ordem correcta de arranque local

1. Confirmar `apps/api/.env` sem imprimir o conteúdo.
2. Iniciar/confirmar PostgreSQL.
3. Aplicar migrações.
4. Iniciar o leitor de plantas.
5. Iniciar a API e confirmar o health check.
6. Iniciar o frontend.

```powershell
# 1 — raiz
Set-Location "C:\Users\Expert Sam\Documents\MediObra"

# 2 — PostgreSQL (PowerShell elevado apenas se for necessário iniciar o serviço)
Get-Service postgresql-17
Start-Service postgresql-17

# 3 — schema
npm run db:migrate

# 4 — Terminal A
Set-Location "C:\Users\Expert Sam\Documents\MediObra\apps\plant-service"
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8001

# 5 — Terminal B
Set-Location "C:\Users\Expert Sam\Documents\MediObra"
npm run dev:api

# 6 — Terminal C
Set-Location "C:\Users\Expert Sam\Documents\MediObra"
npm run dev:web
```

Para abrir os três processos em janelas PowerShell separadas:

```powershell
$sigoRoot = "C:\Users\Expert Sam\Documents\MediObra"
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$sigoRoot\apps\plant-service'; .\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8001"
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$sigoRoot'; npm run dev:api"
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$sigoRoot'; npm run dev:web"
```

## 5. Base de dados

### Tecnologia e caminhos

| Item | Valor |
|---|---|
| Motor | PostgreSQL |
| ORM | Drizzle ORM |
| Gerador de migrações | Drizzle Kit |
| Driver | `postgres` (`postgres-js`) |
| Schema | `apps/api/src/db/schema.ts` |
| Configuração Drizzle | `apps/api/drizzle.config.ts` |
| Migrações | `apps/api/drizzle/` |
| Migrações existentes | 28 ficheiros, `0000` a `0027` |
| Executor de migrações | `apps/api/src/db/migrate.ts` |
| Seed principal | `apps/api/src/db/seed.ts` |
| Seeds auxiliares | `apps/api/src/db/seedCatalog.ts`, `seedCompositions.ts`, `seedNationalZones.ts` |
| Bootstrap administrativo | `apps/api/src/db/bootstrapAdmin.ts` |
| Configuração privada | `apps/api/.env`, variável `DATABASE_URL` |
| Base local configurada | host `localhost`, porta `5432`, base `mediobra` |
| Base de produção | host `localhost`, porta `5432`, base `sigo` |

O seed actual **não cria contas com passwords fixas**. Apenas semeia dados partilhados de catálogo, composições e zonas. A referência a contas fixas em `deploy/README.md` está desactualizada.

### Principais tabelas

| Domínio | Tabelas |
|---|---|
| Empresas e acesso | `companies`, `subscriptions`, `users`, `sessions` |
| Catálogo | `labour_categories`, `materials`, `equipment`, `price_zones`, `material_zone_prices` |
| Composições | `cost_compositions`, `composition_labour_lines`, `composition_material_lines`, `composition_equipment_lines`, `work_item_templates` |
| Projectos e orçamento | `projects`, `budget_documents`, `budget_sections`, `line_items`, `measurement_lines` |
| Autos de medição | `measurement_certificates`, `measurement_certificate_lines` |
| Cronograma | `schedule_tasks`, `schedule_dependencies` |
| Plantas | `plants`, `extracted_rooms`, `extracted_rebar_schedules` |
| Financeiro e diário | `financial_entries`, `site_diary_entries`, `site_diary_task_progress` |
| Compras e stock | `suppliers`, `purchase_orders`, `purchase_order_lines`, `stock_movements` |
| Cotações por fornecedor | `supplier_material_prices`, `supplier_labour_prices`, `supplier_equipment_prices` |

### Relações principais

- Uma `company` agrega subscrição, utilizadores, catálogo próprio/global, zonas, composições, projectos e fornecedores.
- Um `user` possui sessões; utilizadores também são referenciados como criadores de movimentos e registos operacionais.
- `materials` e `price_zones` relacionam-se através de `material_zone_prices`.
- Uma `cost_composition` agrega linhas de mão-de-obra, materiais e equipamento.
- Um `work_item_template` pode apontar para uma composição; um `line_item` também pode manter essa ligação.
- Um `project` pertence a uma empresa e pode usar uma zona de preço.
- `project` → `budget_documents` → `budget_sections` → `line_items` → `measurement_lines`.
- `measurement_certificates` pertencem ao projecto/documento e agregam linhas ligadas aos itens do orçamento.
- `schedule_tasks` pertencem ao projecto; `schedule_dependencies` ligam tarefas predecessoras e sucessoras.
- `plants` pertencem ao projecto e agregam compartimentos e mapas de aço extraídos.
- O diário liga progresso real a tarefas do cronograma através de `site_diary_task_progress`.
- Ordens de compra ligam projecto, fornecedor, tarefa e linhas de material; movimentos de stock podem ligar ordem de compra e diário.
- Preços de fornecedor ligam fornecedor, recurso e, opcionalmente, zona de preço.
- A maior parte das entidades-filhas usa `ON DELETE CASCADE`; algumas referências operacionais usam `SET NULL`. Confirmar sempre o schema antes de apagar entidades-pai.

### Migrações

Gerar uma migração depois de alterar `schema.ts`:

```powershell
npm run db:generate
git status --short
```

Aplicar localmente:

```powershell
npm run db:migrate
```

Aplicar com segurança em produção, depois de backup e build validado:

```bash
cd /home/sigo/htdocs/sud30s.org
source "$HOME/.nvm/nvm.sh"
git status --short
set -a
. apps/api/.env
set +a
pg_dump "$DATABASE_URL" --format=custom --file="$HOME/backups/sigo-pre-migrate-$(date +%Y%m%d-%H%M%S).dump"
npm run db:migrate
```

> Não executar `db:seed` automaticamente em cada deploy. É idempotente por intenção, mas deve ser tratado como uma operação de dados deliberada.

### Backup local

Este comando lê `DATABASE_URL` para memória sem a imprimir e guarda o backup fora do repositório:

```powershell
Set-Location "C:\Users\Expert Sam\Documents\MediObra"
$databaseUrlLine = Get-Content apps/api/.env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
$databaseUrl = $databaseUrlLine.Substring('DATABASE_URL='.Length)
$backupDir = Join-Path $env:USERPROFILE 'SIGO Backups'
New-Item -ItemType Directory -Force $backupDir | Out-Null
$backupFile = Join-Path $backupDir ("sigo-local-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
pg_dump --dbname=$databaseUrl --format=custom --file=$backupFile
Remove-Variable databaseUrl,databaseUrlLine
Write-Host $backupFile
```

### Backup em produção

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_siga_codex" -o IdentitiesOnly=yes sigo@187.127.95.179
```

Já dentro da VPS:

```bash
cd /home/sigo/htdocs/sud30s.org
mkdir -p "$HOME/backups"
chmod 700 "$HOME/backups"
set -a
. apps/api/.env
set +a
umask 077
pg_dump "$DATABASE_URL" --format=custom --file="$HOME/backups/sigo-$(date +%Y%m%d-%H%M%S).dump"
```

Não guardar dumps dentro do repositório.

### Restaurar um backup

Restauração sobre uma base existente é destrutiva. Parar escritas, criar um backup imediatamente antes e confirmar que o destino não é produção por engano.

Local, sobre a base configurada:

```powershell
Set-Location "C:\Users\Expert Sam\Documents\MediObra"
$databaseUrlLine = Get-Content apps/api/.env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
$databaseUrl = $databaseUrlLine.Substring('DATABASE_URL='.Length)
pg_restore --dbname=$databaseUrl --clean --if-exists --no-owner "C:\CAMINHO\backup.dump"
Remove-Variable databaseUrl,databaseUrlLine
npm run db:migrate
```

Em produção, preferir restaurar primeiro numa **nova base de validação** e só trocar `DATABASE_URL` depois de verificar integridade. Uma restauração directa exige janela de manutenção, paragem da API, backup final e aprovação explícita.

### Limpar e recriar apenas a base local

Não existe script npm para esta operação. O bloco abaixo apaga a base indicada no `.env` local, recria-a, aplica migrações e volta a semear o catálogo. **Não executar na VPS nem quando `DATABASE_URL` aponta para produção.**

```powershell
Set-Location "C:\Users\Expert Sam\Documents\MediObra"
$line = Get-Content apps/api/.env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
$databaseUrl = $line.Substring('DATABASE_URL='.Length)
$dbUri = [uri]$databaseUrl
$dbName = $dbUri.AbsolutePath.TrimStart('/')
$dbUserParts = $dbUri.UserInfo -split ':',2
$dbUser = [uri]::UnescapeDataString($dbUserParts[0])
$env:PGPASSWORD = [uri]::UnescapeDataString($dbUserParts[1])

if ($dbUri.Host -notin @('localhost','127.0.0.1')) { throw "Recusado: a base não é local." }
dropdb --host=$dbUri.Host --port=$dbUri.Port --username=$dbUser --force --if-exists $dbName
createdb --host=$dbUri.Host --port=$dbUri.Port --username=$dbUser $dbName

Remove-Item Env:PGPASSWORD
Remove-Variable databaseUrl,line,dbUri,dbName,dbUserParts,dbUser
npm run db:migrate
npm run db:seed
```

### DBeaver — base local

| Campo | Valor |
|---|---|
| Driver | PostgreSQL |
| Host | `localhost` |
| Porta | `5432` |
| Database | `mediobra` |
| Username | componente de utilizador de `DATABASE_URL` em `apps/api/.env` |
| Password | componente de password de `DATABASE_URL` em `apps/api/.env` |
| SSL | desactivado, salvo configuração local diferente |

Na auditoria, o serviço Windows aparecia activo, mas `5432` não apareceu como listener. Confirmar antes de abrir o DBeaver.

### DBeaver — produção por túnel SSH

Abrir e manter este terminal local:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_siga_codex" -o IdentitiesOnly=yes -N -L 55432:127.0.0.1:5432 sigo@187.127.95.179
```

Configurar DBeaver:

| Campo | Valor |
|---|---|
| Driver | PostgreSQL |
| Host | `127.0.0.1` |
| Porta | `55432` |
| Database | `sigo` |
| Username/password | ler localmente da variável `DATABASE_URL` em `/home/sigo/htdocs/sud30s.org/apps/api/.env`; não copiar para este relatório |
| SSL PostgreSQL | desactivado; o túnel SSH já cifra o transporte |

## 6. Produção e VPS

### Inventário confirmado

| Item | Valor/estado |
|---|---|
| SSH | `sigo@187.127.95.179:22` |
| Chave privada local de operação | `C:\Users\Expert Sam\.ssh\id_ed25519_siga_codex` — caminho apenas |
| Chave GitHub local separada | `C:\Users\Expert Sam\.ssh\id_ed25519_siga_github` — caminho apenas |
| Chave de deploy GitHub na VPS | `/home/sigo/.ssh/github_deploy_key` — caminho apenas |
| Projecto | `/home/sigo/htdocs/sud30s.org` |
| Branch | `main` |
| Git | `2.43.0` |
| Node via NVM | `22.23.1` |
| npm | `10.9.8` |
| Python | `3.12.3` na `.venv` |
| PostgreSQL | cliente/servidor da série 16; serviço activo |
| PM2 | `sigo-api` online e `sigo-plant-service` online |
| systemd | `sigo-plant-service.service` habilitado, porém inactivo |
| CloudPanel | CLI `6.0.8` |
| API | `0.0.0.0:4100`, health interno OK |
| Leitor | `127.0.0.1:8001`, health interno OK |
| PostgreSQL | `127.0.0.1:5432` e `::1:5432` |
| Exposição externa testada | 22, 80 e 443 acessíveis; 4100 e 8001 bloqueadas |

### Arquitectura de produção

```text
Internet
   │ HTTPS 443
   ▼
CloudPanel / reverse proxy
   │
   ▼
Node + Fastify :4100 (PM2: sigo-api)
   ├── /api/*
   ├── /uploads/logos/* e /uploads/avatars/*
   └── apps/web/dist/* + fallback SPA

Fastify ──► FastAPI/Uvicorn 127.0.0.1:8001
Fastify ──► PostgreSQL 127.0.0.1:5432
```

A configuração exacta do vhost CloudPanel não pôde ser lida com o utilizador `sigo`. A versão e o encaminhamento funcional foram confirmados; o ficheiro efectivo do vhost requer acesso administrativo do CloudPanel/root.

O ficheiro `deploy/nginx.sigo.conf` é uma referência genérica antiga e **não deve ser copiado por cima da configuração CloudPanel actual**.

### Ver estado

```bash
ssh -i ~/.ssh/id_ed25519_siga_codex -o IdentitiesOnly=yes sigo@187.127.95.179
cd /home/sigo/htdocs/sud30s.org
source "$HOME/.nvm/nvm.sh"
git status --short
git branch --show-current
pm2 status
systemctl status sigo-plant-service.service --no-pager
systemctl status postgresql --no-pager
ss -ltn | grep -E ':(4100|8001|5432)[[:space:]]'
curl -fsS http://127.0.0.1:4100/api/health
curl -fsS http://127.0.0.1:8001/health
```

### Ver logs

```bash
source "$HOME/.nvm/nvm.sh"
pm2 logs sigo-api --lines 100 --nostream
pm2 logs sigo-plant-service --lines 100 --nostream
journalctl -u sigo-plant-service.service -n 100 --no-pager
journalctl -u postgresql -n 100 --no-pager
```

Os logs podem conter nomes de ficheiros, caminhos de plantas, IDs, erros e dados pessoais. Não os copiar integralmente para tickets ou chats públicos.

### Reiniciar serviços

Estado operacional actual:

```bash
source "$HOME/.nvm/nvm.sh"
pm2 restart sigo-api --update-env
pm2 restart sigo-plant-service --update-env
```

Estado pretendido pelo repositório, depois de padronizar a supervisão do leitor:

```bash
source "$HOME/.nvm/nvm.sh"
pm2 restart sigo-api --update-env
sudo systemctl restart sigo-plant-service.service
```

> Não executar simultaneamente o leitor no PM2 e systemd. Escolher um supervisor. A recomendação do repositório é systemd para Python e PM2 para Node.

### Deploy manual real e seguro

Antes do deploy, a branch `main` deve receber a alteração por merge/revisão. Na VPS:

```bash
ssh -i ~/.ssh/id_ed25519_siga_codex -o IdentitiesOnly=yes sigo@187.127.95.179
cd /home/sigo/htdocs/sud30s.org
source "$HOME/.nvm/nvm.sh"

# 1. A árvore deve estar limpa. Parar se houver saída.
git status --short

# 2. Guardar identificação e backup.
git rev-parse HEAD
mkdir -p "$HOME/backups"
chmod 700 "$HOME/backups"
set -a
. apps/api/.env
set +a
umask 077
pg_dump "$DATABASE_URL" --format=custom --file="$HOME/backups/sigo-pre-deploy-$(date +%Y%m%d-%H%M%S).dump"

# 3. Actualizar apenas por fast-forward.
git fetch origin
git pull --ff-only origin main

# 4. Instalar, validar, migrar e publicar.
npm ci
npm run build
npm run db:migrate
pm2 reload deploy/ecosystem.config.cjs --only sigo-api --update-env

# 5. Reiniciar o leitor apenas se Python/requirements mudou.
pm2 restart sigo-plant-service --update-env

# 6. Verificar.
curl -fsS http://127.0.0.1:4100/api/health
curl -fsS http://127.0.0.1:8001/health
curl -fsS https://sud30s.org/api/health
pm2 save
```

O passo `git status --short` actualmente **não está limpo em produção** por causa de `package-lock.json`. Resolver isso antes do próximo deploy; não usar `git reset --hard` como solução automática.

### Rollback seguro

Antes de cada deploy, registar o SHA anterior e criar backup. Para um problema apenas de aplicação:

```bash
cd /home/sigo/htdocs/sud30s.org
source "$HOME/.nvm/nvm.sh"

# Substituir pelo SHA previamente registado e validado.
GOOD_COMMIT=<SHA_CONFIRMADO>
git branch "safety/before-rollback-$(date +%Y%m%d-%H%M%S)" HEAD
git switch --detach "$GOOD_COMMIT"
npm ci
npm run build
pm2 reload deploy/ecosystem.config.cjs --only sigo-api --update-env
curl -fsS http://127.0.0.1:4100/api/health
```

Depois da estabilização, criar um `git revert` na branch `main`, fazer revisão e voltar a colocar a VPS em `main`. Não reescrever o histórico remoto.

Se o deploy aplicou uma migração incompatível:

- não assumir que voltar o código reverte a base;
- preferir uma migração correctiva para a frente;
- restaurar backup apenas em janela de manutenção, sabendo que transacções posteriores ao backup podem ser perdidas;
- validar o dump numa base separada antes de substituir produção.

## 7. Git, GitHub e deploy

### Estado Git

| Item | Estado |
|---|---|
| Repositório | GitHub por SSH |
| Remoto `origin` | `git@github.com:samuellicenga23-oss/Sistema-de-constru-o-civil-para-Mo-ambique.git` |
| Branch principal | `main` |
| Branch local actual | `codex/siga-visual-refresh` |
| Produção | `main`, alinhada com `origin/main` na auditoria |
| GitHub Actions | Existe `.github/workflows/ci.yml` |
| Deploy automático | Não existe |

### Workflow existente

O workflow `CI` executa em `push` para `main` e `feature/**`, e em `pull_request`:

1. Ubuntu;
2. PostgreSQL 16 como serviço;
3. Node.js 20;
4. `npm ci`;
5. build completo;
6. typecheck do pacote partilhado;
7. `db:generate` e verificação de que schema/migrações estão sincronizados;
8. aplicação das migrações;
9. testes da API;
10. testes do frontend;
11. `npm audit` informativo.

O workflow não faz SSH, não reinicia PM2 e não publica na VPS.

### Comandos de trabalho diário

```powershell
Set-Location "C:\Users\Expert Sam\Documents\MediObra"
git status --short --branch
git fetch origin
git pull --ff-only
git diff
git add <ficheiros-confirmados>
git commit -m "tipo: descrição clara da alteração"
git push origin HEAD
```

Para actualizar `main`, usar merge/PR e só depois fazer deploy. Não fazer push directo de uma branch de trabalho para produção sem revisão.

### Ficheiros que nunca devem ser enviados ao Git

- `apps/api/.env`
- `apps/api/.env.test`
- qualquer `.env.local` adicional
- `apps/api/uploads/` e documentos de clientes
- `apps/plant-service/.venv/`
- chaves em `C:\Users\Expert Sam\.ssh\`
- chaves em `/home/sigo/.ssh/`
- backups `.dump`, `.sql`, `.sql.gz`
- cookies exportados, tokens, ficheiros OAuth e credenciais de cloud
- logs com dados pessoais ou payloads de erro

### `.gitignore` actual

```gitignore
node_modules/
dist/
build/
.env
.env.local
.env.test
*.log
*.log.error
uploads/
.venv/
__pycache__/
*.pyc
*.tsbuildinfo
```

Recomenda-se acrescentar numa alteração futura revista:

```gitignore
backups/
*.dump
*.sql.gz
*.bak
.DS_Store
Thumbs.db
```

Não ignorar genericamente todas as migrações `.sql`, porque `apps/api/drizzle/*.sql` deve permanecer versionado.

## 8. Aplicações, linguagens e ferramentas

| Ferramenta/tecnologia | Papel no SIGO | Estado observado |
|---|---|---|
| VS Code/Codex | Edição e operação do workspace | Ferramenta de desenvolvimento; instalação do VS Code não auditada |
| DBeaver | Administração gráfica PostgreSQL | Compatível; instalação local não auditada |
| PowerShell | Terminal principal no Windows | Confirmado |
| Git | Versionamento | Local `2.55.0.windows.1`; VPS `2.43.0` |
| GitHub | Remoto e CI | Confirmado |
| Node.js | API e toolchain web | Local `24.18.0`; VPS `22.23.1`; CI Node 20 |
| npm workspaces | Gestão do monorepo | Local npm `11.16.0`; VPS npm `10.9.8` |
| TypeScript/TSX | Frontend, API e pacote partilhado | Confirmado |
| React 18 | Interface | Confirmado |
| Vite 5 | Dev/build web | Confirmado |
| Tailwind CSS 4 + CSS | Estilos e responsividade | Confirmado |
| Fastify 5 | API HTTP | Confirmado |
| PostgreSQL | Base relacional | Local serviço 17; produção 16 |
| Drizzle ORM/Kit | Schema, queries e migrações | Confirmado |
| Python 3 | Leitor de plantas | Não disponível no PATH local; produção `3.12.3` |
| FastAPI/Uvicorn | API interna do leitor | Confirmado |
| PyMuPDF | Interpretação/renderização de PDFs | Confirmado |
| ExcelJS | Exportação Excel | Confirmado |
| Puppeteer/Chromium | Geração de PDFs/relatórios | Confirmado |
| Vitest/Testing Library | Testes | Confirmado |
| PM2 | Supervisão da API; actualmente também do leitor | Confirmado na VPS |
| systemd | Supervisão prevista do leitor e PostgreSQL | Confirmado na VPS |
| CloudPanel | Site, certificado e reverse proxy | Confirmado `6.0.8` |
| GitHub Actions | CI | Confirmado |
| Bash | Operação da VPS | Confirmado |

### Risco de versões divergentes

Há três versões principais de Node no fluxo: local 24, VPS 22 e CI 20. O projecto deve declarar uma versão suportada em `.nvmrc` e/ou `package.json#engines`, idealmente alinhada com produção e CI. Até essa decisão, testar sempre no CI antes do deploy.

## 9. URLs úteis

| Destino | URL | Estado |
|---|---|---|
| Frontend local | `http://127.0.0.1:5273` | Configurado; serviço parado durante a auditoria |
| API local | `http://127.0.0.1:4100` | Configurado; serviço parado durante a auditoria |
| Health API local | `http://127.0.0.1:4100/api/health` | Configurado |
| Leitor local | `http://127.0.0.1:8001` | Configurado; serviço parado durante a auditoria |
| Health leitor local | `http://127.0.0.1:8001/health` | Configurado |
| Website de produção | `https://sud30s.org` | Activo |
| Health de produção | `https://sud30s.org/api/health` | Activo |
| GitHub | `https://github.com/samuellicenga23-oss/Sistema-de-constru-o-civil-para-Mo-ambique` | Confirmado pelo remoto |
| CloudPanel | URL administrativa não documentada/confirmada | Não incluir URL presumida |

`http://127.0.0.1:5173` aparece num documento antigo, mas **não é a porta actual do Vite**. Deve constar no Control Center apenas como verificação de conflito/porta legada.

## 10. Ficheiros importantes

| Caminho | Função | Ambiente | Risco de alteração |
|---|---|---|---|
| `package.json` | Workspaces e scripts globais | Todos | **Alto** — afecta todo o build |
| `package-lock.json` | Resolução exacta de dependências | Todos/CI | **Alto** — deve permanecer sincronizado e limpo |
| `apps/web/` | Aplicação React, páginas, componentes, CSS e PWA | Dev/build/produção | Alto |
| `apps/web/vite.config.ts` | Porta 5273, proxy, PWA e build | Desenvolvimento/build | Alto |
| `apps/api/` | Backend Fastify, regras, rotas, exportações | Todos | **Crítico** |
| `apps/api/src/app.ts` | Registo das rotas, CORS, uploads, health e frontend estático | API/produção | **Crítico** |
| `apps/api/src/env.ts` | Validação e defaults de ambiente | API/produção | **Crítico** |
| `apps/api/src/db/schema.ts` | Fonte do schema PostgreSQL | Todos | **Crítico** — exige migração |
| `apps/api/drizzle/` | Histórico SQL de migrações | Todos/produção | **Crítico** — não editar migrações aplicadas |
| `apps/api/src/db/migrate.ts` | Executor de migrações | Todos | Crítico |
| `apps/api/src/db/seed.ts` | Orquestra catálogo e zonas | Inicialização controlada | Alto |
| `apps/api/.env.example` | Lista pública de configuração esperada | Referência | Médio; nunca incluir valores reais |
| `apps/api/.env.test.example` | Modelo de testes | CI/dev | Médio |
| `apps/api/.env` | Segredos e endpoints reais locais/produção | Privado | **Crítico e sensível** |
| `apps/api/uploads/` | Logos, avatares, plantas e dados operacionais | Runtime | **Crítico; dados de clientes** |
| `apps/plant-service/` | Análise de plantas e PDF | Todos | **Crítico para medições** |
| `apps/plant-service/main.py` | Endpoints e autenticação interna | Runtime Python | Crítico |
| `apps/plant-service/parser.py` | Regras de leitura e classificação | Runtime Python | Crítico |
| `apps/plant-service/requirements.txt` | Dependências Python | Build/deploy | Alto |
| `packages/shared/` | Zod e tipos partilhados | Web/API | Alto |
| `deploy/ecosystem.config.cjs` | Processo PM2 da API e caminho da VPS | Produção | **Crítico** |
| `deploy/sigo-plant-service.service` | Unidade systemd prevista | Produção | **Crítico** |
| `deploy/nginx.sigo.conf` | Template Nginx legado | Referência | Alto; não substituir vhost CloudPanel |
| `deploy/README.md` | Guia antigo de VPS | Documentação | Alto risco de induzir procedimento errado |
| `.github/workflows/ci.yml` | Build, migrações e testes CI | GitHub Actions | Alto |
| `.gitignore` | Bloqueio de ficheiros sensíveis/gerados | Git | **Crítico de segurança** |
| `CHANGELOG_DEV.md` | Continuidade entre Codex, Claude e equipa | Desenvolvimento | Médio; manter actualizado e sem segredos |
| `ACESSO_TECNICO.md` | Guia de acessos sem credenciais | Operação | Médio; porta frontend está desactualizada |
| `SIGO_CONTROL_CENTER_INVENTARIO.md` | Fonte do futuro Control Center | Documentação | Alto; não inserir segredos |

## 11. Diagnóstico — comandos prontos

### Versões locais

```powershell
node --version
npm --version
python --version
py --version
psql --version
git --version
```

Resultado da auditoria: Node `24.18.0`, npm `11.16.0`, Git `2.55.0.windows.1`; Python/launcher e `psql` não estavam no PATH.

### Portas locais 5173, 5273, 4100, 8001 e 5432

```powershell
foreach ($port in 5173,5273,4100,8001,5432) {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($listeners) {
    $listeners | Select-Object LocalAddress,LocalPort,OwningProcess
  } else {
    Write-Host "${port}: sem listener"
  }
}
```

Identificar processos:

```powershell
$ports = 5173,5273,4100,8001,5432
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object LocalPort -in $ports |
  ForEach-Object {
    $process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    [pscustomobject]@{ Porta=$_.LocalPort; PID=$_.OwningProcess; Processo=$process.ProcessName }
  }
```

### PostgreSQL local

```powershell
Get-Service postgresql-17
Test-NetConnection 127.0.0.1 -Port 5432
```

Testar a base sem imprimir a ligação:

```powershell
$line = Get-Content apps/api/.env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
$databaseUrl = $line.Substring('DATABASE_URL='.Length)
psql $databaseUrl -c "select current_database(), now();"
Remove-Variable databaseUrl,line
```

### HTTP local

```powershell
Invoke-WebRequest http://127.0.0.1:5273 -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:4100/api/health
Invoke-RestMethod http://127.0.0.1:8001/health
```

### Versões e portas na VPS

```bash
source "$HOME/.nvm/nvm.sh"
node --version
npm --version
git --version
/home/sigo/htdocs/sud30s.org/apps/plant-service/.venv/bin/python --version
psql --version
ss -ltnp | grep -E ':(4100|8001|5432)[[:space:]]'
```

### PM2, systemd e health na VPS

```bash
source "$HOME/.nvm/nvm.sh"
pm2 status
pm2 describe sigo-api
pm2 describe sigo-plant-service
systemctl is-enabled sigo-plant-service.service
systemctl is-active sigo-plant-service.service
systemctl is-active postgresql
curl -fsS http://127.0.0.1:4100/api/health
curl -fsS http://127.0.0.1:8001/health
curl -fsS https://sud30s.org/api/health
```

## 12. Segurança

### Caminhos sensíveis

| Caminho | Conteúdo/risco |
|---|---|
| `C:\Users\Expert Sam\Documents\MediObra\apps\api\.env` | Ligação DB e segredos de runtime local |
| `C:\Users\Expert Sam\Documents\MediObra\apps\api\.env.test` | Configuração privada de testes |
| `C:\Users\Expert Sam\Documents\MediObra\apps\api\uploads\` | Documentos e media de clientes |
| `C:\Users\Expert Sam\Documents\MediObra\apps\plant-service\*.log` | Erros e metadados de processamento |
| `C:\Users\Expert Sam\.ssh\id_ed25519_siga_codex` | Chave privada operacional |
| `C:\Users\Expert Sam\.ssh\id_ed25519_siga_github` | Chave privada GitHub |
| `/home/sigo/htdocs/sud30s.org/apps/api/.env` | Segredos de produção |
| `/home/sigo/htdocs/sud30s.org/apps/api/uploads/` | Dados persistentes de produção |
| `/home/sigo/.ssh/github_deploy_key` | Chave privada de deploy GitHub |
| `/home/sigo/.ssh/authorized_keys` | Autorização SSH |
| `/home/sigo/backups/` | Dumps completos da base |
| `/home/sigo/.pm2/logs/` | Logs de processos |

### Variáveis reconhecidas, sem valores

| Variável | Obrigatoriedade/função | Onde guardar |
|---|---|---|
| `DATABASE_URL` | Obrigatória; PostgreSQL | `apps/api/.env` |
| `PORT` | Porta da API; produção usa 4100 | `apps/api/.env` |
| `SESSION_COOKIE_SECRET` | Obrigatória e forte em produção | `apps/api/.env` |
| `PLANT_SERVICE_URL` | URL interna do leitor | `apps/api/.env` |
| `PLANT_SERVICE_TOKEN` | Obrigatória na API em produção; deve coincidir com o serviço Python | ambiente privado dos dois serviços |
| `UPLOADS_DIR` | Directório persistente | `apps/api/.env` |
| `CORS_ORIGIN` | Origens web permitidas | `apps/api/.env` |
| `NODE_ENV` | Deve ser `production` na VPS | PM2/ambiente |
| `GOOGLE_CLIENT_ID` | OAuth Google opcional | `apps/api/.env` |
| `GOOGLE_CLIENT_SECRET` | OAuth Google opcional e sensível | `apps/api/.env` |
| `GOOGLE_REDIRECT_URI` | OAuth Google opcional | `apps/api/.env` |
| `FRONTEND_URL` | Redireccionamentos/origem web | `apps/api/.env` |
| `ENVIRONMENT` | Activa exigência de token no serviço Python quando `production` | ambiente privado do plant-service |

O ficheiro systemd versionado não declara `EnvironmentFile`. Não foi inspeccionado o ambiente efectivo do processo PM2 para evitar expor segredos. Portanto, **não ficou confirmado** que o leitor esteja actualmente a validar `PLANT_SERVICE_TOKEN`.

### Credenciais que devem ser trocadas

Sem reproduzir valores, devem ser rodadas:

1. qualquer password de root/VPS anteriormente partilhada em conversa ou mensagem;
2. password do utilizador de alojamento se alguma vez foi partilhada;
3. passwords de contas administrativas e de demonstração anteriormente transmitidas fora de um gestor de passwords;
4. password da base de dados se foi reutilizada, partilhada ou tem origem incerta;
5. `SESSION_COOKIE_SECRET` se alguma versão foi exposta;
6. `PLANT_SERVICE_TOKEN`, instalando o mesmo valor secreto nos dois processos sem o guardar no Git;
7. chaves SSH se a parte privada alguma vez saiu das máquinas autorizadas;
8. segredos OAuth quando forem configurados, caso tenham sido enviados por chat ou commit.

Depois da rotação, invalidar sessões existentes quando aplicável.

### Permissões recomendadas na VPS

```bash
chmod 700 /home/sigo/.ssh
chmod 600 /home/sigo/.ssh/authorized_keys
chmod 600 /home/sigo/.ssh/github_deploy_key
chmod 600 /home/sigo/htdocs/sud30s.org/apps/api/.env
chmod 700 /home/sigo/backups
find /home/sigo/backups -type f -exec chmod 600 {} \;
```

Aplicar permissões a `uploads` conforme o utilizador real do processo, sem remover a escrita necessária à API. Não usar `chmod 777`.

### Riscos actuais e medidas

| Risco | Severidade | Medida recomendada |
|---|---|---|
| `package-lock.json` modificado na VPS | Alta | Identificar diff, arquivar se necessário e devolver o checkout a estado limpo antes do deploy |
| Leitor em PM2 mas unit systemd habilitada/inactiva | Alta | Escolher um supervisor, activar persistência e testar reboot controlado |
| Token do leitor não confirmado | Alta | Configurar `ENVIRONMENT=production` e `PLANT_SERVICE_TOKEN` no serviço Python; testar autenticação |
| API ligada a `0.0.0.0` | Média/alta | Ligar a `127.0.0.1`; manter 4100 bloqueada na firewall |
| Documentação de deploy antiga | Alta | Actualizar ou marcar `deploy/README.md` como legado |
| Portas/versões divergentes entre docs, local, CI e VPS | Média | Fixar Node e actualizar `ACESSO_TECNICO.md` |
| Sem backup/retention confirmados | Alta | Implementar backups automáticos, retenção e teste periódico de restore |
| Dumps não ignorados explicitamente | Média | Acrescentar padrões ao `.gitignore` e guardar fora do repo |
| Sem deploy automatizado ou release tags | Média | Adoptar PR, tag, backup e checklist de deploy |
| Sem migrações reversíveis | Alta | Migrações pequenas/compatíveis e estratégia forward-fix |
| Uploads e logs com dados de obras | Alta | Acesso mínimo, backups cifrados e proibição de partilha pública |

### Antes de mexer em produção

1. Confirmar alvo, branch e SHA.
2. Exigir `git status --short` limpo.
3. Fazer backup e validar que o ficheiro tem tamanho plausível.
4. Confirmar espaço em disco.
5. Executar CI/build/testes.
6. Rever SQL da nova migração.
7. Definir janela de manutenção para alterações incompatíveis.
8. Registar SHA anterior e plano de rollback.
9. Não editar `.env` por cópia/cola em chats.
10. Depois do deploy, testar health, login, upload/leitura de planta e uma operação crítica sem alterar dados reais indevidamente.

## 13. Informações não confirmadas

- URL exacta do painel administrativo CloudPanel.
- Caminho e conteúdo efectivo do vhost CloudPanel; o utilizador `sigo` não tinha leitura dessa configuração.
- Política actual de firewall além dos testes externos realizados.
- Existência, frequência, retenção, cifragem e testes de backups automáticos.
- Se `PLANT_SERVICE_TOKEN` está activo no processo Python actual.
- Persistência do processo `sigo-plant-service` após reboot, pois não constou claramente no dump PM2 e o systemd está inactivo.
- Instalação local do DBeaver e VS Code.
- Motivo exacto pelo qual PostgreSQL local estava activo sem listener observável em 5432.
- Motivo da `.venv` Windows devolver “Access is denied”; recomenda-se recriá-la.
- Estado da última execução do workflow no GitHub e regras de protecção da branch `main`.
- Permissão exacta da chave GitHub/deploy para todos os repositórios; o remoto configurado foi confirmado.
- Exposição externa de 5432 não completou o teste por timeout; internamente o PostgreSQL está ligado apenas a loopback, o que é o comportamento correcto.
- Política de rotação de segredos e validade das credenciais previamente partilhadas.

## 14. Dados recomendados para o futuro SIGO Control Center HTML

O painel HTML deve representar estes blocos sem guardar segredos:

| Bloco | Campos seguros |
|---|---|
| Projecto | nome, paths, branch, remoto, SHA, estado da árvore |
| Serviços | nome, supervisor, porta, bind, status, uptime e health |
| Base | motor, host público/não público, porta, nome, última migração e último backup; nunca password |
| Deploy | branch, SHA actual/anterior, data, operador, resultado CI e health pós-deploy |
| Segurança | ficheiros esperados, permissões, data de rotação sem mostrar o segredo |
| Diagnóstico | versões e resultados dos checks |
| Alertas | checkout sujo, serviço inactivo, porta indevida, backup vencido, CI falhado |

O Control Center deve executar operações destrutivas apenas mediante confirmação forte, mostrar primeiro o alvo exacto e gerar um registo de auditoria. Tokens e passwords devem permanecer num gestor de segredos ou no ambiente do servidor, nunca no HTML, `localStorage`, logs ou resposta da API.

---

### Resumo para continuidade Codex/Claude

- Monorepo npm workspaces com web, API e shared; leitor Python separado.
- Frontend local real: `5273`.
- Produção: CloudPanel → Fastify `4100`; Fastify serve `apps/web/dist`.
- Leitor: FastAPI `8001`; actualmente PM2, enquanto systemd está habilitado/inactivo.
- PostgreSQL local configurado como `mediobra`; produção `sigo`.
- CI existe; deploy continua manual.
- Resolver checkout sujo da VPS, padronizar supervisor do leitor, confirmar token interno e actualizar documentação antes de automatizar deploys.
