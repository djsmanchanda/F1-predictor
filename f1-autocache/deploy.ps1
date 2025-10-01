# F1 Worker Deployment Commands
# Run these commands one by one

Write-Host "🏎️ F1 Worker Deployment Commands" -ForegroundColor Magenta
Write-Host "=================================" -ForegroundColor Magenta
Write-Host ""

Write-Host "📋 Current Status:" -ForegroundColor Green
Write-Host "✅ Wrangler installed: $(wrangler --version 2>$null)" -ForegroundColor White
Write-Host "✅ Files ready in f1-autocache/" -ForegroundColor White
Write-Host "✅ Current Python system working" -ForegroundColor White
Write-Host ""

Write-Host "🚀 Run these commands step by step:" -ForegroundColor Yellow
Write-Host ""

Write-Host "STEP 1: Login to Cloudflare" -ForegroundColor Cyan
Write-Host "wrangler login" -ForegroundColor White
Write-Host ""

Write-Host "STEP 2: Create KV Namespace" -ForegroundColor Cyan  
Write-Host "wrangler kv:namespace create F1_KV" -ForegroundColor White
Write-Host "👆 Copy the 'id' from the output above" -ForegroundColor Yellow
Write-Host ""

Write-Host "STEP 3: Update wrangler.toml" -ForegroundColor Cyan
Write-Host "Edit wrangler.toml and replace REPLACE_WITH_NAMESPACE_ID with the actual ID" -ForegroundColor White
Write-Host ""

Write-Host "STEP 4: Deploy the Worker" -ForegroundColor Cyan
Write-Host "wrangler deploy" -ForegroundColor White
Write-Host "👆 Note the worker URL from the output" -ForegroundColor Yellow
Write-Host ""

Write-Host "STEP 5: Test the Worker" -ForegroundColor Cyan
Write-Host "Replace YOUR_URL below with the actual worker URL:" -ForegroundColor Yellow
Write-Host "curl `"YOUR_URL/api/f1/standings.json?year=2025`"" -ForegroundColor White
Write-Host ""

Write-Host "STEP 6: If you get 404, trigger initial data load:" -ForegroundColor Cyan
Write-Host "curl -X POST `"YOUR_URL/api/f1/update?year=2025`"" -ForegroundColor White
Write-Host ""

Write-Host "🎯 After deployment, you'll have:" -ForegroundColor Green
Write-Host "• Fast, cached F1 data from Jolpi/Ergast API" -ForegroundColor White
Write-Host "• Automatic hourly updates via cron" -ForegroundColor White  
Write-Host "• Fallback to your existing API if needed" -ForegroundColor White
Write-Host "• Same data format for your frontend" -ForegroundColor White
Write-Host ""

Write-Host "Ready to start? Run: wrangler login" -ForegroundColor Magenta