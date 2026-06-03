// Icons SVG Map
const ICONS = {
  phone: `<svg class="phone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="6" y="2" width="12" height="20" rx="3" ry="3"></rect>
    <path d="M11 5h2"></path>
  </svg>`,
  earbuds: `<svg class="earbuds-icon" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 6.5C8 5.12 6.88 4 5.5 4S3 5.12 3 6.5C3 7.62 3.73 8.57 4.75 8.87v5.63c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V9.45c.74-.4 1.25-1.17 1.25-2.05z"/>
    <path d="M21 6.5c0-1.38-1.12-2.5-2.5-2.5S16 5.12 16 6.5c0 .88.51 1.65 1.25 2.05v5.63c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V8.87c1.02-.3 1.75-1.25 1.75-2.37z"/>
  </svg>`,
  case: `<svg class="case-icon" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="12" height="16" rx="4" ry="4"></rect>
    <line x1="6" y1="9" x2="18" y2="9" stroke="currentColor" stroke-width="1.5" style="opacity: 0.15;"></line>
    <circle cx="12" cy="14" r="1" style="opacity: 0.8;"></circle>
  </svg>`,
  watch: `<svg class="watch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="6" y="6" width="12" height="12" rx="3"></rect>
    <path d="M9 6V2h6v4M9 18v4h6v-4"></path>
    <circle cx="12" cy="12" r="2.2"></circle>
  </svg>`,
  laptop: `<svg class="laptop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="12" rx="2"></rect>
    <path d="M2 20h20M5 16v4M19 16v4"></path>
  </svg>`,
  cpu: `<svg class="cpu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2"></rect>
    <path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3"></path>
  </svg>`,
  ram: `<svg class="ram-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="8" width="20" height="8" rx="1"></rect>
    <path d="M6 8v3M10 8v3M14 8v3M18 8v3M6 13v3M10 13v3M14 13v3M18 13v3"></path>
  </svg>`,
  bluetooth: `<svg class="bluetooth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="m7 7 10 10-5 5V2l5 5L7 17"></path>
  </svg>`
};

// State Variables
let config = null;
let lastStats = null;
const CIRCUMFERENCE = 175.929; // 2 * Math.PI * 28

// Elements
const widgetContainer = document.getElementById('widgetContainer');
const widgetCard = document.getElementById('widgetCard');

// Initialize
async function init() {
  try {
    config = await window.electronAPI.getConfig();
    applyConfig();
    
    const stats = await window.electronAPI.getSystemStats();
    lastStats = stats;
    updateUI(stats);
  } catch (err) {
    console.error('Failed to initialize widget:', err);
  }
}

// Apply Styles / Config
function applyConfig() {
  if (!config) return;

  const root = document.documentElement;
  root.style.setProperty('--background-color', config.widget.backgroundColor);
  root.style.setProperty('--border-color', config.widget.borderColor);
  root.style.setProperty('--accent-color', config.widget.accentColor);
  root.style.setProperty('--blur-radius', `${config.widget.blur}px`);
  root.style.setProperty('--widget-scale', config.widget.scale);
  root.style.setProperty('--widget-opacity', config.widget.opacity);

  // Set the unscaled dimensions of the container to match config slots exactly + shadow padding
  const slotWidth = 85;
  const paddingWidth = 48; // card horizontal padding (24 * 2)
  const shadowPadding = 24; // shadow margins (12 * 2)
  const visibleSlots = config.widget.visibleSlots || 4;
  
  let baseWidth = paddingWidth + visibleSlots * slotWidth;
  if (visibleSlots === 1) {
    baseWidth = 250; // Extra width to accommodate the side-by-side device details!
  }

  widgetContainer.style.width = `${baseWidth + shadowPadding}px`;
  widgetContainer.style.height = `${150 + shadowPadding}px`;
  widgetContainer.style.transform = `scale(${config.widget.scale})`;
  
  // Show/Hide slots and labels based on configuration
  for (let i = 1; i <= 4; i++) {
    const slotEl = document.getElementById(`slot-${i}`);
    if (slotEl) {
      if (i <= visibleSlots) {
        slotEl.style.display = 'flex';
      } else {
        slotEl.style.display = 'none';
      }
    }

    const label = document.getElementById(`label-${i}`);
    if (label) {
      label.style.display = config.widget.showPercentageText ? 'block' : 'none';
    }
  }

  // Set click-through behavior
  window.electronAPI.setIgnoreMouseEvents(config.widget.clickThrough, { forward: true });
}

function cleanBluetoothName(name) {
  if (!name) return '';
  return name.replace(/\s+(hands-free|hands-free ag|hands-free ag audio|stereo|avrcp transport)$/i, '').trim();
}

function formatMacAddress(mac) {
  if (!mac || mac.length !== 12) return mac;
  return mac.match(/.{1,2}/g).join(':').toUpperCase();
}

