import { clearDemoImage, openDB, readState, withoutStarterRecords, writeState } from './db.js';
import { zip } from './export-zip.js';
import {
  RECORD_LIMIT_MESSAGE,
  blankRecord,
  classifyImageMatches,
  codeKey,
  decodeTableText,
  exceedsRecordLimit,
  findDuplicateCodes,
  findRepeatedImportCodes,
  imageCandidateSignature,
  imageKey,
  imageStem,
  parseImportTable,
} from './import.js';
import { getPosterTemplate, loadPosterTemplate, posterTemplates, renderPosterCanvas } from './poster-renderer.js';

const $ = id => document.getElementById(id);
const blank = blankRecord;

let selectedTemplateId = 'original';
let templateRequest = 0;
const templateDialog = $('templateDialog');
const templateGrid = $('templateGrid');
const templateStatus = $('templateStatus');

function updateTemplateUI() {
  for (const button of templateGrid.querySelectorAll('[data-template]')) {
    const selected = button.dataset.template === selectedTemplateId;
    button.setAttribute('aria-pressed', String(selected));
    button.querySelector('.template-current').hidden = !selected;
  }
  $('templateCaption').textContent = getPosterTemplate(selectedTemplateId).name + ' · 1920 × 1080 px';
}

async function selectTemplate(id) {
  const request = ++templateRequest;
  if (id === selectedTemplateId) {
    templateDialog.close();
    advanceStudioTour('template');
    return;
  }
  templateStatus.textContent = '正在載入模板…';
  try {
    const image = await loadPosterTemplate(id);
    if (request !== templateRequest || !templateDialog.open) return;
    base = image;
    selectedTemplateId = id;
    updateTemplateUI();
    draw();
    scheduleSave();
    templateDialog.close();
    advanceStudioTour('template');
  } catch (error) {
    if (request === templateRequest && templateDialog.open) templateStatus.textContent = error.message;
  }
}

for (const template of posterTemplates) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'template-option';
  button.dataset.template = template.id;
  const image = new Image();
  image.src = template.src;
  image.alt = '';
  const caption = document.createElement('span');
  caption.className = 'template-option-caption';
  const currentMark = document.createElement('span');
  currentMark.className = 'template-current';
  currentMark.textContent = '使用中';
  currentMark.setAttribute('aria-hidden', 'true');
  caption.append(template.name, currentMark);
  button.append(image, caption);
  button.addEventListener('click', () => selectTemplate(template.id));
  templateGrid.append(button);
}
$('openTemplates').addEventListener('click', () => {
  ++templateRequest;
  templateStatus.textContent = '';
  updateTemplateUI();
  templateDialog.showModal();
  templateGrid.querySelector('[aria-pressed="true"]')?.focus();
});

let records = [];
let selected = 0;
let base = new Image();
const imagePool = new Map();
let deleteHistory = [];
let saveTimer = null;
let saveWarningShown = false;
let xlsxPromise = null;
let sortKey = '';
let sortDirection = 1;
let stateReady = false;
const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function toast(text) {
  $('message').textContent = text;
  $('message').classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('message').classList.add('hidden'), 6500);
}

function afterActionPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function runOperation(element, pendingLabel, task, fileInput = null) {
  const control = fileInput || element;
  if (control.disabled) return;
  const label = element.querySelector(fileInput ? 'b' : '.operation-label');
  const originalLabel = label.textContent;
  const setLabel = text => { label.textContent = text; };
  control.disabled = true;
  element.classList.add('operation-busy');
  element.setAttribute('aria-busy', 'true');
  if (fileInput) element.setAttribute('aria-disabled', 'true');
  setLabel(pendingLabel);
  try {
    await afterActionPaint();
    return await task(setLabel);
  } finally {
    setLabel(originalLabel);
    element.classList.remove('operation-busy');
    element.removeAttribute('aria-busy');
    element.removeAttribute('aria-disabled');
    control.disabled = false;
  }
}

function runFileOperation(input, pendingLabel, task) {
  return runOperation(input.labels[0], pendingLabel, task, input);
}

function current() { return records[selected]; }
function setTab(batch) {
  $('single').classList.toggle('hidden', batch);
  $('batch').classList.toggle('hidden', !batch);
  for (const [id, on] of [['tabSingle', !batch], ['tabBatch', batch]]) {
    $(id).classList.toggle('active', on);
    $(id).setAttribute('aria-selected', on);
  }
}
$('tabSingle').onclick = () => setTab(false);
$('tabBatch').onclick = () => setTab(true);

function sync() {
  const record = current();
  for (const [id, key] of [['code', 'code'], ['name', 'name'], ['className', 'className'], ['fit', 'fit']]) {
    $(id).value = record?.[key] ?? (id === 'fit' ? 'contain' : '');
  }
  $('imageName').textContent = record?.imageLabel || '尚未加入圖片';
  $('editIndex').textContent = record ? `第 ${selected + 1} 筆` : '可直接輸入';
  $('remove').disabled = !record;
  $('undoDelete').classList.toggle('hidden', !deleteHistory.length);
  list();
  draw();
}

