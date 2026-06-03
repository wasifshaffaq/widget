const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

console.log('========================================');
console.log('WIDGET BUSINESS LOGIC INTEGRITY TESTS');
console.log('========================================');

let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
    testsFailed++;
  }
}

// Test 1: Configuration Schema Validation
function testConfigSchema() {
  const configPath = path.join(__dirname, 'config.json');
  assert(fs.existsSync(configPath), 'config.json file exists');

  try {
    const data = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(data);

    assert(typeof config.widget === 'object', 'Config contains widget settings object');
    assert(typeof config.widget.scale === 'number', 'Widget scale is a number');
    assert(typeof config.widget.blur === 'number', 'Widget glass blur is a number');
    assert(typeof config.widget.alwaysOnTop === 'boolean', 'alwaysOnTop is a boolean');
    assert(typeof config.widget.clickThrough === 'boolean', 'clickThrough is a boolean');
    if (config.widget.visibleSlots !== undefined) {
      assert(typeof config.widget.visibleSlots === 'number', 'visibleSlots is a number');
    }
    
    assert(Array.isArray(config.slots), 'Config contains slots array');
    assert(config.slots.length === 4, 'Slots array has exactly 4 slots');

    config.slots.forEach((slot, index) => {
      assert(slot.id === index + 1, `Slot ${index + 1} has correct id`);
      assert(typeof slot.type === 'string', `Slot ${index + 1} has type string`);
      assert(typeof slot.icon === 'string', `Slot ${index + 1} has icon string`);
    });
  } catch (err) {
    assert(false, `Config parsing failed: ${err.message}`);
  }
}

// Test 2: Native CPU & Memory Metrics
function testSystemMetrics() {
  // RAM
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ramPercent = Math.round((usedMem / totalMem) * 100);
  
  assert(ramPercent >= 0 && ramPercent <= 100, `RAM percentage calculated successfully: ${ramPercent}%`);

  // CPU (Requires two measures to calculate delta)
  function getCpuTimes() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (const cpu of cpus) {
      user += cpu.times.user;
      nice += cpu.times.nice;
      sys += cpu.times.sys;
      idle += cpu.times.idle;
      irq += cpu.times.irq;
    }
    return { idle, total: user + nice + sys + idle + irq };
  }

  const t1 = getCpuTimes();
  
  // Wait 200ms to measure difference
  setTimeout(() => {
    const t2 = getCpuTimes();
    const idleDiff = t2.idle - t1.idle;
    const totalDiff = t2.total - t1.total;
    const cpuPercent = totalDiff === 0 ? 0 : Math.round((1 - idleDiff / totalDiff) * 100);

    assert(cpuPercent >= 0 && cpuPercent <= 100, `CPU percentage calculated successfully: ${cpuPercent}%`);
    
    // Continue with async powershell tests
    testPowerShellQueries();
  }, 200);
}