// Update the visual representation of a slot
function updateSlot(slotIndex, percent, isCharging, iconType, isConnected, customLabel = null) {
  const slotEl = document.getElementById(`slot-${slotIndex}`);
  if (!slotEl) return;

  if (!isConnected) {
    slotEl.className = 'slot empty';
    return;
  }

  slotEl.className = 'slot';

  // Update ring progress
  const bar = slotEl.querySelector('.progress-ring__bar');
  if (bar) {
    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
    bar.style.strokeDashoffset = offset;

    // Apply color logic based on percentage and slot type
    bar.className = 'progress-ring__bar';
    if (percent <= 20) {
      bar.classList.add('low');
    } else if (percent <= 50) {
      bar.classList.add('medium');
    } else {
      bar.classList.add('high');
    }
  }

  // Update icon
  const iconContainer = document.getElementById(`icon-${slotIndex}`);
  if (iconContainer) {
    iconContainer.innerHTML = ICONS[iconType] || ICONS.bluetooth;
  }

  // Update charging bolt
  const charger = document.getElementById(`charge-${slotIndex}`);
  if (charger) {
    if (isCharging) {
      charger.classList.add('active');
    } else {
      charger.classList.remove('active');
    }
  }

  // Update text label
  const label = document.getElementById(`label-${slotIndex}`);
  if (label) {
    // Add space before % to match iOS batteries widget aesthetic
    label.innerText = `${percent} %`;
  }

  // Update name label
  const nameLabel = document.getElementById(`name-${slotIndex}`);
  if (nameLabel) {
    if (customLabel) {
      nameLabel.innerText = customLabel;
      nameLabel.style.display = 'block';
    } else {
      nameLabel.innerText = '';
      nameLabel.style.display = 'none';
    }
  }
}