const DOMAINS = [['A', '企業智慧化'], ['B', '數位內容與多媒體應用'], ['C', '網路應用與資通安全'], ['D', '嵌入式系統與行動計算'], ['E', '智慧運算創新應用'], ['F', '智慧流通應用與研究'], ['N', '進修部']];

function domainCode(code) {
  return String(code || '').trim().charAt(0).toUpperCase();
}

function exportDomainFolder(code) {
  const domain = DOMAINS.find(([prefix]) => prefix === domainCode(code));
  return domain ? domain.join('_') : '未分類';
}

function updateDomainStats() {
  const counts = Object.fromEntries(DOMAINS.map(([code]) => [code, 0]));
  for (const record of records) {
    const code = domainCode(record.code);
    if (Object.prototype.hasOwnProperty.call(counts, code)) counts[code]++;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  $('domainTotal').textContent = `已分類 ${total} 件`;
  $('domainStats').innerHTML = DOMAINS.map(([code, name]) => `<div class="domain-card" role="listitem" aria-label="${code} ${escapeHTML(name)}，${counts[code]} 件"><div class="domain-card-top"><span class="domain-code">${code}</span><span class="domain-label">${escapeHTML(name)}</span></div><div class="domain-card-count"><strong>${counts[code]}</strong><span>件</span></div></div>`).join('');
}

function list() {
  $('count').textContent = `${records.length} 筆`;
  $('total').textContent = `(${records.length})`;
  $('galleryTopCount').textContent = `${records.length} 張`;
  updateDomainStats();
  const query = $('recordSearch').value.trim().toLocaleLowerCase();
  const items = records.map((record, index) => {
    const realImage = !!record.image;
    const status = realImage ? '已就緒' : '缺少圖片';
    return { record, index, realImage, status };
  }).filter(({ record, status }) => !query || [record.code, record.name, record.className, record.filename, record.imageLabel, status].join(' ').toLocaleLowerCase().includes(query));
  const collator = new Intl.Collator('zh-Hant-TW', { numeric: true, sensitivity: 'base' });
  if (sortKey) {
    items.sort((a, b) => {
      const av = sortKey === 'status' ? a.status : a.record[sortKey] || '';
      const bv = sortKey === 'status' ? b.status : b.record[sortKey] || '';
      return sortDirection * collator.compare(String(av), String(bv)) || a.index - b.index;
    });
  }
  $('resultCount').textContent = query ? `顯示 ${items.length} / ${records.length} 筆` : `共 ${records.length} 筆`;
  for (const th of document.querySelectorAll('[data-sort-column]')) {
    const active = th.dataset.sortColumn === sortKey;
    th.setAttribute('aria-sort', active ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none');
    const button = th.querySelector('.sort-button');
    const indicator = button.querySelector('.sort-indicator');
    indicator.textContent = active ? (sortDirection === 1 ? '↑' : '↓') : '↕';
    button.setAttribute('aria-label', `依${button.textContent.replace(/[↕↑↓]/g, '').trim()}排序${active ? `（目前${sortDirection === 1 ? '升冪' : '降冪'}）` : ''}`);
  }
  $('records').innerHTML = items.length
    ? items.map(({ record, index, realImage, status }) => `<tr data-i="${index}" class="${index === selected ? 'selected' : ''}" tabindex="0" aria-label="編輯 ${escapeHTML(record.code || '未命名')}"><td>${escapeHTML(record.code || '—')}</td><td>${escapeHTML(record.name || '未命名專題')}</td><td>${escapeHTML(record.className || '—')}</td><td><span class="status ${realImage ? '' : 'missing'}">${status}</span></td></tr>`).join('')
    : records.length
      ? '<tr><td class="empty" colspan="4">找不到符合的專題；試試其他關鍵字。</td></tr>'
      : '<tr><td class="empty" colspan="4">清單目前沒有資料，請新增或匯入一筆專題。</td></tr>';
  for (const tr of $('records').querySelectorAll('tr[data-i]')) {
    const edit = () => {
      selected = +tr.dataset.i;
      sync();
      setTab(false);
    };
    tr.onclick = edit;
    tr.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        edit();
      }
    };
  }
}

for (const button of document.querySelectorAll('[data-sort]')) {
  button.onclick = () => {
    const key = button.dataset.sort;
    if (sortKey === key) sortDirection *= -1;
    else {
      sortKey = key;
      sortDirection = 1;
    }
    list();
  };
}
$('recordSearch').addEventListener('input', list);

function startFirstRecord() {
  if (exceedsRecordLimit(records.length, 1)) {
    toast(RECORD_LIMIT_MESSAGE);
    return null;
  }
  const record = blank();
  records.push(record);
  selected = 0;
  $('editIndex').textContent = '第 1 筆';
  $('remove').disabled = false;
  return record;
}

