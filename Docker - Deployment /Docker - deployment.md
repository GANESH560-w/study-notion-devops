# StudyNotion – Deployment Guide (Docker on a single AWS EC2)

This guide explains how to host the StudyNotion project (React frontend + Node/Express backend) on **one EC2 instance** using **Docker Compose**.

```
Browser ──► EC2 :80 ──► [ frontend container: Nginx + React build ]
                              │  /api/*
                              ▼
                        [ backend container: Express :4000 ]
                              │
              ┌───────────────┼────────────────────┐
              ▼               ▼                    ▼
        MongoDB Atlas     Cloudinary       Razorpay + SMTP (Gmail)
```

---

## 1. Prerequisites

| Item | Notes |
|---|---|
| AWS account | To create the EC2 instance |
| MongoDB Atlas cluster | Database (see Section 12 for alternatives) |
| Cloudinary account | `CLOUD_NAME`, `API_KEY`, `API_SECRET` |
| Razorpay account | Key ID and Key Secret |
| Gmail App Password | For OTP / reset / enrollment emails |

---

## 2. Project folder structure

```
study-notion/
├── Dockerfile               # frontend (React build + Nginx)
├── docker-compose.yml
├── nginx.conf
├── .dockerignore
├── .env                     # Docker/compose values (CLIENT_URL, Razorpay key)
├── package.json
├── src/
└── server/
    ├── Dockerfile           # backend (Express)
    ├── .dockerignore
    ├── .env                 # backend secrets
    ├── index.js
    └── package.json
```

---

## 3. Make three code changes

Replace **only the code line**. Do not paste `+`, `-` or bullet symbols.

**`src/services/apis.js` – line 1**
```js
const BASE_URL = "/api/v1"
```

**`server/index.js` – CORS block**
```js
origin: process.env.CLIENT_URL || "http://localhost:3000",
```

**`server/controllers/ResetPassword.js` – line 28**
```js
const url = `${process.env.CLIENT_URL || "http://localhost:3000"}/update-password/${token}`;
```

---

## 4. Docker files

### `Dockerfile` (project root)
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
ARG REACT_APP_RAZORPAY_KEY
ENV REACT_APP_RAZORPAY_KEY=$REACT_APP_RAZORPAY_KEY
ENV CI=false
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### `server/Dockerfile`
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "index.js"]
```

### `nginx.conf` (project root)
```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    client_max_body_size 200M;

    location /api/ {
        proxy_pass http://backend:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }

    location / {
        try_files $uri /index.html;
    }
}
```

### `docker-compose.yml` (project root)
```yaml
services:
  backend:
    build: ./server
    container_name: studynotion-backend
    restart: unless-stopped
    env_file: ./server/.env
    environment:
      - PORT=4000
      - CLIENT_URL=${CLIENT_URL}
    expose:
      - "4000"

  frontend:
    build:
      context: .
      args:
        REACT_APP_RAZORPAY_KEY: ${REACT_APP_RAZORPAY_KEY}
    container_name: studynotion-frontend
    restart: unless-stopped
    ports:
      - "80:80"
    depends_on:
      - backend
```

### `.dockerignore` (project root)
```
node_modules
server/node_modules
build
.git
.vscode
images
*.png
.env
server/.env
```

### `server/.dockerignore`
```
node_modules
.env
```

---

## 5. Environment files

### Project root `.env`
```
CLIENT_URL=http://YOUR_EC2_PUBLIC_IP
REACT_APP_RAZORPAY_KEY=rzp_test_xxxxxxxx
```
- `CLIENT_URL`: `http://` + your EC2 public IP (or `https://yourdomain.com`). No trailing slash, no port.
- `REACT_APP_RAZORPAY_KEY`: Razorpay **Key ID**.

### `server/.env`
```
PORT=4000
DATABASE_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/studynotion
JWT_SECRET=<long-random-string>
FOLDER_NAME=StudyNotion

MAIL_HOST=smtp.gmail.com
MAIL_USER=youremail@gmail.com
MAIL_PASS=<16-char-gmail-app-password>

CLOUD_NAME=<cloudinary-cloud-name>
API_KEY=<cloudinary-api-key>
API_SECRET=<cloudinary-api-secret>

RAZORPAY_SECRET=<razorpay-key-secret>
```

**Gmail App Password:** Google Account → Security → turn on 2-Step Verification → App passwords → create one → paste it with no spaces. Your normal Gmail password will not work.

**Never commit `.env` files to Git and never share them in chats.**

