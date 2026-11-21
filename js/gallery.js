import { clearDemoImage, openDB, readState, withoutStarterRecords } from './db.js';
import { getPosterTemplate, loadPosterTemplate, renderPosterCanvas } from './poster-renderer.js';

const GALLERY_DB = {
  unsupported: '這個瀏覽器不支援本機儲存。',
  openFailed: '無法開啟本機資料。',
  readFailed: '無法讀取本機資料。',
};

const $ = id => document.getElementById(id);
const safeText = value => String(value ?? '');
let selectedTemplateId = 'original';
let records = [];
let objectUrls = [];
let templateImage = null;
let visibleItems = [];
let slideIndex = 0;
let slideTimer = null;
let slideObjectUrl = '';
let viewMode = 'source';
const posterCache = new WeakMap();
let posterObserver = null;
let slideRenderToken = 0;
let galleryLoading = true;

function clearObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
}

async function readRecords() {
  const db = await openDB(GALLERY_DB);
  const saved = await readState(db, GALLERY_DB);
  selectedTemplateId = getPosterTemplate(saved?.templateId).id;
  return withoutStarterRecords(saved?.records).map(clearDemoImage);
}

function loadBlobImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(Error('圖片無法讀取'));
    };
    img.src = url;
  });
}

function posterPreview(record) {
  if (posterCache.has(record)) return posterCache.get(record);
  const work = (async () => {
    if (!templateImage) return { url: '', broken: false };
    let image = null;
    let broken = false;
    try {
      if (record.imageBlob) image = await loadBlobImage(record.imageBlob);
    } catch {
      broken = !!record.imageBlob;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    renderPosterCanvas(canvas, record, templateImage, image);
    return { url: canvas.toDataURL('image/png'), broken };
  })();
  posterCache.set(record, work);
  return work;
}

function queuePosterPreview(img, record, badge, frame) {
  posterPreview(record).then(result => {
    if (!img.isConnected) return;
    if (result.broken) {
      badge.className = 'badge missing';
      badge.textContent = '圖片無法預覽';
    }
    if (result.url) img.src = result.url;
    else {
      img.remove();
      badge.className = 'badge missing';
      badge.textContent = '無法預覽';
      appendPlaceholder(frame, '無法產生海報預覽');
    }
  }).catch(() => {
    if (img.isConnected) {
      img.remove();
      badge.className = 'badge missing';
      badge.textContent = '無法預覽';
      appendPlaceholder(frame, '無法產生海報預覽');
    }
  });
}

function observePoster(img, record, badge, frame) {
  img._posterData = { record, badge, frame };
  if (!('IntersectionObserver' in window)) {
    queuePosterPreview(img, record, badge, frame);
    return;
  }
  if (!posterObserver) {
    posterObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        posterObserver.unobserve(entry.target);
        const data = entry.target._posterData;
        queuePosterPreview(entry.target, data.record, data.badge, data.frame);
      }
    });
  }
  posterObserver.observe(img);
}

function appendPlaceholder(frame, text) {
  frame.classList.add('placeholder');
  frame.append(document.createTextNode(text));
}

function setMissing(card, frame, badge, message) {
  badge.className = 'badge missing';
  badge.textContent = '缺少圖片';
  frame.querySelector('img')?.remove();
  frame.classList.add('placeholder');
  frame.replaceChildren(document.createTextNode(message));
  card.dataset.status = '缺少圖片';
}

