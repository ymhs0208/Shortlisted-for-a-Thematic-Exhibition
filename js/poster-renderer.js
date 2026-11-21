const WIDTH = 1920;
const HEIGHT = 1080;

export const posterTemplates = [
  { id: 'original', name: '原始模板', src: './assets/nutc-exhibition-template.png', poster: [1224, 73, 660, 934], fields: [['code', 450, 585, 720, 112], ['className', 450, 760, 720, 112], ['name', 450, 933, 720, 112]] },
  { id: 'warm', name: '暖米色電路模板', src: './assets/nutc-exhibition-warm.png', poster: [1152, 119, 631, 844], fields: [['code', 100, 423, 456, 138, 88], ['className', 625, 423, 459, 138, 88], ['name', 100, 762, 980, 285, 108]] },
  { id: 'minimal', name: '簡約學院模板', src: './assets/nutc-exhibition-minimal.jpg', poster: [1166, 60, 677, 960], fields: [['code', 102, 675, 320, 100], ['className', 465, 675, 505, 100], ['name', 102, 900, 870, 150]] },
  { id: 'shortlist', name: '入圍專題成果展背景模板', src: './assets/nutc-exhibition-shortlist.png', poster: [1115, 78, 658, 925], fields: [['code', 110, 600, 390, 76, 64], ['className', 600, 600, 405, 76, 64], ['name', 105, 839, 900, 145, 96]] },
  { id: 'letterpress', name: '藍色活字成果展模板', src: './assets/letterpress-showcase.png', poster: [1125, 78, 657, 925], fields: [['code', 72, 710, 450, 135, 88], ['className', 583, 710, 450, 135, 88], ['name', 72, 953, 955, 165, 104]] },
  { id: 'annual-banner', name: '年度主視覺橫幅模板', src: './assets/annual-banner-showcase.png', poster: [159, 237, 539, 760], fields: [['code', 876, 685, 475, 140, 88], ['className', 1418, 685, 420, 140, 88], ['name', 876, 922, 870, 150, 100]] },
];

export function getPosterTemplate(id) {
  return posterTemplates.find(item => item.id === id) || posterTemplates[0];
}

let localImagesPromise;

export async function loadPosterTemplate(id) {
  const config = getPosterTemplate(id);
  let src = config.src;
  if (location.protocol === 'file:') {
    // Chromium taints canvases drawn from separate file URLs.
    localImagesPromise ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './assets/local-template-images.js';
      script.onload = resolve;
      script.onerror = () => {
        localImagesPromise = undefined;
        script.remove();
        reject(Error('無法讀取本機模板資源'));
      };
      document.head.append(script);
    });
    await localImagesPromise;
    src = globalThis.localPosterTemplateImages?.[src];
    if (!src) throw Error('找不到本機模板圖片');
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.exhibitionTemplateId = config.id;
    image.onload = () => resolve(image);
    image.onerror = () => reject(Error('模板載入失敗'));
    image.src = src;
  });
}

function wrapText(ctx, text, maxWidth) {
  const lines = [''];
  for (const character of String(text || '')) {
    const index = lines.length - 1;
    if (ctx.measureText(lines[index] + character).width > maxWidth && lines[index]) {
      lines.push(character);
    } else {
      lines[index] += character;
    }
  }
  return lines;
}

function drawText(ctx, text, x, y, maxWidth, maxHeight, maxSize = 72) {
  let size = maxSize;
  let lines;
  do {
    ctx.font = `700 ${size}px "PingFang TC","Microsoft JhengHei",sans-serif`;
    lines = wrapText(ctx, text || '', maxWidth);
    if (lines.length * size * 1.12 <= maxHeight) break;
    size -= 2;
  } while (size >= 16);

  ctx.fillStyle = '#1559a2';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + (index - (lines.length - 1) / 2) * size * 1.12, maxWidth);
  });
}

export function renderPosterCanvas(canvas, record, template, image) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  if (template && template.complete && template.naturalWidth) {
    ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);
  }

  const values = record || {};
  const layout = getPosterTemplate(template && template.exhibitionTemplateId);
  for (const [key, x, y, width, height, maxSize] of layout.fields) {
    drawText(ctx, values[key], x, y, width, height, maxSize);
  }

  const [x, y, width, height] = layout.poster;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, width, height);

  const poster = image || values.image || null;
  const imageWidth = poster && (poster.naturalWidth || poster.width);
  const imageHeight = poster && (poster.naturalHeight || poster.height);
  if (poster && imageWidth > 0 && imageHeight > 0) {
    const scale = (values.fit === 'cover' ? Math.max : Math.min)(width / imageWidth, height / imageHeight);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.drawImage(
      poster,
      x + (width - imageWidth * scale) / 2,
      y + (height - imageHeight * scale) / 2,
      imageWidth * scale,
      imageHeight * scale
    );
    ctx.restore();
  } else {
    ctx.fillStyle = '#edf3fa';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#8093ad';
    ctx.font = '32px "PingFang TC",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('請加入專題海報', x + width / 2, y + height / 2);
  }
  ctx.restore();
}