for (const [id, key] of [['code', 'code'], ['name', 'name'], ['className', 'className'], ['fit', 'fit']]) {
  $(id).addEventListener('input', () => {
    if (!stateReady) return;
    const value = $(id).value;
    if (!current() && !value.trim()) return;
    const record = current() || startFirstRecord();
    if (!record) return;
    record[key] = value;
    list();
    draw();
    scheduleSave();
  });
}

$('add').onclick = () => {
  if (exceedsRecordLimit(records.length, 1)) {
    toast(RECORD_LIMIT_MESSAGE);
    return;
  }
  records.push(blank());
  selected = records.length - 1;
  sync();
  scheduleSave();
  $('code').focus();
};
$('remove').onclick = () => {
  if (!current()) return;
  deleteHistory.push({ record: current(), index: selected });
  records.splice(selected, 1);
  selected = records.length ? Math.min(selected, records.length - 1) : 0;
  sync();
  scheduleSave();
  toast('已刪除這筆資料；可按「復原刪除」還原');
};
$('undoDelete').onclick = () => {
  const item = deleteHistory.pop();
  if (!item) return;
  const at = Math.max(0, Math.min(item.index, records.length));
  records.splice(at, 0, item.record);
  selected = at;
  sync();
  scheduleSave();
  toast('已復原刪除');
};
$('clearAll').onclick = () => {
  $('clearAllCount').textContent = `目前有 ${records.length} 筆專題資料；已匯入圖片與復原紀錄也會一併清除。`;
  $('clearAllDialog').showModal();
  $('cancelClearAll').focus();
};
$('cancelClearAll').onclick = () => $('clearAllDialog').close();
$('confirmClearAll').onclick = async () => {
  const confirmButton = $('confirmClearAll');
  confirmButton.disabled = true;
  clearTimeout(saveTimer);
  saveTimer = null;
  records = [];
  selected = 0;
  deleteHistory = [];
  imagePool.clear();
  $('recordSearch').value = '';
  $('images').value = '';
  $('poster').value = '';
  $('spreadsheet').value = '';
  $('paste').value = '';
  sync();
  try {
    await persist();
    toast('已刪除全部專題資料與已匯入圖片');
  } catch {
    toast('畫面資料已清除，但未能儲存；重新整理後可能會恢復舊資料');
  } finally {
    $('clearAllDialog').close();
    confirmButton.disabled = false;
    $('clearAll').focus();
  }
};

function paint(canvas, record) { renderPosterCanvas(canvas, record, base, record.image); }
function draw() {
  if (base.complete && base.naturalWidth) paint($('canvas'), current() || blank());
}

function loadFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const fail = () => {
      URL.revokeObjectURL(url);
      reject(Error(`無法解碼或無法安全用於海報輸出：${file.name}`));
    };
    image.onload = () => {
      try {
        if (!image.naturalWidth || !image.naturalHeight) throw Error('empty image');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        if (!context) throw Error('canvas unavailable');
        context.drawImage(image, 0, 0, 1, 1);
        context.getImageData(0, 0, 1, 1);
        URL.revokeObjectURL(url);
        resolve({
          image,
          blob: file,
          name: file.name,
          lastModified: file.lastModified || 0,
          width: image.naturalWidth,
          height: image.naturalHeight,
          type: file.type || '',
        });
      } catch {
        fail();
      }
    };
    image.onerror = fail;
    image.src = url;
  });
}

function loadBlob(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) return resolve(null);
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(Error('無法還原已儲存的圖片'));
    };
    image.src = url;
  });
}

$('poster').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !stateReady) return;
  const initialRecords = records;
  const originalRecord = current();
  return runFileOperation(event.target, '正在讀取海報圖片…', async () => {
    try {
      const loaded = await loadFile(file);
      if (originalRecord ? !records.includes(originalRecord) : records !== initialRecords) {
        toast('專題清單已變更，請重新選擇海報圖片');
        return;
      }
      const record = originalRecord || records[0] || startFirstRecord();
      if (!record) return;
      Object.assign(record, { image: loaded.image, imageBlob: loaded.blob, imageLabel: file.name, imageSource: 'manual' });
      sync();
      scheduleSave();
      toast('已加入海報圖片');
      advanceStudioTour('poster');
    } catch (error) {
      toast(error.message);
    }
  });
};

let pendingImport = null;
let pendingImageChoices = null;
let imagePoolSequence = 0;

function addImageCandidate(item) {
  const signature = imageCandidateSignature(item);
  for (const [key, existing] of imagePool) {
    if (imageCandidateSignature(existing) === signature) {
      imagePool.set(key, item);
      return;
    }
  }
  imagePool.set(`candidate-${++imagePoolSequence}`, item);
}

function imageOptionLabel(item) {
  const meta = [
    item.width && item.height ? `${item.width} × ${item.height}px` : '',
    item.type || item.blob?.type || '格式由瀏覽器判讀',
    item.blob?.size ? `${(item.blob.size / 1024).toFixed(1)} KB` : '',
  ].filter(Boolean);
  return `${item.name}（${meta.join(' · ')}）`;
}

