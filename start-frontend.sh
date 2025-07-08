#!/bin/bash
cd /var/www/ai-platform/frontend
screen -dmS frontend-dev npm run dev
echo "Frontend started in screen session 'frontend-dev'"
