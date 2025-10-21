#!/bin/bash

# Brand Extraction Worker - Quick Start Script
# This script helps you get started quickly

set -e

echo "🚀 Brand Extraction Worker - Quick Start"
echo "========================================"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.example .env
    echo "✅ Created .env file"
    echo ""
    echo "📝 Please edit .env and add your credentials:"
    echo "   - OPENAI_API_KEY"
    echo "   - SUPABASE_URL"
    echo "   - SUPABASE_SERVICE_KEY"
    echo "   - REDIS_HOST (use 'localhost' for local development)"
    echo ""
    read -p "Press Enter when you've updated .env file..."
fi

echo ""
echo "🔍 Checking environment variables..."
source .env

if [ -z "$OPENAI_API_KEY" ] || [ "$OPENAI_API_KEY" = "sk-..." ]; then
    echo "❌ OPENAI_API_KEY not set in .env"
    exit 1
fi

if [ -z "$SUPABASE_URL" ] || [ "$SUPABASE_URL" = "https://your-project.supabase.co" ]; then
    echo "❌ SUPABASE_URL not set in .env"
    exit 1
fi

if [ -z "$SUPABASE_SERVICE_KEY" ] || [ "$SUPABASE_SERVICE_KEY" = "eyJ..." ]; then
    echo "❌ SUPABASE_SERVICE_KEY not set in .env"
    exit 1
fi

echo "✅ Environment variables configured"
echo ""

# Check if Redis is running
echo "🔍 Checking Redis connection..."
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "✅ Redis is running"
    else
        echo "⚠️  Redis is not responding"
        echo ""
        echo "To start Redis:"
        echo "  - Docker: docker run -d -p 6379:6379 redis:alpine"
        echo "  - Homebrew: brew services start redis"
        echo ""
        read -p "Press Enter when Redis is running..."
    fi
else
    echo "⚠️  redis-cli not found. Assuming Redis is running..."
fi

echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
else
    echo "✅ Dependencies already installed"
fi

echo ""

# Build the project
echo "🔨 Building TypeScript..."
npm run build
echo "✅ Build successful"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup complete! Ready to start."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo ""
echo "1️⃣  Start the worker:"
echo "   npm run dev"
echo ""
echo "2️⃣  In another terminal, test it:"
echo "   npm run test"
echo ""
echo "3️⃣  Check the documentation:"
echo "   - README.md - Full documentation"
echo "   - SETUP.md - Setup guide"
echo "   - INTEGRATION_GUIDE.md - Integrate with your API"
echo "   - PROJECT_SUMMARY.md - Overview"
echo ""
echo "🎉 Happy brand extracting!"

