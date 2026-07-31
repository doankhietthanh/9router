# Deploy Fork Docker Image To VPS

Use this when you changed this fork locally, want to build a Docker image, push it to a registry, then pull it on the VPS to replace the running `9router` container.

## 1. Build And Push From Local

Replace `YOUR_DOCKERHUB_USER` and tag name as needed.

```bash
cd /Users/doankhietthanh/dev/9router

docker login
docker build -t YOUR_DOCKERHUB_USER/9router:custom .
docker push YOUR_DOCKERHUB_USER/9router:custom
```

Optional versioned tag:

```bash
docker build -t YOUR_DOCKERHUB_USER/9router:custom-YYYYMMDD .
docker push YOUR_DOCKERHUB_USER/9router:custom-YYYYMMDD
```

## 2. Check Current VPS Container

SSH into the VPS:

```bash
ssh user@YOUR_VPS_IP
```

Check the running container and current data mount before replacing it:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
docker inspect 9router --format '{{json .Mounts}}'
```

Important: keep the same mount into `/app/data`. This is where the SQLite DB/config live. Common examples:

```text
9router-data:/app/data
/root/.9router:/app/data
```

## 3A. Replace If Using Docker Run

Use this if the VPS container was started directly with `docker run`.

For named volume `9router-data`:

```bash
docker pull YOUR_DOCKERHUB_USER/9router:custom
docker stop 9router
docker rm 9router

docker run -d \
  --name 9router \
  --restart always \
  -p 20128:20128 \
  --env-file .env \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -v 9router-data:/app/data \
  YOUR_DOCKERHUB_USER/9router:custom

docker logs -f 9router
```

For bind mount `/root/.9router:/app/data`, replace the `-v` line:

```bash
-v /root/.9router:/app/data \
```

## 3B. Replace If Using Docker Compose

Use this if the VPS runs 9Router from a `docker-compose.yml`.

Edit the image:

```yaml
services:
  9router:
    image: YOUR_DOCKERHUB_USER/9router:custom
```

Then run:

```bash
docker compose pull 9router
docker compose up -d 9router
docker logs -f 9router
```

If Compose is not using the pushed image and you want to force recreate:

```bash
docker compose up -d --force-recreate 9router
```

## 4. Verify

Open:

```text
http://YOUR_VPS_IP:20128
```

Or if using domain/reverse proxy:

```text
https://YOUR_DOMAIN
```

Check logs:

```bash
docker logs --tail=100 9router
```

Check image currently used:

```bash
docker inspect 9router --format '{{.Config.Image}}'
```

## Rollback

If the new image has a problem, run the previous image again while keeping the same data mount:

```bash
docker stop 9router
docker rm 9router
docker run -d \
  --name 9router \
  --restart always \
  -p 20128:20128 \
  --env-file .env \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -v 9router-data:/app/data \
  decolua/9router:latest
```

If the old container used a bind mount, keep that same bind mount instead of `9router-data:/app/data`.