function showImageChoices(choices) {
  pendingImageChoices = choices;
  $('imageChoiceList').innerHTML = choices.map((item, index) => `<div class="image-choice-group"><strong>${escapeHTML(item.record.code || '未填編號')} — ${escapeHTML(item.record.name || '未命名專題')}</strong><p>找到 ${item.candidates.length} 張同名圖片，請選擇其一。</p><div class="image-choice-options">${item.candidates.map((candidate, candidateIndex) => `<label class="image-choice-option"><input type="radio" name="imageChoice${index}" value="${candidateIndex}"><span>${escapeHTML(imageOptionLabel(candidate))}</span></label>`).join('')}</div></div>`).join('');
  $('imageChoiceDialog').showModal();
  $('imageChoiceList').querySelector('input[type="radio"]')?.focus();
}

function resolveImageChoices(apply) {
  const choices = pendingImageChoices;
  if (!choices) return;
  if (apply) {
    const selectedInputs = choices.map((_, index) => $('imageChoiceList').querySelector(`input[name="imageChoice${index}"]:checked`));
    const missingIndex = selectedInputs.findIndex(item => !item);
    if (missingIndex >= 0) {
      $('imageChoiceList').querySelector(`input[name="imageChoice${missingIndex}"]`)?.focus();
      toast('請為每個專題選擇一張圖片');
      return;
    }
    for (let i = 0; i < choices.length; i++) {
      const candidate = choices[i].candidates[Number(selectedInputs[i].value)];
      Object.assign(choices[i].record, {
        image: candidate.image,
        imageBlob: candidate.blob,
        imageLabel: candidate.name,
        imageSource: 'matched',
      });
    }
  }
  pendingImageChoices = null;
  $('imageChoiceDialog').close();
  if (apply) {
    sync();
    scheduleSave();
    toast(`已為 ${choices.length} 筆專題選擇圖片`);
    advanceStudioTour('images');
  } else toast('已略過多張圖片的選擇；其他唯一配對已套用');
}
$('cancelImageChoices').onclick = () => resolveImageChoices(false);
$('applyImageChoices').onclick = () => resolveImageChoices(true);
$('imageChoiceDialog').addEventListener('close', () => { pendingImageChoices = null; });

function renderBatchImageResults(loaded, errors) {
  const box = $('batchImageResults');
  box.replaceChildren();
  if (!loaded.length && !errors.length) {
    box.classList.add('hidden');
    return;
  }
  const summary = document.createElement('p');
  summary.textContent = `本次成功解碼 ${loaded.length} 張圖片；檔案格式依瀏覽器解碼結果判定。`;
  box.append(summary);
  if (errors.length) {
    const heading = document.createElement('p');
    heading.textContent = `以下 ${errors.length} 個檔案無法解碼或無法安全用於海報輸出：`;
    const listElement = document.createElement('ul');
    for (const error of errors) {
      const item = document.createElement('li');
      item.textContent = `${error.name} — ${error.reason}`;
      listElement.append(item);
    }
    box.append(heading, listElement);
  }
  box.classList.remove('hidden');
}

const repeatedImportDialog = document.createElement('dialog');
repeatedImportDialog.id = 'repeatedImportDialog';
repeatedImportDialog.className = 'confirm-dialog import-duplicate-dialog';
repeatedImportDialog.setAttribute('aria-labelledby', 'repeatedImportTitle');
repeatedImportDialog.setAttribute('aria-describedby', 'repeatedImportDescription');
repeatedImportDialog.innerHTML = '<div class="confirm-dialog-inner"><div class="confirm-dialog-icon import-duplicate-icon" aria-hidden="true">!</div><h2 id="repeatedImportTitle">同一批匯入資料有重複編號</h2><p id="repeatedImportDescription">已停止匯入，沒有新增或覆寫任何資料。請在 CSV 中修正以下列，再重新匯入。</p><div id="repeatedImportCount" class="help"></div><div id="repeatedImportCodes" class="duplicate-code-list" role="list" aria-label="重複編號及所在列"></div><p class="duplicate-import-note">每個編號在同一批資料中只能出現一次；本次不提供新增或覆寫，以免產生重複資料或覆蓋其中一列。</p><div class="dialog-actions"><button id="closeRepeatedImport" type="button">關閉並修正資料</button></div></div>';
document.body.append(repeatedImportDialog);

function showRepeatedImport(duplicates) {
  const listElement = $('repeatedImportCodes');
  listElement.replaceChildren();
  $('repeatedImportCount').textContent = `共 ${duplicates.length} 個重複編號：`;
  for (const group of duplicates) {
    const row = document.createElement('div');
    row.className = 'duplicate-import-row';
    row.setAttribute('role', 'listitem');
    const code = document.createElement('strong');
    code.textContent = `編號 ${group.code}`;
    const detail = document.createElement('span');
    detail.textContent = group.rows.map((line, index) => `第 ${line} 列「${group.values[index]}」`).join('、') + (group.exists ? '；目前清單中已有此編號' : '；目前清單中沒有此編號');
    row.append(code, detail);
    listElement.append(row);
  }
  repeatedImportDialog.showModal();
  $('closeRepeatedImport').focus();
}

