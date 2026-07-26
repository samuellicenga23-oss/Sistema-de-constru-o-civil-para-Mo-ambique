# Deploy do SIGO numa VPS

Guia passo-a-passo para colocar o SIGO (web + api + plant-service + PostgreSQL) numa VPS
Linux (Ubuntu/Debian — para outra distro, adaptar os comandos `apt`). Assume que já tens a VPS
contratada, um domínio a apontar para o IP dela, e que a base de dados vai ficar na própria VPS.

**Importante**: isto é um guia para correres tu, via SSH, na tua VPS — não há aqui nenhuma
automação remota; cada bloco de código é para colar no terminal da VPS (ou local, quando indicado).

## 0. Visão geral do que vai ficar onde

```
/var/www/sigo/            ← código (clonado do teu repositório)
  apps/web/dist/               ← build do frontend, servido directamente pelo Nginx
  apps/api/dist/                ← build da API Node, corre via PM2 na porta 4100 (só localhost)
  apps/plant-service/.venv/     ← ambiente Python, corre via systemd na porta 8001 (só localhost)
Nginx (porta 80/443, público) → serve o build do web + faz proxy de /api e /uploads para a API
PostgreSQL (porta 5432, só localhost) ← base de dados
```

O frontend chama sempre caminhos relativos (`/api/...`), por isso não há nada a configurar do
lado do build do web para apontar para um domínio — o Nginx é que decide para onde tudo vai,
sempre no mesmo domínio/porta 443 (evita complicações de CORS entre domínios diferentes).

## 1. Preparação inicial da VPS

Ligar por SSH e actualizar o sistema:

```bash
ssh root@SEU_IP
apt update && apt upgrade -y
apt install -y curl git build-essential ufw
```

Firewall básico (deixa SSH, HTTP e HTTPS passar; tudo o resto fica fechado — a API e o
plant-service nunca ficam expostos directamente, só através do Nginx):

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

## 2. Node.js, PM2, Python e PostgreSQL

```bash
# Node.js LTS (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2

# Python (para o plant-service)
apt install -y python3 python3-venv python3-pip

# PostgreSQL
apt install -y postgresql postgresql-contrib

# Nginx + Certbot (SSL)
apt install -y nginx certbot python3-certbot-nginx

# Dependências de sistema do Chromium usado pelo Puppeteer (exportação de PDF) — lista
# oficial do Puppeteer para Debian/Ubuntu
apt install -y ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
  libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 \
  libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 \
  libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils
```

## 3. Base de dados PostgreSQL

```bash
sudo -u postgres psql
```
```sql
CREATE DATABASE sigo;
CREATE USER sigo_app WITH ENCRYPTED PASSWORD 'ESCOLHE_UMA_PASSWORD_FORTE';
GRANT ALL PRIVILEGES ON DATABASE sigo TO sigo_app;
ALTER DATABASE sigo OWNER TO sigo_app;
\q
```

Guarda a password — vai para o `DATABASE_URL` do `.env` da API no passo 5.

## 4. Levar o código para a VPS

O projecto ainda não é um repositório git. Localmente (no teu PC), antes de ires para a VPS:

```bash
cd "C:\Users\Expert Sam\Documents\SIGO"
git init
git add .
git commit -m "Primeira versão para deploy"
```

Depois cria um repositório vazio no GitHub/GitLab (à tua escolha) e faz push:

```bash
git remote add origin <URL_DO_TEU_REPOSITORIO>
git branch -M main
git push -u origin main
```

Na VPS, clona-o:

```bash
mkdir -p /var/www && cd /var/www
git clone <URL_DO_TEU_REPOSITORIO> sigo
cd sigo
```

(Se preferires não usar git, `rsync -av --exclude node_modules --exclude dist ./ root@SEU_IP:/var/www/sigo/`
a partir do teu PC funciona também, mas perdes o `git pull` fácil para actualizações futuras.)

## 5. Instalar dependências e variáveis de ambiente

```bash
cd /var/www/sigo
npm install
npm run build   # compila packages/shared, apps/api e apps/web, por esta ordem
```

Ambiente da API — copiar o exemplo e editar:

```bash
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```

Preencher assim (substituindo a password que escolheste no passo 3, e gerando um segredo novo
para `SESSION_COOKIE_SECRET`, ex: `openssl rand -hex 32`):

