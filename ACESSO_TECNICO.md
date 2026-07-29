# SIGO — acesso técnico, base de dados e tecnologias

Este documento descreve como entrar no projecto e na base de dados sem colocar passwords,
tokens ou chaves privadas no Git. As credenciais permanecem nos ficheiros `.env`, que não devem
ser enviados ao repositório nem copiados para mensagens.

## 1. Endereços e directórios

### Desenvolvimento local (Windows)

- Projecto: `C:\Users\Expert Sam\Documents\MediObra`
- Frontend: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:4100`
- Saúde da API: `http://127.0.0.1:4100/api/health`
- Leitor de plantas: `http://127.0.0.1:8001`
- Configuração privada da API: `apps/api/.env`
- Modelo de configuração: `apps/api/.env.example`

### Produção

- Website: `https://sud30s.org`
- Saúde pública da API: `https://sud30s.org/api/health`
- SSH: utilizador `sigo`, servidor `187.127.95.179`, porta `22`
- Projecto: `/home/sigo/htdocs/sud30s.org`
- Branch de produção: `main`
- Configuração privada: `/home/sigo/htdocs/sud30s.org/apps/api/.env`

Ligação SSH a partir deste computador:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_siga_codex" -o IdentitiesOnly=yes sigo@187.127.95.179
```

## 2. Base de dados local

O SIGO usa PostgreSQL. A ligação completa está na variável `DATABASE_URL` de `apps/api/.env`.
O formato é:

```text
postgres://UTILIZADOR:PASSWORD@SERVIDOR:PORTA/BASE_DE_DADOS
```

Por omissão, o exemplo local usa `localhost`, porta `5432` e base `sigo`. Confirme sempre o
ficheiro local antes de ligar; não copie a password para este documento.

### Entrar com `psql` no PowerShell

```powershell
Set-Location "C:\Users\Expert Sam\Documents\MediObra"
$databaseUrlLine = Get-Content apps/api/.env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
$databaseUrl = $databaseUrlLine.Substring('DATABASE_URL='.Length)
psql $databaseUrl
```

Comandos úteis dentro do `psql`:

```sql
\conninfo
\dt
\d projects
SELECT id, name, status, created_at FROM projects ORDER BY created_at DESC LIMIT 20;
\q
```

### Ferramenta gráfica

Pode usar DBeaver, pgAdmin ou DataGrip. Leia o `DATABASE_URL` e preencha separadamente:

- Host: normalmente `localhost`
- Porta: normalmente `5432`
- Database: normalmente `sigo`
- User e password: valores do `apps/api/.env`
- SSL local: desactivado, salvo se a sua instalação PostgreSQL tiver configuração diferente

## 3. Base de dados no servidor

A base de produção não está exposta directamente à Internet. Entre primeiro na VPS:

```bash
ssh sigo@187.127.95.179
cd /home/sigo/htdocs/sud30s.org
set -a
. apps/api/.env
set +a
psql "$DATABASE_URL"
```

Para consultas de diagnóstico:

```sql
\conninfo
\dt
SELECT now();
SELECT id, name, status, created_at FROM projects ORDER BY created_at DESC LIMIT 20;
```

Antes de qualquer alteração manual em produção, crie um backup:

```bash
mkdir -p /home/sigo/backups
pg_dump "$DATABASE_URL" --format=custom --file=/home/sigo/backups/sigo-manual-backup.dump
```

Não execute `UPDATE`, `DELETE`, `DROP`, seeds ou migrações manuais em produção sem confirmar o
alvo e possuir um backup recente. As alterações normais devem passar pela API e pelas migrações.

### Aceder à produção numa ferramenta gráfica

Abra um túnel SSH no computador local e mantenha o terminal aberto:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_siga_codex" -o IdentitiesOnly=yes -N -L 55432:127.0.0.1:5432 sigo@187.127.95.179
```

Depois configure o DBeaver/pgAdmin/DataGrip com:

- Host: `127.0.0.1`
- Porta: `55432`
- Database, user e password: os valores do `DATABASE_URL` de produção
- SSL da ligação PostgreSQL: desactivado; o transporte já está protegido pelo túnel SSH

## 4. Arranque local

Na raiz do projecto:

```powershell
npm install
npm run db:migrate
```

Terminal 1 — API:

```powershell
npm run dev:api
```

Terminal 2 — frontend:

```powershell
npm run dev:web
```

Terminal 3 — leitor de plantas:

```powershell
Set-Location apps/plant-service
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

## 5. Serviços em produção

- `sigo-api`: Node.js/Fastify, supervisionado pelo PM2, porta interna `4100`
- `sigo-plant-service`: Python/FastAPI, normalmente supervisionado pelo systemd, porta interna `8001`
- PostgreSQL: porta interna `5432`
- CloudPanel encaminha o domínio HTTPS para a aplicação Node; a API também serve o build do frontend

Verificação sem alterar dados:

```bash
pm2 status
systemctl status sigo-plant-service
curl http://127.0.0.1:4100/api/health
curl http://127.0.0.1:8001/health
```

## 6. Linguagens e tecnologias do projecto

| Camada | Linguagem / tecnologia | Função |
|---|---|---|
| Frontend | TypeScript + TSX | Tipos, páginas e componentes da aplicação |
| Interface | React 18 | Estado, formulários, modais, rotas e interacção |
| Estilos | CSS + Tailwind CSS 4 | Layout, responsividade e sistema visual |
| Build web | Vite 5 + PWA | Compilação, desenvolvimento e aplicação instalável |
| Backend | TypeScript sobre Node.js | Regras de negócio e serviços da aplicação |
| API | Fastify 5 | Rotas HTTP, autenticação, uploads e validação |
| Validação | Zod | Schemas partilhados entre API e frontend |
| Base de dados | PostgreSQL + SQL | Persistência transaccional do sistema |
| ORM e migrações | Drizzle ORM / Drizzle Kit | Consultas tipadas, schema e versões da base |
| Leitor de plantas | Python 3 | Processamento especializado dos PDFs técnicos |
| Serviço Python | FastAPI + Uvicorn | API interna do leitor de plantas |
| Leitura de PDF | PyMuPDF | Texto, geometria, páginas e renderização das plantas |
| Relatórios | ExcelJS + Puppeteer | Exportação de Excel e geração de PDF |
| Testes | Vitest + Testing Library | Testes da API, regras e componentes React |
| Infraestrutura | Bash, systemd, PM2 e CloudPanel | Arranque, supervisão e publicação na VPS |
| Automação | YAML (GitHub Actions) | Build, testes e verificações do repositório |
| Pacotes | npm workspaces | Coordenação de `apps/web`, `apps/api` e `packages/shared` |

## 7. Onde alterar cada parte

- Interface: `apps/web/src`
- Rotas HTTP: `apps/api/src/routes`
- Regras de negócio: `apps/api/src/services`
- Schema PostgreSQL: `apps/api/src/db/schema.ts`
- Migrações: `apps/api/drizzle`
- Leitor de plantas: `apps/plant-service/parser.py`
- Tipos partilhados: `packages/shared/src`
- Serviços da VPS: `deploy`
- Histórico para continuidade entre Codex e Claude: `CHANGELOG_DEV.md`