function rejectRepeatedImport(imported) {
  const duplicates = findRepeatedImportCodes(imported, records);
  if (duplicates.length) {
    showRepeatedImport(duplicates);
    return true;
  }
  return false;
}
$('closeRepeatedImport').onclick = () => repeatedImportDialog.close();

function showDuplicateImport(imported, codes) {
  pendingImport = imported;
  $('duplicateImportCount').textContent = String(codes.length);
  $('duplicateImportCodes').innerHTML = codes.map(code => `<span class="duplicate-code-chip">${escapeHTML(code)}</span>`).join('');
  $('duplicateImportDialog').showModal();
  $('overwriteDuplicateImport').focus();
}

function applyImport(imported, mode) {
  if (rejectRepeatedImport(imported)) return;
  const isPlaceholder = records.length === 1 && (!current().code && !current().name && !current().image);
  const nextRecords = isPlaceholder ? [] : records.slice();
  const existingByCode = new Map();
  nextRecords.forEach((record, index) => {
    const key = codeKey(record.code);
    if (!key) return;
    if (!existingByCode.has(key)) existingByCode.set(key, []);
    existingByCode.get(key).push({ record, index });
  });
  const updates = [];
  const additions = [];
  for (const incoming of imported) {
    const targets = mode === 'overwrite' ? (existingByCode.get(codeKey(incoming.code)) || []) : [];
    if (targets.length) updates.push({ incoming, targets });
    else additions.push(incoming);
  }
  if (exceedsRecordLimit(nextRecords.length, additions.length)) throw Error(RECORD_LIMIT_MESSAGE);
  records = nextRecords;
  for (const { incoming, targets } of updates) {
    for (const { record } of targets) {
      if (record.imageSource === 'matched' && imageKey(record) !== imageKey(incoming)) {
        record.image = null;
        record.imageBlob = null;
        record.imageLabel = '';
        record.imageSource = '';
      }
      Object.assign(record, {
        code: incoming.code,
        name: incoming.name,
        className: incoming.className,
        filename: incoming.filename,
      });
    }
  }
  const firstUpdated = updates.flatMap(item => item.targets).sort((a, b) => a.index - b.index)[0];
  const firstAddedIndex = records.length;
  records.push(...additions);
  selected = firstUpdated?.index ?? (additions.length ? firstAddedIndex : Math.max(0, Math.min(selected, records.length - 1)));
  matchImages();
  sync();
  scheduleSave();
  if (mode === 'overwrite' && updates.length) {
    const updated = updates.reduce((count, item) => count + item.targets.length, 0);
    toast(`已匯入 ${imported.length} 筆：覆寫 ${updated} 筆、新增 ${additions.length} 筆`);
  } else toast(`已匯入 ${imported.length} 筆資料`);
  advanceStudioTour('import');
}

function resolveImport(mode) {
  const imported = pendingImport;
  pendingImport = null;
  $('duplicateImportDialog').close();
  if (!imported) return;
  try { applyImport(imported, mode); } catch (error) { toast(error.message || '匯入失敗'); }
}
$('cancelDuplicateImport').onclick = () => { $('duplicateImportDialog').close(); };
$('addDuplicateImport').onclick = () => resolveImport('add');
$('overwriteDuplicateImport').onclick = () => resolveImport('overwrite');
$('duplicateImportDialog').addEventListener('close', () => { pendingImport = null; });

function importText(text) {
  const imported = parseImportTable(text);
  if (rejectRepeatedImport(imported)) return;
  const duplicates = findDuplicateCodes(imported, records);
  if (duplicates.length) showDuplicateImport(imported, duplicates);
  else applyImport(imported, 'add');
}

function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './vendor/xlsx.full.min.js';
      script.onload = () => {
        if (window.XLSX) resolve(window.XLSX);
        else {
          xlsxPromise = null;
          reject(Error('無法啟動 Excel 解析器，請重新整理後再試'));
        }
      };
      script.onerror = () => {
        xlsxPromise = null;
        reject(Error('無法載入本機 Excel 解析器，請重新整理後再試'));
      };
      document.head.appendChild(script);
    });
  }
  return xlsxPromise;
}

$('spreadsheet').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !stateReady) return;
  return runFileOperation(event.target, '正在讀取資料表…', async () => {
    try {
      let text;
      if (/\.xlsx$/i.test(file.name)) {
        const XLSX = await loadXLSX();
        const workbook = XLSX.read(await file.arrayBuffer());
        const sheetName = workbook.SheetNames[0];
        if (!sheetName || !workbook.Sheets[sheetName]) throw Error('Excel 檔案中沒有可讀取的工作表');
        text = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false });
      } else {
        text = decodeTableText(await file.arrayBuffer());
      }
      importText(text);
    } catch (error) {
      toast(error.message || '無法讀取這個試算表檔案');
    }
  });
};

