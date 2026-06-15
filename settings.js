let config = null;
let detectedBluetoothDevices = [];

function cleanBluetoothName(name) {
  if (!name) return '';
  return name.replace(/\s+(hands-free|hands-free ag|hands-free ag audio|stereo|avrcp transport)$/i, '').trim();
}

// Form DOM bindings
const scaleInput = document.getElementById('scale');
const scaleVal = document.getElementById('scaleVal');
const opacityInput = document.getElementById('opacity');
const opacityVal = document.getElementById('opacityVal');
const updateIntervalInput = document.getElementById('updateIntervalMs');
const updateIntervalVal = document.getElementById('updateIntervalVal');

const backgroundColorInput = document.getElementById('backgroundColor');
const accentColorInput = document.getElementById('accentColor');
const xInput = document.getElementById('x');
const yInput = document.getElementById('y');

const alwaysOnTopInput = document.getElementById('alwaysOnTop');
const clickThroughInput = document.getElementById('clickThrough');
const showPercentageTextInput = document.getElementById('showPercentageText');
const visibleSlotsInput = document.getElementById('visibleSlots');

const slotsContainer = document.getElementById('slotsContainer');
const settingsForm = document.getElementById('settingsForm');

// Tab switcher
function switchTab(tabId) {
  const buttons = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  buttons.forEach(btn => btn.classList.remove('active'));
  contents.forEach(content => content.classList.remove('active'));

  // Activating clicked tab
  const activeBtn = Array.from(buttons).find(btn => btn.outerHTML.includes(tabId));
  if (activeBtn) activeBtn.classList.add('active');
  
  const activeContent = document.getElementById(`tab-${tabId}`);
  if (activeContent) activeContent.classList.add('active');
}

// Live range output updates
scaleInput.addEventListener('input', () => scaleVal.innerText = parseFloat(scaleInput.value).toFixed(2));
opacityInput.addEventListener('input', () => opacityVal.innerText = parseFloat(opacityInput.value).toFixed(2));
updateIntervalInput.addEventListener('input', () => updateIntervalVal.innerText = `${updateIntervalInput.value / 1000}s`);

// Reset Position helper
function resetToDefaultPosition() {
  xInput.value = -1;
  yInput.value = -1;
}

// Re-render slots when slot count changes
visibleSlotsInput.addEventListener('change', () => {
  renderSlots();
});

