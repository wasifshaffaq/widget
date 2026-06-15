const { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const koffi = require('koffi');

// Disable hardware acceleration to prevent ghosting on transparent Progman child windows
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// ── Win32 API bindings for desktop embedding ──────────────────────────
const user32 = koffi.load('user32.dll');

// Proper koffi type definitions
const HWND = koffi.pointer('HWND', koffi.opaque());
const BOOL = 'int';
const LPARAM = 'intptr';
const WPARAM = 'uintptr';
const LRESULT = 'intptr';

// Callback type for EnumWindows
const WNDENUMPROC = koffi.proto('WNDENUMPROC', BOOL, [HWND, LPARAM]);

// Win32 function declarations
const FindWindowW = user32.func('FindWindowW', HWND, ['str16', 'str16']);
const FindWindowExW = user32.func('FindWindowExW', HWND, [HWND, HWND, 'str16', 'str16']);
const SendMessageTimeoutW = user32.func('SendMessageTimeoutW', LRESULT, [HWND, 'uint', WPARAM, LPARAM, 'uint', 'uint', koffi.pointer(koffi.opaque())]);
const EnumWindows = user32.func('EnumWindows', BOOL, [koffi.pointer(WNDENUMPROC), LPARAM]);
const SetParent = user32.func('SetParent', HWND, [HWND, HWND]);
const SetWindowLongPtrW = user32.func('SetWindowLongPtrW', 'intptr', [HWND, 'int', 'intptr']);
const GetWindowLongPtrW = user32.func('GetWindowLongPtrW', 'intptr', [HWND, 'int']);
const SetWindowPos = user32.func('SetWindowPos', BOOL, [HWND, HWND, 'int', 'int', 'int', 'int', 'uint']);
const GetShellWindow = user32.func('GetShellWindow', HWND, []);
const GetClassNameW = user32.func('GetClassNameW', 'int', [HWND, koffi.out('str16'), 'int']);

// Constants
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_NOACTIVATE = 0x08000000;
const SWP_NOMOVE = 0x0002;
const SWP_NOSIZE = 0x0001;
const SWP_NOZORDER = 0x0004;
const SWP_FRAMECHANGED = 0x0020;
const SWP_NOACTIVATE = 0x0010;
const SMTO_NORMAL = 0x0000;

// Desktop embedding state
let workerWHwnd = null;

// Configuration Path Helper
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

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
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(data);
      // Merge with defaults to ensure new fields are populated
      config.widget = { ...DEFAULT_CONFIG.widget, ...config.widget };
      if (!config.slots || config.slots.length !== 4) {
        config.slots = [ ...DEFAULT_CONFIG.slots ];
      }
    } else {
      // Fallback: Check if there's a template config in the app directory
      const templatePath = path.join(__dirname, 'config.json');
      if (fs.existsSync(templatePath)) {
        try {
          const data = fs.readFileSync(templatePath, 'utf-8');
          config = JSON.parse(data);
          // Merge with defaults
          config.widget = { ...DEFAULT_CONFIG.widget, ...config.widget };
          if (!config.slots || config.slots.length !== 4) {
            config.slots = [ ...DEFAULT_CONFIG.slots ];
          }
          saveConfig(config);
        } catch (templateErr) {
          console.error('Failed to load template config, using defaults:', templateErr);
          saveConfig(DEFAULT_CONFIG);
        }
      } else {
        saveConfig(DEFAULT_CONFIG);
      }
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
    const configPath = getConfigPath();
    // Ensure parent directory exists before writing
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
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

// ── Desktop Embedding ─────────────────────────────────────────────────
// Embeds the Electron widget window as a child of the desktop's WorkerW
// window, so it sits behind all application windows (like Rainmeter).
//
// The standard Windows desktop hierarchy after sending 0x052C to Progman:
//
//   Desktop (root)
//     ├── WorkerW          <-- empty; this is where we embed our widget
//     └── Progman
//           └── SHELLDLL_DefView  (desktop icons live here)
//
// By SetParent-ing our widget into the empty WorkerW, the widget appears
// on the desktop surface, behind all normal application windows.
//

// Helper to get the class name of a window handle
function getWindowClassName(hwnd) {
  try {
    const buf = Buffer.alloc(512);
    const len = GetClassNameW(hwnd, buf, 256);
    if (len <= 0) return '';
    return buf.toString('utf16le', 0, len * 2);
  } catch {
    return '';
  }
}

function findDesktopWorkerW() {
  // Strategy 1: Find the Progman window directly via FindWindow
  let progman = FindWindowW('Progman', null);
  
  // Strategy 2: If FindWindow fails, try GetShellWindow (returns Progman or its replacement)
  if (!progman) {
    console.log('[Desktop Embed] FindWindowW("Progman") returned null, trying GetShellWindow...');
    const shellWin = GetShellWindow();
    if (shellWin) {
      const className = getWindowClassName(shellWin);
      console.log('[Desktop Embed] GetShellWindow returned class:', className);
      if (className === 'Progman') {
        progman = shellWin;
      }
    }
  }

  if (!progman) {
    console.error('[Desktop Embed] Could not find Progman window via any strategy');
    return null;
  }
  console.log('[Desktop Embed] Found Progman');

  // Send undocumented message 0x052C to Progman.
  // This forces Windows Explorer to spawn a WorkerW window behind the desktop icons.
  const resultBuf = Buffer.alloc(8);
  SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000, resultBuf);
  console.log('[Desktop Embed] Sent 0x052C to spawn WorkerW');

  // Find the WorkerW that contains SHELLDLL_DefView (desktop icons).
  // We enumerate all top-level windows to find it.
  let workerWWithShellView = null;

  const findShellViewParent = koffi.register((hwnd, _lParam) => {
    const shellView = FindWindowExW(hwnd, null, 'SHELLDLL_DefView', null);
    if (shellView) {
      workerWWithShellView = hwnd;
      return 0; // Stop enumeration
    }
    return 1; // Continue
  }, koffi.pointer(WNDENUMPROC));

  EnumWindows(findShellViewParent, 0);
  koffi.unregister(findShellViewParent);

  if (!workerWWithShellView) {
    // SHELLDLL_DefView might live directly inside Progman (no WorkerW sibling yet).
    // Check if Progman itself contains SHELLDLL_DefView
    const shellInProgman = FindWindowExW(progman, null, 'SHELLDLL_DefView', null);
    if (shellInProgman) {
      console.log('[Desktop Embed] SHELLDLL_DefView found inside Progman; embedding into Progman');
      return progman;
    }
    console.error('[Desktop Embed] Could not find SHELLDLL_DefView anywhere');
    return progman; // Last resort: try Progman anyway
  }

  // Now find the OTHER WorkerW — the empty one that was spawned by 0x052C.
  // Use FindWindowExW to enumerate WorkerW windows after the one with SHELLDLL_DefView.
  const nextWorkerW = FindWindowExW(null, workerWWithShellView, 'WorkerW', null);
  if (nextWorkerW) {
    console.log('[Desktop Embed] Found empty WorkerW behind desktop icons');
    return nextWorkerW;
  }

  // If no sibling WorkerW, embed into Progman directly
  console.log('[Desktop Embed] No sibling WorkerW found; embedding into Progman');
  return progman;
}