$('importPaste').onclick = () => {
  if (!stateReady) return;
  const text = $('paste').value;
  return runOperation($('importPaste'), '正在匯入資料…', () => {
    try { importText(text); } catch (error) { toast(error.message); }
  });
};

function matchImages() {
  const classified = classifyImageMatches(records, [...imagePool.values()]);
  for (const { record, candidate } of classified.unique) {
    Object.assign(record, {
      image: candidate.image,
      imageBlob: candidate.blob,
      imageLabel: candidate.name,
      imageSource: 'matched',
    });
  }
  if (classified.ambiguous.length) showImageChoices(classified.ambiguous);
  return { matched: classified.unique.length, ambiguous: classified.ambiguous.length };
}

$('images').onchange = async event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length || !stateReady) return;
  return runFileOperation(event.target, `正在讀取圖片 0 / ${files.length}`, async setLabel => {
    try {
      const loaded = [];
      const errors = [];
      for (const [index, file] of files.entries()) {
        setLabel(`正在讀取圖片 ${index + 1} / ${files.length}`);
        try {
          const item = await loadFile(file);
          addImageCandidate(item);
          loaded.push(item);
        } catch {
          errors.push({ name: file.name, reason: '瀏覽器無法解碼，或無法安全用於海報輸出' });
        }
      }
      setLabel('正在配對海報圖片…');
      await afterActionPaint();
      renderBatchImageResults(loaded, errors);
      const result = matchImages();
      sync();
      scheduleSave();
      if (result.matched && !result.ambiguous) advanceStudioTour('images');
      if (loaded.length || result.matched) {
        toast(`成功解碼 ${loaded.length} 張圖片；自動配對 ${result.matched} 筆${result.ambiguous ? `，另有 ${result.ambiguous} 筆請選擇圖片` : ''}`);
      } else if (errors.length) toast(`沒有圖片能解碼；${errors.length} 個檔名已列於批次匯入區`);
    } catch (error) {
      toast(error.message || '批次讀取圖片失敗');
    }
  });
};

for (const label of document.querySelectorAll('label.upload[for]')) {
  label.tabIndex = 0;
  label.setAttribute('role', 'button');
  label.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      $(label.htmlFor)?.click();
    }
  });
}

function download(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
$('sample').onclick = () => download(new Blob(['\uFEFF編號,名稱,班級,海報檔名\r\n'], { type: 'text/csv;charset=utf-8' }), '海報匯入範本.csv');

function validate(record) {
  if (!record) throw Error('請先新增或匯入專題資料');
  if (!record.code.trim() || !record.name.trim() || !record.className.trim()) throw Error('請先填妥編號、名稱與班級');
  if (!record.image) throw Error(`「${record.code}」缺少海報圖片，請先上傳`);
}
const safe = value => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 90) || '海報';

function png(record) {
  if (!base.naturalWidth) return Promise.reject(Error('請先選擇可用的模板'));
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    paint(canvas, record);
    canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('圖片產生失敗')), 'image/png');
  });
}

$('exportOne').onclick = () => {
  const record = current();
  return runOperation($('exportOne'), '正在產生 PNG…', async () => {
    try {
      validate(record);
      download(await png(record), safe(record.code + '_' + record.name) + '.png');
      toast('海報已開始下載');
      advanceStudioTour('download');
    } catch (error) { toast(error.message); }
  });
};

function showExportIssues(issues, exportedCount, fatalMessage = '') {
  let dialog = $('exportIssuesDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'exportIssuesDialog';
    dialog.className = 'confirm-dialog export-issues-dialog';
    dialog.setAttribute('aria-labelledby', 'exportIssuesTitle');
    dialog.innerHTML = '<div class="confirm-dialog-inner"><div class="confirm-dialog-icon" aria-hidden="true">!</div><h2 id="exportIssuesTitle"></h2><p id="exportIssuesDescription" class="export-issues-description"></p><ul id="exportIssuesList" class="export-issues-list"></ul><div id="exportIssuesEmpty" class="export-issues-empty hidden"></div><div class="dialog-actions"><button id="closeExportIssues" type="button">關閉</button></div></div>';
    document.body.append(dialog);
    $('closeExportIssues').onclick = () => dialog.close();
  }
  const title = $('exportIssuesTitle');
  const description = $('exportIssuesDescription');
  const listElement = $('exportIssuesList');
  const empty = $('exportIssuesEmpty');
  if (fatalMessage) {
    title.textContent = 'ZIP 建立失敗';
    description.textContent = `${fatalMessage}；本次沒有成功下載 ZIP。`;
  } else if (exportedCount) {
    title.textContent = `已打包 ${exportedCount} 張海報，${issues.length} 筆未匯出`;
    description.textContent = 'ZIP 已開始下載。以下資料因欄位、圖片或製圖錯誤未收錄，請修正後再重新下載。';
  } else {
    title.textContent = '沒有可匯出的海報';
    description.textContent = '本次 ZIP 未建立。請修正下列資料後再試。';
  }
  listElement.replaceChildren();
  for (const issue of issues) {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    const reason = document.createElement('span');
    label.textContent = issue.label;
    reason.textContent = `：${issue.reason}`;
    item.append(label, reason);
    listElement.append(item);
  }
  listElement.classList.toggle('hidden', !issues.length);
  empty.classList.toggle('hidden', !!issues.length);
  empty.textContent = fatalMessage && !issues.length
    ? '沒有單筆資料錯誤；請稍後重試，或檢查瀏覽器可用記憶體。'
    : '目前沒有錯誤項目。';
  dialog.showModal();
  $('closeExportIssues').focus();
}

