// IndexedDB shared by the studio and the gallery.
// Database thematic-exhibition-poster-studio, version 1.
// Object store "state", key "app":
// { templateId, records, selected, deleteHistory, imagePool }.

export const DB_NAME = 'thematic-exhibition-poster-studio';
export const DB_VERSION = 1;
export const STATE_KEY = 'app';

let dbPromise = null;

export function openDB(messages = {}) {
  const unsupported = messages.unsupported ?? '此瀏覽器不支援本機儲存';
  const openFailed = messages.openFailed ?? '無法開啟本機儲存';
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(Error(unsupported));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('state')) {
          request.result.createObjectStore('state');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error(openFailed));
    });
  }
  return dbPromise;
}

export function readState(db, messages = {}) {
  const readFailed = messages.readFailed ?? '無法讀取本機資料';
  return new Promise((resolve, reject) => {
    const request = db.transaction('state', 'readonly').objectStore('state').get(STATE_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error(readFailed));
  });
}

export function writeState(db, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(value, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || Error('無法儲存本機資料'));
    tx.onabort = () => reject(tx.error || Error('本機資料儲存中斷'));
  });
}

export function withoutStarterRecords(records) {
  return (records || []).filter(record => !record.isStarter);
}

export function clearDemoImage(record) {
  if (record.imageSource === 'demo') {
    return { ...record, imageSource: '', imageLabel: '' };
  }
  return record;
}
