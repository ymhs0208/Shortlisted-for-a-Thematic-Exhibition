export const FIELD_LIMITS = { code: 60, name: 160, className: 100 };
export const RECORD_LIMIT = 500;
export const RECORD_LIMIT_MESSAGE = '一次最多管理 500 筆資料；請減少新增資料後再匯入';

export function exceedsRecordLimit(existingCount, additions) {
  return existingCount + additions > RECORD_LIMIT;
}

export function blankRecord() {
  return {
    code: '',
    name: '',
    className: '',
    filename: '',
    image: null,
    imageBlob: null,
    imageLabel: '',
    imageSource: '',
    fit: 'contain',
  };
}

export function codeKey(code) {
  return String(code || '').trim().toLocaleLowerCase();
}

export function imageStem(value) {
  let name = String(value || '').split(/[\\/]/).pop().trim().normalize('NFC');
  const dot = name.lastIndexOf('.');
  if (dot > 0) name = name.slice(0, dot);
  return name.toLocaleLowerCase();
}

export function imageKey(record) {
  return imageStem(record.filename || record.code);
}

export function imageCandidateSignature(item) {
  return `${String(item.name || '').normalize('NFC').toLocaleLowerCase()}\u0000${item.blob?.size || 0}\u0000${item.lastModified || 0}`;
}

export function decodeTableText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('big5').decode(bytes);
  }
}

export function parseDelimited(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0];
  const delimiter = first.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted) throw Error('CSV 引號未成對，請確認檔案格式');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export function parseImportTable(text) {
  const rows = parseDelimited(text);
  if (rows.length < 2) throw Error('請包含標題列與至少一筆資料');
  const headers = rows.shift().map(header => header.trim().toLowerCase());
  const index = aliases => headers.findIndex(header => aliases.includes(header));
  const codeIndex = index(['編號', '代碼', 'code']);
  const nameIndex = index(['名稱', '專題名稱', 'name']);
  const classIndex = index(['班級', 'class', 'classname']);
  const fileIndex = index(['海報檔名', '圖片檔名', 'filename', 'poster']);
  if ([codeIndex, nameIndex, classIndex].some(column => column < 0)) {
    throw Error('標題列必須包含：編號（也接受舊欄名「代碼」）、名稱、班級');
  }
  return rows.map((row, indexInRows) => {
    const code = row[codeIndex]?.trim() || '';
    const name = row[nameIndex]?.trim() || '';
    const className = row[classIndex]?.trim() || '';
    const rowNumber = indexInRows + 2;
    if (!code || !name || !className) throw Error(`第 ${rowNumber} 列的編號、名稱、班級不可空白`);
    for (const [label, value, max] of [
      ['編號', code, FIELD_LIMITS.code],
      ['名稱', name, FIELD_LIMITS.name],
      ['班級', className, FIELD_LIMITS.className],
    ]) {
      if (value.length > max) {
        throw Error(`第 ${rowNumber} 列的${label}有 ${value.length} 字，最多 ${max} 字；請縮短後再匯入`);
      }
    }
    return { ...blankRecord(), code, name, className, filename: row[fileIndex]?.trim() || '' };
  });
}

export function findDuplicateCodes(imported, existingRecords) {
  const existing = new Set(existingRecords.map(record => codeKey(record.code)));
  return [...new Set(imported.map(record => record.code))].filter(code => existing.has(codeKey(code)));
}

export function findRepeatedImportCodes(imported, existingRecords) {
  const groups = new Map();
  imported.forEach((record, index) => {
    const key = codeKey(record.code);
    if (!groups.has(key)) groups.set(key, { code: record.code, rows: [], values: [] });
    const group = groups.get(key);
    group.rows.push(index + 2);
    group.values.push(record.code);
  });
  const existing = new Set(existingRecords.map(record => codeKey(record.code)));
  return [...groups.values()]
    .filter(group => group.rows.length > 1)
    .map(group => ({ ...group, exists: existing.has(codeKey(group.code)) }));
}

export function classifyImageMatches(records, candidates) {
  const unique = [];
  const ambiguous = [];
  for (const record of records) {
    if (record.imageSource === 'manual') continue;
    const key = imageStem(record.filename || record.code);
    if (!key) continue;
    const hits = candidates.filter(item => imageStem(item.name) === key);
    if (hits.length === 1) unique.push({ record, candidate: hits[0] });
    else if (hits.length > 1) ambiguous.push({ record, candidates: hits });
  }
  return { unique, ambiguous };
}
