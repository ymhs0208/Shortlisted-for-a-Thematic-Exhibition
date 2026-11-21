import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECORD_LIMIT,
  classifyImageMatches,
  codeKey,
  decodeTableText,
  exceedsRecordLimit,
  findDuplicateCodes,
  findRepeatedImportCodes,
  imageCandidateSignature,
  imageKey,
  imageStem,
  parseDelimited,
  parseImportTable,
} from '../js/import.js';

test('parseDelimited reads CSV, TSV, quotes, and a leading BOM', () => {
  const csv = parseDelimited('\uFEFF編號,名稱,班級\r\nA01,"智慧,步態","資管""四甲"\n');
  assert.deepEqual(csv, [
    ['編號', '名稱', '班級'],
    ['A01', '智慧,步態', '資管"四甲'],
  ]);
  const tsv = parseDelimited('編號\t名稱\t班級\nB02\t校園導覽\t多媒四乙\n');
  assert.equal(tsv[0].length, 3);
  assert.equal(tsv[1][0], 'B02');
  assert.throws(() => parseDelimited('"未結束'), /引號未成對/);
});

test('parseImportTable accepts legacy headers and rejects bad rows', () => {
  const imported = parseImportTable('代碼,專題名稱,class,poster\nA01,智慧步態,資管四甲,poster.png\n');
  assert.equal(imported.length, 1);
  assert.equal(imported[0].code, 'A01');
  assert.equal(imported[0].name, '智慧步態');
  assert.equal(imported[0].className, '資管四甲');
  assert.equal(imported[0].filename, 'poster.png');
  assert.equal(imported[0].fit, 'contain');
  assert.throws(() => parseImportTable('名稱,班級\n只有兩欄,甲\n'), /標題列必須包含/);
  assert.throws(() => parseImportTable('編號,名稱,班級\n,智慧步態,資管四甲\n'), /第 2 列的編號、名稱、班級不可空白/);
  assert.throws(() => parseImportTable(`編號,名稱,班級\n${'A'.repeat(61)},名稱,班級\n`), /第 2 列的編號有 61 字/);
});

test('decodeTableText keeps UTF-8 and falls back to Big5', () => {
  const utf8 = new TextEncoder().encode('\uFEFF編號,名稱,班級\nA01,名稱,班級\n');
  assert.match(decodeTableText(utf8), /^編號/);
  const big5 = Uint8Array.from([189, 115, 184, 185, 44, 166, 87, 186, 217, 44, 175, 90, 175, 197, 44, 174, 252, 179, 248, 192, 201, 166, 87, 13, 10, 65, 48, 49, 44, 180, 188, 188, 122, 168, 66, 186, 65, 44, 184, 234, 186, 222, 165, 124, 165, 210, 44, 65, 48, 49, 46, 112, 110, 103, 13, 10]);
  const imported = parseImportTable(decodeTableText(big5));
  assert.equal(imported[0].code, 'A01');
  assert.equal(imported[0].name, '智慧步態');
  assert.equal(imported[0].className, '資管四甲');
  assert.equal(imported[0].filename, 'A01.png');
});

test('duplicate detection is case-insensitive and reports repeated rows', () => {
  const existing = [{ code: 'A01' }, { code: ' c03 ' }];
  const imported = parseImportTable('編號,名稱,班級\na01,一,甲\nB02,二,乙\nC03,三,丙\n');
  assert.deepEqual(findDuplicateCodes(imported, existing), ['a01', 'C03']);
  assert.equal(codeKey(' A01 '), 'a01');
  const repeated = findRepeatedImportCodes([
    { code: 'A01' },
    { code: 'B02' },
    { code: 'a01' },
  ], existing);
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].code, 'A01');
  assert.deepEqual(repeated[0].rows, [2, 4]);
  assert.deepEqual(repeated[0].values, ['A01', 'a01']);
  assert.equal(repeated[0].exists, true);
  const fresh = findRepeatedImportCodes([{ code: 'Z01' }, { code: 'Z01' }], []);
  assert.equal(fresh[0].exists, false);
});

test('the 500-record cap counts only records that would be added', () => {
  assert.equal(RECORD_LIMIT, 500);
  assert.equal(exceedsRecordLimit(499, 1), false);
  assert.equal(exceedsRecordLimit(500, 0), false);
  assert.equal(exceedsRecordLimit(500, 1), true);
  assert.equal(exceedsRecordLimit(0, 501), true);
});

test('image filenames match on the stem, ignoring extension, path, and case', () => {
  assert.equal(imageStem('C:\\posters\\A01.PNG'), 'a01');
  assert.equal(imageStem('./photos/B02.jpeg'), 'b02');
  assert.equal(imageStem('  Name.WEBP  '), 'name');
  assert.equal(imageStem('.hidden'), '.hidden');
  assert.equal(imageStem('archive.tar.gz'), 'archive.tar');
  assert.equal(imageKey({ filename: 'Poster.png', code: 'A01' }), 'poster');
  assert.equal(imageKey({ filename: '', code: 'A01' }), 'a01');
  assert.equal(imageCandidateSignature({ name: 'A01.PNG', blob: { size: 12 }, lastModified: 5 }), 'a01.png\u000012\u00005');
});

test('classifyImageMatches skips manual uploads and separates unique matches from collisions', () => {
  const manual = { code: 'A01', filename: '', imageSource: 'manual' };
  const byCode = { code: 'B02', filename: '', imageSource: '' };
  const byName = { code: 'C03', filename: 'custom-name.jpg', imageSource: 'matched' };
  const ambiguous = { code: 'D04', filename: '', imageSource: '' };
  const blank = { code: '', filename: '', imageSource: '' };
  const candidates = [
    { name: 'b02.png' },
    { name: 'folder/Custom-Name.webp' },
    { name: 'D04.jpg' },
    { name: 'D04.jpeg' },
    { name: 'A01.png' },
  ];
  const result = classifyImageMatches([manual, byCode, byName, ambiguous, blank], candidates);
  assert.deepEqual(result.unique.map(item => [item.record.code, item.candidate.name]), [
    ['B02', 'b02.png'],
    ['C03', 'folder/Custom-Name.webp'],
  ]);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].record, ambiguous);
  assert.deepEqual(result.ambiguous[0].candidates.map(item => item.name), ['D04.jpg', 'D04.jpeg']);
});