```
DATABASE_URL=postgres://sigo_app:ESCOLHE_UMA_PASSWORD_FORTE@localhost:5432/sigo
PORT=4100
SESSION_COOKIE_SECRET=<gerar um valor aleatório longo>
PLANT_SERVICE_URL=http://127.0.0.1:8001
UPLOADS_DIR=./uploads
CORS_ORIGIN=https://SEU_DOMINIO
NODE_ENV=production
```

`NODE_ENV=production` é importante — activa o cookie de sessão `secure` (só enviado por HTTPS).
`CORS_ORIGIN` é importante também — sem isto, em produção o CORS fica fechado por omissão (o que
está certo se só o próprio frontend, servido pelo mesmo Nginx, chamar a API); só precisas de o
preencher se outro domínio/app também precisar de chamar esta API directamente do browser.

Plant-service (Python, ambiente virtual):

```bash
cd /var/www/sigo/apps/plant-service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd /var/www/sigo
```

## 6. Migrações da base de dados

```bash
cd /var/www/sigo
npm run db:migrate
```

Para popular o catálogo de preços partilhado (materiais, mão-de-obra, composições) já com os
dados-base do sistema:

```bash
npm run db:seed
```

**Aviso de segurança — ler antes de expor isto publicamente**: este comando também cria duas
contas com passwords públicas e conhecidas (estão no código-fonte, `apps/api/src/db/seed.ts`):
- `super@sigo.local` / `admin123` (super_admin da plataforma)
- `demo@empresa.local` / `demo123` (empresa "Empresa Demo Lda", perfil admin_empresa)

Em produção real, **muda estas duas passwords imediatamente a seguir ao seed**. A aplicação
ainda não tem um ecrã de "mudar password" — faz-se directamente na base de dados, gerando o
hash com a mesma função que a API usa (`apps/api/src/auth/password.ts`):

```bash
cd /var/www/sigo/apps/api
node --input-type=module -e "
import bcrypt from 'bcryptjs';
console.log(await bcrypt.hash(process.argv[1], 10));
" -- "ESCOLHE_UMA_PASSWORD_NOVA_FORTE"
```

Copia o hash que aparece e aplica-o ao utilizador que quiseres (repetir para os dois emails):

```bash
sudo -u postgres psql -d sigo -c "UPDATE users SET password_hash = '<hash colado aqui>' WHERE email = 'super@sigo.local';"
```

Ou, em alternativa mais simples, apaga a empresa de demonstração se não precisares dela (via o
painel do super_admin, depois de mudares a password dele primeiro). Não deixes o sistema
acessível ao público com as credenciais por omissão do seed.

## 7. Arrancar os serviços

**API (PM2)**:

```bash
cd /var/www/sigo
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup   # segue a instrução que aparece no ecrã (comando systemctl enable a copiar/colar)
```

**Plant-service (systemd)**:

```bash
sudo cp deploy/sigo-plant-service.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sigo-plant-service
sudo systemctl status sigo-plant-service   # confirmar "active (running)"
```

## 8. Nginx + SSL

```bash
sudo cp deploy/nginx.sigo.conf /etc/nginx/sites-available/sigo
sudo nano /etc/nginx/sites-available/sigo   # substituir SEU_DOMINIO pelo domínio real
sudo ln -s /etc/nginx/sites-available/sigo /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # evita conflito com a config por omissão do Nginx
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d SEU_DOMINIO
```

O certbot edita o ficheiro do Nginx sozinho para acrescentar o bloco HTTPS/443 e o redirect
automático de 80→443, e trata da renovação automática do certificado.

## 9. Verificar

```bash
curl https://SEU_DOMINIO/api/health
```
Deve devolver `{"status":"ok","dbTime":"..."}`. Depois abrir `https://SEU_DOMINIO` no browser —
deve aparecer o ecrã de login. Entra com `super@sigo.local` (já com a password que definiste
no passo 6, não a do seed) para o painel da plataforma, e cria aí as empresas/clientes reais.

## 10. Actualizações futuras

```bash
cd /var/www/sigo
git pull
npm install
npm run build
npm run db:migrate   # só se houver migrações novas
pm2 reload sigo-api
sudo systemctl restart sigo-plant-service   # só se o plant-service tiver mudado
```

## 11. Backups (recomendado antes de ires para produção a sério)

Backup diário da base de dados via cron (`crontab -e` como root ou um utilizador com acesso):

```bash
0 3 * * * pg_dump -U sigo_app -h localhost sigo | gzip > /var/backups/sigo-$(date +\%F).sql.gz
```

E não esquecer de incluir `apps/api/uploads/` (plantas carregadas, logótipos de empresas) num
backup regular também — não está na base de dados.