// Handle statistics update
function updateUI(stats) {
  if (!config || !stats) return;
  lastStats = stats;

  const isSingle = config.widget.visibleSlots === 1;
  const infoPanel = document.getElementById('infoPanel');
  
  if (isSingle) {
    widgetCard.classList.add('single-slot');
    const firstSlot = config.slots[0];
    
    if (firstSlot && firstSlot.type === 'bluetooth_device') {
      if (infoPanel) infoPanel.style.display = 'flex';
      
      let matchedDevice = null;
      let iconType = firstSlot.icon || 'earbuds';
      const hasConfiguredName = firstSlot.name && firstSlot.name.trim() !== '' && firstSlot.name.trim() !== '(No devices detected)';
      
      if (hasConfiguredName) {
        matchedDevice = stats.bluetooth.find(d => {
          if (!d.name) return false;
          const configName = firstSlot.name.toLowerCase().trim();
          const devName = d.name.toLowerCase().trim();
          const cleanConfig = configName.replace(/\s+(hands-free|hands-free ag|hands-free ag audio|stereo|avrcp transport)$/i, '').trim();
          const cleanDev = devName.replace(/\s+(hands-free|hands-free ag|hands-free ag audio|stereo|avrcp transport)$/i, '').trim();
          return cleanDev === cleanConfig || devName.includes(configName) || configName.includes(devName);
        });
      }
      
      if (!matchedDevice && stats.bluetooth && stats.bluetooth.length > 0) {
        // Prioritize audio/wearable devices (earbuds, headphones, watches) over input devices (mice, keyboards)
        matchedDevice = stats.bluetooth.find(d => {
          const cat = (d.category || '').toLowerCase();
          return cat === 'headset' || cat === 'audio device' || cat === 'watch';
        });
        if (!matchedDevice) {
          matchedDevice = stats.bluetooth[0];
        }
      }
      
      if (matchedDevice) {
        document.getElementById('infoTitle').innerText = cleanBluetoothName(matchedDevice.name);
        document.getElementById('infoCategory').innerText = matchedDevice.category || 'Headset';
        document.getElementById('infoMac').innerText = formatMacAddress(matchedDevice.mac);
        
        const badge = document.getElementById('infoBadge');
        badge.innerText = 'Connected';
        badge.className = 'info-badge';
      } else {
        document.getElementById('infoTitle').innerText = 'No Device';
        document.getElementById('infoCategory').innerText = 'Bluetooth';
        document.getElementById('infoMac').innerText = '---';
        
        const badge = document.getElementById('infoBadge');
        badge.innerText = 'Disconnected';
        badge.className = 'info-badge disconnected';
      }
    } else if (firstSlot && firstSlot.type === 'laptop_battery') {
      if (infoPanel) infoPanel.style.display = 'flex';
      document.getElementById('infoTitle').innerText = 'System Battery';
      document.getElementById('infoCategory').innerText = stats.laptop_battery.charging ? 'Charging' : 'On Battery';
      document.getElementById('infoMac').innerText = stats.laptop_battery.exists ? 'Internal hardware' : 'Virtual AC';
      
      const badge = document.getElementById('infoBadge');
      badge.innerText = stats.laptop_battery.charging ? 'Charging' : 'Connected';
      badge.className = 'info-badge';
    } else {
      if (infoPanel) infoPanel.style.display = 'none';
      widgetCard.classList.remove('single-slot');
    }
  } else {
    if (infoPanel) infoPanel.style.display = 'none';
    widgetCard.classList.remove('single-slot');
  }

  config.slots.forEach((slot, index) => {
    const slotIndex = index + 1;

    switch (slot.type) {
      case 'none':
        updateSlot(slotIndex, 0, false, 'bluetooth', false);
        break;

      case 'cpu':
        updateSlot(slotIndex, stats.cpu, false, 'cpu', true, 'CPU');
        break;

      case 'ram':
        updateSlot(slotIndex, stats.ram, false, 'ram', true, 'RAM');
        break;

      case 'laptop_battery':
        if (stats.laptop_battery && stats.laptop_battery.exists) {
          updateSlot(
            slotIndex, 
            stats.laptop_battery.percent, 
            stats.laptop_battery.charging, 
            'laptop', 
            true,
            'Laptop'
          );
        } else {
          // Fallback if no battery hardware (e.g. desktop PC)
          updateSlot(slotIndex, 100, false, 'laptop', true, 'Laptop');
        }
        break;

      case 'bluetooth_device':
        let matchedDevice = null;
        let iconType = slot.icon || 'earbuds';

        // 1. Try to match the configured friendly name if it's set and not empty/default
        const hasConfiguredName = slot.name && slot.name.trim() !== '' && slot.name.trim() !== '(No devices detected)';
        
        if (hasConfiguredName) {
          matchedDevice = stats.bluetooth.find(d => {
            if (!d.name) return false;
            const configName = slot.name.toLowerCase().trim();
            const devName = d.name.toLowerCase().trim();
            const cleanConfig = configName.replace(/\s+(hands-free|hands-free ag|hands-free ag audio|stereo|avrcp transport)$/i, '').trim();
            const cleanDev = devName.replace(/\s+(hands-free|hands-free ag|hands-free ag audio|stereo|avrcp transport)$/i, '').trim();
            return cleanDev === cleanConfig || devName.includes(configName) || configName.includes(devName);
          });
        }

        // 2. If no matched device found (or no custom name configured), fallback to first connected bluetooth device (prioritizing audio/wearables)
        if (!matchedDevice && stats.bluetooth && stats.bluetooth.length > 0) {
          matchedDevice = stats.bluetooth.find(d => {
            const cat = (d.category || '').toLowerCase();
            return cat === 'headset' || cat === 'audio device' || cat === 'watch';
          });
          if (!matchedDevice) {
            matchedDevice = stats.bluetooth[0];
          }
          
          // Intelligently choose icon based on device name
          const lowerName = matchedDevice.name.toLowerCase();
          const lowerCat = (matchedDevice.category || '').toLowerCase();
          if (lowerName.includes('ear') || lowerName.includes('buds') || lowerName.includes('head') || lowerName.includes('free') || lowerName.includes('airpods') || lowerName.includes('pro') || lowerCat.includes('headset') || lowerCat.includes('audio')) {
            iconType = 'earbuds';
          } else if (lowerName.includes('watch') || lowerName.includes('band')) {
            iconType = 'watch';
          } else if (lowerName.includes('mouse') || lowerName.includes('keyboard') || lowerName.includes('pencil') || lowerName.includes('pen') || lowerName.includes('trackpad') || lowerName.includes('input')) {
            iconType = 'bluetooth';
          } else if (lowerName.includes('phone') || lowerName.includes('iphone') || lowerName.includes('android')) {
            iconType = 'phone';
          } else if (lowerName.includes('pc') || lowerName.includes('laptop') || lowerName.includes('book')) {
            iconType = 'laptop';
          } else {
            iconType = 'bluetooth';
          }
        }

        if (matchedDevice) {
          updateSlot(slotIndex, matchedDevice.percent, false, iconType, true, cleanBluetoothName(matchedDevice.name));
        } else {
          // If no Bluetooth device is connected / found, show empty
          updateSlot(slotIndex, 0, false, slot.icon || 'earbuds', false);
        }
        break;

      case 'simulated':
      default:
        // Use custom user mock data
        updateSlot(
          slotIndex, 
          slot.mockPercent, 
          slot.mockCharging, 
          slot.icon, 
          true,
          slot.name
        );
        break;
    }
  });
}

// Window Dragging (Dynamic Resizing Disabled to Remain Constant)
let isDragging = false;
let startX = 0, startY = 0;

widgetCard.addEventListener('mousedown', (e) => {
  if (config.widget.clickThrough) {
    return;
  }
  isDragging = true;
  document.body.classList.add('dragging');
  startX = e.screenX;
  startY = e.screenY;
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (e.buttons === 0) {
    isDragging = false;
    document.body.classList.remove('dragging');
    return;
  }

  if (isDragging) {
    const dx = e.screenX - startX;
    const dy = e.screenY - startY;
    startX = e.screenX;
    startY = e.screenY;
    window.electronAPI.dragWindow(dx, dy);
  }
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  document.body.classList.remove('dragging');
});


// IPC listeners
window.electronAPI.onStatsUpdate((stats) => {
  updateUI(stats);
});

window.electronAPI.onConfigUpdate((newConfig) => {
  config = newConfig;
  applyConfig();
  if (lastStats) {
    updateUI(lastStats);
  }
});

// Run
init();
