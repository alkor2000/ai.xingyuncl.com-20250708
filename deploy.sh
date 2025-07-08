#!/bin/bash
set -e

echo "🚀 Starting deployment..."

# Load environment variables
export $(cat /var/www/ai-platform/config/env/.env.production | xargs)

# Stop all PM2 processes
pm2 stop all || echo "No processes to stop"

# Build and deploy each service
cd /var/www/ai-platform

# Install dependencies and build each service
for service in apps/apis/*; do
  if [ -d "$service" ]; then
    echo "📦 Building $(basename $service)..."
    cd "$service"
    npm install --production
    npm run build
    cd - > /dev/null
  fi
done

# Build main app
if [ -d "apps/main-app" ]; then
  echo "📦 Building main-app..."
  cd apps/main-app
  npm install --production
  npm run build
  cd - > /dev/null
fi

# Start all services
echo "🔄 Starting PM2 processes..."
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

echo "✅ Deployment completed successfully!"
