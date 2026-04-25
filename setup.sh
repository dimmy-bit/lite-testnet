#!/bin/bash
# ╔══════════════════════════════════════════════════════════╗
# ║        MirLite Bot v5.0 — Setup Script                 ║
# ╚══════════════════════════════════════════════════════════╝

echo ""
echo "  ⚡ MirLite Bot v5.0 — Setup"
echo "  Installing dependencies..."
echo ""

# Install Node deps
npm install

# Install Chromium for Puppeteer
npx puppeteer browsers install chrome 2>/dev/null || true

echo ""
echo "  ✅ Setup complete!"
echo ""
echo "  Run the bot with:"
echo "  node bot.js"
echo ""