// Load and populate settings
async function loadSettings() {
  try {
    config = await window.electronAPI.getConfig();
    const stats = await window.electronAPI.getSystemStats();
    
    // Store detected Bluetooth devices for dropdown options
    if (stats && stats.bluetooth) {
      const cleanedNames = stats.bluetooth.map(d => cleanBluetoothName(d.name));
      detectedBluetoothDevices = [...new Set(cleanedNames)]; // Deduplicate
    }

    // General tab population
    scaleInput.value = config.widget.scale;
    scaleVal.innerText = parseFloat(config.widget.scale).toFixed(2);
    
    opacityInput.value = config.widget.opacity;
    opacityVal.innerText = parseFloat(config.widget.opacity).toFixed(2);

    updateIntervalInput.value = config.widget.updateIntervalMs;
    updateIntervalVal.innerText = `${config.widget.updateIntervalMs / 1000}s`;

    backgroundColorInput.value = config.widget.backgroundColor;
    accentColorInput.value = config.widget.accentColor;
    xInput.value = config.widget.x;
    yInput.value = config.widget.y;

    alwaysOnTopInput.checked = config.widget.alwaysOnTop;
    clickThroughInput.checked = config.widget.clickThrough;
    showPercentageTextInput.checked = config.widget.showPercentageText;
    visibleSlotsInput.value = config.widget.visibleSlots || 4;

    // Slots tab population
    renderSlots();
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// Render Slot Configurations dynamically
function renderSlots() {
  slotsContainer.innerHTML = '';
  const count = parseInt(visibleSlotsInput.value) || 4;

  config.slots.slice(0, count).forEach((slot, index) => {
    const slotCard = document.createElement('div');
    slotCard.className = 'slot-config-card';
    
    const bluetoothOptions = detectedBluetoothDevices.length > 0
      ? detectedBluetoothDevices.map(d => `<option value="${d}" ${cleanBluetoothName(slot.name) === d ? 'selected' : ''}>${d}</option>`).join('')
      : `<option value="">(No devices detected)</option>`;

    slotCard.innerHTML = `
      <div class="slot-config-header">
        <span>Slot ${slot.id} configuration</span>
        <span>ID: slot-${slot.id}</span>
      </div>
      <div class="slot-config-fields">
        <div class="form-group">
          <label>Data Source</label>
          <select id="slot-${slot.id}-type" onchange="toggleSlotSubfields(${slot.id})">
            <option value="none" ${slot.type === 'none' ? 'selected' : ''}>None (Empty Circle)</option>
            <option value="cpu" ${slot.type === 'cpu' ? 'selected' : ''}>CPU Usage</option>
            <option value="ram" ${slot.type === 'ram' ? 'selected' : ''}>RAM Usage</option>
            <option value="laptop_battery" ${slot.type === 'laptop_battery' ? 'selected' : ''}>Laptop Battery</option>
            <option value="bluetooth_device" ${slot.type === 'bluetooth_device' ? 'selected' : ''}>Bluetooth Device</option>
            <option value="simulated" ${slot.type === 'simulated' ? 'selected' : ''}>Simulated (Mock Device)</option>
          </select>
        </div>

        <div class="form-group">
          <label>Device Icon</label>
          <select id="slot-${slot.id}-icon">
            <option value="phone" ${slot.icon === 'phone' ? 'selected' : ''}>iPhone</option>
            <option value="earbuds" ${slot.icon === 'earbuds' ? 'selected' : ''}>AirPods</option>
            <option value="case" ${slot.icon === 'case' ? 'selected' : ''}>AirPods Case</option>
            <option value="watch" ${slot.icon === 'watch' ? 'selected' : ''}>Apple Watch</option>
            <option value="laptop" ${slot.icon === 'laptop' ? 'selected' : ''}>Laptop PC</option>
            <option value="cpu" ${slot.icon === 'cpu' ? 'selected' : ''}>CPU Icon</option>
            <option value="ram" ${slot.icon === 'ram' ? 'selected' : ''}>RAM Icon</option>
            <option value="bluetooth" ${slot.icon === 'bluetooth' ? 'selected' : ''}>Bluetooth Icon</option>
          </select>
        </div>

        <!-- Subfields container -->
        <div class="slot-config-subfields" id="slot-${slot.id}-subfields" style="display: none;">
          
          <!-- Bluetooth device names selection -->
          <div class="form-group" id="slot-${slot.id}-bt-group" style="display: none; grid-column: span 2;">
            <label>Select Bluetooth Device</label>
            <select id="slot-${slot.id}-bt-select" style="margin-bottom: 8px;">
              ${bluetoothOptions}
            </select>
            <label style="margin-top: 4px;">Or Type Manually</label>
            <input type="text" id="slot-${slot.id}-bt-manual" value="${slot.name}" placeholder="Leave blank to auto-detect connected device">
            <span style="font-size: 11px; color: #8e8e93; display: block; margin-top: 4px; line-height: 1.3;">* Leaving this blank automatically detects and binds the first connected Bluetooth device, updating the icon accordingly.</span>
          </div>

          <!-- Mock Device settings -->
          <div class="form-group" id="slot-${slot.id}-mock-name-group" style="display: none; grid-column: span 2;">
            <label>Device Label Name</label>
            <input type="text" id="slot-${slot.id}-mock-name" value="${slot.name || ''}" placeholder="iPhone / Watch">
          </div>

          <div class="form-group" id="slot-${slot.id}-mock-percent-group" style="display: none;">
            <label>Mock Charge Level (%)</label>
            <input type="number" id="slot-${slot.id}-mock-percent" min="0" max="100" value="${slot.mockPercent || 100}">
          </div>

          <div class="form-group" id="slot-${slot.id}-mock-charging-group" style="display: none; justify-content: center; align-items: flex-start; margin-top: 14px;">
            <div class="checkbox-group">
              <input type="checkbox" id="slot-${slot.id}-mock-charging" ${slot.mockCharging ? 'checked' : ''}>
              <label for="slot-${slot.id}-mock-charging">Is Charging</label>
            </div>
          </div>
          
        </div>
      </div>
    `;

    slotsContainer.appendChild(slotCard);
    toggleSlotSubfields(slot.id); // Trigger visibility rules initially
  });
}

// Toggle subfields dynamically based on selected Data Source Type
function toggleSlotSubfields(slotId) {
  const typeSelect = document.getElementById(`slot-${slotId}-type`);
  const subfields = document.getElementById(`slot-${slotId}-subfields`);
  const btGroup = document.getElementById(`slot-${slotId}-bt-group`);
  const mockNameGroup = document.getElementById(`slot-${slotId}-mock-name-group`);
  const mockPercentGroup = document.getElementById(`slot-${slotId}-mock-percent-group`);
  const mockChargingGroup = document.getElementById(`slot-${slotId}-mock-charging-group`);

  const val = typeSelect.value;

  if (val === 'bluetooth_device') {
    subfields.style.display = 'grid';
    btGroup.style.display = 'block';
    mockNameGroup.style.display = 'none';
    mockPercentGroup.style.display = 'none';
    mockChargingGroup.style.display = 'none';
  } else if (val === 'simulated') {
    subfields.style.display = 'grid';
    btGroup.style.display = 'none';
    mockNameGroup.style.display = 'block';
    mockPercentGroup.style.display = 'block';
    mockChargingGroup.style.display = 'flex';
  } else {
    subfields.style.display = 'none';
    btGroup.style.display = 'none';
    mockNameGroup.style.display = 'none';
    mockPercentGroup.style.display = 'none';
    mockChargingGroup.style.display = 'none';
  }
}

// Save Changes
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const newConfig = {
    widget: {
      x: parseInt(xInput.value),
      y: parseInt(yInput.value),
      scale: parseFloat(scaleInput.value),
      opacity: parseFloat(opacityInput.value),
      alwaysOnTop: alwaysOnTopInput.checked,
      clickThrough: clickThroughInput.checked,
      theme: 'dark',
      blur: config.widget.blur || 32,
      backgroundColor: backgroundColorInput.value,
      borderColor: config.widget.borderColor, // Preserve default
      accentColor: accentColorInput.value,
      showPercentageText: showPercentageTextInput.checked,
      updateIntervalMs: parseInt(updateIntervalInput.value),
      visibleSlots: parseInt(visibleSlotsInput.value)
    },
    slots: []
  };

  // Compile slots settings safely
  for (let i = 1; i <= 4; i++) {
    const typeEl = document.getElementById(`slot-${i}-type`);
    if (!typeEl) {
      // If card was hidden, preserve previous settings
      newConfig.slots.push(config.slots[i - 1]);
      continue;
    }
    const type = typeEl.value;
    const icon = document.getElementById(`slot-${i}-icon`).value;
    
    let name = '';
    let mockPercent = 100;
    let mockCharging = false;

    if (type === 'bluetooth_device') {
      const selectVal = document.getElementById(`slot-${i}-bt-select`).value;
      const manualVal = document.getElementById(`slot-${i}-bt-manual`).value;
      name = manualVal.trim() || selectVal;
    } else if (type === 'simulated') {
      name = document.getElementById(`slot-${i}-mock-name`).value.trim() || 'Device';
      mockPercent = parseInt(document.getElementById(`slot-${i}-mock-percent`).value);
      mockCharging = document.getElementById(`slot-${i}-mock-charging`).checked;
    }

    newConfig.slots.push({
      id: i,
      type,
      name,
      icon,
      mockPercent: isNaN(mockPercent) ? 100 : Math.min(100, Math.max(0, mockPercent)),
      mockCharging
    });
  }

  try {
    await window.electronAPI.saveConfig(newConfig);
    window.close(); // Close Settings window
  } catch (err) {
    console.error('Failed to save settings:', err);
    alert('Failed to save settings: ' + err.message);
  }
});

// Run settings loader
loadSettings();