function render() {
  if (galleryLoading) return;
  clearObjectUrls();
  const query = $('search').value.trim().toLocaleLowerCase();
  const grid = $('grid');
  grid.setAttribute('aria-busy', 'false');
  grid.replaceChildren();
  const items = records.map((record, index) => ({ record, index })).filter(({ record }) => {
    const status = record.imageBlob ? '已加入圖片' : '缺少圖片';
    return !query || [record.code, record.name, record.className, record.filename, record.imageLabel, status].map(safeText).join(' ').toLocaleLowerCase().includes(query);
  });
  $('count').textContent = query ? `顯示 ${items.length} / ${records.length} 筆` : `共 ${records.length} 筆`;
  visibleItems = items;
  $('startShow').disabled = !items.length;
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const strong = document.createElement('strong');
    strong.textContent = records.length ? '找不到符合的圖片或專題資料' : '目前沒有專題資料';
    const detail = document.createElement('span');
    detail.textContent = records.length ? '試試其他關鍵字，或清除搜尋條件。' : '回到海報製作室新增或匯入資料後，圖片就會顯示在這裡。';
    empty.append(strong, detail);
    grid.append(empty);
    return;
  }
  for (const { record, index } of items) {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = `./index.html?edit=${index}`;
    card.setAttribute('aria-label', `編輯 ${record.code || '未填編號'} ${record.name || '未命名專題'}`);
    const frame = document.createElement('span');
    frame.className = `frame${viewMode === 'poster' ? ' poster-mode' : ''}`;
    const badge = document.createElement('span');
    badge.className = 'badge';
    const hasImage = !!record.imageBlob;
    if (viewMode === 'poster') {
      const img = document.createElement('img');
      img.alt = `${record.code || '專題'} 製作完成海報預覽`;
      img.loading = 'lazy';
      img.decoding = 'async';
      badge.textContent = hasImage ? '已製作海報' : '缺少圖片';
      badge.classList.toggle('missing', !hasImage);
      frame.append(img);
      observePoster(img, record, badge, frame);
    } else if (hasImage) {
      const img = document.createElement('img');
      img.alt = `${record.code || '專題'} 海報圖片`;
      img.loading = 'lazy';
      img.decoding = 'async';
      try {
        const url = URL.createObjectURL(record.imageBlob);
        objectUrls.push(url);
        img.src = url;
        badge.textContent = '已加入圖片';
        img.onerror = () => setMissing(card, frame, badge, '圖片無法預覽');
      } catch {
        appendPlaceholder(frame, '圖片無法預覽');
        badge.classList.add('missing');
        badge.textContent = '缺少圖片';
      }
      frame.append(img);
    } else {
      appendPlaceholder(frame, '尚未加入圖片');
      badge.classList.add('missing');
      badge.textContent = '缺少圖片';
    }
    const info = document.createElement('span');
    info.className = 'info';
    info.append(badge);
    const title = document.createElement('strong');
    title.textContent = [record.code, record.name].filter(Boolean).join(' · ') || '未命名專題';
    title.title = title.textContent;
    const detail = document.createElement('span');
    detail.textContent = [record.className, record.imageLabel || record.filename].filter(Boolean).join(' · ') || '點選以查看與編輯';
    detail.title = detail.textContent;
    info.append(title, detail);
    card.append(frame, info);
    grid.append(card);
  }
}

function setViewMode(mode) {
  viewMode = mode;
  $('modeSource').classList.toggle('active', mode === 'source');
  $('modePoster').classList.toggle('active', mode === 'poster');
  $('modeSource').setAttribute('aria-pressed', String(mode === 'source'));
  $('modePoster').setAttribute('aria-pressed', String(mode === 'poster'));
  $('startShow').textContent = mode === 'poster' ? '▶ 播放海報幻燈片' : '▶ 播放幻燈片';
  render();
}

$('modeSource').addEventListener('click', () => setViewMode('source'));
$('modePoster').addEventListener('click', () => setViewMode('poster'));

function stopAuto() {
  clearInterval(slideTimer);
  slideTimer = null;
  $('togglePlay').textContent = '▶ 自動播放';
}

function startAuto() {
  stopAuto();
  $('togglePlay').textContent = 'Ⅱ 暫停播放';
  slideTimer = setInterval(() => moveSlide(1), 3500);
}

