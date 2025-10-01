# F1 Worker Deployment & Testing Guide
# =====================================

Write-Host "🚀 F1 Worker Deployment & Testing Guide" -ForegroundColor Magenta
Write-Host "=======================================" -ForegroundColor Magenta
Write-Host ""

Write-Host "📋 STEP 1: Prerequisites" -ForegroundColor Green
Write-Host "------------------------" -ForegroundColor Green
Write-Host "✅ Cloudflare account (free tier is fine)" -ForegroundColor White
Write-Host "✅ Wrangler CLI installed: npm install -g wrangler" -ForegroundColor White
Write-Host "✅ Current directory: f1-autocache" -ForegroundColor White
Write-Host ""

Write-Host "📋 STEP 2: Deploy the Worker" -ForegroundColor Green
Write-Host "----------------------------" -ForegroundColor Green
Write-Host "1. wrangler login" -ForegroundColor Yellow
Write-Host "2. wrangler kv:namespace create F1_KV" -ForegroundColor Yellow
Write-Host "3. [Copy namespace ID to wrangler.toml]" -ForegroundColor Yellow
Write-Host "4. wrangler deploy" -ForegroundColor Yellow
Write-Host "5. [Note the worker URL]" -ForegroundColor Yellow
Write-Host ""

Write-Host "📋 STEP 3: Test the Worker" -ForegroundColor Green
Write-Host "--------------------------" -ForegroundColor Green
Write-Host "Replace YOUR_WORKER_URL below with your actual URL:" -ForegroundColor Cyan
Write-Host ""
Write-Host "# Test JSON endpoint" -ForegroundColor White
Write-Host "curl `"YOUR_WORKER_URL/api/f1/standings.json?year=2025`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "# Trigger initial data load (if you get 404 above)" -ForegroundColor White
Write-Host "curl -X POST `"YOUR_WORKER_URL/api/f1/update?year=2025`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "# Test CSV endpoint" -ForegroundColor White
Write-Host "curl `"YOUR_WORKER_URL/api/f1/standings.csv?year=2025`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "# Test metadata" -ForegroundColor White
Write-Host "curl `"YOUR_WORKER_URL/api/f1/meta?year=2025`"" -ForegroundColor Yellow
Write-Host ""

Write-Host "📋 STEP 4: Update Your App" -ForegroundColor Green
Write-Host "--------------------------" -ForegroundColor Green
Write-Host "1. Open: functions/api/data.js" -ForegroundColor White
Write-Host "2. Replace: F1_WORKER_BASE_URL = 'https://f1-autocache.your-username.workers.dev'" -ForegroundColor White
Write-Host "3. With: F1_WORKER_BASE_URL = 'YOUR_ACTUAL_WORKER_URL'" -ForegroundColor White
Write-Host "4. Deploy your Cloudflare Pages site" -ForegroundColor White
Write-Host ""

Write-Host "📋 STEP 5: Test Your Updated App" -ForegroundColor Green
Write-Host "--------------------------------" -ForegroundColor Green
Write-Host "curl `"https://your-site.pages.dev/api/data`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "Look for these headers in the response:" -ForegroundColor White
Write-Host "  X-Data-Source: worker     - Success! Using new system" -ForegroundColor Green
Write-Host "  X-Data-Source: fallback   - OK! Fallback to old system" -ForegroundColor Yellow
Write-Host ""

Write-Host "🎯 Expected Timeline:" -ForegroundColor Blue
Write-Host "- Deployment: 5-10 minutes" -ForegroundColor White
Write-Host "- First data load: 30-60 seconds after manual trigger" -ForegroundColor White
Write-Host "- Auto-updates: Every hour via cron" -ForegroundColor White
Write-Host "- Fallback: Immediate if worker fails" -ForegroundColor White
Write-Host ""

Write-Host "🔧 Troubleshooting:" -ForegroundColor Red
Write-Host "- 404 errors? Run the manual update POST command" -ForegroundColor White
Write-Host "- 503 errors? Check Cloudflare Workers dashboard logs" -ForegroundColor White
Write-Host "- No data? Worker needs time to fetch from Jolpi API" -ForegroundColor White
Write-Host "- Still issues? App will fall back to your existing API" -ForegroundColor White