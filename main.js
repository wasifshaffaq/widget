const { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// Configuration Path
const CONFIG_PATH = path.join(__dirname, 'config.json');

// Default Config
const DEFAULT_CONFIG = {
  widget: {
    x: 1282,
    y: 66,
    scale: 0.85,
    opacity: 1.0,
    alwaysOnTop: false,
    clickThrough: false,
    theme: 'dark',
    blur: 32,
    backgroundColor: 'rgba(20, 20, 22, 0.45)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    accentColor: '#30d158',
    showPercentageText: true,
    updateIntervalMs: 4000,
    visibleSlots: 1
  },
  slots: [
    { id: 1, type: 'bluetooth_device', name: '', icon: 'earbuds', mockPercent: 100, mockCharging: false },
    { id: 2, type: 'cpu', name: '', icon: 'cpu', mockPercent: 100, mockCharging: false },
    { id: 3, type: 'bluetooth_device', name: 'AirPods', icon: 'earbuds', mockPercent: 100, mockCharging: false },
    { id: 4, type: 'simulated', name: 'AirPods Case', icon: 'case', mockPercent: 38, mockCharging: false }
  ]
};

// Global References
let widgetWindow = null;
let settingsWindow = null;
let tray = null;
let updateTrayMenu = null;
let config = { ...DEFAULT_CONFIG };
let cpuUsageHistory = { idle: 0, total: 0 };
let cachedStats = {
  cpu: 0,
  ram: 0,
  laptop_battery: { percent: 100, charging: false, exists: false },
  bluetooth: []
};

// Base64 Green Battery Icon for Tray (16x16 pixels)
const TRAY_ICON_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAm0lEQVQ4T2NkoBAwUqifAbfKb5mEGFgYGBgY//+D81kZGJjVGP4zwGXDGEBRMAqGBQMyQAJiQFn1B4YBv6D8FwwDGEE0yAAJiAFlFRiBGIgGGVBN5WdkgFv6gWEAI4gGGSABMSCPApiBZNB2hT9kAzggGgh+EBsF+BkQ6GfAIP7vH3R/I8OPf+D9eIIMkH/+I9iACF+A+RkwgG4hADh3O3t3L54VAAAAAElFTkSuQmCC';

// Load Config from disk
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      config = JSON.parse(data);
      // Merge with defaults to ensure new fields are populated
      config.widget = { ...DEFAULT_CONFIG.widget, ...config.widget };
      if (!config.slots || config.slots.length !== 4) {
        config.slots = [ ...DEFAULT_CONFIG.slots ];
      }
    } else {
      saveConfig(DEFAULT_CONFIG);
    }
  } catch (err) {
    console.error('Failed to load config, using defaults:', err);
    config = { ...DEFAULT_CONFIG };
  }
}

// Save Config to disk
function saveConfig(newConfig) {
  try {
    config = newConfig;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send('config-update', config);
    }
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

// Calculate CPU Usage natively
function getCpuUsage() {
  const cpus = os.cpus();
  let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
  for (const cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }
  const total = user + nice + sys + idle + irq;
  const current = { idle, total };

  const idleDiff = current.idle - cpuUsageHistory.idle;
  const totalDiff = current.total - cpuUsageHistory.total;
  cpuUsageHistory = current;

  if (totalDiff === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
}

// Calculate RAM Usage natively
function getRamUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return Math.round((used / total) * 100);
}

// Query host battery via PowerShell using execFile
function queryLaptopBattery() {
  return new Promise((resolve) => {
    const script = `Get-CimInstance Win32_Battery | Select-Object -Property EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json`;
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], (error, stdout) => {
      if (error || !stdout.trim()) {
        return resolve({ percent: 100, charging: false, exists: false });
      }
      try {
        const parsed = JSON.parse(stdout);
        let percent = 100;
        let charging = false;
        let exists = true;

        if (Array.isArray(parsed)) {
          percent = parsed[0]?.EstimatedChargeRemaining ?? 100;
          const status = parsed[0]?.BatteryStatus ?? 1;
          charging = (status === 2 || status === 6 || status === 7 || status === 8);
        } else if (parsed && typeof parsed === 'object') {
          percent = parsed.EstimatedChargeRemaining ?? 100;
          const status = parsed.BatteryStatus ?? 1;
          charging = (status === 2 || status === 6 || status === 7 || status === 8);
        } else {
          exists = false;
        }

        resolve({ percent, charging, exists });
      } catch (e) {
        resolve({ percent: 100, charging: false, exists: false });
      }
    });
  });
}