$('exportAll').onclick = () => runOperation($('exportAll'), '正在準備海報…', async setLabel => {
  try {
    if (!records.length) throw Error('清單目前沒有資料');
    const exportRecords = records.map((record, index) => ({ record, index }));
    const files = [];
    const issues = [];
    for (let i = 0; i < exportRecords.length; i++) {
      const { record, index } = exportRecords[i];
      setLabel(`正在產生海報 ${i + 1} / ${exportRecords.length}`);
      try {
        validate(record);
        const blob = await png(record);
        files.push({
          name: `${exportDomainFolder(record.code)}/${String(files.length + 1).padStart(3, '0')}_${safe(record.code + '_' + record.name)}.png`,
          blob,
        });
      } catch (error) {
        issues.push({
          label: `第 ${index + 1} 筆｜${record.code || '未填編號'} — ${record.name || '未命名專題'}`,
          reason: error.message || '海報產生失敗',
        });
      }
      await new Promise(requestAnimationFrame);
    }
    if (!files.length) {
      showExportIssues(issues, 0);
      return;
    }
    try {
      setLabel('正在打包 ZIP…');
      await afterActionPaint();
      download(await zip(files), '成果展海報.zip');
      if (issues.length) showExportIssues(issues, files.length);
      else {
        toast(`已打包 ${files.length} 張海報`);
        advanceStudioTour('download');
      }
    } catch (error) {
      showExportIssues(issues, 0, error.message || '打包時發生未知錯誤');
    }
  } catch (error) {
    toast(error.message);
  }
});

function serialRecord(record) {
  const { image, ...data } = record;
  return { ...data, imageBlob: record.imageBlob || null };
}

async function persist() {
  const db = await openDB();
  const value = {
    templateId: selectedTemplateId,
    records: records.map(serialRecord),
    selected,
    deleteHistory: deleteHistory.map(item => ({ index: item.index, record: serialRecord(item.record) })),
    imagePool: [...imagePool].map(([key, obj]) => [key, {
      name: obj.name,
      blob: obj.blob || null,
      lastModified: obj.lastModified || 0,
      width: obj.width || 0,
      height: obj.height || 0,
      type: obj.type || obj.blob?.type || '',
    }]),
  };
  await writeState(db, value);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist().catch(() => {
    if (!saveWarningShown) {
      saveWarningShown = true;
      toast('自動儲存失敗；請先下載資料備份，稍後可再試');
    }
  }), 180);
}

async function materializeRecord(data) {
  const record = { ...blank(), ...clearDemoImage(data), image: null };
  delete record.isStarter;
  try {
    if (record.imageBlob) record.image = await loadBlob(record.imageBlob);
  } catch {
    record.image = null;
    record.imageBlob = null;
    record.imageSource = '';
  }
  return record;
}

async function restoreState() {
  const db = await openDB();
  const saved = await readState(db);
  if (!saved) return false;
  if (saved.templateId && saved.templateId !== 'original') {
    try {
      base = await loadPosterTemplate(saved.templateId);
      selectedTemplateId = getPosterTemplate(saved.templateId).id;
    } catch {
      toast('已儲存的模板無法載入，暫用原始模板');
    }
  }
  updateTemplateUI();
  const savedRecords = saved.records || [];
  records = await Promise.all(withoutStarterRecords(savedRecords).map(materializeRecord));
  const selectedIndex = withoutStarterRecords(savedRecords.slice(0, saved.selected || 0)).length;
  selected = Math.min(selectedIndex, Math.max(0, records.length - 1));
  deleteHistory = [];
  for (const item of saved.deleteHistory || []) {
    if (item.record.isStarter) continue;
    deleteHistory.push({ index: item.index, record: await materializeRecord(item.record) });
  }
  imagePool.clear();
  const restoredSignatures = new Set();
  for (const [, obj] of saved.imagePool || []) {
    let image = null;
    try { image = await loadBlob(obj.blob); } catch { /* drop images that can no longer be decoded */ }
    if (!image) continue;
    const item = {
      image,
      blob: obj.blob,
      name: obj.name,
      lastModified: obj.lastModified || 0,
      width: obj.width || image.naturalWidth,
      height: obj.height || image.naturalHeight,
      type: obj.type || obj.blob?.type || '',
    };
    const signature = imageCandidateSignature(item);
    if (!restoredSignatures.has(signature)) {
      imagePool.set(`restored-${++imagePoolSequence}`, item);
      restoredSignatures.add(signature);
    }
  }
  return true;
}

