# SIGO

Sistema Integrado de Gestão de Obras — plataforma multi-empresa para orçamento, planeamento,
compras, stock, execução, medição e controlo financeiro.

## Estrutura

- `apps/web` — frontend React + TypeScript + Tailwind (Vite)
- `apps/api` — backend Node.js + TypeScript + Fastify + Drizzle ORM (PostgreSQL)
- `apps/plant-service` — microserviço Python (FastAPI) para leitura automática de plantas ArchiCAD
- `packages/shared` — tipos e schemas Zod partilhados entre web e api

## Desenvolvimento local

```bash
# 1. Instalar dependências (na raiz, usa npm workspaces)
npm install

# 2. Configurar .env em apps/api (copiar de .env.example)
cp apps/api/.env.example apps/api/.env

# 3. Criar/migrar a base de dados
npm run db:generate
npm run db:migrate
npm run db:seed

# 4. Correr o backend e o frontend (em terminais separados)
npm run dev:api
npm run dev:web

# 5. Plant service (Python)
cd apps/plant-service
./.venv/Scripts/activate
uvicorn main:app --reload --port 8001
```

## Testes

```bash
# Backend: precisa de uma base de dados de teste separada (nunca a de desenvolvimento)
createdb sigo_test   # ou: psql -U postgres -c "CREATE DATABASE sigo_test"
cp apps/api/.env.test.example apps/api/.env.test   # ajustar credenciais se necessário

npm run test   # corre backend (Vitest + Fastify inject()) e frontend (Vitest + Testing Library)
```

O CI (`.github/workflows/ci.yml`) corre `npm ci`, build, typecheck, os mesmos testes contra um
Postgres efémero, validação de que o schema e as migrations estão sincronizados, e uma
auditoria de dependências informativa — em cada push/PR. Nunca faz deploy sozinho.

O acesso local/VPS, a ligação segura à base de dados e a lista completa de tecnologias estão em
[`ACESSO_TECNICO.md`](./ACESSO_TECNICO.md). O histórico comum para continuidade entre Codex e
Claude está em [`CHANGELOG_DEV.md`](./CHANGELOG_DEV.md).
