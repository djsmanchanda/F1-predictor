# PowerShell Test Script for F1 Worker API
# Usage: .\test-worker.ps1 [WorkerURL]
# Example: .\test-worker.ps1 "https://f1-autocache.your-username.workers.dev"

param(
    [string]$WorkerURL = "https://f1-autocache.your-username.workers.dev"
)

$CurrentYear = (Get-Date).Year

function Test-Endpoint {
    param(
        [string]$Url,
        [string]$ExpectedType = "json"
    )
    
    Write-Host "`n🧪 Testing: $Url" -ForegroundColor Cyan
    
    try {
        $response = Invoke-RestMethod -Uri $Url -Method GET -Headers @{ 'Accept' = 'application/json' } -ResponseHeadersVariable headers
        
        Write-Host "   ✅ Status: 200" -ForegroundColor Green
        Write-Host "   CORS: $($headers['Access-Control-Allow-Origin'][0])" -ForegroundColor Yellow
        Write-Host "   Cache: $($headers['Cache-Control'][0])" -ForegroundColor Yellow
        
        if ($ExpectedType -eq "json") {
            if ($response -is [array]) {
                $leader = $response[0]
                Write-Host "   ✅ JSON: $($response.Count) drivers, leader: $($leader.'Driver Name') ($($leader.'Final Points') pts)" -ForegroundColor Green
            } else {
                $jsonString = ($response | ConvertTo-Json -Compress).Substring(0, [Math]::Min(100, ($response | ConvertTo-Json -Compress).Length))
                Write-Host "   ✅ JSON: $jsonString..." -ForegroundColor Green
            }
        } else {
            $lines = $response -split "`n"
            Write-Host "   ✅ CSV: $($lines.Count) lines, first: $($lines[0].Substring(0, [Math]::Min(50, $lines[0].Length)))..." -ForegroundColor Green
        }
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 404) {
            Write-Host "   ⚠️  404: No data yet (normal for new deployment)" -ForegroundColor Yellow
        } else {
            Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

function Test-Worker {
    Write-Host "🏎️  Testing F1 Worker: $WorkerURL" -ForegroundColor Magenta
    Write-Host "📅 Year: $CurrentYear`n" -ForegroundColor Magenta
    
    # Test all endpoints
    Test-Endpoint "$WorkerURL/api/f1/standings.json?year=$CurrentYear" "json"
    Test-Endpoint "$WorkerURL/api/f1/standings.csv?year=$CurrentYear" "csv"
    Test-Endpoint "$WorkerURL/api/f1/meta?year=$CurrentYear" "json"
    
    # Test manual update
    Write-Host "`n🔄 Testing manual update (401 or success expected):" -ForegroundColor Cyan
    Test-Endpoint "$WorkerURL/api/f1/update?year=$CurrentYear" "json"
    
    Write-Host "`n📋 Next Steps:" -ForegroundColor Green
    Write-Host "   1. If you see 404s, trigger an initial update:" -ForegroundColor White
    Write-Host "      curl -X POST `"$WorkerURL/api/f1/update`"" -ForegroundColor Gray
    Write-Host "   2. Update your data.js file with this worker URL" -ForegroundColor White
    Write-Host "   3. The worker will auto-update via cron every hour" -ForegroundColor White
    Write-Host "`n🚀 Worker testing complete!" -ForegroundColor Green
}

# Run the test
Test-Worker