---

## 6. Launch the EC2 instance

1. AWS Console → **EC2 → Launch instance**.
2. **AMI:** Ubuntu 22.04/24.04 or Amazon Linux 2023.
3. **Type:** `t3.small` (2 GB RAM) or larger. The React build can run out of memory on 1 GB.
4. **Key pair:** create/download a `.pem` file.
5. **Storage:** 20 GB gp3.
6. **Security group – inbound rules:**

| Type | Port | Source |
|---|---|---|
| SSH | 22 | My IP only |
| HTTP | 80 | 0.0.0.0/0 |
| HTTPS | 443 | 0.0.0.0/0 (if using a domain) |

   Do **not** open port 4000. The backend is only reachable through Nginx.
7. Launch.

### Attach an Elastic IP
EC2 → **Elastic IPs → Allocate → Associate** with your instance. This keeps the public IP fixed after reboots.

---

## 7. Connect to the server

```bash
chmod 400 mykey.pem
ssh -i mykey.pem ubuntu@<EC2_PUBLIC_IP>      # Ubuntu
ssh -i mykey.pem ec2-user@<EC2_PUBLIC_IP>    # Amazon Linux
```

---

## 8. Install Docker

**Ubuntu**
```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker
```

**Amazon Linux 2023**
```bash
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user && newgrp docker
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
```

Verify:
```bash
docker --version
docker compose version
```

---

## 9. Get the code onto the server

```bash
git clone <your-repo-url> study-notion
cd study-notion
```
Or upload from your laptop:
```bash
scp -i mykey.pem -r study-notion ubuntu@<EC2_PUBLIC_IP>:~/
```

Then create `.env` and `server/.env` (Section 5) and confirm the three code changes (Section 3).

---

## 10. Allow the EC2 in MongoDB Atlas

Atlas → **Network Access → Add IP Address** → enter the EC2 Elastic IP. Without this the backend cannot connect and exits at startup.

---

## 11. Build and run

```bash
cd ~/study-notion
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

Look for `✅ Database Connected Successfully!`, then open `http://<EC2_PUBLIC_IP>`.

### Everyday commands
```bash
docker compose logs -f                 # all logs
docker compose restart backend         # restart one service
docker compose stop / start            # stop / start everything
docker compose down                    # remove containers
docker compose up -d --build           # rebuild after code changes
docker compose up -d --force-recreate  # apply .env changes
docker system prune -af                # free disk space
```

### Updating the app
```bash
cd ~/study-notion
git pull
docker compose up -d --build
```

---

## 12. Using RDS instead of Atlas – read this first

**Amazon RDS cannot be used with this project as it is.**

StudyNotion uses **MongoDB** (`mongoose`). RDS only provides **relational** databases (MySQL, PostgreSQL, MariaDB, Oracle, SQL Server). Pointing `DATABASE_URL` at RDS will not work, because the driver, models and queries are all MongoDB-specific.

Your realistic options on AWS:

| Option | Effort | Cost | Notes |
|---|---|---|---|
| **A. Keep MongoDB Atlas** | None | Free tier available | Simplest. Current setup. |
| **B. MongoDB container on the same EC2** | Low | No extra service | Fully on your one EC2. Needs backups. |
| **C. Amazon DocumentDB** | Medium | Higher (roughly $200+/month minimum) | AWS-managed, MongoDB-compatible, VPC-only. |
| **D. Real RDS (MySQL/PostgreSQL)** | Very high | Medium | Requires rewriting every Mongoose model and query (Sequelize/Prisma). Not recommended. |

### Option B – MongoDB in Docker on the same EC2

Update `docker-compose.yml`:
```yaml
services:
  mongo:
    image: mongo:7
    container_name: studynotion-mongo
    restart: unless-stopped
    volumes:
      - mongo_data:/data/db
    expose:
      - "27017"

  backend:
    build: ./server
    container_name: studynotion-backend
    restart: unless-stopped
    env_file: ./server/.env
    environment:
      - PORT=4000
      - CLIENT_URL=${CLIENT_URL}
    expose:
      - "4000"
    depends_on:
      - mongo

  frontend:
    build:
      context: .
      args:
        REACT_APP_RAZORPAY_KEY: ${REACT_APP_RAZORPAY_KEY}
    container_name: studynotion-frontend
    restart: unless-stopped
    ports:
      - "80:80"
    depends_on:
      - backend

volumes:
  mongo_data:
```

