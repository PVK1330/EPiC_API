#!/bin/bash

# Deployment script for EPiC API Server
# This script deploys the server code to VPS

set -e

# Configuration
VPS_HOST="${VPS_HOST:-your-vps-host}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/epic-api}"
LOCAL_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting server deployment to $VPS_HOST..."

# Create deployment package
echo "Creating deployment package..."
cd "$LOCAL_PATH"
tar -czf /tmp/epic-server-deploy.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=*.log \
  --exclude=.env \
  --exclude=.github \
  .

# Upload package to VPS
echo "Uploading package to VPS..."
scp -P "$VPS_PORT" /tmp/epic-server-deploy.tar.gz "$VPS_USER@$VPS_HOST:/tmp/"

# Deploy on VPS
echo "Deploying on VPS..."
ssh -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" << 'ENDSSH'
  set -e
  
  DEPLOY_PATH="/var/www/epic-api"
  
  # Create backup
  if [ -d "$DEPLOY_PATH/current" ]; then
    echo "Creating backup..."
    cp -r "$DEPLOY_PATH/current" "$DEPLOY_PATH/backup-$(date +%Y%m%d-%H%M%S)"
  fi
  
  # Create new release directory
  mkdir -p "$DEPLOY_PATH/new-release"
  
  # Extract package
  echo "Extracting package..."
  tar -xzf /tmp/epic-server-deploy.tar.gz -C "$DEPLOY_PATH/new-release"
  rm /tmp/epic-server-deploy.tar.gz
  
  # Install dependencies
  echo "Installing dependencies..."
  cd "$DEPLOY_PATH/new-release"
  npm ci --production
  
  # Copy environment file if exists
  if [ -f "$DEPLOY_PATH/.env" ]; then
    cp "$DEPLOY_PATH/.env" "$DEPLOY_PATH/new-release/.env"
  fi
  
  # Run migrations
  echo "Running migrations..."
  npm run migrate
  
  # Switch to new release
  echo "Switching to new release..."
  cd "$DEPLOY_PATH"
  rm -rf current
  mv new-release current
  
  # Restart application
  echo "Restarting application..."
  pm2 restart epic-api || pm2 start "$DEPLOY_PATH/current/src/server.js" --name epic-api
  pm2 save
  
  # Clean up old backups (keep last 3)
  echo "Cleaning up old backups..."
  cd "$DEPLOY_PATH"
  ls -t backup-* 2>/dev/null | tail -n +4 | xargs rm -rf || true
  
  echo "Deployment completed successfully!"
ENDSSH

# Cleanup local package
rm /tmp/epic-server-deploy.tar.gz

echo "Server deployment finished successfully!"
