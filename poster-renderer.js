(function (root) {
  'use strict';

  const WIDTH = 1920;
  const HEIGHT = 1080;

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

  function drawText(ctx, text, y) {
    let size = 72;
    let lines;
    do {
      ctx.font = `700 ${size}px "PingFang TC","Microsoft JhengHei",sans-serif`;
      lines = wrapText(ctx, text || '', 720);
      if (lines.length * size * 1.12 <= 112) break;
      size -= 2;
    } while (size >= 16);

    ctx.fillStyle = '#1559a2';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((line, index) => {
      ctx.fillText(line, 450, y + (index - (lines.length - 1) / 2) * size * 1.12);
    });
  }

  function renderPosterCanvas(canvas, record, template, image) {
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
    for (const [key, y] of [['code', 585], ['className', 760], ['name', 933]]) {
      drawText(ctx, values[key], y);
    }

    const x = 1224;
    const y = 73;
    const width = 660;
    const height = 934;
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

  root.renderPosterCanvas = renderPosterCanvas;
})(globalThis);
