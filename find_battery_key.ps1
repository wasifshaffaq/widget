$devices = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match 'BTH' }
foreach ($d in $devices) {
    $battery = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2" -ErrorAction SilentlyContinue
    if ($battery -and $battery.Data -ne $null) {
        Write-Output "Name: $($d.FriendlyName) | Battery: $($battery.Data)%"
    }
}