// Convert Electron's native window handle Buffer to a koffi-compatible HWND
function bufferToHwnd(buffer) {
  // Electron's getNativeWindowHandle() returns a Buffer containing the raw HWND
  // On 64-bit Windows, HWND is 8 bytes; on 32-bit it's 4 bytes
  if (buffer.length >= 8) {
    return koffi.as(buffer.readBigUInt64LE(0), HWND);
  } else if (buffer.length >= 4) {
    return koffi.as(buffer.readUInt32LE(0), HWND);
  }
  return null;
}

function embedInDesktop() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return false;

  try {
    // Get the native HWND of our Electron window
    const widgetHwndBuffer = widgetWindow.getNativeWindowHandle();
    const widgetHwnd = bufferToHwnd(widgetHwndBuffer);

    if (!widgetHwnd) {
      console.error('[Desktop Embed] Could not get widget native window handle');
      return false;
    }
    console.log('[Desktop Embed] Widget HWND obtained');

    // Find the desktop embedding target (WorkerW or Progman fallback)
    const desktopHwnd = findDesktopWorkerW();
    if (!desktopHwnd) {
      console.error('[Desktop Embed] Desktop embedding failed — no target window. Widget will float as normal window.');
      return false;
    }

    // Embed the widget as a child of the desktop window
    const prevParent = SetParent(widgetHwnd, desktopHwnd);
    if (!prevParent) {
      console.error('[Desktop Embed] SetParent failed');
      return false;
    }

    // Adjust extended styles: ensure tool window + no activate
    const exStyle = Number(GetWindowLongPtrW(widgetHwnd, GWL_EXSTYLE));
    SetWindowLongPtrW(widgetHwnd, GWL_EXSTYLE, exStyle | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);

    // Force style update
    SetWindowPos(widgetHwnd, null, 0, 0, 0, 0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE);

    // Reposition widget to saved config coordinates
    widgetWindow.setPosition(config.widget.x, config.widget.y);

    workerWHwnd = desktopHwnd;
    console.log('[Desktop Embed] ✓ Widget successfully embedded into desktop layer!');
    return true;
  } catch (err) {
    console.error('[Desktop Embed] Error during embedding:', err);
    return false;
  }
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

  // Verify that window is within visible screen bounds
  let isVisible = false;
  if (windowX !== -1 && windowY !== -1) {
    const displays = screen.getAllDisplays();
    for (const display of displays) {
      const bounds = display.bounds;
      // If window's top-left corner is inside this display's coordinates, it is visible
      if (windowX >= bounds.x && windowX < bounds.x + bounds.width &&
          windowY >= bounds.y && windowY < bounds.y + bounds.height) {
        isVisible = true;
        break;
      }
    }
  }
  
  if (windowX === -1 || windowY === -1 || !isVisible) {
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
    resizable: false,
    skipTaskbar: true,
    type: 'toolbar',
    hasShadow: false,
    show: false, // Don't show until embedded into desktop
    title: 'Battery Widget',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  widgetWindow.loadFile('widget.html');

  // Once the content is ready, embed the widget into the desktop layer
  widgetWindow.webContents.once('did-finish-load', () => {
    // Small delay to ensure window handle is fully initialized
    setTimeout(() => {
      const embedded = embedInDesktop();
      if (embedded) {
        console.log('[Widget] Embedded into desktop — showing widget');
      } else {
        // Fallback: if embedding fails, show as normal window with alwaysOnTop behavior
        console.warn('[Widget] Desktop embedding failed — falling back to normal window mode');
        widgetWindow.setAlwaysOnTop(config.widget.alwaysOnTop);
      }
      widgetWindow.show();

      // Handle click-through configuration
      if (config.widget.clickThrough) {
        widgetWindow.setIgnoreMouseEvents(true, { forward: true });
      }
    }, 100);
  });

  widgetWindow.on('show', () => {
    if (updateTrayMenu) updateTrayMenu();
  });

  widgetWindow.on('hide', () => {
    if (updateTrayMenu) updateTrayMenu();
  });

  widgetWindow.on('closed', () => {
    widgetWindow = null;
    workerWHwnd = null;
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
          // Only apply alwaysOnTop in fallback mode (not desktop-embedded)
          if (widgetWindow && !workerWHwnd) {
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
    // Only apply alwaysOnTop in fallback mode (not desktop-embedded)
    if (!workerWHwnd) {
      widgetWindow.setAlwaysOnTop(newConfig.widget.alwaysOnTop);
    }
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
      saveConfig(config);
    }, 1000);
  }
});

ipcMain.on('open-settings', () => {
  createSettingsWindow();
});
