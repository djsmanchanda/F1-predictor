# Quick Test Commands for F1 Worker
# Copy and paste these commands to test your deployed worker

# Replace YOUR_WORKER_URL with your actual worker URL after deployment
$WORKER_URL = "https://f1-autocache.your-username.workers.dev"
$YEAR = 2025

Write-Host "🏎️ F1 Worker Quick Test Commands" -ForegroundColor Magenta
Write-Host "=================================" -ForegroundColor Magenta
Write-Host ""

Write-Host "📋 Copy and run these commands after deploying your worker:" -ForegroundColor Green
Write-Host ""

Write-Host "1️⃣ Test JSON Standings:" -ForegroundColor Cyan
Write-Host "curl `"$WORKER_URL/api/f1/standings.json?year=$YEAR`"" -ForegroundColor Yellow
Write-Host ""

Write-Host "2️⃣ Test CSV Standings:" -ForegroundColor Cyan  
Write-Host "curl `"$WORKER_URL/api/f1/standings.csv?year=$YEAR`"" -ForegroundColor Yellow
Write-Host ""

Write-Host "3️⃣ Test Metadata:" -ForegroundColor Cyan
Write-Host "curl `"$WORKER_URL/api/f1/meta?year=$YEAR`"" -ForegroundColor Yellow
Write-Host ""

Write-Host "4️⃣ Trigger Manual Update:" -ForegroundColor Cyan
Write-Host "curl -X POST `"$WORKER_URL/api/f1/update?year=$YEAR`"" -ForegroundColor Yellow
Write-Host ""

Write-Host "5️⃣ Test Your Current App:" -ForegroundColor Cyan
Write-Host "curl `"https://your-site.pages.dev/api/data`"" -ForegroundColor Yellow
Write-Host ""

Write-Host "📝 Expected Results:" -ForegroundColor Green
Write-Host "- 404 = No data yet (run manual update first)" -ForegroundColor White
Write-Host "- 200 = Success! Worker is functioning" -ForegroundColor White
Write-Host "- 401 = Update endpoint needs authentication (normal)" -ForegroundColor White
Write-Host "- 503 = Worker error (check Cloudflare dashboard)" -ForegroundColor White