async function initializeStudio() {
  try {
    base = await loadPosterTemplate('original');
  } catch (error) {
    toast(error.message);
  }
  try {
    await restoreState();
  } catch {
    toast('無法讀取瀏覽器中的自動儲存資料');
  }
  const requestedEdit = new URLSearchParams(location.search).get('edit');
  if (requestedEdit !== null) {
    const target = Number(requestedEdit);
    if (Number.isInteger(target) && target >= 0 && target < records.length) selected = target;
  }
  sync();
  stateReady = true;
  updateTemplateUI();
  $('openTemplates').disabled = false;
}

const studioTourMode = new URLSearchParams(location.search).get('tour');
let studioTourSteps = [];
let studioTourIndex = -1;
let studioTourTarget;
const templateTourStep = ['template', '#openTemplates', '按「選擇模板」，再點一張縮圖確認版面。'];

function showStudioTourStep() {
  studioTourTarget?.classList.remove('tour-target');
  const step = studioTourSteps[studioTourIndex];
  $('studioTourStep').textContent = step ? '第 ' + (studioTourIndex + 1) + ' 步／共 ' + studioTourSteps.length + ' 步' : '導覽完成';
  $('studioTourHint').textContent = step ? step[2] : '檔案已開始下載，通常可在「下載」資料夾找到。';
  studioTourTarget = step ? document.querySelector(step[1]) : null;
  studioTourTarget?.classList.add('tour-target');
  studioTourTarget?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function advanceStudioTour(action) {
  if (studioTourSteps[studioTourIndex]?.[0] !== action) return;
  studioTourIndex++;
  showStudioTourStep();
}

function startStudioTour() {
  if (studioTourMode !== 'single' && studioTourMode !== 'batch') return;
  if (studioTourMode === 'single') {
    setTab(false);
    studioTourSteps = [
      ...(records.length ? [['add', '#add', '按「新增一筆」，建立一組新的專題。']] : []),
      ['code', '#code', '點框起來的欄位，輸入專題編號，例如 A01。'],
      ['className', '#className', '輸入班級，例如資管四甲。'],
      ['name', '#name', '輸入專題名稱，填完後點欄位外面或按 Tab。'],
      ['poster', 'label[for="poster"]', '按「選擇海報圖片」，從電腦選一張海報，然後按「開啟」。'],
      templateTourStep,
      ['download', '#exportOne', '確認預覽後，按「下載這張 PNG」。'],
    ];
    $('add').addEventListener('click', () => advanceStudioTour('add'));
    for (const id of ['code', 'className', 'name']) {
      $(id).addEventListener('change', () => {
        if ($(id).value.trim()) advanceStudioTour(id);
      });
    }
  } else {
    setTab(true);
    studioTourSteps = [
      ['import', 'label[for="spreadsheet"]', '按「匯入 Excel 或 CSV 資料表」，選擇已填好編號、班級和名稱的檔案。'],
      ['images', 'label[for="images"]', '按「批次選擇海報圖片」。圖片檔名使用專題編號，例如 A01.png。如果出現候選圖片，請先選擇並套用。'],
      templateTourStep,
      ['download', '#exportAll', '按「下載全部 ZIP」。如果有未匯出的專題，可依提示補齊後重試。'],
    ];
  }
  studioTourIndex = 0;
  $('studioTour').classList.remove('hidden');
  document.body.classList.add('tour-in-progress');
  $('stopStudioTour').addEventListener('click', () => {
    studioTourTarget?.classList.remove('tour-target');
    studioTourIndex = -1;
    $('studioTour').classList.add('hidden');
    document.body.classList.remove('tour-in-progress');
    const url = new URL(location.href);
    url.searchParams.delete('tour');
    history.replaceState(null, '', url);
  });
  showStudioTourStep();
}

initializeStudio().catch(error => {
  toast(error.message || '無法完成載入，請重新整理頁面');
}).finally(() => {
  $('studioLoading').remove();
  $('studioContent').classList.remove('hidden');
  $('studioContent').setAttribute('aria-busy', 'false');
  if (stateReady) startStudioTour();
});

$('openGallery').addEventListener('click', async event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (!stateReady) {
    toast('資料仍在載入，請稍後再開啟圖片相簿');
    return;
  }
  const link = event.currentTarget;
  link.setAttribute('aria-busy', 'true');
  clearTimeout(saveTimer);
  try {
    await persist();
    location.href = link.href;
  } catch {
    link.removeAttribute('aria-busy');
    toast('本機資料尚未成功儲存，因此沒有切換頁面；請稍後再試');
  }
});