In `server/.env`:
```
DATABASE_URL=mongodb://mongo:27017/studynotion
```

Port 27017 is **not** published to the internet; only the backend container can reach it.

**Backup**
```bash
docker exec studynotion-mongo mongodump --db studynotion --archive > backup_$(date +%F).archive
```
**Restore**
```bash
docker exec -i studynotion-mongo mongorestore --archive < backup_2026-01-01.archive
```
Copy backups off the server (for example to S3), because if the instance is lost the data is lost with it.

**Move existing data from Atlas** (run from any machine with the MongoDB Database Tools):
```bash
mongodump --uri="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/test" --archive=atlas.archive
docker exec -i studynotion-mongo mongorestore --archive --nsFrom='test.*' --nsTo='studynotion.*' < atlas.archive
```
(Your current data is in the `test` database if `DATABASE_URL` had no database name.)

### Option C – Amazon DocumentDB

1. **DocumentDB → Create cluster** in the **same VPC** as the EC2.
2. Create a security group rule: inbound TCP **27017** from the **EC2 security group**.
3. DocumentDB has no public access; only the EC2 can reach it.
4. Download the CA bundle on the EC2:
   ```bash
   cd ~/study-notion/server
   wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
   ```
5. Mount it in the backend (in `docker-compose.yml`):
   ```yaml
   backend:
     volumes:
       - ./server/global-bundle.pem:/app/global-bundle.pem:ro
   ```
6. `server/.env`:
   ```
   DATABASE_URL=mongodb://<user>:<password>@<cluster-endpoint>:27017/studynotion?tls=true&tlsCAFile=/app/global-bundle.pem&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false
   ```
7. `docker compose up -d --force-recreate backend`.

DocumentDB is API-compatible with MongoDB but not identical, so test every feature (signup, courses, payments).

---

## 13. Optional: domain + HTTPS (recommended for production)

1. Buy or use a domain and create an **A record** pointing to your Elastic IP (Route 53 or your registrar).
2. Add a `Caddyfile` in the project root:
   ```
   yourdomain.com {
       reverse_proxy frontend:80
   }
   ```
3. In `docker-compose.yml`, change the frontend to `expose: ["80"]` (remove `ports`) and add:
   ```yaml
   caddy:
     image: caddy:2
     container_name: studynotion-caddy
     restart: unless-stopped
     ports:
       - "80:80"
       - "443:443"
     volumes:
       - ./Caddyfile:/etc/caddy/Caddyfile
       - caddy_data:/data
     depends_on:
       - frontend
   volumes:
     caddy_data:
   ```
4. Set `CLIENT_URL=https://yourdomain.com` in the root `.env`.
5. `docker compose up -d --build`. Caddy gets and renews the SSL certificate automatically.

Razorpay live payments require HTTPS.

---

## 14. Troubleshooting

| Problem | Cause / Fix |
|---|---|
| `Syntax error: Unexpected token (1:1)` in `apis.js` | Diff markers (`+`/`-`) were pasted into the file. Line 1 must be exactly `const BASE_URL = "/api/v1"`. |
| `bash: mongodb+srv://...: No such file or directory` | A connection string is not a command. Put it in `server/.env` or after `mongosh "..."`. |
| Backend exits, log shows database error | Add the EC2 IP in Atlas Network Access; check username/password in `DATABASE_URL`. |
| Emails not arriving | Use a Gmail **App Password**; check `docker compose logs backend` for `Invalid login`; check spam. |
| Login/API calls fail with CORS error | `CLIENT_URL` must exactly match the address in the browser (`http://IP`, no trailing slash). Recreate backend. |
| Site not loading | Check the security group allows port 80 and `docker compose ps` shows both containers `Up`. |
| React build killed / out of memory | Use `t3.small` or larger, or add swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |
| Warning: `buildx isn't installed` | Harmless. |
| Changed `.env` but nothing happened | Run `docker compose up -d --force-recreate`. Changing `REACT_APP_RAZORPAY_KEY` needs `--build`. |

---

## 15. Security checklist

- [ ] Rotate any password or key that was ever shared or committed (Atlas, Cloudinary, Razorpay, Gmail App Password, `JWT_SECRET`).
- [ ] `.env` files are not in Git.
- [ ] SSH (22) is limited to your IP.
- [ ] Port 4000 and 27017 are not open to the internet.
- [ ] Elastic IP attached and whitelisted in Atlas.
- [ ] HTTPS enabled before going live with real payments.
- [ ] Database backups are scheduled and stored off the server.
