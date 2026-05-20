

const DEFAULT_SETTINGS = {
  hp_width: 768, hp_height: 529, hp_autohide: false, hp_theme: false,
  hp_ghost: false, hp_multipeak: false,
  hp_search: false, hp_modifier: 'Shift', hp_sidebar_mode: 'split', 
  hp_bubble_trigger: 'dblclick_head', hp_allow_bubble: true, hp_scroll: false
};

const elements = {
  wInput: document.getElementById('width'),
  hInput: document.getElementById('height'),
  wVal: document.getElementById('widthVal'),
  hVal: document.getElementById('heightVal'),
  modKey: document.getElementById('modifierKey'),
  sidebarMode: document.getElementById('sidebarMode'),
  bubbleTrigger: document.getElementById('bubbleTrigger')
};

const toggles = ['hp_autohide', 'hp_theme', 'hp_ghost', 'hp_multipeak', 'hp_search', 'hp_allow_bubble', 'hp_scroll'];

chrome.storage.local.get(DEFAULT_SETTINGS, (data) => {
  elements.wInput.value = data.hp_width;
  elements.hInput.value = data.hp_height;
  elements.wVal.innerText = data.hp_width + 'px';
  elements.hVal.innerText = data.hp_height + 'px';
  elements.modKey.value = data.hp_modifier;
  elements.sidebarMode.value = data.hp_sidebar_mode;
  elements.bubbleTrigger.value = data.hp_bubble_trigger;
  
  toggles.forEach(key => { document.getElementById(key).checked = data[key]; });
});

function updateStorage() {
  const settings = {
    hp_width: parseInt(elements.wInput.value),
    hp_height: parseInt(elements.hInput.value),
    hp_modifier: elements.modKey.value,
    hp_sidebar_mode: elements.sidebarMode.value,
    hp_bubble_trigger: elements.bubbleTrigger.value
  };
  toggles.forEach(key => { settings[key] = document.getElementById(key).checked; });
  chrome.storage.local.set(settings);
}

elements.wInput.addEventListener('input', (e) => { elements.wVal.innerText = e.target.value + 'px'; updateStorage(); });
elements.hInput.addEventListener('input', (e) => { elements.hVal.innerText = e.target.value + 'px'; updateStorage(); });
elements.modKey.addEventListener('change', updateStorage);
elements.sidebarMode.addEventListener('change', updateStorage);
elements.bubbleTrigger.addEventListener('change', updateStorage);
toggles.forEach(key => document.getElementById(key).addEventListener('change', updateStorage));

document.getElementById('resetBtn').addEventListener('click', () => {
  chrome.storage.local.set(DEFAULT_SETTINGS, () => location.reload());
});