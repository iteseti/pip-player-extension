/* PiP Player — background service worker
 * Левый клик по иконке: открыть/закрыть PiP на активной вкладке.
 * Правый клик: контекстное меню с пунктом «Настройки».
 */

const MENU_ID = 'pip-player-settings';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Настройки PiP Player',
    contexts: ['action']
  });
});

// левый клик по иконке — PiP на текущей вкладке
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'PIP_TOGGLE' }).catch(() => null);
    if (resp == null) {
      // контент-скрипт не загружен — внедряем вручную
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['pip.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'PIP_TOGGLE' }).catch(() => null);
      return;
    }
    if (resp.ok === false && resp.reason === 'no-video') {
      // короткая индикация на иконке: видео на странице не найдено
      await chrome.action.setBadgeText({ tabId: tab.id, text: '✕' });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#e33' });
      setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {}), 2000);
    }
  } catch (err) {
    console.warn('[PiP Player] cannot run on this page:', err);
  }
});

// правый клик → «Настройки»
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID) {
    chrome.windows.create({
      url: chrome.runtime.getURL('options.html'),
      type: 'popup',
      width: 320,
      height: 430
    });
  }
});