async function paintSlide() {
  if (!visibleItems.length) return;
  const token = ++slideRenderToken;
  const { record } = visibleItems[slideIndex];
  $('slideTitle').textContent = [record.code, record.name].filter(Boolean).join(' · ') || '未命名專題';
  $('slideDetail').textContent = (viewMode === 'poster' ? '製作海報 · ' : '') + ([record.className, record.imageLabel || record.filename].filter(Boolean).join(' · ') || '專題海報');
  $('slideCounter').textContent = `${slideIndex + 1} / ${visibleItems.length}`;
  const media = $('slideMedia');
  media.replaceChildren();
  if (slideObjectUrl) {
    URL.revokeObjectURL(slideObjectUrl);
    slideObjectUrl = '';
  }
  let src = '';
  let alt = '';
  if (viewMode === 'poster') {
    try {
      src = (await posterPreview(record)).url;
      alt = `${record.code || '專題'} 完整製作海報`;
    } catch { /* keep the empty slide placeholder */ }
  } else if (record.imageBlob) {
    try {
      slideObjectUrl = URL.createObjectURL(record.imageBlob);
      src = slideObjectUrl;
      alt = `${record.code || '專題'} 海報圖片`;
    } catch { /* keep the empty slide placeholder */ }
  }
  if (token !== slideRenderToken) return;
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.title = '點一下切換下一張';
    img.onclick = () => moveSlide(1);
    img.onerror = () => {
      media.replaceChildren();
      const placeholder = document.createElement('div');
      placeholder.className = 'slide-placeholder';
      placeholder.textContent = '這張圖片目前無法預覽；可用左右按鈕繼續瀏覽。';
      media.append(placeholder);
    };
    media.append(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'slide-placeholder';
    placeholder.textContent = viewMode === 'poster'
      ? '無法產生海報預覽；可用左右按鈕繼續瀏覽。'
      : '尚未加入圖片；可用左右按鈕繼續瀏覽。';
    media.append(placeholder);
  }
}

function moveSlide(delta) {
  if (!visibleItems.length) return;
  slideIndex = (slideIndex + delta + visibleItems.length) % visibleItems.length;
  paintSlide();
}

function openSlideshow() {
  if (!visibleItems.length) return;
  slideIndex = 0;
  paintSlide();
  $('slideshow').showModal();
  startAuto();
}

function closeSlideshow() {
  stopAuto();
  $('slideshow').close();
  if (slideObjectUrl) {
    URL.revokeObjectURL(slideObjectUrl);
    slideObjectUrl = '';
  }
}

$('startShow').addEventListener('click', openSlideshow);
$('closeShow').addEventListener('click', closeSlideshow);
$('prevSlide').addEventListener('click', () => moveSlide(-1));
$('nextSlide').addEventListener('click', () => moveSlide(1));
$('togglePlay').addEventListener('click', () => slideTimer ? stopAuto() : startAuto());
$('slideshow').addEventListener('click', event => {
  if (event.target === $('slideshow')) closeSlideshow();
});
$('slideshow').addEventListener('close', () => {
  stopAuto();
  if (slideObjectUrl) {
    URL.revokeObjectURL(slideObjectUrl);
    slideObjectUrl = '';
  }
});
document.addEventListener('keydown', event => {
  if (!$('slideshow').open) return;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    moveSlide(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    moveSlide(1);
  } else if (event.code === 'Space') {
    event.preventDefault();
    slideTimer ? stopAuto() : startAuto();
  }
});
$('search').addEventListener('input', render);

(async () => {
  try {
    records = await readRecords();
    templateImage = await loadPosterTemplate(selectedTemplateId);
    galleryLoading = false;
    render();
  } catch (error) {
    galleryLoading = false;
    $('grid').setAttribute('aria-busy', 'false');
    $('grid').replaceChildren();
    $('count').textContent = '無法讀取';
    $('loadError').textContent = `讀取本機資料時發生問題：${error.message || '請回到海報製作室重新開啟圖片相簿。'}`;
    $('loadError').classList.remove('hidden');
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '目前無法顯示圖片。請確認已在同一個瀏覽器與網站開啟海報製作室。';
    $('grid').append(empty);
  }
})();
