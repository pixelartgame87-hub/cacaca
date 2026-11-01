$lines = Get-Content "C:/Users/ZuKA/Desktop/VA29/src/island/islaNatalData.ts"
$lines = $lines | Where-Object { $_.LineNumber -ne 1052 }
$lines | Set-Content "C:/Users/ZuKA/Desktop/VA29/src/island/islaNatalData.ts" -Force
