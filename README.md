# SIGO

Sistema de Medições e Orçamentos para Construção Civil (Moçambique) — SaaS multi-empresa.

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

Ver `C:\Users\Expert Sam\.claude\plans\shiny-conjuring-muffin.md` para o plano técnico completo e as decisões de âmbito validadas.
