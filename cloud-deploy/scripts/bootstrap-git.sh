#!/bin/bash
# First-time Git deployment for a Linux cloud server.
#
# Usage:
#   sudo bash cloud-deploy/scripts/bootstrap-git.sh https://github.com/your-name/your-repo.git
#
# Optional:
#   sudo PROJECT_DIR=/opt/fashion-inventory BRANCH=main HOST_PORT=3001 \
#     bash cloud-deploy/scripts/bootstrap-git.sh https://github.com/your-name/your-repo.git

set -euo pipefail

REPO_URL="${1:-}"
PROJECT_DIR="${PROJECT_DIR:-/opt/fashion-inventory}"
BRANCH="${BRANCH:-main}"
HOST_PORT="${HOST_PORT:-3001}"

echo "=========================================="
echo "  Fashion Inventory - Git bootstrap"
echo "=========================================="
echo ""

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root:"
  echo "  sudo bash cloud-deploy/scripts/bootstrap-git.sh <repo-url>"
  exit 1
fi

if [ -z "$REPO_URL" ]; then
  echo "Missing repo URL."
  echo "Usage:"
  echo "  sudo bash cloud-deploy/scripts/bootstrap-git.sh https://github.com/your-name/your-repo.git"
  exit 1
fi

if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  echo "Installing base packages..."
  apt-get update
  apt-get install -y ca-certificates curl git openssl
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is not available."
  exit 1
fi

if [ -e "$PROJECT_DIR/.git" ]; then
  echo "Existing Git checkout found: $PROJECT_DIR"
  cd "$PROJECT_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
elif [ -e "$PROJECT_DIR" ] && [ "$(ls -A "$PROJECT_DIR" 2>/dev/null)" ]; then
  echo "Target directory is not empty and is not a Git checkout: $PROJECT_DIR"
  echo "Move it away first, or set PROJECT_DIR to another path."
  exit 1
else
  echo "Cloning repository..."
  mkdir -p "$(dirname "$PROJECT_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

ENV_FILE="$PROJECT_DIR/.env"
ENV_TEMPLATE="$PROJECT_DIR/cloud-deploy/.env.production.example"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_TEMPLATE" ]; then
    cp "$ENV_TEMPLATE" "$ENV_FILE"
  elif [ -f "$PROJECT_DIR/.env.example" ]; then
    cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
  else
    touch "$ENV_FILE"
  fi

  SESSION_SECRET="$(openssl rand -hex 32)"
  AI_CONFIG_SECRET="$(openssl rand -hex 32)"
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '\n')"

  grep -q '^SESSION_SECRET=' "$ENV_FILE" && sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" "$ENV_FILE" || echo "SESSION_SECRET=$SESSION_SECRET" >> "$ENV_FILE"
  grep -q '^AI_CONFIG_SECRET=' "$ENV_FILE" && sed -i "s/^AI_CONFIG_SECRET=.*/AI_CONFIG_SECRET=$AI_CONFIG_SECRET/" "$ENV_FILE" || echo "AI_CONFIG_SECRET=$AI_CONFIG_SECRET" >> "$ENV_FILE"
  grep -q '^ADMIN_USERNAME=' "$ENV_FILE" && sed -i "s/^ADMIN_USERNAME=.*/ADMIN_USERNAME=admin/" "$ENV_FILE" || echo "ADMIN_USERNAME=admin" >> "$ENV_FILE"
  grep -q '^ADMIN_PASSWORD=' "$ENV_FILE" && sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$ADMIN_PASSWORD/" "$ENV_FILE" || echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" >> "$ENV_FILE"
  grep -q '^HOST_PORT=' "$ENV_FILE" && sed -i "s/^HOST_PORT=.*/HOST_PORT=$HOST_PORT/" "$ENV_FILE" || echo "HOST_PORT=$HOST_PORT" >> "$ENV_FILE"
  grep -q '^TZ=' "$ENV_FILE" && sed -i "s|^TZ=.*|TZ=Asia/Shanghai|" "$ENV_FILE" || echo "TZ=Asia/Shanghai" >> "$ENV_FILE"

  chmod 600 "$ENV_FILE"
  echo "Created .env with generated secrets."
else
  echo ".env already exists, keeping it unchanged."
fi

echo "Building and starting Docker service..."
docker compose -f "$PROJECT_DIR/cloud-deploy/docker-compose.prod.yml" --env-file "$ENV_FILE" up -d --build

echo "Waiting for service..."
sleep 10

if curl -sf "http://127.0.0.1:${HOST_PORT}/api/healthz" >/dev/null; then
  echo "Service is healthy."
else
  echo "Health check failed. Recent logs:"
  docker compose -f "$PROJECT_DIR/cloud-deploy/docker-compose.prod.yml" --env-file "$ENV_FILE" logs --tail=80
  exit 1
fi

SERVER_IP="$(hostname -I | awk '{print $1}')"
echo ""
echo "=========================================="
echo "  Done"
echo "=========================================="
echo "URL: http://${SERVER_IP}:${HOST_PORT}"
echo "Project: $PROJECT_DIR"
echo "Branch: $BRANCH"
echo ""
echo "Next updates:"
echo "  cd $PROJECT_DIR"
echo "  bash cloud-deploy/scripts/update.sh"
echo ""
echo "Admin password is in:"
echo "  $ENV_FILE"
