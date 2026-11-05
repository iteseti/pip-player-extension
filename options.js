const DEFAULTS = { speed: 1, fitMode: 'contain', autoButton: true, rememberVolume: false, miniMode: false };

const speedSel = document.getElementById('speed');
const fitSel = document.getElementById('fitMode');
const autoBtn = document.getElementById('autoButton');
const remVol = document.getElementById('rememberVolume');
const miniChk = document.getElementById('miniMode');

chrome.storage.sync.get(DEFAULTS, (s) => {
  speedSel.value = String(s.speed);
  fitSel.value = s.fitMode === 'cover' ? 'cover' : 'contain';
  autoBtn.checked = !!s.autoButton;
  remVol.checked = !!s.rememberVolume;
  miniChk.checked = !!s.miniMode;
});

speedSel.addEventListener('change', () => chrome.storage.sync.set({ speed: +speedSel.value }));
fitSel.addEventListener('change', () => chrome.storage.sync.set({ fitMode: fitSel.value }));
autoBtn.addEventListener('change', () => chrome.storage.sync.set({ autoButton: autoBtn.checked }));
remVol.addEventListener('change', () => chrome.storage.sync.set({ rememberVolume: remVol.checked }));
miniChk.addEventListener('change', () => chrome.storage.sync.set({ miniMode: miniChk.checked }));