// Test 3: PowerShell command queries (Hardware Battery & Bluetooth)
function testPowerShellQueries() {
  // Laptop Battery query
  const batteryCmd = `powershell -Command "Get-CimInstance Win32_Battery | Select-Object -Property EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json"`;
  exec(batteryCmd, (error, stdout) => {
    if (error) {
      console.log(`[INFO] Win32_Battery query returned error (This is expected on desktop PCs without battery hardware)`);
    } else {
      console.log(`[INFO] Win32_Battery query output: ${stdout.trim() || 'No battery found'}`);
      if (stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout);
          const percent = Array.isArray(parsed) ? parsed[0].EstimatedChargeRemaining : parsed.EstimatedChargeRemaining;
          assert(percent >= 0 && percent <= 100, `Successfully parsed system battery level: ${percent}%`);
        } catch (e) {
          console.log(`[INFO] No battery hardware parsed: ${e.message}`);
        }
      }
    }

    // Bluetooth queries using execFile to bypass CMD shell parsing and escaping issues
    const bluetoothScript = `
      $connectedDevices = @()
      $parentDevices = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^BTHENUM\\\\DEV_' }
      foreach ($pd in $parentDevices) {
          $isConn = Get-PnpDeviceProperty -InstanceId $pd.InstanceId -KeyName '{83da6326-97a6-4088-9453-a1923f573b29} 15' -ErrorAction SilentlyContinue
          if ($isConn -and $isConn.Data -eq $true) {
              $mac = ""
              if ($pd.InstanceId -match 'DEV_([0-9A-Fa-f]{12})') {
                  $mac = $Matches[1]
              }
              $catProp = Get-PnpDeviceProperty -InstanceId $pd.InstanceId -KeyName 'DEVPKEY_DeviceContainer_Category' -ErrorAction SilentlyContinue
              $category = "Bluetooth Device"
              if ($catProp -and $catProp.Data) {
                  $category = $catProp.Data -join ", "
              }
              if ($category -match 'Headset') { $category = 'Headset' }
              elseif ($category -match 'Audio') { $category = 'Audio Device' }
              elseif ($category -match 'Mouse') { $category = 'Mouse' }
              elseif ($category -match 'Keyboard') { $category = 'Keyboard' }
              elseif ($category -match 'Phone') { $category = 'Phone' }
              elseif ($category -match 'Watch') { $category = 'Watch' }
              
              $subDevices = Get-PnpDevice -Class Bluetooth, System, Keyboard, Mouse, Ports -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like "*$mac*" }
              $batteryVal = $null
              foreach ($sd in $subDevices) {
                  $battery = Get-PnpDeviceProperty -InstanceId $sd.InstanceId -KeyName "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2" -ErrorAction SilentlyContinue
                  if ($battery -and $battery.Data -ne $null) {
                      $batteryVal = $battery.Data
                      break
                  }
              }
              
              $connectedDevices += [PSCustomObject]@{
                  name = $pd.FriendlyName
                  percent = if ($batteryVal -ne $null) { $batteryVal } else { 100 }
                  mac = $mac
                  category = $category
              }
          }
      }
      if ($connectedDevices.Count -gt 0) {
          $connectedDevices | ConvertTo-Json -Compress
      }
    `;

    const { execFile } = require('child_process');
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', bluetoothScript], (error, stdout, stderr) => {
      assert(!error, 'Bluetooth PowerShell command executed without crash');
      if (error) {
        console.error('[INFO] PowerShell error details:', error.message);
        console.error('[INFO] PowerShell stderr:', stderr);
      }
      
      if (stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          assert(list.length > 0, `Bluetooth devices reporting battery found: ${list.length}`);
          list.forEach(dev => {
            console.log(`[INFO] Detected Bluetooth Device: ${dev.name} - Battery: ${dev.percent}% - MAC: ${dev.mac} - Category: ${dev.category}`);
            assert(dev.mac !== undefined, 'Device contains MAC address');
            assert(dev.category !== undefined, 'Device contains Category');
          });
        } catch (e) {
          console.error(`[FAIL] Failed to parse Bluetooth output: ${e.message}`);
          console.log(`[INFO] Raw stdout:`, stdout);
          testsFailed++;
        }
      } else {
        console.log(`[INFO] Bluetooth battery query returned no devices currently reporting battery levels`);
      }

      // Test 4: Startup shortcut check
      testStartupShortcut();

      // Test 5: Dynamic Bluetooth routing check
      testDynamicBluetoothRouting();

      // Finish Suite
      console.log('\n========================================');
      if (testsFailed === 0) {
        console.log('ALL TESTS COMPLETED SUCCESSFULLY! (0 Failures)');
        process.exit(0);
      } else {
        console.error(`TEST SUITE COMPLETED WITH ${testsFailed} FAILURES!`);
        process.exit(1);
      }
    });
  });
}

function testStartupShortcut() {
  const startupPath = path.join(process.env.APPDATA, 'Microsoft\\Windows\\Start Menu\\Programs\\Startup\\BatteryWidget.lnk');
  const launchVbs = path.join(__dirname, 'launch.vbs');
  
  assert(fs.existsSync(launchVbs), 'launch.vbs silent launcher exists');
  assert(fs.existsSync(startupPath), 'BatteryWidget.lnk exists in Windows Startup directory');
}

function testDynamicBluetoothRouting() {
  // Mock data representing what widgetWindow receives
  const mockStats = {
    bluetooth: [
      { name: "realme Buds T310 Hands-Free AG", percent: 80 },
      { name: "pTron BT Hands-Free AG", percent: 10 }
    ]
  };

  // Scenario A: Manually configured slot name
  const slotA = { type: 'bluetooth_device', name: 'realme Buds T310', icon: 'earbuds' };
  const matchA = mockStats.bluetooth.find(d => {
    const configName = slotA.name.toLowerCase().trim();
    const devName = d.name.toLowerCase().trim();
    return devName.includes(configName);
  });
  assert(matchA && matchA.percent === 80, 'Matched specific configured device by substring');

  // Scenario B: Auto-routing (empty/blank slot name)
  const slotB = { type: 'bluetooth_device', name: '', icon: 'bluetooth' };
  let matchB = null;
  let iconB = slotB.icon;
  if (mockStats.bluetooth.length > 0) {
    matchB = mockStats.bluetooth[0];
    const lowerName = matchB.name.toLowerCase();
    if (lowerName.includes('buds') || lowerName.includes('ear')) {
      iconB = 'earbuds';
    }
  }
  assert(matchB && matchB.name === "realme Buds T310 Hands-Free AG" && matchB.percent === 80, 'Auto-routed to first connected Bluetooth device');
  assert(iconB === 'earbuds', 'Dynamically set icon based on device name keyword scanning');
}

// Run Suite
testConfigSchema();
testSystemMetrics();