// Query Bluetooth devices via PowerShell using execFile
function queryBluetoothBattery() {
  return new Promise((resolve) => {
    const script = `
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

    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], (error, stdout) => {
      if (error || !stdout.trim()) {
        return resolve([]);
      }
      try {
        const parsed = JSON.parse(stdout);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        resolve(list.map(item => ({
          name: item.name || item.FriendlyName || '',
          percent: item.percent !== undefined ? item.percent : 100,
          mac: item.mac || '',
          category: item.category || 'Bluetooth Device'
        })));
      } catch (e) {
        resolve([]);
      }
    });
  });
}

// Poll Stats (Fast: CPU & RAM)
function pollStats() {
  cachedStats.cpu = getCpuUsage();
  cachedStats.ram = getRamUsage();
  
  // Broadcast CPU/RAM immediately
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('stats-update', cachedStats);
  }
}

// Poll Hardware Stats (Slow: Battery & Bluetooth)
let isQueryingHardware = false;
async function queryHardwareStats() {
  if (isQueryingHardware) return;
  isQueryingHardware = true;

  try {
    const batteryPromise = queryLaptopBattery();
    const bluetoothPromise = queryBluetoothBattery();

    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));

    const battery = await Promise.race([batteryPromise, timeout(10000)]).catch(err => {
      console.error('Battery query failed or timed out:', err);
      return cachedStats.laptop_battery;
    });

    const bluetooth = await Promise.race([bluetoothPromise, timeout(10000)]).catch(err => {
      console.error('Bluetooth query failed or timed out:', err);
      return cachedStats.bluetooth;
    });

    cachedStats.laptop_battery = battery;
    cachedStats.bluetooth = bluetooth;

    // Broadcast immediately upon update
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send('stats-update', cachedStats);
    }
  } catch (err) {
    console.error('Error in queryHardwareStats:', err);
  } finally {
    isQueryingHardware = false;
  }
}

// Set the widget's owner to Progman so it stays on the desktop but retains full transparency
function pinWidgetToDesktop() {
  const script = `
$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class DesktopOwner {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong", SetLastError = true)]
    private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

    public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) {
        if (IntPtr.Size == 8) {
            return SetWindowLongPtr64(hWnd, nIndex, dwNewLong);
        } else {
            return new IntPtr(SetWindowLong32(hWnd, nIndex, dwNewLong.ToInt32()));
        }
    }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public const int GWLP_HWNDPARENT = -8;

    public static bool ApplyOwner() {
        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return false;

        bool found = false;
        EnumWindows(new EnumWindowsProc((hwnd, lParam) => {
            StringBuilder sbClass = new StringBuilder(256);
            GetClassName(hwnd, sbClass, sbClass.Capacity);
            if (sbClass.ToString() == "Chrome_WidgetWin_1") {
                StringBuilder sbTitle = new StringBuilder(256);
                GetWindowText(hwnd, sbTitle, sbTitle.Capacity);
                if (sbTitle.ToString() == "Battery Widget") {
                    SetWindowLongPtr(hwnd, GWLP_HWNDPARENT, progman);
                    found = true;
                }
            }
            return true;
        }), IntPtr.Zero);
        return found;
    }
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
[DesktopOwner]::ApplyOwner()
`;

  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], (error, stdout) => {
    if (error) {
      console.error('Failed to set widget owner to Progman:', error);
    } else {
      console.log('Set owner result:', stdout.trim());
    }
  });
}

// Create Widget Window
function createWidgetWindow() {
  if (widgetWindow) return;

  loadConfig();

  const slotWidth = 85;
  const paddingWidth = 48; // card horizontal padding (24 * 2)
  const shadowPadding = 24; // shadow margins (12 * 2)
  const visibleSlots = config.widget.visibleSlots || 4;
  let baseWidth = paddingWidth + visibleSlots * slotWidth;
  if (visibleSlots === 1) {
    baseWidth = 250; // Extra width to accommodate the side-by-side device details!
  }
  const width = Math.round((baseWidth + shadowPadding) * config.widget.scale);
  const height = Math.round((150 + shadowPadding) * config.widget.scale);

  // Position calculation (Top-Right Default)
  let windowX = config.widget.x;
  let windowY = config.widget.y;
  
  if (windowX === -1 || windowY === -1) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;
    windowX = screenWidth - width - 40;
    windowY = 40;
    config.widget.x = windowX;
    config.widget.y = windowY;
    saveConfig(config);
  }

  widgetWindow = new BrowserWindow({
    width: width,
    height: height,
    x: windowX,
    y: windowY,
    frame: false,
    transparent: true,
    backgroundMaterial: 'acrylic',
    resizable: false,
    alwaysOnTop: config.widget.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  widgetWindow.loadFile('widget.html');

  // Pin to desktop after a short delay to ensure OS registration
  setTimeout(pinWidgetToDesktop, 1000);

  // Handle click-through configuration
  if (config.widget.clickThrough) {
    widgetWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  widgetWindow.on('show', () => {
    if (updateTrayMenu) updateTrayMenu();
  });

  widgetWindow.on('hide', () => {
    if (updateTrayMenu) updateTrayMenu();
  });

  widgetWindow.on('minimize', (event) => {
    event.preventDefault();
    setTimeout(() => {
      if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.restore();
      }
    }, 50);
  });

  widgetWindow.on('closed', () => {
    widgetWindow = null;
    if (updateTrayMenu) updateTrayMenu();
  });
}

// Create Settings Window
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 650,
    height: 720,
    resizable: false,
    autoHideMenuBar: true,
    title: 'Battery Widget Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  settingsWindow.loadFile('settings.html');

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// Create System Tray
function createTray() {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_BASE64);
  tray = new Tray(icon);
  tray.setToolTip('iOS Battery Widget');

  updateTrayMenu = () => {
    const isVisible = widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible();
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Settings...', click: createSettingsWindow },
      {
        label: isVisible ? 'Hide Widget' : 'Show Widget',
        click: () => {
          if (isVisible) {
            if (widgetWindow) widgetWindow.hide();
          } else {
            if (!widgetWindow || widgetWindow.isDestroyed()) {
              createWidgetWindow();
            } else {
              widgetWindow.show();
            }
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: config.widget.alwaysOnTop,
        click: (item) => {
          config.widget.alwaysOnTop = item.checked;
          saveConfig(config);
          if (widgetWindow) {
            widgetWindow.setAlwaysOnTop(item.checked);
          }
        }
      },
      {
        label: 'Click Through',
        type: 'checkbox',
        checked: config.widget.clickThrough,
        click: (item) => {
          config.widget.clickThrough = item.checked;
          saveConfig(config);
          if (widgetWindow) {
            widgetWindow.setIgnoreMouseEvents(item.checked, { forward: true });
          }
        }
      },
      { type: 'separator' },
      { label: 'Exit', click: () => app.quit() }
    ]);
    tray.setContextMenu(contextMenu);
  };

  updateTrayMenu();

  tray.on('double-click', () => {
    createSettingsWindow();
  });
}

// Create startup shortcut pointing to launch.vbs in user's Startup folder
function setupStartupShortcut() {
  try {
    const startupPath = path.join(process.env.APPDATA, 'Microsoft\\Windows\\Start Menu\\Programs\\Startup\\BatteryWidget.lnk');
    let targetPath = '';
    let workingDir = '';

    if (app.isPackaged) {
      targetPath = process.execPath;
      workingDir = path.dirname(process.execPath);
    } else {
      const launchVbs = path.join(__dirname, 'launch.vbs');
      if (!fs.existsSync(launchVbs)) {
        console.log('launch.vbs not found, skipping startup shortcut creation in dev mode.');
        return;
      }
      targetPath = launchVbs;
      workingDir = __dirname;
    }

    const script = `
      $ShortcutFile = "${startupPath.replace(/\\/g, '\\\\')}"
      $WScriptShell = New-Object -ComObject WScript.Shell
      $Shortcut = $WScriptShell.CreateShortcut($ShortcutFile)
      $Shortcut.TargetPath = "${targetPath.replace(/\\/g, '\\\\')}"
      $Shortcut.WorkingDirectory = "${workingDir.replace(/\\/g, '\\\\')}"
      $Shortcut.Save()
    `;

    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], (error) => {
      if (error) {
        console.error('Failed to create startup shortcut:', error);
      } else {
        console.log('Startup shortcut verified.');
      }
    });
  } catch (err) {
    console.error('Error in setupStartupShortcut:', err);
  }
}

// App Readiness
app.whenReady().then(() => {
  loadConfig();
  createWidgetWindow();
  createTray();
  setupStartupShortcut();

  // Initialize CPU times before polling
  const cpus = os.cpus();
  let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
  for (const cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }
  cpuUsageHistory = { idle, total: user + nice + sys + idle + irq };

  // Polling loop for stats (Fast: CPU & RAM every 3 seconds)
  setInterval(pollStats, 3000);
  pollStats(); // Initial fast poll

  // Polling loop for hardware (Slow: Battery & Bluetooth every 10 seconds)
  setInterval(queryHardwareStats, 10000);
  queryHardwareStats(); // Initial hardware poll
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handler Registrations
ipcMain.handle('get-config', () => {
  return config;
});

ipcMain.handle('save-config', (event, newConfig) => {
  saveConfig(newConfig);

  // Apply real-time window adjustments if widget exists
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    const slotWidth = 85;
    const paddingWidth = 48; // card horizontal padding (24 * 2)
    const shadowPadding = 24; // shadow margins (12 * 2)
    const visibleSlots = newConfig.widget.visibleSlots || 4;
    let baseWidth = paddingWidth + visibleSlots * slotWidth;
    if (visibleSlots === 1) {
      baseWidth = 250; // Extra width to accommodate the side-by-side device details!
    }
    const width = Math.round((baseWidth + shadowPadding) * newConfig.widget.scale);
    const height = Math.round((150 + shadowPadding) * newConfig.widget.scale);
    widgetWindow.setSize(width, height);
    widgetWindow.setAlwaysOnTop(newConfig.widget.alwaysOnTop);
    widgetWindow.setIgnoreMouseEvents(newConfig.widget.clickThrough, { forward: true });
  }
  return config;
});

ipcMain.on('resize-window', (event, width, height) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setSize(Math.round(width), Math.round(height));
  }
});

ipcMain.handle('get-system-stats', () => {
  return cachedStats;
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setIgnoreMouseEvents(ignore, options);
  }
});

ipcMain.on('drag-window', (event, movementX, movementY) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const [x, y] = win.getPosition();
    const newX = x + movementX;
    const newY = y + movementY;
    win.setPosition(newX, newY);
    
    // Save new position
    config.widget.x = newX;
    config.widget.y = newY;
    // Don't write to disk on every single pixel movement; throttle or debouncing is handled
    // We will save back to config, and we can persist it to file debounced or when drag stops.
    // Let's persist it to config object so it's live, and write to disk in a debounced way.
    if (global.dragSaveTimeout) clearTimeout(global.dragSaveTimeout);
    global.dragSaveTimeout = setTimeout(() => {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    }, 1000);
  }
});

ipcMain.on('open-settings', () => {
  createSettingsWindow();
});
