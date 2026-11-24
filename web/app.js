/*!
 * JPEG 编解码流程实验台 —— 交互与渲染逻辑
 *
 * 依赖（均为 window 上的全局对象，按 index.html 中的 defer 顺序加载）：
 *   window.DEMO_PHOTOS      样例照片像素（photos.js）
 *   window.DEMO_DATA        合成样例像素（demo_data.js）
 *   window.COLOR_REFERENCE  色彩参考数据（color_reference.js）
 *   window.JpegCodec        JPEG 编解码实现（jpeg_codec.js）
 *
 * 分区：通用工具 / 各步骤可视化 / 步骤导航 / 一屏装下 / 动画 / 事件绑定 / 初始化
 * 所有 DOM 查询都发生在 defer 执行阶段，此时文档已解析完毕。
 */
(function () {
  'use strict';

  const DATA = window.DEMO_DATA;
  const Codec = window.JpegCodec;
  const DEMO_WIDTH = 1024;
  const DEMO_HEIGHT = 1024;
  const SOURCE_CANVAS_WIDTH = 1024;
  const SOURCE_CANVAS_HEIGHT = 1024;
  const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  /* 视口相关的三个开关会随窗口变化重算（换显示器、全屏、投影切换都要重新排版） */
  let VIEWPORT_WIDTH = window.innerWidth || document.documentElement.clientWidth || 1200;
  let SMALL_SCREEN = VIEWPORT_WIDTH < 700;
  let WIDE_SCREEN = VIEWPORT_WIDTH >= 1560;
  const LOW_POWER = SMALL_SCREEN || !!(typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);

  function refreshViewportFlags() {
    VIEWPORT_WIDTH = window.innerWidth || document.documentElement.clientWidth || 1200;
    SMALL_SCREEN = VIEWPORT_WIDTH < 700;
    WIDE_SCREEN = VIEWPORT_WIDTH >= 1560;
  }

  const ANIM = {
    reduced: REDUCED_MOTION,
    scale: REDUCED_MOTION ? 0.12 : (LOW_POWER ? 1.25 : 1),
    FLOWS: {
      stepEnter: { trigger: 'setStep / rebuild / 切换节点', duration: 380, easing: 'easeStandard', transition: 'opacity + translateY + scale' },
      basis: { trigger: '步骤05 余弦叠加按钮', duration: 2800, easing: 'easeInOutCubic', transition: '一维余弦波逐项累加 + 残差回落' },
      basissum: { trigger: '步骤05 逐项叠加重建按钮', duration: 3600, easing: 'linear', transition: '二维 64 项按 |F| 降序叠加 + 重建块逼近原块' },
      twopass: { trigger: '步骤05 行列分解按钮', duration: 4000, easing: 'linear', transition: '每拍一行/一列，匀速扫过' },
      quant: { trigger: '步骤06 量化按钮', duration: 2300, easing: 'steps', transition: '量化系数逐格替换' },
      zigzag: { trigger: '步骤07 Zigzag 按钮', duration: 2560, easing: 'steps', transition: '扫描游标 + 序列条带' },
      rle: { trigger: '步骤08 游程按钮', duration: 3200, easing: 'steps', transition: '符号表行高亮 + 条带游标' },
      bitwrite: { trigger: '步骤09 位流写入按钮', duration: 1400, easing: 'steps', transition: '位串增长 + 字节分组' },
      assembly: { trigger: '步骤10 拼接按钮', duration: 3600, easing: 'steps', transition: 'MCU 格点顺序点亮' },
      decode: { trigger: '步骤11 熵解码按钮', duration: 3400, easing: 'steps', transition: '符号表行高亮 + 位游标' },
      idct: { trigger: '步骤13 IDCT 按钮', duration: 1280, easing: 'easeOutCubic', transition: '基函数累加 + 误差图更新' },
      tour: { trigger: '步骤01 扫描块按钮', duration: 7000, easing: 'easeInOutSine', transition: '仅重绘源图高亮层' },
      freqZoom: { trigger: '原理02 整体缩小演示', duration: 4200, easing: 'easeInOutSine', transition: '整幅图等比例缩小到 1/5 再放大回去，高细节随缩小消失' }
    },
    ease: {
      linear: function (t) { return t; },
      easeStandard: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
      easeInOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
      easeOutCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
      easeInOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
      steps: function (t) { return t; }
    },
    duration: function (name) {
      const flow = this.FLOWS[name];
      return Math.max(80, Math.round((flow ? flow.duration : 1000) * this.scale));
    },
    interval: function (name, totalTicks) {
      return Math.max(SMALL_SCREEN ? 20 : 12, Math.round(this.duration(name) / Math.max(1, totalTicks)));
    },
    progress: function (name, tick, totalTicks) {
      const flow = this.FLOWS[name];
      const raw = clamp(tick / Math.max(1, totalTicks), 0, 1);
      const eased = (this.ease[(flow && flow.easing) || 'linear'] || this.ease.linear)(raw);
      return flow && flow.easing === 'steps' ? Math.floor(eased * totalTicks) : eased;
    }
  };

  const LABELS = {
    synthetic_gradient: '渐变（合成）',
    synthetic_texture: '纹理（合成）',
    synthetic_text: '文字（合成）'
  };

  const stage = document.getElementById('stage');
  const mainScroll = document.getElementById('mainScroll');

  const rebuildCache = new Map();
  let imageSerial = 0;

  const state = {
    imageId: 0,
    imageName: '风景示例',
    rgb: null,
    width: DEMO_WIDTH,
    height: DEMO_HEIGHT,
    Q: 50,
    subsampling: '420',
    component: 'Y',
    blockX: 16,
    blockY: 16,
    hoverBlock: null,
    step: 14,
    flowIndex: 0,
    encoded: null,
    decoded: null,
    psnr: 0,
    selectedCoeff: -1,
    zigStep: 64,
    basis: null,
    quantStep: 64,
    quantFocus: -1,
    rleStep: 0,
    bitWriteStep: 0,
    decodeStep: 0,
    idctStep: 64,
    dctView: 'coeff',
    dctRow: -1,
    dctUseCount: 8,
    dctRowStep: 8,
    dctColStep: 8,
    dctPassStep: 16,
    dctSumStep: 64,
    assemblyStep: 0,
    quantTimer: null,
    rleTimer: null,
    bitTimer: null,
    decodeTimer: null,
    idctTimer: null,
    tourTimer: null,
    dctPassTimer: null,
    assemblyTimer: null
  };

  const samples = [];
  let FLOW_ENTRIES = [];

  /* ------------------------------------------------------------------ */
  /* 通用工具                                                            */
  /* ------------------------------------------------------------------ */

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  /* 画布配色统一从 CSS 变量读取，避免 JS / CSS 两处各写一份色值。 */
  const rootStyle = getComputedStyle(document.documentElement);
  function cssRGB(name) {
    const hex = rootStyle.getPropertyValue(name).trim();
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  const DARK_TEXT = rootStyle.getPropertyValue('--text').trim();
  const RGB = {
    empty: cssRGB('--cell-empty'),
    blue: cssRGB('--cell-blue'),
    red: cssRGB('--cell-red'),
    orange: cssRGB('--orange')
  };
  function mixRGB(from, to, level) {
    return [
      Math.round(from[0] + (to[0] - from[0]) * level),
      Math.round(from[1] + (to[1] - from[1]) * level),
      Math.round(from[2] + (to[2] - from[2]) * level)
    ];
  }

  function rgbCss(rgb) {
    return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
  }

  function darkenRGB(rgb, level) {
    return mixRGB(rgb, [15, 23, 42], level);
  }

  function escapeHTML(text) {
    return String(text).replace(/[&<>"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character];
    });
  }

  function base64ToBytes(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function formatValue(value) {
    const absolute = Math.abs(value);
    if (absolute >= 1000) return (value / 1000).toFixed(1) + 'k';
    if (absolute >= 10) return String(Math.round(value));
    return value.toFixed(1);
  }

  /* fitStageToViewport 为了“一屏装下”会把画布压窄；而点步进按钮（+Xk / 下一步）
     只重画位图、不重建整页，setupCanvas 若把 maxWidth 弹回满尺寸，同一页的图就会
     突然变大、页面也跟着变长。这里记住第一次算出的显示宽度，重画一律沿用。 */
  const canvasFitWidth = new Map();

  /* 演示台“一屏可用高度”，与 fitStageToViewport 用的是同一个来源，
     供需要按视口高度给画布限额的页面复用。 */
  function stageViewportHeight() {
    const value = parseFloat(getComputedStyle(stage).minHeight);
    if (isFinite(value) && value > 0) return value;
    return Math.max(320, (window.innerHeight || 800) - 120);
  }

  function setupCanvas(id, width, height, cap) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    /* 宽屏下允许画布在栅格里适度放大，但位图同步按比例加密（缩放系数 × 设备像素比），
       保证放大后仍是一比一渲染、不糊；大画布只做小幅放大，避免整页被拉长。
       27" 等大屏（≥1560px）栅格列更宽，放宽上限，让图填满列宽而不是缩在中间。 */
    const grow = WIDE_SCREEN
      ? (width <= 420 ? 2.2 : width <= 700 ? 1.85 : 1.7)
      : (width <= 420 ? 1.5 : width <= 700 ? 1.25 : 1.1);
    const dpr = Math.min(SMALL_SCREEN ? 1.5 : 2, window.devicePixelRatio || 1) * grow;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const fullWidth = Math.round(width * grow);
    const fitted = canvasFitWidth.get(id);
    let limit = fitted && fitted < fullWidth ? fitted : fullWidth;
    /* 少数页面把几张大方形图叠在一起（系数页），放任满宽会让“一屏装下”把同页的
       小图一起压扁；这类页面可以传一个按视口高度算出的上限，fit 只需小幅修正。 */
    if (cap && cap < limit) limit = cap;
    canvas.style.maxWidth = limit + 'px';
    canvas.style.aspectRatio = width + ' / ' + height;
    const context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas: canvas, ctx: context, w: width, h: height };
  }

  /* 离屏画布池：drawRGBInto / drawPlaneInto 在悬浮与动画里被高频调用，
     复用同一块离屏画布与 ImageData，省掉反复 createElement + createImageData 的分配与 GC 抖动。 */
  const offscreenCache = new Map();

  function offscreenTarget(width, height) {
    const key = width + 'x' + height;
    let entry = offscreenCache.get(key);
    if (!entry) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      entry = { canvas: canvas, ctx: context, imageData: context.createImageData(width, height) };
      offscreenCache.set(key, entry);
    }
    return entry;
  }

  function drawRGBInto(target, rgb, width, height) {
    const offscreen = offscreenTarget(width, height);
    const imageData = offscreen.imageData;
    /* 复用缓冲区时必须先清空，保证 rgb 偏短时尾部像素与“每次新建”的结果一致 */
    if (rgb.length < imageData.data.length) imageData.data.fill(0);
    imageData.data.set(rgb);
    offscreen.ctx.putImageData(imageData, 0, 0);
    target.ctx.imageSmoothingEnabled = false;
    target.ctx.drawImage(offscreen.canvas, 0, 0, target.w, target.h);
  }

  function drawPlaneInto(target, plane, width, height, tint) {
    const offscreen = offscreenTarget(width, height);
    const imageData = offscreen.imageData;
    for (let i = 0; i < width * height; i++) {
      const value = clamp(Math.round(plane[i]), 0, 255);
      if (tint === 'cb') {
        imageData.data[i * 4] = clamp(255 - Math.abs(value - 128) * 2, 0, 255);
        imageData.data[i * 4 + 1] = value;
        imageData.data[i * 4 + 2] = clamp(255 - Math.abs(value - 128) * 2, 0, 255);
      } else if (tint === 'cr') {
        imageData.data[i * 4] = value;
        imageData.data[i * 4 + 1] = clamp(255 - Math.abs(value - 128) * 2, 0, 255);
        imageData.data[i * 4 + 2] = clamp(255 - Math.abs(value - 128) * 2, 0, 255);
      } else {
        imageData.data[i * 4] = value;
        imageData.data[i * 4 + 1] = value;
        imageData.data[i * 4 + 2] = value;
      }
      imageData.data[i * 4 + 3] = 255;
    }
    offscreen.ctx.putImageData(imageData, 0, 0);
    target.ctx.imageSmoothingEnabled = false;
    target.ctx.drawImage(offscreen.canvas, 0, 0, target.w, target.h);
  }

  function chromaColor(value, tint) {
    const level = clamp(Math.round(value), 0, 255);
    const neutral = clamp(255 - Math.abs(level - 128) * 2, 0, 255);
    return tint === 'cb' ? [neutral, level, neutral] : [level, neutral, neutral];
  }

  function drawSampleGrid(target, values, width, height, tint) {
    const context = target.ctx;
    const cellWidth = target.w / width;
    const cellHeight = target.h / height;
    context.clearRect(0, 0, target.w, target.h);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const rgb = chromaColor(values[row * width + column], tint);
        context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
        context.fillRect(column * cellWidth, row * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
      }
    }
    context.strokeStyle = 'rgba(255,255,255,0.55)';
    context.lineWidth = 1;
    for (let i = 0; i <= width; i++) {
      context.beginPath(); context.moveTo(i * cellWidth, 0); context.lineTo(i * cellWidth, target.h); context.stroke();
    }
    for (let i = 0; i <= height; i++) {
      context.beginPath(); context.moveTo(0, i * cellHeight); context.lineTo(target.w, i * cellHeight); context.stroke();
    }
  }

  /* 有符号量统一用发散色标：0=浅中性、正=暖红、负=冷蓝，端点来自 CSS 变量。 */
  function heatColor(value, maximum) {
    const level = Math.min(1, Math.log1p(Math.abs(value)) / Math.log1p(Math.max(1, maximum)));
    return value >= 0 ? mixRGB(RGB.empty, RGB.red, level) : mixRGB(RGB.empty, RGB.blue, level);
  }

  /* 量化步长是无符号量：白 → 暖橙，避免和“蓝 = 负”撞语义。 */
  function magnitudeColor(value, maximum) {
    const level = Math.min(1, Math.sqrt(Math.max(0, value) / Math.max(1, maximum)));
    return mixRGB([255, 253, 246], RGB.orange, level);
  }

  /* 移位块是带符号量，直接复用全站发散色标：蓝负 / 红正 / 浅中性=0。
   * 量程固定 ±128，换块后颜色仍可横向比较；对数映射让小差值也有颜色。 */
  function shiftedBlockColor(value) {
    return heatColor(value, 128);
  }

  function grayColor(value) {
    const level = clamp(Math.round(value), 0, 255);
    return [level, level, level];
  }

  /* 用 WCAG 相对亮度挑字色：约 0.21 是深字与白字对比度的交叉点（sRGB 灰度 ≈ 126）。 */
  function textColor(rgb) {
    const linear = function (channel) {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    const luminance = 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
    return luminance > 0.21 ? DARK_TEXT : '#ffffff';
  }

  function drawCells(target, values, colorFunction, options) {
    options = options || {};
    const context = target.ctx;
    const cellWidth = target.w / 8;
    const cellHeight = target.h / 8;
    context.clearRect(0, 0, target.w, target.h);
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        const value = values[row * 8 + column];
        const rgb = colorFunction(value);
        context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
        context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
        if (options.zeroMark && value === 0) {
          context.strokeStyle = '#dc2626';
          context.lineWidth = 1.7;
          const padding = 5;
          context.beginPath();
          context.moveTo(column * cellWidth + padding, row * cellHeight + padding);
          context.lineTo((column + 1) * cellWidth - padding, (row + 1) * cellHeight - padding);
          context.moveTo((column + 1) * cellWidth - padding, row * cellHeight + padding);
          context.lineTo(column * cellWidth + padding, (row + 1) * cellHeight - padding);
          context.stroke();
        }
      }
    }
    context.strokeStyle = options.gridColor || 'rgba(255,255,255,0.75)';
    context.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      context.beginPath(); context.moveTo(i * cellWidth, 0); context.lineTo(i * cellWidth, target.h); context.stroke();
      context.beginPath(); context.moveTo(0, i * cellHeight); context.lineTo(target.w, i * cellHeight); context.stroke();
    }
    if (options.text) {
      context.font = '600 11px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (let row = 0; row < 8; row++) {
        for (let column = 0; column < 8; column++) {
          const value = values[row * 8 + column];
          const text = options.text(value);
          if (text === null) continue;
          const rgb = colorFunction(value);
          context.fillStyle = textColor(rgb);
          context.fillText(text, column * cellWidth + cellWidth / 2, row * cellHeight + cellHeight / 2);
        }
      }
    }
    if (typeof options.highlight === 'number' && options.highlight >= 0) {
      const row = Math.floor(options.highlight / 8);
      const column = options.highlight % 8;
      context.strokeStyle = textColor(colorFunction(values[options.highlight]));
      context.lineWidth = 2.5;
      context.strokeRect(column * cellWidth + 1.5, row * cellHeight + 1.5, cellWidth - 3, cellHeight - 3);
    }
  }

  function drawGridAndBlock(target, imageWidth, imageHeight) {
    const context = target.ctx;
    const blockWidth = target.w / imageWidth * 8;
    const blockHeight = target.h / imageHeight * 8;
    const x = state.blockX * blockWidth;
    const y = state.blockY * blockHeight;
    const cx = x + blockWidth / 2;
    const cy = y + blockHeight / 2;
    context.fillStyle = 'rgba(29,78,216,0.22)';
    context.fillRect(x, y, blockWidth, blockHeight);
    context.strokeStyle = 'rgba(255,255,255,0.9)';
    context.lineWidth = 5;
    context.strokeRect(x, y, blockWidth, blockHeight);
    context.strokeStyle = '#1d4ed8';
    context.lineWidth = 2.5;
    context.strokeRect(x, y, blockWidth, blockHeight);
    context.beginPath();
    context.moveTo(cx - 13, cy); context.lineTo(cx + 13, cy);
    context.moveTo(cx, cy - 13); context.lineTo(cx, cy + 13);
    context.strokeStyle = 'rgba(255,255,255,0.9)';
    context.lineWidth = 4;
    context.stroke();
    context.strokeStyle = '#1d4ed8';
    context.lineWidth = 1.5;
    context.stroke();
  }

  function drawRGBBlockPreview(target, blockX, blockY) {
    const context = target.ctx;
    const cell = target.w / 8;
    context.clearRect(0, 0, target.w, target.h);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const sourceX = Math.min(state.width - 1, blockX * 8 + x);
        const sourceY = Math.min(state.height - 1, blockY * 8 + y);
        const index = (sourceY * state.width + sourceX) * 4;
        context.fillStyle = 'rgb(' + state.rgb[index] + ',' + state.rgb[index + 1] + ',' + state.rgb[index + 2] + ')';
        context.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
      }
    }
    context.strokeStyle = 'rgba(100,116,139,0.55)';
    context.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const position = Math.round(i * cell) + 0.5;
      context.beginPath(); context.moveTo(position, 0); context.lineTo(position, target.h); context.stroke();
      context.beginPath(); context.moveTo(0, position); context.lineTo(target.w, position); context.stroke();
    }
  }

  function statBlock(rows) {
    return '<div class="stats">' + rows.map(function (row) {
      return '<div><span>' + escapeHTML(row[0]) + '</span><b>' + row[1] + '</b></div>';
    }).join('') + '</div>';
  }

  function metricCards(rows) {
    return '<div class="cards">' + rows.map(function (row) {
      return '<div class="card"><span>' + escapeHTML(row[0]) + '</span><b>' + row[1] + '</b><small>' +
        escapeHTML(row[2] || '') + '</small></div>';
    }).join('') + '</div>';
  }

  /* 图注里含 <br>/<span> 等标记，画布的无障碍名称需要的是纯文本 */
  function plainText(html) {
    return String(html).replace(/<br\s*\/?>/gi, '，').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  /* 统一产出带 role/aria-label 的画布标签：读屏用户听到的就是图注内容 */
  function canvasTag(id, caption) {
    return '<canvas id="' + id + '" role="img" aria-label="' + escapeHTML(plainText(caption)) + '"></canvas>';
  }

  function figure(id, caption, className) {
    return '<figure class="' + (className || '') + '">' + canvasTag(id, caption) +
      '<figcaption>' + caption + '</figcaption></figure>';
  }

  /* ------------------------------------------------------------------ */
  /* 样例图像                                                            */
  /* ------------------------------------------------------------------ */

  function rgbToRGBA(pixels) {
    const output = new Uint8ClampedArray(pixels.length / 3 * 4);
    for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
      output[j] = pixels[i];
      output[j + 1] = pixels[i + 1];
      output[j + 2] = pixels[i + 2];
      output[j + 3] = 255;
    }
    return output;
  }

  function grayscaleToRGBA(pixels) {
    const output = new Uint8ClampedArray(pixels.length * 4);
    for (let i = 0; i < pixels.length; i++) {
      output[i * 4] = pixels[i];
      output[i * 4 + 1] = pixels[i];
      output[i * 4 + 2] = pixels[i];
      output[i * 4 + 3] = 255;
    }
    return output;
  }

  function resizeRGBA(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    if (sourceWidth === targetWidth && sourceHeight === targetHeight) return source;
    const targetRatio = targetWidth / targetHeight;
    const sourceRatio = sourceWidth / sourceHeight;
    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;
    if (sourceRatio > targetRatio) cropWidth = Math.round(sourceHeight * targetRatio);
    else if (sourceRatio < targetRatio) cropHeight = Math.round(sourceWidth / targetRatio);
    const cropX = Math.floor((sourceWidth - cropWidth) / 2);
    const cropY = Math.floor((sourceHeight - cropHeight) / 2);
    const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    for (let y = 0; y < targetHeight; y++) {
      const sy = cropY + Math.min(cropHeight - 1, Math.floor(y * cropHeight / targetHeight));
      for (let x = 0; x < targetWidth; x++) {
        const sx = cropX + Math.min(cropWidth - 1, Math.floor(x * cropWidth / targetWidth));
        const from = (sy * sourceWidth + sx) * 4;
        const to = (y * targetWidth + x) * 4;
        output[to] = source[from];
        output[to + 1] = source[from + 1];
        output[to + 2] = source[from + 2];
        output[to + 3] = 255;
      }
    }
    return output;
  }

  /* 样例图解码代价不小（1024² 的 RGBA 约 4MB/张），改成用到时才解码：
     首屏只解默认那张，其余样例不占内存也不花启动时间。 */
  function buildSamples() {
    if (window.DEMO_PHOTOS) {
      window.DEMO_PHOTOS.forEach(function (photo) {
        samples.push({
          name: photo.name,
          width: photo.width || 256,
          height: photo.height || 256,
          decode: function () { return rgbToRGBA(base64ToBytes(photo.pixels)); }
        });
      });
    }
    DATA.images.forEach(function (image) {
      samples.push({
        name: LABELS[image.name] || image.name,
        width: DEMO_WIDTH,
        height: DEMO_HEIGHT,
        decode: function () {
          return resizeRGBA(grayscaleToRGBA(base64ToBytes(image.pixels)), image.width || 256, image.height || 256, DEMO_WIDTH, DEMO_HEIGHT);
        }
      });
    });
  }

  /* 惰性解码入口：解一次后缓存到 sample.rgb 上 */
  function sampleRGB(sample) {
    if (!sample.rgb) sample.rgb = sample.decode();
    return sample.rgb;
  }

  function loadImage(rgb, name, width, height) {
    state.imageId = ++imageSerial;
    state.rgb = rgb;
    state.width = width || DEMO_WIDTH;
    state.height = height || DEMO_HEIGHT;
    state.imageName = name;
    const block = chooseDefaultBlock();
    state.blockX = block.x;
    state.blockY = block.y;
    state.selectedCoeff = -1;
    state.basis = null;
    rebuild();
  }

  function blockLumaValues(blockX, blockY) {
    const values = new Float64Array(64);
    for (let y = 0; y < 8; y++) {
      const sourceY = Math.min(state.height - 1, blockY * 8 + y);
      for (let x = 0; x < 8; x++) {
        const sourceX = Math.min(state.width - 1, blockX * 8 + x);
        const index = (sourceY * state.width + sourceX) * 4;
        values[y * 8 + x] = 0.299 * state.rgb[index] + 0.587 * state.rgb[index + 1] + 0.114 * state.rgb[index + 2];
      }
    }
    return values;
  }

  function blockDct(values) {
    const temporary = rowDct(values);
    const output = new Float64Array(64);
    for (let u = 0; u < 8; u++) {
      for (let v = 0; v < 8; v++) {
        let sum = 0;
        for (let y = 0; y < 8; y++) sum += Codec.T[u][y] * temporary[y * 8 + v];
        output[u * 8 + v] = sum;
      }
    }
    return output;
  }

  /* 色度起伏：块内 Cb / Cr 的标准差（合成一个数），用来衡量“这块颜色变化明不明显”。 */
  function blockChromaSpread(blockX, blockY) {
    let cbSum = 0;
    let crSum = 0;
    let cbSquare = 0;
    let crSquare = 0;
    for (let y = 0; y < 8; y++) {
      const sourceY = Math.min(state.height - 1, blockY * 8 + y);
      for (let x = 0; x < 8; x++) {
        const sourceX = Math.min(state.width - 1, blockX * 8 + x);
        const index = (sourceY * state.width + sourceX) * 4;
        const r = state.rgb[index];
        const g = state.rgb[index + 1];
        const b = state.rgb[index + 2];
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        cbSum += cb;
        crSum += cr;
        cbSquare += cb * cb;
        crSquare += cr * cr;
      }
    }
    const cbMean = cbSum / 64;
    const crMean = crSum / 64;
    const cbVariance = Math.max(0, cbSquare / 64 - cbMean * cbMean);
    const crVariance = Math.max(0, crSquare / 64 - crMean * crMean);
    return Math.sqrt(cbVariance + crVariance);
  }

  /* 默认演示块：不挑“最花”的块，而是同时满足三件事——
     ① 结构清楚、能量集中在低中频（u+v ≤ 4），DCT 系数矩阵有可讲的形状；
     ② 曝光适中，DC 不会压倒一切；
     ③ 色度有起伏，YCbCr 那一步的 Cb/Cr 面板不会是一整片纯洋红/纯青。
     于是量化后仍有保留也有置零，反量化 / IDCT 的变化肉眼可见，
     而不是落到一片纯噪声（高频散点，量化后直接变灰）或一片天空（几乎没有交流系数、颜色也几乎不变）。 */
  function chooseDefaultBlock() {
    const columns = Math.ceil(state.width / 8);
    const rows = Math.ceil(state.height / 8);
    const stride = columns > 48 ? 2 : 1;
    const centerX = (columns - 1) / 2;
    const centerY = (rows - 1) / 2;
    const maxDistance = Math.max(1, Math.hypot(centerX, centerY));
    let best = null;
    let bestScore = -1;
    let relaxed = null;
    let relaxedScore = -1;
    let fallback = { x: Math.floor(columns / 2), y: Math.floor(rows / 2) };
    let fallbackScore = -1;
    const margin = 2;
    for (let blockY = margin; blockY < rows - margin; blockY += stride) {
      for (let blockX = margin; blockX < columns - margin; blockX += stride) {
        const values = blockLumaValues(blockX, blockY);
        let sum = 0;
        let squares = 0;
        for (let i = 0; i < 64; i++) {
          sum += values[i];
          squares += values[i] * values[i];
        }
        const mean = sum / 64;
        const variance = squares / 64 - mean * mean;
        if (variance > fallbackScore) {
          fallbackScore = variance;
          fallback = { x: blockX, y: blockY };
        }
        const coefficients = blockDct(values);
        let alternating = 0;
        let structured = 0;
        for (let index = 1; index < 64; index++) {
          const energy = coefficients[index] * coefficients[index];
          alternating += energy;
          const order = Math.floor(index / 8) + (index % 8);
          if (order <= 4) structured += energy;
        }
        if (alternating < 400) continue;
        const coherence = structured / alternating;
        if (coherence < 0.55) continue;
        const exposure = 1 - Math.abs(mean - 128) / 240;
        if (exposure <= 0) continue;
        // 色度起伏 12 个码值以上算“颜色差异明显”，给满分；全灰/单色块保留 15% 基础分，
        // 这样灰度图（各处色度起伏都是 0）仍按结构挑块，彩色图才会为颜色让一步。
        const chroma = blockChromaSpread(blockX, blockY);
        const colorGain = 0.15 + 0.85 * Math.min(1, chroma / 12);
        const distance = Math.hypot(blockX - centerX, blockY - centerY) / maxDistance;
        const score = Math.sqrt(structured) * Math.pow(coherence, 1.5) * exposure * (1 - 0.4 * distance) * colorGain;
        if (score > relaxedScore) {
          relaxedScore = score;
          relaxed = { x: blockX, y: blockY };
        }
        // 首选块还要满足：亮度适中（80–182，减 128 后两侧都有值，移位与 DCT 两步都好看）
        // 且色度起伏 ≥ 8（YCbCr 那一步 Cb/Cr 面板能看出颜色变化）。
        // 灰度图 / 单色图达不到色度条件时退回 relaxed，仍按结构挑块。
        if (mean >= 80 && mean <= 182 && chroma >= 8 && score > bestScore) {
          bestScore = score;
          best = { x: blockX, y: blockY };
        }
      }
    }
    return best || relaxed || fallback;
  }

  /* ------------------------------------------------------------------ */
  /* 编码 / 解码                                                         */
  /* ------------------------------------------------------------------ */

  function rebuild() {
    try {
      stopVisualAnimations();
      state.quantStep = 64;
      state.quantFocus = -1;
      state.rleStep = 0;
      state.bitWriteStep = 0;
      state.decodeStep = 0;
      state.idctStep = 64;
      state.zigStep = 64;
      /* 只在 DCT 章内保留当前子页（05.1…05.5），其他章节回到系数页。
         原来无条件写死 'coeff'，会让“改 QF / 换样例图”把 05.2/05.3/05.5 的内容
         换成 05.4 的二维系数页，而步骤条与左侧说明还停在原来的子页。 */
      state.dctView = currentDctView();
      state.dctRow = -1;
      state.dctRowStep = 8;
      state.dctColStep = 8;
      state.assemblyStep = 0;
      const cacheKey = state.imageId + '|' + state.width + 'x' + state.height + '|' + state.Q + '|' + state.subsampling;
      const cached = rebuildCache.get(cacheKey);
      if (cached) {
        state.encoded = cached.encoded;
        state.decoded = cached.decoded;
        state.psnr = cached.psnr;
      } else {
        state.encoded = Codec.encode(state.rgb, state.width, state.height, {
          quality: state.Q,
          subsampling: state.subsampling
        });
        state.decoded = Codec.decode(state.encoded);
        state.psnr = Codec.psnr(state.rgb, state.decoded.rgb);
        if (rebuildCache.size >= 8) rebuildCache.delete(rebuildCache.keys().next().value);
        rebuildCache.set(cacheKey, { encoded: state.encoded, decoded: state.decoded, psnr: state.psnr });
      }
      state.assemblyStep = state.encoded.mcus.length;
      const maxBlockX = Math.ceil(state.width / 8) - 1;
      const maxBlockY = Math.ceil(state.height / 8) - 1;
      state.blockX = clamp(state.blockX, 0, maxBlockX);
      state.blockY = clamp(state.blockY, 0, maxBlockY);
      render();
    } catch (error) {
      stage.innerHTML = '<p class="error">编码失败：' + escapeHTML(error.message) + '</p>';
      console.error(error);
    }
  }

  function componentBlock(component) {
    let blockX = state.blockX;
    let blockY = state.blockY;
    if (component !== 'Y') {
      if (state.subsampling === '420' || state.subsampling === '422') blockX = Math.floor(blockX / 2);
      if (state.subsampling === '420') blockY = Math.floor(blockY / 2);
    }
    const info = state.encoded.components[component];
    return {
      x: clamp(blockX, 0, info.cols - 1),
      y: clamp(blockY, 0, info.rows - 1)
    };
  }

  function encodedBlock(component) {
    const position = componentBlock(component || state.component);
    return state.encoded.blocks.get((component || state.component) + ':' + position.x + ':' + position.y);
  }

  function decodedBlock(component) {
    const position = componentBlock(component || state.component);
    return state.decoded.blocks.get((component || state.component) + ':' + position.x + ':' + position.y);
  }

  function componentQuant(component) {
    return component === 'Y' ? state.encoded.quant.lum : state.encoded.quant.chr;
  }

  function selectedYCbCrBlock() {
    const y = new Float64Array(64);
    const cb = new Float64Array(64);
    const cr = new Float64Array(64);
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        const sourceX = Math.min(state.width - 1, state.blockX * 8 + column);
        const sourceY = Math.min(state.height - 1, state.blockY * 8 + row);
        const index = (sourceY * state.width + sourceX) * 4;
        const r = state.rgb[index];
        const g = state.rgb[index + 1];
        const b = state.rgb[index + 2];
        const at = row * 8 + column;
        y[at] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        cb[at] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
        cr[at] = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
      }
    }
    return { y: y, cb: cb, cr: cr };
  }

  function subsampleChroma(values, mode) {
    if (mode === '444') return { data: Float64Array.from(values), width: 8, height: 8 };
    const width = 4;
    const height = mode === '420' ? 4 : 8;
    const data = new Float64Array(width * height);
    const stepY = mode === '420' ? 2 : 1;
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        let sum = 0;
        for (let dy = 0; dy < stepY; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            sum += values[(row * stepY + dy) * 8 + (column * 2 + dx)];
          }
        }
        data[row * width + column] = sum / (stepY * 2);
      }
    }
    return { data: data, width: width, height: height };
  }

  /* ------------------------------------------------------------------ */
  /* 步骤定义                                                            */
  /* ------------------------------------------------------------------ */

  const STEPS = [
    {
      id: 'source', short: '源图', tag: '输入',
      title: '源图像与 8×8 分块',
      lead: '整幅图先切成互不重叠的 8×8 块，后面所有变换都以块为单位。',
      principle: '<p>块按光栅顺序排列；点击右图任意块即可切换分析对象，后续每一步都跟着换。</p><p>默认块由程序在整幅图上打分选出：<b>结构清楚、曝光适中、靠近画面中心</b>。这样 DCT 系数有可讲的形状，量化后会一部分归零、一部分保留，重建差别肉眼可辨。</p>',
      formula: '块坐标  bx = floor(x/8),  by = floor(y/8)\n块内像素  f(x, y),  x, y = 0..7',
      tips: ['点击图像可切换分析块', '彩色图还会经过 YCbCr 与色度下采样', '纯噪声块会整块归零，纯天空块几乎没有交流系数'],
      params: function () {
        return [
          ['图像', escapeHTML(state.imageName)],
          ['分辨率', state.width + ' × ' + state.height],
          ['块网格', Math.ceil(state.width / 8) + ' × ' + Math.ceil(state.height / 8)],
          ['当前块', '(' + state.blockX + ', ' + state.blockY + ')']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="tour">扫描块动画</button><button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
      }
    },
    {
      id: 'color', short: '颜色空间', tag: '编码 01',
      title: 'RGB → YCbCr 颜色空间转换',
      lead: '对第一步选中的 8×8 块逐像素做颜色空间转换，得到同一块的 Y、Cb、Cr 三个 8×8 分量。',
      principle: '<p>转换只作用于当前选中的 8×8 块：R/G/B 三通道逐像素线性组合成亮度 Y 和色差 Cb/Cr。此时仍无损，只是换了一种表示。</p>',
      formula: 'Y  =  0.299R + 0.587G + 0.114B\nCb = 128 - 0.168736R - 0.331264G + 0.5B\nCr = 128 + 0.5R - 0.418688G - 0.081312B',
      tips: ['Y 通道看起来就是灰度图', 'Cb/Cr 以 128 为中性：偏离越远颜色越浓'],
      params: function () {
        const block = selectedYCbCrBlock();
        return [
          ['分析块', '(' + state.blockX + ', ' + state.blockY + ')'],
          ['块尺寸', '8 × 8'],
          ['Y 均值', mean(block.y).toFixed(1)],
          ['Cb/Cr 均值', mean(block.cb).toFixed(1) + ' / ' + mean(block.cr).toFixed(1)]
        ];
      },
      tools: function () { return ''; }
    },
    {
      id: 'subsample', short: '色度采样', tag: '编码 02',
      title: '色度下采样',
      lead: '把 Cb/Cr 的采样点减半或减到 1/4，亮度 Y 一列不动。',
      principle: '<p>4:2:0 在水平和垂直方向各减半，色度样本数降到 1/4；4:2:2 只水平减半；4:4:4 不变。人眼对色度不敏感，这一步几乎看不出差别，码率却明显下降。</p>',
      formula: '4:4:4  8×8 → 8×8\n4:2:2  8×8 → 4×8\n4:2:0  8×8 → 4×4\n色度数据量：100% / 50% / 25%',
      tips: ['只处理当前 8×8 块，Y 不变', '4:2:0 是码率与观感最常用的折中', '彩色边缘会最先变糊'],
      params: function () {
        const mode = state.subsampling;
        return [
          ['分析块', '(' + state.blockX + ', ' + state.blockY + ')'],
          ['采样格式', mode === '444' ? '4:4:4' : mode === '422' ? '4:2:2' : '4:2:0'],
          ['Cb/Cr 尺寸', mode === '444' ? '8 × 8' : mode === '422' ? '4 × 8' : '4 × 4'],
          ['色度数据量', mode === '444' ? '100%' : mode === '422' ? '50%' : '25%']
        ];
      },
      tools: function () { return ''; }
    },
    {
      id: 'block', short: '分块', tag: '编码 03',
      title: '8×8 分块与电平平移',
      lead: '各分量单独分块，再把像素值整体减去 128，让 DCT 输入围绕 0 起伏。',
      principle: '<p>电平平移不改变信息，只把 0–255 映射到 −128…127，让直流系数更小、量化更高效。块边缘不足 8 像素时复制最后一行/列补齐。</p>',
      formula: 'f′(x,y) = f(x,y) − 128\nY：0..255 → −128..127\nCb/Cr 同样以 128 为中心',
      tips: ['色度已下采样，三个分量的块位置不同', '平移不丢信息，只是把 0–255 变成 −128…127', '块效应来自量化，不是分块本身'],
      params: function () {
        const yBlock = encodedBlock('Y');
        return [
          ['分析分量', state.component],
          ['Y 块坐标', '(' + componentBlock('Y').x + ', ' + componentBlock('Y').y + ')'],
          ['Cb 块坐标', '(' + componentBlock('Cb').x + ', ' + componentBlock('Cb').y + ')'],
          ['Y 原始范围', rangeText(yBlock.pixels, 128)]
        ];
      },
      tools: function () {
        return '<button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
      }
    },
    {
      id: 'dct', short: 'DCT', tag: '编码 04',
      title: '二维离散余弦变换',
      lead: 'DCT 不问“哪里多亮”，只问“这块由哪些余弦图案拼成、各占几份”——答案就是 64 个系数。',
      principle: '<p><b>它换了一套坐标系。</b>原来是“第几行第几列有多少亮度”，DCT 之后是“第几种余弦图案占了多少份”。数据没变，只是换个说法。</p>' +
        '<p><b>三步走：</b>① 每个像素减 128，让整块围绕 0 起伏；② 用 64 张固定基图与整块做内积，量出权重 F(u,v)；③ 反变换把基图按权重加回去，像素原样回来。</p>' +
        '<p><b>所以 DCT 本身无损。</b>真正的损失在下一步量化——那里才把系数取整、把小系数砍成 0。四个细节分别在后面四页展开。</p>',
      formula: '电平移位：f(x,y) = p(x,y) − 128\n基图：B_uv(x,y) = C_u(y)·C_v(x)\n正变换：F(u,v) = ΣxΣy f(x,y)·B_uv(x,y)   ← 内积/投影\n反变换：f(x,y) = ΣuΣv F(u,v)·B_uv(x,y)   ← 加权求和\n分解：F = T·f·Tᵀ（先逐行，再逐列）\nα0 = 1/√8，αk(k>0) = 1/2',
      tips: [
        '系数是权重：正=同相位，负=反相位，0=没有这种图案',
        '64 项全加回 = 原块，DCT 无损',
        '左上 DC 管平均亮度，越往右下频率越高',
        '量化才是主动丢信息的一步'
      ],
      params: function () {
        const block = encodedBlock();
        let energy = 0;
        for (let i = 0; i < 64; i++) energy += block.coefficients[i] * block.coefficients[i];
        const sorted = Array.from(block.coefficients).map(Math.abs).sort(function (a, b) { return b - a; });
        const top = sorted[0] * sorted[0] + sorted[1] * sorted[1] + sorted[2] * sorted[2];
        return [
          ['分量', state.component],
          ['DC 系数', formatValue(block.coefficients[0])],
          ['前 3 系数能量', (100 * top / Math.max(1e-9, energy)).toFixed(1) + '%'],
          ['低频 10 项能量', lowFrequencyEnergyShare(block.coefficients) + '%']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="goto" data-target="dct:1">下一张：一维 DCT</button>' +
          '<button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
      }
    },
    {
      id: 'quant', short: '量化', tag: '编码 05',
      title: '量化：系数域中的有损步骤',
      lead: '每个系数都做一次「除以步长 → 四舍五入」；点矩阵任意一格，可以看这一格完整的算式。',
      principle: '<p>四个矩阵从上到下就是一条流水线：原始系数 F 除以这一格的量化步长 q，得到商 F/q，再四舍五入成整数 Fq。商落在 ±0.5 之内就归 0，这一格整格被丢掉。</p><p>量化表按人眼对比度敏感度设计：<b>低频步长小、高频步长大</b>，所以高频的 F/q 更容易落进 ±0.5 被清零。质量因子 QF 整体缩放量化表，QF 越小步长越大、丢得越多。</p><p>DCT 和熵编码都可逆，量化是整条链路里唯一真正丢信息的地方。</p>',
      formula: 'Fq(u,v) = round( F(u,v) / q(u,v) )\nround(x)：x ≥ 0 时 ⌊x+0.5⌋，x < 0 时 ⌈x−0.5⌉\n即 |x| < 0.5 → 0；|x| ≥ 0.5 → 最近的整数\nq(u,v)=round(Qbase(u,v)×scale(QF)/100)\nQF<50  scale=5000/QF；QF≥50  scale=200−2QF',
      tips: ['点击任一格，看 F → q → F/q → Fq 的完整算式', '③ 的浅橙底 = 商不足半个步长，必被置零', '红叉 = 最终被量化为 0 的系数', 'QF=100 也不保证逐像素无损'],
      params: function () {
        const block = encodedBlock();
        let zeros = 0;
        for (let i = 0; i < 64; i++) if (block.quantized[i] === 0) zeros += 1;
        return [
          ['质量因子 QF', state.Q],
          ['q(u,v) 范围', Math.min.apply(null, Array.from(block.quant)) + '–' + Math.max.apply(null, Array.from(block.quant))],
          ['置零系数', zeros + ' / 64'],
          ['零系数占比', (100 * zeros / 64).toFixed(1) + '%']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="quant">播放量化过程</button>';
      }
    },
    {
      id: 'zigzag', short: 'Zigzag', tag: '编码 06',
      title: 'Zigzag 扫描',
      lead: '按频率从低到高重排 64 个系数，让零集中到序列尾部。',
      principle: '<p>路径从左上角出发沿对角线往返，先覆盖低频再覆盖高频。扫描本身不压缩，只是把二维矩阵摊成一维，方便后面做游程编码。</p>',
      formula: '扫描顺序：(0,0)→(0,1)→(1,0)→(2,0)→…→(7,7)\n一维序列 s[0..63]',
      tips: ['低频在前、高频在后，零集中在尾部', '尾部的长零串正好给游程编码', '16 个零写成 ZRL，剩余全零用 EOB 收尾'],
      params: function () {
        const block = encodedBlock();
        let zeros = 0;
        for (let i = 0; i < 64; i++) if (block.scan[i] === 0) zeros += 1;
        return [
          ['分量', state.component],
          ['序列长度', '64'],
          ['零系数', zeros + ' / 64'],
          ['扫描进度', state.zigStep + ' / 64']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="zigzag">播放 Zigzag 扫描</button>';
      }
    },
    {
      id: 'rle', short: '游程编码', tag: '编码 07',
      title: 'DC 差分与 AC 游程',
      lead: 'DC 系数用块间差分，AC 系数用 (零游程, 幅值类别) 表示。',
      principle: '<p>相邻块的 DC 代表平均亮度、高度相关，所以编码差值而非绝对值。AC 按 Zigzag 顺序扫描，连续零用 run 表示：16 个连续零记 ZRL（0xF0），剩余全零记 EOB（0x00）。</p><p>每个非零幅值再按类别写成幅值位，负数用 JPEG 的反码映射。</p>',
      formula: 'DC：diff = DC(k) − DC(k−1)\nAC：(run, size) + amplitude bits\nZRL = (16, 0)，EOB = (0, 0)\nsize = floor(log2|v|)+1',
      tips: ['DC 用差值，动态范围远小于绝对值', 'ZRL 补 16 个零，EOB 提前收尾', '符号数越少，后面的位数就越少'],
      params: function () {
        const block = encodedBlock();
        let zrl = 0;
        block.symbols.forEach(function (symbol) { if (symbol.kind === 'ZRL') zrl += 1; });
        return [
          ['前块 DC', block.previousDC],
          ['当前 DC', block.scan[0]],
          ['DC 差分', block.difference],
          ['符号数 / ZRL', block.symbols.length + ' / ' + zrl]
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="rle">播放游程编码</button>';
      }
    },
    {
      id: 'huffman', short: 'Huffman', tag: '编码 08',
      title: '规范 Huffman 编码',
      lead: 'JPEG 用约定的规范 Huffman 表：常见符号短码、罕见符号长码，换图也不重新建表。',
      principle: '<p>JPEG 不传整棵码树，只传每种码长上有多少个符号，解码端据此唯一生成码字。DC 与 AC 各一张表，本演示用 T.81 附录 K 的亮度表。</p><p>每个符号 = Huffman 码 + 幅值位，幅值位不参与 Huffman 编码。</p>',
      formula: '码字按码长递增、同长度按符号值递增分配\n块位数 = Σ(码字长度) + Σ(幅值位数)',
      tips: ['短码给出现次数多的符号', 'DC 与 AC 各用一张表', '码表本身也要写进文件头'],
      params: function () {
        const block = encodedBlock();
        let average = 0;
        block.symbols.forEach(function (symbol) { average += symbol.code.length + symbol.amplitude.length; });
        average /= block.symbols.length;
        return [
          ['符号数', block.symbols.length],
          ['本块位数', block.bits.length + ' bit'],
          ['平均每符号', average.toFixed(2) + ' bit'],
          ['编码后字节', Math.ceil(block.bits.length / 8) + ' B']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="bitwrite">播放位流写入</button>';
      }
    },
    {
      id: 'bitstream', short: '位流', tag: '编码 09',
      title: '熵编码输出',
      lead: '所有块按 MCU 顺序拼接，形成最终熵编码位流。',
      principle: '<p>位流只含 Huffman 码与幅值位；真实 JPEG 还会在文件头写 SOI、DQT、SOF0、DHT、SOS 等标记段，本页只统计熵编码段。</p><p>压缩比以原始 RGB 24 bit/像素为基准，实际文件还要加表与标记的开销。</p>',
      formula: '总位数 = Σ 块位数\n字节数 = ceil(总位数 / 8)\n压缩比 = (W·H·24) / (8·字节数)',
      tips: ['Y 分量通常占最多位数', '高频纹理块位数明显更高', '压缩比只看熵编码段'],
      params: function () {
        const stats = state.encoded.stats;
        return [
          ['总位数', stats.totalBits + ' bit'],
          ['熵编码字节', stats.entropyBytes + ' B'],
          ['填充位', stats.paddingBits + ' bit'],
          ['压缩比', (state.width * state.height * 24 / (8 * stats.entropyBytes)).toFixed(1) + '×']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="assembly">播放位流拼接</button>';
      }
    },
    {
      id: 'decEntropy', short: '熵解码', tag: '解码 01',
      title: '熵解码：从位流恢复符号',
      lead: '解码器按相同码表逐位读取，遇到完整码字就输出符号，再读取幅值位。',
      principle: '<p>Huffman 解码是一棵前缀树：从根开始逐位下降，到达叶节点即得到一个符号。DC 用独立预测器按块顺序累加差分，AC 按游程填满 64 个系数。</p>',
      formula: '读取 Huffman 码 → 符号\nDC：DC(k)=DC(k−1)+diff\nAC：按 (run,size) 填充\n位位置从该块的 bitStart 开始',
      tips: ['编码与解码符号应完全一致', 'DC 预测器按分量独立', '解码头只读取熵编码段'],
      params: function () {
        const block = encodedBlock();
        const decoded = decodedBlock();
        const same = sameSymbols(block.symbols, decoded.symbols);
        return [
          ['分量', state.component],
          ['位范围', block.bitStart + '–' + block.bitEnd],
          ['符号数', block.symbols.length + ' / ' + decoded.symbols.length],
          ['一致性', same ? '<span class="ok">一致</span>' : '<span class="warn">不一致</span>']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="decode">播放熵解码</button>';
      }
    },
    {
      id: 'dequant', short: '反量化', tag: '解码 02',
      title: '反量化',
      lead: '解码端把量化系数乘回量化步长，得到带误差的 DCT 系数。',
      principle: '<p>反量化只能恢复量化区间的中心值，无法恢复被丢弃的高频细节。量化步长越大，系数误差越大，块效应和振铃越明显。</p>',
      formula: 'F′(u,v) = Fq(u,v) × Q(u,v)\n系数误差 e = F′ − F',
      tips: ['反量化不是逆运算，信息已丢失', '高频误差通常更大', 'QF 越小、步长越小，误差也越小'],
      params: function () {
        const block = encodedBlock();
        const decoded = decodedBlock();
        let squared = 0;
        for (let i = 0; i < 64; i++) {
          const difference = decoded.dequantized[i] - block.coefficients[i];
          squared += difference * difference;
        }
        return [
          ['分量', state.component],
          ['质量因子 QF', state.Q],
          ['系数 MSE', (squared / 64).toFixed(2)],
          ['最大系数误差', maxAbsDifference(block.coefficients, decoded.dequantized).toFixed(1)]
        ];
      },
      tools: function () { return ''; }
    },
    {
      id: 'idct', short: 'IDCT', tag: '解码 03',
      title: 'IDCT 重建像素块',
      lead: '反量化系数经过二维 IDCT 回到空间域，再加 128 并截断到 0–255。',
      principle: '<p>IDCT 与 DCT 用同一组余弦基，只是转置相乘。浮点结果四舍五入后可能超出 0–255，需要截断，这一步也会带来少量误差。</p>',
      formula: 'f(x,y) = 1/4·ΣuΣv C(u)C(v)F′(u,v)\n        ·cos((2x+1)uπ/16)·cos((2y+1)vπ/16)\n像素 = clamp(round(f + 128), 0, 255)',
      tips: ['块内误差集中在高频纹理处', '块边界不连续 → 块效应', 'IDCT 本身不引入量化误差'],
      params: function () {
        const block = encodedBlock();
        const decoded = decodedBlock();
        let squared = 0;
        let maximum = 0;
        for (let i = 0; i < 64; i++) {
          const original = block.pixels[i] + 128;
          const reconstructed = clamp(Math.round(decoded.pixels[i] + 128), 0, 255);
          const difference = original - reconstructed;
          squared += difference * difference;
          maximum = Math.max(maximum, Math.abs(difference));
        }
        const mse = squared / 64;
        return [
          ['分量', state.component],
          ['块 MSE', mse.toFixed(2)],
          ['块 PSNR', mse === 0 ? '∞' : (10 * Math.log10(255 * 255 / mse)).toFixed(2) + ' dB'],
          ['最大像素误差', maximum]
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="idct">播放 IDCT 合成</button>';
      }
    },
    {
      id: 'recolor', short: '重建', tag: '解码 04',
      title: '色度上采样与逆颜色变换',
      lead: 'Cb/Cr 上采样回原尺寸，再与 Y 合成 RGB，得到最终解码图像。',
      principle: '<p>Cb/Cr 先双线性插值回原尺寸，再按逆矩阵恢复 RGB。编码端的下采样前做过平均，相当于先低通再抽取，避免混叠。</p><p>色度损失只让彩色边缘略微发糊，亮度细节基本都在。误差图放大 10 倍，块效应与色度误差才看得清。</p>',
      formula: 'R = Y + 1.402(Cr−128)\nG = Y − 0.344136(Cb−128) − 0.714136(Cr−128)\nB = Y + 1.772(Cb−128)',
      tips: ['PSNR 以 RGB 全部通道计算', '色度误差在彩色边缘更明显', 'QF 与采样格式共同决定最终码率'],
      params: function () {
        return [
          ['采样格式', state.subsampling === '444' ? '4:4:4' : state.subsampling === '422' ? '4:2:2' : '4:2:0'],
          ['质量因子 QF', state.Q],
          ['PSNR', state.psnr.toFixed(2) + ' dB'],
          ['压缩比', (state.width * state.height * 3 / state.encoded.stats.fileBytes).toFixed(1) + '×（原始RGB/完整文件）']
        ];
      },
      tools: function () { return ''; }
    },
    {
      id: 'visualLuma', short: '亮度颜色', tag: '原理 01',
      title: '人眼先看亮度，再看颜色',
      lead: '同样 ±5% 的幅度，一张只动亮度、一张只动饱和度——哪张更容易被看出来？',
      principle: '<p>两张图都是你的照片：② 只动<b>亮度</b>，颜色还在；③ 只动<b>饱和度</b>，明暗还在，区别只在“动了哪个通道”。</p><p>视网膜上<b>视杆细胞</b>管明暗约 1.25 亿个，<b>视锥细胞</b>管颜色只有约 600 万个——人眼对亮度敏感、对颜色迟钝。两张图同步按 <b>±5%</b> 跳动：亮度那张一眼就闪，饱和度那张几乎看不出来。这正是 JPEG 把 RGB 换成 <b>Y + Cb/Cr</b> 并只对色度下采样的理由。</p>',
      formula: 'Y  = 0.299R + 0.587G + 0.114B\nCb = 128 − 0.168736R − 0.331264G + 0.5B\nCr = 128 + 0.5R − 0.418688G − 0.081312B',
      tips: ['两张图同步跳动，幅度完全一样', '亮度那张：一亮一暗非常明显', '饱和度那张：同样的 5% 几乎看不出来'],
      params: function () {
        const planes = Codec.rgbToYCbCr(state.rgb, state.width, state.height);
        return [
          ['Y 均值', mean(planes.y).toFixed(1)],
          ['Cb 均值', mean(planes.cb).toFixed(1)],
          ['Cr 均值', mean(planes.cr).toFixed(1)],
          ['人眼感光', '视杆 1.25 亿 · 视锥 600 万']
        ];
      },
      tools: function () { return ''; }
    },
    {
      id: 'visualFreq', short: '低与高频', tag: '原理 02',
      title: '人眼对高频不敏感，所以敢删',
      lead: '相邻像素的亮度差就是频率：慢慢起伏是低频，一小块一小块跳变是高频。',
      principle: '<p>把亮度当高度画成地形图最直观：低频是一整片缓坡，高频是密密麻麻的细锯齿。人眼对细密锯齿本来就不敏感。</p><p>自然图像的能量也集中在低频：8×8 块做 DCT 后，前 10 个低频系数往往就够还原出可辨认的画面，剩下 54 个大多是细纹和噪声。所以 JPEG 敢把大量高频系数置零。</p>',
      formula: '低频：变化慢、成片、能量大 → 人眼敏感，保留\n高频：变化快、细密、能量小 → 人眼迟钝，可删',
      tips: ['低频决定“是什么”，高频决定“有多细”', '细密条纹对比度低时，人眼几乎分辨不出', '三维视图可拖动旋转，从侧面看起伏'],
      params: function () {
        return [
          ['低频系数', 'Zigzag 前 10 个'],
          ['高频系数', '其余 54 个'],
          ['DCT 块', '8 × 8'],
          ['区域对比', '蓝框 vs 橙框']
        ];
      },
      tools: function () { return ''; }
    }
  ];

  const FLOW_OVERRIDES = {
    'dct:0': function () {
      return {
        short: 'DCT·移位',
        title: 'DCT ①：把亮度搬到 0 附近',
        lead: '每个像素减 128，把 0–255 搬到 −128…127，让整块围绕 0 起伏。',
        principle: '<p><b>为什么要减 128。</b>64 张基图里只有 B(0,0) 是均匀的，其余 63 张平均值为 0。像素若带着 0–255 的正偏置，这 63 张怎么加权也凑不出平均值，只能让 DC 硬扛、其余系数反向补偿、数值虚高。减掉 128 后，DC 专管平均亮度，其余 63 张专管起伏。</p>' +
          '<p><b>这一步不丢信息</b>，反变换时再加回 128 即可。64 张基图与图像内容无关，换图换块都不变，变的只是权重 F(u,v)。</p>',
        formula: 'p(x,y) ∈ [0,255]\nf(x,y) = p(x,y) − 128 ∈ [−128,+127]\nDC 负责平均值，其余 63 张负责起伏\n反变换末步：像素 = clamp(round(f + 128))',
        tips: ['减 128 是平移不是压缩，可完全还原', 'DC 管平均亮度，其余 63 张管形状', '负数表示该处比平均亮度更暗'],
        params: function () {
          const block = encodedBlock();
          return [
            ['原块范围', rangeText(block.pixels, 128)],
            ['移位后范围', rangeText(block.pixels, 0)],
            ['DC 系数', formatValue(block.coefficients[0])],
            ['移位量', '128（固定）']
          ];
        },
        tools: function () {
          return '<button class="primary" data-action="goto" data-target="dct:1">下一张：一维 DCT</button>' +
            '<button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
        }
      };
    },
    'dct:1': function () {
      return {
        short: 'DCT·一维',
        title: 'DCT ②：一行像素拆成 8 个余弦波',
        lead: '取块里的一行：8 个像素 = 8 个固定余弦波按权重相加，权重就是内积算出的系数。',
        principle: '<p><b>8 个形状固定的波。</b>C<sub>0</sub> 是平的，C<sub>1</sub> 半个周期，越往后越密。它们两两正交，像坐标轴一样张成 8 维空间——任何 8 个数都能唯一写成它们的组合。</p>' +
          '<p><b>求权重就是量“像不像”。</b>与某个波逐点相乘再求和：像 → |系数| 大；不像 → 0；相位相反 → 负数。8 项全用残差为 0，少用几项才开始失真。</p>',
        formula: 'X(k) = Σx f(x)·C_k(x)      ← 内积求权重\nC_k(x) = α_k·cos((2x+1)kπ/16)\nf(x) = Σk X(k)·C_k(x)       ← 8 项全用 = 原行\nα0 = 1/√8，αk(k>0) = 1/2',
        tips: ['X(0) 是这行像素减 128 后的平均值', 'X(0) 为负说明整行比中灰更暗', 'k 越大条纹越密，越靠高频', '负系数 = 相位相反（亮暗颠倒）'],
        params: function () {
          const row = state.dctRow < 0 ? bestRowOfBlock() : state.dctRow;
          const values = dctRowValues(row);
          let peakIndex = 0;
          for (let k = 1; k < 8; k++) if (Math.abs(values.coefficients[k]) > Math.abs(values.coefficients[peakIndex])) peakIndex = k;
          const used = clamp(typeof state.dctUseCount === 'number' ? state.dctUseCount : 8, 0, 8);
          let error = 0;
          for (let k = 0; k < 8; k++) {
            let sum = 0;
            for (let i = 0; i < used; i++) sum += values.coefficients[i] * cosineBasis(i, k);
            error = Math.max(error, Math.abs(sum + 128 - values.pixels[k]));
          }
          return [
            ['当前行', dctRowLabel(row)],
            ['当前叠加', used + ' / 8 项' + (used === 0 ? '（直线）' : used === 1 ? '（只有 X0）' : '（X0…X' + (used - 1) + '）')],
            ['当前残差', used >= 8 ? '0.0（完全重合）' : error.toFixed(1)],
            ['最大 |X(k)|', 'X(' + peakIndex + ') = ' + formatValue(values.coefficients[peakIndex])]
          ];
        },
        tools: function () {
          return '<button class="primary" data-action="basis">自动播放叠加</button>' +
            '<button data-action="goto" data-target="dct:2">下一张：行列分解</button>' +
            '<button data-action="prevBlock">上一块</button>';
        }
      };
    },
    'dct:3': function () {
      return {
        short: 'DCT·二维',
        title: 'DCT ④：64 张基图，64 个权重',
        lead: '这一页看 64 个系数各自代表什么图案、单独一项能贡献多少。',
        principle: '<p><b>基图 = 纵向余弦 × 横向余弦。</b>u 管纵向条纹密度、v 管横向；(0,0) 是一片均匀，(7,7) 是最密的棋盘格。系数是权重而非亮度，负值只表示相位相反。</p>' +
          '<p><b>下方三联图：</b>① 基图长什么样；② 乘上系数后对像素的加减，白提亮、黑压暗；③ 只留这一项能画出什么。</p>' +
          '<p><b>能量集中在左上。</b>自然图像的系数从左上往右下迅速变小，低频十几项常占九成能量——这正是高频可以被砍掉的前提。</p>',
        formula: 'F(u,v) = ΣxΣy f(x,y)·B_uv(x,y)\n单项贡献 = F(u,v)·B_uv(x,y)\n反变换：f = ΣuΣv F(u,v)·B_uv\n能量守恒：Σf² = ΣF²（帕塞瓦尔）',
        tips: ['系数是权重：正=同相位，负=反相位', '|F| 越大，这一项对还原越重要', '单项画不出原块，64 项相加才行'],
        params: function () {
          const block = encodedBlock();
          return [
            ['分量', state.component],
            ['DC 系数', formatValue(block.coefficients[0])],
            ['非零系数', countNonZero(block.coefficients) + ' / 64'],
            ['低频 10 项能量', lowFrequencyEnergyShare(block.coefficients) + '%']
          ];
        },
        tools: function () {
          return '<button class="primary" data-action="goto" data-target="dct:4">下一张：叠加重建</button>' +
            '<button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
        }
      };
    },
    'dct:2': function () {
      return {
        short: 'DCT·行列',
        title: 'DCT ③：二维 = 先逐行、再逐列做两次一维',
        lead: '二维 DCT 没有新数学：先逐行做一维（横向频率），再逐列做一维（纵向频率）。',
        principle: '<p><b>第一遍只动横向：</b>每行做一次一维 DCT，8 行各做一次，得到一张中间矩阵——此时纵向还是像素坐标。</p>' +
          '<p><b>第二遍动纵向：</b>对中间矩阵的每列再做一次，纵向也变成频率，才得到 F(u,v)，矩阵式 F = T·f·Tᵀ。拆成两次一维是 2×8³ 次乘加，直接按二维算要 64²，差一个数量级——可分离性正是 JPEG 当年能跑在慢速硬件上的原因。</p>',
        formula: 'F = T·f·Tᵀ\nT[u][x] = α_u·cos((2x+1)uπ/16)\n第一遍 T·f：每行独立 → 横向频率\n第二遍 (…)·Tᵀ：每列独立 → 纵向频率',
        tips: ['第一遍后纵向仍是像素，不是频率', '先列后行结果相同', '中途那张是“半成品”，不是最终系数'],
        params: function () {
          return [
            ['已处理行', state.dctRowStep + ' / 8'],
            ['已处理列', state.dctColStep + ' / 8'],
            ['等价矩阵式', 'F = T·f·Tᵀ'],
            ['中间结果', '不是最终系数']
          ];
        },
        tools: function () {
          return '<button class="primary" data-action="twopass">重播行列动图</button>' +
            '<button data-action="goto" data-target="dct:3">下一张：二维系数</button>';
        }
      };
    },
    'dct:4': function () {
      return {
        short: 'DCT·重建',
        title: 'DCT ⑤：64 项加权相加 = 原块',
        lead: '把 64 项按权重从大到小一层层叠上去：前几项搭出轮廓，其余项补细纹；全部加完，与原块分毫不差。',
        principle: '<p><b>按 |F| 降序叠加。</b>前 3 项常占七成以上能量，只叠它们就能看出明暗结构；后面几十项数值很小，只补细纹。因为基图两两正交，按 |F| 排序与“每步挑残差最大”结果完全一样。</p>' +
          '<p><b>64 项全加完误差为 0</b>，这才是 DCT 无损的含义。真正的损失在下一步量化：取整、把小系数砍成 0。</p>' +
          '<p><b>这也解释了量化为什么专挑高频。</b>排在后面的项本就小，砍掉后重建几乎不变；砍掉前几项则画面立刻糊成一片。</p>',
        formula: 'f(x,y) = ΣuΣv F(u,v)·B_uv(x,y)\n前 3 项能量占比 ≈ 70%\n64 项全加：逐像素误差 = 0\n量化：Fq = round(F/q) ← 真正丢信息处',
        tips: ['每次「下一步」加一项，重建块逐步贴近原块', '按 |F| 排序叠加，最快看到轮廓', '小项只补细节，砍掉不明显'],
        params: function () {
          const block = encodedBlock();
          const count = clamp(Math.round(state.dctSumStep), 0, 64);
          const order = dctSumOrder(block.coefficients);
          let totalEnergy = 0;
          let usedEnergy = 0;
          for (let i = 0; i < 64; i++) totalEnergy += block.coefficients[i] * block.coefficients[i];
          for (let i = 0; i < count; i++) usedEnergy += block.coefficients[order[i]] * block.coefficients[order[i]];
          return [
            ['已叠加项', count + ' / 64'],
            ['占总能量', (totalEnergy > 0 ? (100 * usedEnergy / totalEnergy).toFixed(1) : '0.0') + '%'],
            ['当前重建误差', count >= 64 ? '0（无损）' : '见右侧读数'],
            ['下一步', '量化：round(F / q)']
          ];
        },
        tools: function () {
          return '<button class="primary" data-action="basissum">自动播放叠加</button>' +
            '<button data-action="goto" data-target="quant">下一章：量化</button>' +
            '<button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
        }
      };
    },
    result: function () {
      return {
        short: '二次压缩结果',
        title: '二次压缩结果',
        lead: '再压一次：熵编码能无损解回符号，但第一次量化抹掉的高频细节回不来。',
        principle: '<p>解码结果以“输入解码像素”为参考算 PSNR，只统计重建误差，不等价于人类观感。</p>',
        tips: ['压缩比只统计熵编码段', 'PSNR 高不等于看着好', 'QF=100 也不保证逐像素无损']
      };
    }
  };

  function flowStep(index) {
    const entry = FLOW_ENTRIES[clamp(index, 0, FLOW_ENTRIES.length - 1)];
    const base = STEPS[entry.step];
    /* 先找 chapter:subIndex 的覆盖（DCT 五页各一份），再退回整章覆盖 */
    const override = FLOW_OVERRIDES[entry.chapter + ':' + entry.subIndex] || FLOW_OVERRIDES[entry.chapter];
    const extra = override ? override(entry) : null;
    return extra ? Object.assign({}, base, extra) : base;
  }

  /* ------------------------------------------------------------------ */
  /* 小工具                                                              */
  /* ------------------------------------------------------------------ */

  function mean(values) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
  }

  function rangeText(values, offset) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let i = 0; i < values.length; i++) {
      minimum = Math.min(minimum, values[i] + offset);
      maximum = Math.max(maximum, values[i] + offset);
    }
    return minimum + '–' + maximum;
  }

  function entropyOf(values) {
    const histogram = new Map();
    for (let i = 0; i < values.length; i++) {
      const key = Math.round(values[i] + 128);
      histogram.set(key, (histogram.get(key) || 0) + 1);
    }
    let entropy = 0;
    histogram.forEach(function (count) {
      const probability = count / values.length;
      entropy -= probability * Math.log2(probability);
    });
    return entropy;
  }

  function maxAbsDifference(a, b) {
    let maximum = 0;
    for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i]));
    return maximum;
  }

  function countNonZero(values) {
    let count = 0;
    for (let i = 0; i < values.length; i++) if (values[i] !== 0) count += 1;
    return count;
  }

  function countZero(values) {
    let count = 0;
    for (let i = 0; i < values.length; i++) if (values[i] === 0) count += 1;
    return count;
  }

  function trailingZeros(values) {
    let count = 0;
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] !== 0) break;
      count += 1;
    }
    return count;
  }

  function colorBits(bits) {
    return bits.split('').map(function (bit) {
      return '<span class="' + (bit === '1' ? 'one' : 'zero') + '">' + bit + '</span>';
    }).join('');
  }

  function sameSymbols(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].kind !== b[i].kind || a[i].value !== b[i].value ||
          a[i].run !== b[i].run || a[i].size !== b[i].size) return false;
    }
    return true;
  }

  function symbolLabel(symbol) {
    if (symbol.kind === 'DC') return 'DC(' + symbol.size + ')';
    if (symbol.kind === 'EOB') return 'EOB';
    if (symbol.kind === 'ZRL') return 'ZRL';
    return '(' + symbol.run + ',' + symbol.size + ')';
  }

  function symbolTable(symbols, limit) {
    const rows = symbols.slice(0, limit || 24).map(function (symbol) {
      return '<tr><td>' + symbolLabel(symbol) + '</td><td>' + (symbol.kind === 'AC' || symbol.kind === 'DC' ? symbol.value : '—') +
        '</td><td><code>' + symbol.code + '</code></td><td>' + symbol.code.length + '</td><td><code>' +
        (symbol.amplitude || '—') + '</code></td></tr>';
    }).join('');
    return '<div class="scroll"><table class="data"><thead><tr><th>符号</th><th>值</th><th>码字</th><th>码长</th><th>幅值位</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' + (symbols.length > (limit || 24) ? '<p class="note">仅显示前 ' + (limit || 24) + ' 个符号，共 ' + symbols.length + ' 个。</p>' : '');
  }

  /* ------------------------------------------------------------------ */
  /* 各步骤可视化                                                        */
  /* ------------------------------------------------------------------ */

  function renderSourceStep() {
    stage.innerHTML = '<div class="source-layout">' +
      figure('sourceCanvas', '悬浮预览 · 点击确认分析块', 'source-figure') +
      '<div class="block-preview">' +
      '<div class="block-preview-head" id="blockPreviewHead"></div>' +
      '<canvas id="blockPreview" role="img" aria-label="当前分析块的 8×8 放大预览"></canvas>' +
      '<p class="note">当前分析块的 8×8 放大预览。</p>' +
      '</div></div>';
    const target = setupCanvas('sourceCanvas', SOURCE_CANVAS_WIDTH, SOURCE_CANVAS_HEIGHT);
    const preview = setupCanvas('blockPreview', 240, 240);
    const head = document.getElementById('blockPreviewHead');
    /* 大屏用高度换尺寸：源图接近满高，块预览栏也放宽，避免正中一大片空白 */
    target.canvas.style.maxWidth = WIDE_SCREEN
      ? 'min(100%, calc(100vh - 300px), 1180px)'
      : 'min(100%, calc(100vh - 230px), 820px)';
    drawRGBInto(target, state.rgb, state.width, state.height);
    drawGridAndBlock(target, state.width, state.height);

    function showBlock(blockX, blockY, hovering) {
      drawRGBBlockPreview(preview, blockX, blockY);
      head.innerHTML = (hovering ? '悬浮 8×8 块' : '当前 8×8 块') +
        ' <b>(' + blockX + ', ' + blockY + ')</b>';
    }

    function blockAt(event) {
      const rectangle = target.canvas.getBoundingClientRect();
      const x = (event.clientX - rectangle.left) / rectangle.width * state.width;
      const y = (event.clientY - rectangle.top) / rectangle.height * state.height;
      return {
        x: clamp(Math.floor(x / 8), 0, Math.ceil(state.width / 8) - 1),
        y: clamp(Math.floor(y / 8), 0, Math.ceil(state.height / 8) - 1)
      };
    }

    state.hoverBlock = null;
    showBlock(state.blockX, state.blockY, false);

    /* 指针移动合并到一帧一次：每次 mousemove 都要读一次 rect 并重绘块预览，
       高频事件下合并后掉帧明显减少，视觉表现不变（最多延后一帧）。 */
    let hoverFrame = 0;
    let hoverPoint = null;

    function applyHover() {
      hoverFrame = 0;
      const point = hoverPoint;
      hoverPoint = null;
      if (!point) return;
      const block = blockAt(point);
      if (state.hoverBlock && state.hoverBlock.x === block.x && state.hoverBlock.y === block.y) return;
      state.hoverBlock = block;
      showBlock(block.x, block.y, true);
    }

    target.canvas.addEventListener('mousemove', function (event) {
      hoverPoint = { clientX: event.clientX, clientY: event.clientY };
      if (!hoverFrame) hoverFrame = requestAnimationFrame(applyHover);
    });

    target.canvas.addEventListener('mouseleave', function () {
      if (hoverFrame) { cancelAnimationFrame(hoverFrame); hoverFrame = 0; }
      hoverPoint = null;
      state.hoverBlock = null;
      showBlock(state.blockX, state.blockY, false);
    });

    target.canvas.addEventListener('click', function (event) {
      const block = blockAt(event);
      state.blockX = block.x;
      state.blockY = block.y;
      state.hoverBlock = null;
      state.selectedCoeff = -1;
      state.basis = null;
      refreshSourceCanvas();
      renderLeft();
    });
  }

  function renderColorStep() {
    const block = selectedYCbCrBlock();
    const maxWidth = SMALL_SCREEN
      ? 'min(100%, 420px)'
      : 'min(100%, max(200px, calc((100vh - 230px) / 2)), 420px)';
    function colorCanvas(id) {
      const target = setupCanvas(id, 420, 420);
      target.canvas.style.maxWidth = maxWidth;
      return target;
    }
    stage.innerHTML = '<div class="grid-2 color-grid">' +
      figure('colorRGB', 'RGB 8×8 块 (' + state.blockX + ', ' + state.blockY + ')') +
      figure('colorY', 'Y 亮度 8×8 · 范围 ' + rangeText(block.y, 0)) +
      figure('colorCb', 'Cb 蓝色差 8×8 · 范围 ' + rangeText(block.cb, 0)) +
      figure('colorCr', 'Cr 红色差 8×8 · 范围 ' + rangeText(block.cr, 0)) +
      '</div>';
    drawRGBBlockPreview(colorCanvas('colorRGB'), state.blockX, state.blockY);
    drawCells(colorCanvas('colorY'), block.y, grayColor, { gridColor: 'rgba(255,255,255,0.55)' });
    drawCells(colorCanvas('colorCb'), block.cb, function (value) { return chromaColor(value, 'cb'); }, { gridColor: 'rgba(255,255,255,0.55)' });
    drawCells(colorCanvas('colorCr'), block.cr, function (value) { return chromaColor(value, 'cr'); }, { gridColor: 'rgba(255,255,255,0.55)' });
  }

  /* ---- 色度下采样的局部对比 ------------------------------------------
     8×8 的色度格只能看出“样本变少了”，看不出观感上的变化。这里以第一步选中的
     8×8 块为中心取一块 160×160 的区域（20×20 个块），按当前格式走一遍
     “下采样 → 上采样 → 逆颜色变换”，与 4:4:4 的全分辨率结果并排显示。
     换个分析块，这块对比区就跟着换。 */
  const CROP_SIZE = 160;
  const CROP_CANVAS = 220;
  let cropWindowCache = { key: '', window: null };

  /* 跟随分析块：以其像素质心为中心取窗，原点对齐到 8 像素（也就对齐了色度采样格），
     贴到画面边缘时向内收。 */
  function chromaCropWindow() {
    const key = state.imageId + ':' + state.blockX + ':' + state.blockY;
    if (cropWindowCache.key === key && cropWindowCache.window) return cropWindowCache.window;
    const size = Math.max(8, Math.min(CROP_SIZE, Math.floor(Math.min(state.width, state.height) / 8) * 8));
    const centerX = state.blockX * 8 + 4;
    const centerY = state.blockY * 8 + 4;
    const snap = function (center, limit) {
      return clamp(Math.floor((center - size / 2) / 8) * 8, 0, Math.max(0, limit - size));
    };
    const crop = { x: snap(centerX, state.width), y: snap(centerY, state.height), size: size };
    cropWindowCache = { key: key, window: crop };
    return crop;
  }

  /* 抠出窗内的 Y/Cb/Cr 平面（全分辨率，取整口径与 8×8 块一致）。 */
  function cropPlanes(crop) {
    const size = crop.size;
    const y = new Float32Array(size * size);
    const cb = new Float32Array(size * size);
    const cr = new Float32Array(size * size);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const sourceX = Math.min(state.width - 1, crop.x + column);
        const sourceY = Math.min(state.height - 1, crop.y + row);
        const index = (sourceY * state.width + sourceX) * 4;
        const r = state.rgb[index];
        const g = state.rgb[index + 1];
        const b = state.rgb[index + 2];
        const at = row * size + column;
        y[at] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        cb[at] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
        cr[at] = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
      }
    }
    return { y: y, cb: cb, cr: cr, size: size };
  }

  /* 与编解码器同一条路：2×2（4:2:0）/ 1×2（4:2:2）平均下采样，再双线性插值回原尺寸。 */
  function chromaRoundTrip(plane, size, mode) {
    const small = Codec.downsample(plane, size, size, mode);
    return Codec.upsampleBilinear(small.data, small.w, small.h, size, size, mode);
  }

  function subsampleCompareMarkup(crop, mode) {
    const shown = mode === '444' ? '420' : mode;
    const label = shown === '422' ? '4:2:2' : '4:2:0';
    const method = shown === '422' ? '水平 2 个取平均，垂直保留' : '4 个色度样本平均成 1 个';
    const zoom = CROP_CANVAS / crop.size;
    return '<div class="sub-compare">' +
      '<div class="sub-compare-head">局部对比<span>像素 (' + crop.x + ', ' + crop.y + ') 起 ' + crop.size + '×' + crop.size +
      ' · 放大 ×' + (zoom >= 10 ? Math.round(zoom) : zoom.toFixed(1)) + ' · ' + label + '：' + method +
      '</span></div>' +
      '<div class="grid-2">' +
      figure('subCropBefore', '采样前 · 4:4:4，色度逐像素保留') +
      figure('subCropAfter', '采样后 · ' + label + ' 重建（色度插值放大）' +
        (mode === '444' ? '<br>当前参数为 4:4:4，这里用 4:2:0 举例' : '')) +
      '</div><p class="note" id="subCropNote"></p></div>';
  }

  function drawSubsampleCompare(crop, mode) {
    const before = setupCanvas('subCropBefore', CROP_CANVAS, CROP_CANVAS);
    const after = setupCanvas('subCropAfter', CROP_CANVAS, CROP_CANVAS);
    if (!before || !after) return;
    const shown = mode === '444' ? '420' : mode;
    const planes = cropPlanes(crop);
    const size = crop.size;
    const beforeRGB = Codec.ycbcrToRgb(planes.y, planes.cb, planes.cr, size, size);
    const cbAfter = chromaRoundTrip(planes.cb, size, shown);
    const crAfter = chromaRoundTrip(planes.cr, size, shown);
    const afterRGB = Codec.ycbcrToRgb(planes.y, cbAfter, crAfter, size, size);
    drawRGBInto(before, beforeRGB, size, size);
    drawRGBInto(after, afterRGB, size, size);
    let maxCb = 0;
    let maxCr = 0;
    let total = 0;
    for (let i = 0; i < size * size; i++) {
      const deltaCb = Math.abs(cbAfter[i] - planes.cb[i]);
      const deltaCr = Math.abs(crAfter[i] - planes.cr[i]);
      if (deltaCb > maxCb) maxCb = deltaCb;
      if (deltaCr > maxCr) maxCr = deltaCr;
      total += deltaCb + deltaCr;
    }
    const note = document.getElementById('subCropNote');
    if (note) {
      const observation = (maxCb + maxCr) < 3
        ? '这块颜色本来就平，下采样几乎改不动它——4:2:0 只在颜色交界处吃亏。'
        : '颜色交界变软、细密的彩色纹路被抹平；亮度边缘仍然清晰，因为 Y 一个样本都没丢。';
      note.innerHTML = observation +
        '该区域色度最大偏差 ΔCb/ΔCr = ' + Math.round(maxCb) + ' / ' + Math.round(maxCr) +
        '，平均 ' + (total / (size * size * 2)).toFixed(1) + '（0–255）。';
    }
  }

  function renderSubsampleStep() {
    const block = selectedYCbCrBlock();
    const mode = state.subsampling;
    const cbSample = subsampleChroma(block.cb, mode);
    const crSample = subsampleChroma(block.cr, mode);
    const sampleSize = cbSample.width + ' × ' + cbSample.height;
    const crop = chromaCropWindow();
    const compare = subsampleCompareMarkup(crop, mode);
    if (mode === '444') {
      stage.innerHTML = '<div class="grid-2">' + figure('subCb', 'Cb 8×8（4:4:4 不降采样）') +
        figure('subCr', 'Cr 8×8（4:4:4 不降采样）') + '</div>' + compare;
      drawSampleGrid(setupCanvas('subCb', 200, 200), block.cb, 8, 8, 'cb');
      drawSampleGrid(setupCanvas('subCr', 200, 200), block.cr, 8, 8, 'cr');
      drawSubsampleCompare(crop, mode);
      return;
    }
    stage.innerHTML = '<div class="grid-4">' +
      figure('subCbOriginal', 'Cb 原 8×8') +
      figure('subCbSmall', 'Cb 下采样 ' + sampleSize) +
      figure('subCrOriginal', 'Cr 原 8×8') +
      figure('subCrSmall', 'Cr 下采样 ' + sampleSize) + '</div>' + compare;
    drawSampleGrid(setupCanvas('subCbOriginal', 200, 200), block.cb, 8, 8, 'cb');
    drawSampleGrid(setupCanvas('subCrOriginal', 200, 200), block.cr, 8, 8, 'cr');
    drawSampleGrid(setupCanvas('subCbSmall', 200, 200), cbSample.data, cbSample.width, cbSample.height, 'cb');
    drawSampleGrid(setupCanvas('subCrSmall', 200, 200), crSample.data, crSample.width, crSample.height, 'cr');
    drawSubsampleCompare(crop, mode);
  }

  function renderBlockStep() {
    stage.innerHTML = '<div class="grid-3">' +
      figure('blockY', 'Y 块 ' + blockLabel('Y')) +
      figure('blockCb', 'Cb 块 ' + blockLabel('Cb')) +
      figure('blockCr', 'Cr 块 ' + blockLabel('Cr')) +
      '</div>';
    ['Y', 'Cb', 'Cr'].forEach(function (component) {
      const block = encodedBlock(component);
      const values = new Float64Array(64);
      for (let i = 0; i < 64; i++) values[i] = block.pixels[i] + 128;
      const target = setupCanvas('block' + component, 360, 360);
      drawCells(target, values, grayColor, {
        text: function (value) { return String(Math.round(value)); },
        gridColor: 'rgba(255,255,255,0.55)'
      });
    });
  }

  function blockLabel(component) {
    const position = componentBlock(component);
    return '(' + position.x + ', ' + position.y + ')';
  }

  function renderDctStep() {
    const view = state.dctView;
    if (view === 'shift') { renderDctShift(); return; }
    if (view === 'twopass') { renderDctTwoPass(); return; }
    if (view === 'oneD') { renderDctOneD(); return; }
    if (view === 'rebuild') { renderDctRebuild(); return; }
    renderDctBasisView();
  }

  /* ① 电平移位：原块 0–255 → 减 128 → 64 张固定基图 */
  function renderDctShift() {
    const block = encodedBlock();
    stage.innerHTML = '<div class="dct-shift-row">' +
      figure('shiftOriginal', '① 原块 p(x,y)：0–255，亮度只有正数') +
      figure('shiftCentered', '② 减 128 后 f(x,y)：−128…+127，蓝 = 负、红 = 正') +
      '</div>' +
      '<p class="note" id="shiftReadout"></p>';
    drawCells(setupCanvas('shiftOriginal', 460, 460), block.pixels, function (value) {
      const level = clamp(Math.round(value + 128), 0, 255);
      return [level, level, level];
    }, {
      text: function (value) { return String(Math.round(value + 128)); },
      gridColor: 'rgba(255,255,255,0.6)'
    });
    drawCells(setupCanvas('shiftCentered', 460, 460), block.pixels, function (value) {
      return shiftedBlockColor(value);
    }, {
      text: function (value) { return String(Math.round(value)); },
      gridColor: 'rgba(255,255,255,0.6)'
    });
    refreshShiftReadout();
  }

  function refreshShiftReadout() {
    const readout = document.getElementById('shiftReadout');
    if (!readout) return;
    readout.textContent = '右图读法：蓝 = 比平均暗（负），红 = 比平均亮（正），浅色 ≈ 0（与均值相当）。';
  }

  /* ③ 二维视角：系数矩阵 + 单项贡献三联图 */
  function renderDctBasisView() {
    const block = encodedBlock();
    /* 这一页是“系数矩阵 + 64 张基图 + 三联图”三层方形图叠起来，两个主图按满宽放任时
       总高超过一屏，一屏装下算法只能把三块一起压到 0.4 倍——矩阵格子里的数字会小到
       看不清、左侧还留一片空白。先按可用高度给两张主图一个上限，让矩阵保持可读尺寸，
       fit 只做小幅修正；窗口变化时会随整页重绘重新计算。 */
    const pictureCap = (window.innerWidth || document.documentElement.clientWidth || 1200) >= 900
      ? clamp(Math.round(stageViewportHeight() * 0.42), 240, 620)
      : 0;
    stage.innerHTML = '<div class="dct-2d-top"><div class="dct-2d-col">' +
      figure('dctMain', 'DCT 系数矩阵 F(u,v)：点任意一格（或右侧基图）看这一项的贡献') +
      '<p class="note" id="dctReadout"></p>' +
      statBlock([
        ['分量', state.component],
        ['DC 系数', formatValue(block.coefficients[0])],
        ['|F| 最大', formatValue(maxAbsCoefficient(block.coefficients))],
        ['低频 10 项能量', lowFrequencyEnergyShare(block.coefficients) + '%']
      ]) +
      '</div><div class="dct-2d-col">' +
      figure('dctBasis', '64 张余弦基图像 B(u,v)：行 u = 纵向频率，列 v = 横向频率，点任意一张选中它') +
      '</div></div>' +
      '<div class="dct-term-row">' +
      figure('dctTermBasis', '① 基图 B(u,v)：固定图案') +
      figure('dctTermContribution', '② 基图 × 系数 F(u,v)：白=加亮，黑=压暗') +
      figure('dctTermRebuild', '③ 只留这一项能画出的块（+128）') +
      '</div>';
    const target = setupCanvas('dctMain', 360, 360, pictureCap);
    drawCoefficientMatrix(target);
    target.canvas.addEventListener('click', function (event) {
      const rectangle = target.canvas.getBoundingClientRect();
      const x = (event.clientX - rectangle.left) / rectangle.width * target.w;
      const y = (event.clientY - rectangle.top) / rectangle.height * target.h;
      const column = clamp(Math.floor(x / (target.w / 8)), 0, 7);
      const row = clamp(Math.floor(y / (target.h / 8)), 0, 7);
      state.selectedCoeff = row * 8 + column;
      renderDctBasisView();
    });
    const gallery = setupCanvas('dctBasis', 600, 600, pictureCap);
    drawBasisGallery(gallery);
    gallery.canvas.addEventListener('click', function (event) {
      const rectangle = gallery.canvas.getBoundingClientRect();
      const x = (event.clientX - rectangle.left) / rectangle.width * gallery.w;
      const y = (event.clientY - rectangle.top) / rectangle.height * gallery.h;
      const cell = (gallery.w - BASIS_GAP * 9) / 8;
      const column = clamp(Math.floor((x - BASIS_GAP) / (cell + BASIS_GAP)), 0, 7);
      const row = clamp(Math.floor((y - BASIS_GAP) / (cell + BASIS_GAP)), 0, 7);
      state.selectedCoeff = row * 8 + column;
      renderDctBasisView();
    });
    const selected = resolvedSelectedCoeff(block.coefficients);
    /* 三联图是补充说明，别让它抢到比主图还大：上限取主图上限的 3/4 */
    const termCap = pictureCap ? Math.round(pictureCap * 0.75) : 0;
    drawDctTermViews(setupCanvas('dctTermBasis', 260, 260, termCap),
      setupCanvas('dctTermContribution', 260, 260, termCap),
      setupCanvas('dctTermRebuild', 260, 260, termCap), selected);
    const readout = document.getElementById('dctReadout');
    readout.textContent = describeCoefficient(block.coefficients, selected);
  }

  /* ⑤ 重建：64 项按 |F| 降序叠加，看它怎样一步步逼回原块 */
  function renderDctRebuild() {
    if (typeof state.dctSumStep !== 'number') state.dctSumStep = 64;
    stage.innerHTML = '<div class="dct-use-row">' +
      '<span class="note">逐项叠加：按 |F| 从大到小，一次加一项</span>' +
      rebuildStepButtons(state.dctSumStep) +
      '</div>' +
      '<div class="dct-rebuild-row3">' +
      figure('rebuildTarget', '① 原块目标（+128 显示）') +
      figure('rebuildSum', '② 当前重建块：已叠加项之和（+128）') +
      figure('rebuildTerm', '③ 刚加入的那一项 F(u,v)·B(u,v)：白=加亮，黑=压暗（按该项峰值归一化）') +
      '</div>' +
      figure('rebuildBars', '64 项按 |F| 从大到小排开：柱高 = 系数大小，蓝 = 已叠加，灰 = 还没用上') +
      '<p class="note" id="rebuildInfo"></p>';
    Array.prototype.forEach.call(stage.querySelectorAll('.dct-use-row button'), function (button) {
      button.addEventListener('click', function () {
        const set = button.getAttribute('data-set');
        if (set !== null) { applyRebuildStep(Number(set)); return; }
        applyRebuildStep(state.dctSumStep + Number(button.getAttribute('data-step')));
      });
    });
    drawDctRebuildViews();
  }

  function rebuildStepButtons(count) {
    function cls(value) { return value === count ? ' class="on"' : ''; }
    return '<button data-set="0"' + cls(0) + '>清空</button>' +
      '<button data-step="-1">◀ 上一步</button>' +
      '<button data-step="1">下一步 ▶</button>' +
      '<button data-step="8">+8 项</button>' +
      '<button data-set="16"' + cls(16) + '>前 16</button>' +
      '<button data-set="32"' + cls(32) + '>前 32</button>' +
      '<button data-set="64"' + cls(64) + '>全部 64</button>';
  }

  /* 手动步进：与一维页同一套逻辑，count = 已叠加的项数 */
  function applyRebuildStep(count) {
    stopVisualAnimations();
    state.dctSumStep = clamp(Math.round(count), 0, 64);
    drawDctRebuildViews();
    syncRebuildButtons();
    refreshStepParams();
  }

  function syncRebuildButtons() {
    Array.prototype.forEach.call(stage.querySelectorAll('.dct-use-row button'), function (button) {
      const value = button.getAttribute('data-set');
      if (value === null) return;
      button.classList.toggle('on', Number(value) === state.dctSumStep);
    });
  }

  /* 没点选时默认展示“AC 里最大的那一项”：DC 是一整片均匀，看不出图案差别 */
  function resolvedSelectedCoeff(coefficients) {
    if (state.selectedCoeff >= 0) return state.selectedCoeff;
    let best = 1;
    for (let i = 2; i < 64; i++) if (Math.abs(coefficients[i]) > Math.abs(coefficients[best])) best = i;
    return best;
  }

  function describeCoefficient(coefficients, index) {
    const u = Math.floor(index / 8);
    const v = index % 8;
    const value = coefficients[index];
    const name = index === 0 ? 'DC（整块的平均亮度）' :
      '第 ' + u + ' 阶纵向 × 第 ' + v + ' 阶横向频率';
    let total = 0;
    for (let i = 0; i < 64; i++) total += coefficients[i] * coefficients[i];
    const share = total > 0 ? (100 * value * value / total) : 0;
    const sign = value > 0.05 ? '正数：该图案在此处是亮的，按原相位叠加' :
      value < -0.05 ? '负数：相位相反，图案亮的地方这块反而暗' :
        '接近 0：这块里几乎没有这种图案';
    return 'F(' + u + ',' + v + ') = ' + formatValue(value) + '，' + name + '，占总能量 ' + share.toFixed(1) + '%。' + sign + '。';
  }

  const DCT_ZIG = (function () {
    const list = [];
    for (let diagonal = 0; diagonal <= 14; diagonal++) {
      const rows = [];
      for (let row = Math.max(0, diagonal - 7); row <= Math.min(7, diagonal); row++) rows.push(row);
      if (diagonal % 2 === 0) rows.reverse();
      for (let i = 0; i < rows.length; i++) list.push(rows[i] * 8 + (diagonal - rows[i]));
    }
    return list;
  })();

  function lowFrequencyEnergyShare(coefficients) {
    let total = 0;
    let low = 0;
    for (let i = 0; i < 64; i++) total += coefficients[i] * coefficients[i];
    for (let i = 0; i < 10; i++) {
      const value = coefficients[DCT_ZIG[i]];
      low += value * value;
    }
    return total > 0 ? (100 * low / total).toFixed(1) : '0.0';
  }

  function basisValue(u, v, x, y) {
    return Codec.T[u][y] * Codec.T[v][x];
  }

  /* 基图灰度映射的唯一刻度：128 为零电平，±BASIS_CONTRAST 对应 ±1，正负严格对称 */
  const BASIS_CONTRAST = 124;

  function drawBasisTile(target, u, v) {
    const context = target.ctx;
    const cell = target.w / 8;
    /* 按这张基图自身的峰值归一化，保证每张都看得清条纹 */
    let tilePeak = 1 / 64;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) tilePeak = Math.max(tilePeak, Math.abs(basisValue(u, v, x, y)));
    }
    context.clearRect(0, 0, target.w, target.h);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const level = clamp(Math.round(128 + BASIS_CONTRAST * basisValue(u, v, x, y) / tilePeak), 0, 255);
        context.fillStyle = 'rgb(' + level + ',' + level + ',' + level + ')';
        context.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
      }
    }
    context.strokeStyle = 'rgba(148,163,184,0.65)';
    context.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      context.beginPath(); context.moveTo(i * cell, 0); context.lineTo(i * cell, target.h); context.stroke();
      context.beginPath(); context.moveTo(0, i * cell); context.lineTo(target.w, i * cell); context.stroke();
    }
  }

  function drawDctTermViews(basisTarget, contributionTarget, rebuildTarget, index) {
    if (!basisTarget || !contributionTarget || !rebuildTarget) return;
    const coefficients = encodedBlock().coefficients;
    const u = Math.floor(index / 8);
    const v = index % 8;
    const weight = coefficients[index];
    drawBasisTile(basisTarget, u, v);
    /* 满刻度取 |F| 最大项的峰值，这样大项白得刺眼、小项几乎全灰，能看出“份量” */
    const peak = Math.max(0.5, maxAbsCoefficient(coefficients) * 0.5);
    const context = contributionTarget.ctx;
    const cell = contributionTarget.w / 8;
    context.clearRect(0, 0, contributionTarget.w, contributionTarget.h);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const ratio = clamp(weight * basisValue(u, v, x, y) / peak, -1, 1);
        /* 开方压缩：大项仍然刺眼，小项也能看出图案走向，不至于全灰 */
        const shaped = Math.sign(ratio) * Math.pow(Math.abs(ratio), 0.5);
        const level = clamp(Math.round(128 + 126 * shaped), 0, 255);
        context.fillStyle = 'rgb(' + level + ',' + level + ',' + level + ')';
        context.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
      }
    }
    context.strokeStyle = 'rgba(148,163,184,0.65)';
    context.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      context.beginPath(); context.moveTo(i * cell, 0); context.lineTo(i * cell, contributionTarget.h); context.stroke();
      context.beginPath(); context.moveTo(0, i * cell); context.lineTo(contributionTarget.w, i * cell); context.stroke();
    }
    const single = new Float64Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) single[y * 8 + x] = weight * basisValue(u, v, x, y);
    }
    drawCells(rebuildTarget, single, function (value) {
      const level = clamp(Math.round(128 + value), 0, 255);
      return [level, level, level];
    }, { gridColor: 'rgba(148,163,184,0.5)' });
  }

  function dctSumOrder(coefficients) {
    const order = [];
    for (let i = 0; i < 64; i++) order.push(i);
    order.sort(function (a, b) { return Math.abs(coefficients[b]) - Math.abs(coefficients[a]); });
    return order;
  }

  function reconstructBlock(coefficients, order, count) {
    const output = new Float64Array(64);
    for (let i = 0; i < count; i++) {
      const index = order[i];
      const u = Math.floor(index / 8);
      const v = index % 8;
      const weight = coefficients[index];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) output[y * 8 + x] += weight * basisValue(u, v, x, y);
      }
    }
    return output;
  }

  function drawDctRebuildViews() {
    const block = encodedBlock();
    const target = setupCanvas('rebuildTarget', 340, 340);
    const rebuilt = setupCanvas('rebuildSum', 340, 340);
    const termTarget = setupCanvas('rebuildTerm', 340, 340);
    if (!target || !rebuilt) return;
    const count = clamp(Math.round(typeof state.dctSumStep === 'number' ? state.dctSumStep : 64), 0, 64);
    const order = dctSumOrder(block.coefficients);
    drawCells(target, block.pixels, function (value) {
      const level = clamp(Math.round(value + 128), 0, 255);
      return [level, level, level];
    }, { gridColor: 'rgba(148,163,184,0.5)' });
    const sum = reconstructBlock(block.coefficients, order, count);
    drawCells(rebuilt, sum, function (value) {
      const level = clamp(Math.round(value + 128), 0, 255);
      return [level, level, level];
    }, { gridColor: 'rgba(148,163,184,0.5)' });

    /* 刚加入的那一项：F(u,v)·B(u,v)，就是视频里“这张图案乘这个权重” */
    if (termTarget) {
      const term = new Float64Array(64);
      if (count > 0) {
        const index = order[count - 1];
        const weight = block.coefficients[index];
        const u = Math.floor(index / 8);
        const v = index % 8;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) term[y * 8 + x] = weight * basisValue(u, v, x, y);
        }
      }
      let termPeak = 1 / 64;
      for (let i = 0; i < 64; i++) termPeak = Math.max(termPeak, Math.abs(term[i]));
      drawCells(termTarget, term, function (value) {
        const level = clamp(Math.round(128 + 124 * value / termPeak), 0, 255);
        return [level, level, level];
      }, { gridColor: 'rgba(148,163,184,0.45)' });
    }

    drawRebuildBars(setupCanvas('rebuildBars', 1120, 230), order, count);

    let totalEnergy = 0;
    let usedEnergy = 0;
    for (let i = 0; i < 64; i++) totalEnergy += block.coefficients[i] * block.coefficients[i];
    for (let i = 0; i < count; i++) usedEnergy += block.coefficients[order[i]] * block.coefficients[order[i]];
    let worst = 0;
    for (let i = 0; i < 64; i++) {
      const original = Math.round(clamp(block.pixels[i] + 128, 0, 255));
      const value = clamp(Math.round(sum[i] + 128), 0, 255);
      worst = Math.max(worst, Math.abs(original - value));
    }
    const info = document.getElementById('rebuildInfo');
    if (info) {
      const share = totalEnergy > 0 ? (100 * usedEnergy / totalEnergy) : 0;
      const lastIndex = count > 0 ? order[count - 1] : -1;
      const lastText = lastIndex < 0 ? '' :
        '刚加入第 ' + count + ' 项 F(' + Math.floor(lastIndex / 8) + ',' + (lastIndex % 8) + ') = ' +
        formatValue(block.coefficients[lastIndex]) + '。';
      info.textContent = '已叠加 ' + count + ' / 64 项，占总能量 ' + share.toFixed(1) + '%。' + lastText +
        (count >= 64 ? '全部加完，最大误差 ' + worst + '，与原块一致。'
          : '当前最大像素误差 ' + worst + '。');
    }
  }

  function drawRebuildBars(target, order, count) {
    const context = target.ctx;
    const coefficients = encodedBlock().coefficients;
    context.clearRect(0, 0, target.w, target.h);
    const left = 34;
    const right = target.w - 16;
    const bottom = target.h - 26;
    const top = 18;
    let maximum = 1;
    for (let i = 0; i < 64; i++) maximum = Math.max(maximum, Math.abs(coefficients[i]));
    const slot = (right - left) / 64;
    const width = Math.max(2.5, slot * 0.62);
    for (let i = 0; i < 64; i++) {
      const value = Math.abs(coefficients[order[i]]);
      const height = (value / maximum) * (bottom - top);
      const x = left + i * slot + (slot - width) / 2;
      context.fillStyle = i < count ? 'rgba(29,78,216,0.88)' : 'rgba(148,163,184,0.45)';
      context.fillRect(x, bottom - Math.max(1.5, height), width, Math.max(1.5, height));
    }
    context.strokeStyle = 'rgba(148,163,184,0.75)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, bottom + 0.5);
    context.lineTo(right, bottom + 0.5);
    context.stroke();
    context.fillStyle = '#94a3b8';
    context.font = '10.5px Consolas, monospace';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText('|F| 最大', left, 2);
    context.fillText('第 1 项（最大）', left, bottom + 5);
    context.textAlign = 'right';
    context.fillText('第 64 项（最小）', right, bottom + 5);
  }

  function maxAbsCoefficient(values) {
    let maximum = 1;
    for (let i = 0; i < values.length; i++) maximum = Math.max(maximum, Math.abs(values[i]));
    return maximum;
  }

  function drawCoefficientMatrix(target) {
    const block = encodedBlock();
    const maximum = maxAbsCoefficient(block.coefficients);
    drawCells(target, block.coefficients, function (value) { return heatColor(value, maximum); }, {
      text: function (value) { return formatValue(value); },
      highlight: resolvedSelectedCoeff(block.coefficients),
      gridColor: 'rgba(255,255,255,0.75)'
    });
  }

  const BASIS_GAP = 6;

  function drawBasisGallery(target) {
    const context = target.ctx;
    const active = resolvedSelectedCoeff(encodedBlock().coefficients);
    const cell = (target.w - BASIS_GAP * 9) / 8;
    const pixel = cell / 8;
    context.clearRect(0, 0, target.w, target.h);
    for (let u = 0; u < 8; u++) {
      for (let v = 0; v < 8; v++) {
        const index = u * 8 + v;
        const originX = BASIS_GAP + v * (cell + BASIS_GAP);
        const originY = BASIS_GAP + u * (cell + BASIS_GAP);
        /* 这 64 张是与图像无关的固定基图：每格按自身峰值归一化后统一画成
           128 ± BASIS_CONTRAST，零电平恒为 128、亮暗严格对称，
           并且 (u,v) 与 (v,u) 只差一次转置，正好关于主对角线成对 */
        let tileMaximum = 1 / 64;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) tileMaximum = Math.max(tileMaximum, Math.abs(Codec.T[u][y] * Codec.T[v][x]));
        }
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const value = Codec.T[u][y] * Codec.T[v][x] / tileMaximum;
            const level = clamp(Math.round(128 + BASIS_CONTRAST * value), 0, 255);
            context.fillStyle = 'rgb(' + level + ',' + level + ',' + level + ')';
            context.fillRect(originX + x * pixel, originY + y * pixel, pixel + 0.5, pixel + 0.5);
          }
        }
        const selected = active === index;
        context.strokeStyle = selected ? '#1d4ed8' : 'rgba(148,163,184,0.7)';
        context.lineWidth = selected ? 2.5 : 1;
        context.strokeRect(originX + 0.5, originY + 0.5, cell - 1, cell - 1);
        context.fillStyle = selected ? 'rgba(232,239,255,0.92)' : 'rgba(255,255,255,0.5)';
        context.fillRect(originX + 2, originY + 2, 19, 10);
        context.fillStyle = selected ? '#1d4ed8' : 'rgba(21,32,51,0.5)';
        context.font = '600 8.5px Consolas, monospace';
        context.textAlign = 'left';
        context.textBaseline = 'top';
        context.fillText(u + ',' + v, originX + 3.5, originY + 3);
      }
    }
  }

  /* 一维视角：一行像素 → 8 个系数 → 余弦波加权求和 */
  function renderDctOneD() {
    if (typeof state.dctRow !== 'number' || state.dctRow < 0 || state.dctRow > 7) state.dctRow = bestRowOfBlock();
    if (typeof state.dctUseCount !== 'number') state.dctUseCount = 8;
    const row = state.dctRow;
    stage.innerHTML = '<div class="dct-row-picker">' +
      Array.from({ length: 8 }, function (_, index) {
        return '<button data-index="' + index + '" class="' + (index === row ? 'on' : '') + '">第 ' + (index + 1) + ' 行</button>';
      }).join('') +
      '<span class="note">任选一行：同一套余弦波，只是权重不同</span></div>' +
      '<div class="dct-strips">' +
      '<div class="dct-strip-col">' +
      '<div class="dct-pixel-strip">' +
      Array.from(dctRowValues(row).pixels).map(function (value) {
        const level = Math.round(clamp(value, 0, 255));
        return '<span style="background:rgb(' + level + ',' + level + ',' + level + ');color:' +
          (level > 140 ? '#1f2937' : '#ffffff') + '">' + level + '</span>';
      }).join('') +
      '</div>' +
      '<p class="dct-pixel-strip-caption">左边是' + dctRowLabel(row) + '的 8 个像素值（0–255，按数值画成灰度块），右边是它们 DCT 后的 8 个系数。</p>' +
      '</div>' +
      '<div class="dct-strip-col">' +
      figure('dctRowCoeff', '这一行的 DCT 系数：蓝 = 负 · 红 = 正，颜色深浅与系数矩阵一致；灰框 = 尚未加入的项') +
      '<p class="note" id="dctRowCoeffInfo"></p>' +
      '</div></div>' +
      '<div class="dct-use-row">' +
      '<span class="note">逐步逼近：只保留前 N 个余弦波</span>' + rowUseButtons(state.dctUseCount) +
      '</div>' +
      figure('dctRowBasis', '① 上排：8 个余弦波 × 各自权重 X(k)（波形高度按 |X|^0.5 压缩，下方细条是真实占比）' +
        '；② 下排左：' + dctRowLabel(row) + '逐项叠加的逼近过程（○ 原行目标值、● 当前叠加值、橙线 = 残差）' +
        '；下排右：下一次会加入的那一项', 'dct-1d-figure') +
      '<p class="note" id="dctRowReadout"></p>';
    Array.prototype.forEach.call(stage.querySelectorAll('.dct-row-picker button'), function (button) {
      button.addEventListener('click', function () {
        const index = Number(button.getAttribute('data-index'));
        if (!isFinite(index) || index === state.dctRow) return;
        stopVisualAnimations();
        state.dctRow = index;
        renderDctOneD();
      });
    });
    Array.prototype.forEach.call(stage.querySelectorAll('.dct-use-row button'), function (button) {
      button.addEventListener('click', function () {
        const delta = button.getAttribute('data-step');
        if (delta !== null) {
          applyRowUse(state.dctUseCount + Number(delta));
          return;
        }
        const use = Number(button.getAttribute('data-use'));
        if (!isFinite(use)) return;
        applyRowUse(use);
      });
    });
    drawRowBasis(setupCanvas('dctRowBasis', 1240, 850));
    drawDctRowCoeff();
    refreshRowReadout();
  }

  /* 系数条与步进动画同步：只显示已经加进来的 X(k)，其余留灰色空框。 */
  function drawDctRowCoeff() {
    const target = setupCanvas('dctRowCoeff', 520, 110);
    if (!target) return;
    const values = dctRowValues(state.dctRow).coefficients;
    drawValueChips(target.ctx,
      { x: 6, y: 4, w: target.w - 12, h: target.h - 8 },
      '', values, false, maxAbsCoefficient(rowDct(encodedBlock().pixels)), state.dctUseCount);
    const info = document.getElementById('dctRowCoeffInfo');
    if (info) {
      info.textContent = '已加入 ' + state.dctUseCount + ' / 8 个余弦波；灰框 = 还没加进来的系数';
    }
  }

  function rowUseButtons(used) {
    let html = '<button data-use="0" class="' + (used === 0 ? 'on' : '') + '">清空</button>';
    for (let k = 0; k < 8; k++) {
      html += '<button data-use="' + (k + 1) + '" class="' + (used === k + 1 ? 'on' : '') + '">+X' + k + '</button>';
    }
    html += '<button data-step="-1" title="少用一个余弦波">◀ 上一步</button>' +
      '<button data-step="1" title="多加一个余弦波">下一步 ▶</button>';
    return html;
  }

  /* 手动步进：点 "+Xk" 就从当前项继续累加，点"清空"回到一条直线 */
  function applyRowUse(use) {
    stopVisualAnimations();
    state.dctUseCount = clamp(use, 0, 8);
    const target = setupCanvas('dctRowBasis', 1240, 850);
    if (target) drawRowBasis(target);
    drawDctRowCoeff();
    syncUseButtons(state.dctUseCount);
    refreshRowReadout();
    refreshStepParams();
  }

  function syncUseButtons(used) {
    Array.prototype.forEach.call(stage.querySelectorAll('.dct-use-row button'), function (button) {
      const value = button.getAttribute('data-use');
      if (value === null) return;
      button.classList.toggle('on', Number(value) === used);
    });
  }

  function dctRowValues(row) {
    const block = encodedBlock();
    const temporary = rowDct(block.pixels);
    const pixels = new Float64Array(8);
    const coefficients = new Float64Array(8);
    for (let k = 0; k < 8; k++) {
      pixels[k] = block.pixels[row * 8 + k] + 128;
      coefficients[k] = temporary[row * 8 + k];
    }
    return { pixels: pixels, coefficients: coefficients };
  }

  function cosineBasis(frequency, x) {
    const alpha = frequency === 0 ? 1 / Math.sqrt(8) : 0.5;
    return alpha * Math.cos(Math.PI * frequency * (2 * x + 1) / 16);
  }

  function bestRowOfBlock() {
    const block = encodedBlock();
    let best = 0;
    let bestScore = -1;
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      let squares = 0;
      for (let x = 0; x < 8; x++) {
        const value = block.pixels[y * 8 + x];
        sum += value;
        squares += value * value;
      }
      const mean = sum / 8;
      const variance = squares / 8 - mean * mean;
      if (variance > bestScore) {
        bestScore = variance;
        best = y;
      }
    }
    return best;
  }

  function refreshRowReadout() {
    const readout = document.getElementById('dctRowReadout');
    if (!readout) return;
    const data = dctRowValues(state.dctRow);
    let energy = 0;
    let original = 0;
    for (let k = 0; k < 8; k++) {
      energy += data.coefficients[k] * data.coefficients[k];
      original += (data.pixels[k] - 128) * (data.pixels[k] - 128);
    }
    const used = state.basis && state.basis.active
      ? state.basis.step
      : clamp(typeof state.dctUseCount === 'number' ? state.dctUseCount : 8, 0, 8);
    let error = 0;
    for (let k = 0; k < 8; k++) {
      let sum = 0;
      for (let i = 0; i < used; i++) sum += data.coefficients[i] * cosineBasis(i, k);
      error = Math.max(error, Math.abs(sum + 128 - data.pixels[k]));
    }
    readout.textContent = dctRowLabel(state.dctRow) + '：X(0) = ' + formatValue(data.coefficients[0]) +
      '（直流 = 这行像素减 128 后的平均值，为负说明整行偏暗），X(1)–X(7) 是横向频率；系数平方和 ' +
      formatValue(energy) + ' = 像素减 128 后的平方和 ' + formatValue(original) + '（帕塞瓦尔定理）。' +
      '当前只保留 ' + used + ' 个波（' + (used === 0 ? '一条水平直线' : used === 1 ? '只有 DC 项 X0' : 'X0…X' + (used - 1)) + '），最大残差 ' +
      (used >= 8 ? '0.0' : error.toFixed(1)) + '；8 个全用上才能逐点重合。';
  }

  function drawRowWave(target) {
    const context = target.ctx;
    const data = dctRowValues(state.dctRow);
    context.clearRect(0, 0, target.w, target.h);

    const leftX = 22;
    const leftWidth = 352;
    const plotTop = 124;
    const plotBottom = 262;
    const rightX = 470;
    const rightWidth = target.w - rightX - 26;

    context.fillStyle = '#334155';
    context.font = '600 12px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('空间域：一行 8 个像素 x(0)–x(7)', leftX, 22);

    const slot = leftWidth / 8;
    for (let index = 0; index < 8; index++) {
      const center = leftX + (index + 0.5) * slot;
      const swatch = slot - 8;
      const rgb = grayColor(data.pixels[index]);
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      context.fillRect(center - swatch / 2, 36, swatch, 46);
      context.strokeStyle = 'rgba(21,32,51,0.25)';
      context.lineWidth = 1;
      context.strokeRect(center - swatch / 2 + 0.5, 36.5, swatch - 1, 45);
      context.fillStyle = textColor(rgb);
      context.font = '600 11px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(Math.round(data.pixels[index])), center, 59);
    }

    const yOf = function (value) { return plotBottom - (value / 255) * (plotBottom - plotTop); };
    context.strokeStyle = 'rgba(148,163,184,0.6)';
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(leftX, plotTop); context.lineTo(leftX + leftWidth, plotTop);
    context.moveTo(leftX, plotBottom); context.lineTo(leftX + leftWidth, plotBottom);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = '#94a3b8';
    context.font = '10.5px Consolas, monospace';
    context.textAlign = 'left';
    context.textBaseline = 'bottom';
    context.fillText('255', leftX, plotTop - 4);
    context.textBaseline = 'top';
    context.fillText('0', leftX, plotBottom + 4);

    context.strokeStyle = '#1d4ed8';
    context.lineWidth = 2.4;
    context.beginPath();
    for (let index = 0; index < 8; index++) {
      const center = leftX + (index + 0.5) * slot;
      const y = yOf(data.pixels[index]);
      if (index === 0) context.moveTo(center, y);
      else context.lineTo(center, y);
    }
    context.stroke();
    for (let index = 0; index < 8; index++) {
      const center = leftX + (index + 0.5) * slot;
      context.beginPath();
      context.arc(center, yOf(data.pixels[index]), 3.8, 0, Math.PI * 2);
      context.fillStyle = '#fff';
      context.fill();
      context.strokeStyle = '#1d4ed8';
      context.lineWidth = 2;
      context.stroke();
    }

    const arrowY = (plotTop + plotBottom) / 2;
    const arrowStart = leftX + leftWidth + 16;
    const arrowEnd = rightX - 26;
    context.strokeStyle = '#64748b';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(arrowStart, arrowY);
    context.lineTo(arrowEnd, arrowY);
    context.stroke();
    context.beginPath();
    context.moveTo(arrowEnd, arrowY);
    context.lineTo(arrowEnd - 9, arrowY - 5.5);
    context.lineTo(arrowEnd - 9, arrowY + 5.5);
    context.closePath();
    context.fillStyle = '#64748b';
    context.fill();
    context.fillStyle = '#475569';
    context.font = '600 11.5px "Microsoft YaHei", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.fillText('一维 DCT', (arrowStart + arrowEnd) / 2, arrowY - 7);

    context.fillStyle = '#334155';
    context.font = '600 12px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('频率域：8 个系数 X(0)–X(7)', rightX, 22);

    const maximum = Math.max(1, Math.max.apply(null, Array.from(data.coefficients).map(Math.abs)));
    const baseline = (plotTop + plotBottom) / 2;
    const halfHeight = (plotBottom - plotTop) / 2 - 20;
    context.strokeStyle = 'rgba(148,163,184,0.85)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(rightX, baseline);
    context.lineTo(rightX + rightWidth, baseline);
    context.stroke();
    context.fillStyle = '#94a3b8';
    context.font = '10.5px Consolas, monospace';
    context.textAlign = 'right';
    context.textBaseline = 'bottom';
    context.fillText(formatValue(maximum), rightX + rightWidth, baseline - 3);
    context.textBaseline = 'top';
    context.fillText('−' + formatValue(maximum), rightX + rightWidth, baseline + 3);

    const barSlot = rightWidth / 8;
    for (let k = 0; k < 8; k++) {
      const center = rightX + (k + 0.5) * barSlot;
      const value = data.coefficients[k];
      const height = Math.abs(value) / maximum * halfHeight;
      const width = barSlot * 0.5;
      context.fillStyle = value >= 0 ? 'rgba(220,38,38,0.85)' : 'rgba(29,78,216,0.85)';
      context.fillRect(center - width / 2, value >= 0 ? baseline - height : baseline, width, Math.max(1.5, height));
      context.fillStyle = value >= 0 ? '#b91c1c' : '#1d4ed8';
      context.font = '600 10.5px Consolas, monospace';
      context.textAlign = 'center';
      if (value >= 0) {
        context.textBaseline = 'bottom';
        context.fillText(formatValue(value), center, baseline - height - 4);
      } else {
        context.textBaseline = 'top';
        context.fillText(formatValue(value), center, baseline + height + 4);
      }
      context.fillStyle = '#64748b';
      context.textBaseline = 'top';
      context.fillText('X' + k, center, plotBottom + 6);
    }
  }

  function drawRowBasis(target) {
    const context = target.ctx;
    const data = dctRowValues(state.dctRow);
    const used = state.basis && state.basis.active
      ? state.basis.step
      : clamp(typeof state.dctUseCount === 'number' ? state.dctUseCount : 8, 0, 8);
    context.clearRect(0, 0, target.w, target.h);
    drawRowCards(context, data, used, target.w);
    drawRowSumCard(context, data, used, { x: 10, y: 372, w: 610, h: 466 });
    drawRowNextCard(context, data, used, { x: 636, y: 372, w: 594, h: 466 });
  }

  /* 上排：8 个余弦波 × 各自权重 */
  function drawRowCards(context, data, used, width) {
    const maximum = Math.max(1, Math.max.apply(null, Array.from(data.coefficients).map(Math.abs)));
    const gridX = 10;
    const gridY = 8;
    const cellWidth = (width - 20) / 4;
    const cellHeight = 170;
    for (let k = 0; k < 8; k++) {
      const column = k % 4;
      const row = Math.floor(k / 4);
      const x0 = gridX + column * cellWidth;
      const y0 = gridY + row * cellHeight;
      const innerX = x0 + 8;
      const innerWidth = cellWidth - 16;
      const axisY = y0 + cellHeight * 0.56;
      const weight = Math.abs(data.coefficients[k]) / maximum;
      const amplitude = cellHeight * 0.32 * Math.pow(weight, 0.5);
      const peak = k === 0 ? 1 / Math.sqrt(8) : 0.5;
      const shape = function (position) { return cosineBasis(k, position) / peak; };

      const isUsed = k < used;
      const isCurrent = used > 0 && k === used - 1;
      const positive = data.coefficients[k] >= 0;
      /* 画面与“刚跳转过来”的初始界面完全一致：底色/波形都不因“还没加入”而褪色 */
      const color = positive ? '#1d4ed8' : '#c2410c';

      context.fillStyle = isCurrent ? 'rgba(194,65,12,0.07)' : 'rgba(29,78,216,0.11)';
      context.fillRect(x0 + 2, y0 + 2, cellWidth - 4, cellHeight - 6);
      context.strokeStyle = isCurrent ? '#c2410c' : (isUsed ? 'rgba(29,78,216,0.5)' : 'rgba(29,78,216,0.3)');
      context.lineWidth = isCurrent ? 2 : 1;
      context.strokeRect(x0 + 2.5, y0 + 2.5, cellWidth - 5, cellHeight - 7);

      context.fillStyle = '#334155';
      context.font = '600 11px Consolas, monospace';
      context.textAlign = 'left';
      context.textBaseline = 'top';
      context.fillText('X' + k + ' = ' + formatValue(data.coefficients[k]), innerX, y0 + 8);
      context.fillStyle = isCurrent ? '#c2410c' : '#94a3b8';
      context.font = '9.5px Consolas, monospace';
      context.textAlign = 'right';
      context.fillText(isCurrent ? '刚加入' : (isUsed ? '已加入' : '未加入'), innerX + innerWidth, y0 + 9);

      context.strokeStyle = 'rgba(148,163,184,0.7)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(innerX, axisY);
      context.lineTo(innerX + innerWidth, axisY);
      context.stroke();

      context.strokeStyle = color;
      context.lineWidth = 1.8;
      context.beginPath();
      for (let step = 0; step <= 64; step++) {
        const position = step / 64 * 8 - 0.5;
        const x = innerX + step / 64 * innerWidth;
        const y = axisY - shape(position) * amplitude;
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      for (let i = 0; i < 8; i++) {
        const center = innerX + (i + 0.5) / 8 * innerWidth;
        const y = axisY - shape(i) * amplitude;
        context.strokeStyle = color;
        context.lineWidth = 1.1;
        context.beginPath();
        context.moveTo(center, axisY);
        context.lineTo(center, y);
        context.stroke();
        context.beginPath();
        context.arc(center, y, 2.3, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
      }

      context.fillStyle = 'rgba(148,163,184,0.3)';
      context.fillRect(innerX, y0 + cellHeight - 18, innerWidth, 4);
      context.fillStyle = color;
      context.fillRect(innerX, y0 + cellHeight - 18, innerWidth * weight, 4);
    }

    context.fillStyle = '#94a3b8';
    context.font = '9.5px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText('右上角标签 = 这一项是否已加入；橙框 = 刚加入；下方细条 = 该系数在 8 项中的真实占比', gridX, gridY + cellHeight * 2 + 4);
  }

  /* 下排左：逐项叠加的逼近过程 */
  function drawRowSumCard(context, data, used, box) {
    const cardX = box.x;
    const cardY = box.y;
    const cardWidth = box.w;
    const cardHeight = box.h;
    const plotLeft = cardX + 46;
    const plotRight = cardX + cardWidth - 16;
    const plotTop = cardY + 58;
    const plotBottom = cardY + cardHeight - 46;
    const yOf = function (value) { return plotBottom - (value / 255) * (plotBottom - plotTop); };

    context.fillStyle = '#fff';
    context.fillRect(cardX, cardY, cardWidth, cardHeight);
    context.strokeStyle = '#e3eaf4';
    context.lineWidth = 1;
    context.strokeRect(cardX + 0.5, cardY + 0.5, cardWidth - 1, cardHeight - 1);

    context.fillStyle = '#334155';
    context.font = '600 12px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('叠加过程', cardX + 14, cardY + 22);

    let error = 0;
    for (let k = 0; k < 8; k++) {
      let sum = 0;
      for (let i = 0; i < Math.min(used, 8); i++) sum += data.coefficients[i] * cosineBasis(i, k);
      error = Math.max(error, Math.abs(sum + 128 - data.pixels[k]));
    }
    context.fillStyle = '#64748b';
    context.font = '11px Consolas, monospace';
    context.fillText('已用 ' + used + ' / 8 个余弦波', cardX + 14, cardY + 39);
    context.textAlign = 'right';
    context.fillText(used >= 8 ? '残差 0.0' : '残差 ' + error.toFixed(1), cardX + cardWidth - 16, cardY + 39);

    const slot = (plotRight - plotLeft) / 8;
    const levels = [0, 64, 128, 192, 255];
    context.lineWidth = 1;
    context.font = '9.5px Consolas, monospace';
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const y = yOf(level);
      context.strokeStyle = level === 128 ? 'rgba(29,78,216,0.3)' : 'rgba(148,163,184,0.28)';
      context.setLineDash(level === 128 ? [] : [3, 4]);
      context.beginPath();
      context.moveTo(plotLeft, y);
      context.lineTo(plotRight, y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = level === 128 ? 'rgba(29,78,216,0.8)' : '#94a3b8';
      context.textAlign = 'right';
      context.textBaseline = 'middle';
      context.fillText(String(level), plotLeft - 6, y);
    }
    context.strokeStyle = 'rgba(100,116,139,0.6)';
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(plotLeft, plotTop);
    context.lineTo(plotLeft, plotBottom);
    context.moveTo(plotLeft, plotBottom);
    context.lineTo(plotRight, plotBottom);
    context.stroke();
    context.textAlign = 'center';
    context.font = '9.5px Consolas, monospace';
    for (let k = 0; k < 8; k++) {
      context.fillText(String(k), plotLeft + (k + 0.5) * slot, plotBottom + 3);
    }

    const current = new Float64Array(8);
    for (let k = 0; k < 8; k++) {
      let sum = 0;
      for (let i = 0; i < Math.min(used, 8); i++) sum += data.coefficients[i] * cosineBasis(i, k);
      current[k] = sum + 128;
    }
    const targetY = function (k) { return yOf(clamp(data.pixels[k], 0, 255)); };
    const currentY = function (k) { return yOf(clamp(current[k], 0, 255)); };

    /* 原行目标值：虚线折线 */
    context.strokeStyle = 'rgba(100,116,139,0.7)';
    context.lineWidth = 1.4;
    context.setLineDash([5, 4]);
    context.beginPath();
    for (let k = 0; k < 8; k++) {
      const center = plotLeft + (k + 0.5) * slot;
      if (k === 0) context.moveTo(center, targetY(k));
      else context.lineTo(center, targetY(k));
    }
    context.stroke();
    context.setLineDash([]);

    /* 每个位置一条橙色残差线：目标点 ↔ 当前叠加值 */
    context.strokeStyle = 'rgba(194,65,12,0.5)';
    context.lineWidth = 1.3;
    for (let k = 0; k < 8; k++) {
      const center = plotLeft + (k + 0.5) * slot;
      if (Math.abs(currentY(k) - targetY(k)) < 0.8) continue;
      context.beginPath();
      context.moveTo(center, targetY(k));
      context.lineTo(center, currentY(k));
      context.stroke();
    }

    /* 当前叠加曲线 */
    context.strokeStyle = used >= 8 ? '#15803d' : '#1d4ed8';
    context.lineWidth = 2.6;
    context.beginPath();
    const samples = 96;
    for (let step = 0; step <= samples; step++) {
      const position = step / samples * 8 - 0.5;
      let sum = 0;
      for (let k = 0; k < Math.min(used, 8); k++) sum += data.coefficients[k] * cosineBasis(k, position);
      const x = plotLeft + step / samples * (plotRight - plotLeft);
      const y = yOf(clamp(sum + 128, 0, 255));
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();

    /* 空心点 = 原行 8 个预期值（叠加的目标） */
    for (let k = 0; k < 8; k++) {
      const center = plotLeft + (k + 0.5) * slot;
      context.beginPath();
      context.arc(center, targetY(k), 4, 0, Math.PI * 2);
      context.fillStyle = '#fff';
      context.fill();
      context.strokeStyle = '#475569';
      context.lineWidth = 1.6;
      context.stroke();
    }

    /* 实心点 = 当前叠加值 */
    for (let k = 0; k < 8; k++) {
      const center = plotLeft + (k + 0.5) * slot;
      context.beginPath();
      context.arc(center, currentY(k), 2.8, 0, Math.PI * 2);
      context.fillStyle = used >= 8 ? '#15803d' : '#1d4ed8';
      context.fill();
    }

    /* 残差最大的位置标出 Δ 数值 */
    if (used < 8) {
      let worst = 0;
      for (let k = 1; k < 8; k++) {
        if (Math.abs(current[k] - data.pixels[k]) > Math.abs(current[worst] - data.pixels[worst])) worst = k;
      }
      const gap = Math.abs(current[worst] - data.pixels[worst]);
      if (gap >= 1.5) {
        const center = plotLeft + (worst + 0.5) * slot;
        const midY = (targetY(worst) + currentY(worst)) / 2;
        const toLeft = center > plotRight - 34;
        context.fillStyle = '#c2410c';
        context.font = '600 9.5px Consolas, monospace';
        context.textAlign = toLeft ? 'right' : 'left';
        context.textBaseline = 'middle';
        context.fillText('Δ' + gap.toFixed(0), toLeft ? center - 7 : center + 7, midY);
      }
    }

    context.fillStyle = '#94a3b8';
    context.font = '9.5px Consolas, monospace';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText('○ 原行预期点  ● 当前叠加值  橙线 = 残差', cardX + 14, plotBottom + 24);
  }

  /* 下排右：下一次要加入的那一项 X(k)·C_k */
  function drawRowNextCard(context, data, used, box) {
    context.fillStyle = '#fff';
    context.fillRect(box.x, box.y, box.w, box.h);
    context.strokeStyle = '#e3eaf4';
    context.lineWidth = 1;
    context.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);

    const done = used >= 8;
    const k = Math.min(used, 7);
    const weight = done ? 0 : data.coefficients[k];

    context.fillStyle = '#334155';
    context.font = '600 12px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(done ? '没有下一项了' : '下一次要加入：X' + k + ' × C' + k, box.x + 14, box.y + 22);
    context.fillStyle = '#64748b';
    context.font = '11px "Microsoft YaHei", sans-serif';
    context.fillText(done ? '8 个波已全部加入，曲线与原行重合'
      : '系数 ' + formatValue(weight) + ' 乘上余弦波 C' + k + '，下面就是它加进曲线的形状',
      box.x + 14, box.y + 39);

    const left = box.x + 56;
    const right = box.x + box.w - 22;
    const top = box.y + 64;
    const bottom = box.y + box.h - 54;
    const mid = (top + bottom) / 2;
    const unit = (bottom - top) / 2 / 128;
    const yOfValue = function (value) { return mid - value * unit; };

    context.font = '9.5px Consolas, monospace';
    const gridLevels = [128, 64, 0, -64, -128];
    for (let i = 0; i < gridLevels.length; i++) {
      const level = gridLevels[i];
      const y = yOfValue(level);
      context.strokeStyle = level === 0 ? 'rgba(100,116,139,0.7)' : 'rgba(148,163,184,0.26)';
      context.setLineDash(level === 0 ? [] : [3, 4]);
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = level === 0 ? '#64748b' : '#94a3b8';
      context.textAlign = 'right';
      context.textBaseline = 'middle';
      context.fillText(String(level), left - 6, y);
    }

    const plotW = right - left;
    const slot = plotW / 8;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = '#94a3b8';
    for (let i = 0; i < 8; i++) context.fillText(String(i), left + (i + 0.5) * slot, bottom + 4);

    if (done) {
      context.fillStyle = '#15803d';
      context.font = '600 11px "Microsoft YaHei", sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('8 / 8 已完成，没有下一项', (left + right) / 2, mid);
      return;
    }

    const color = weight >= 0 ? '#1d4ed8' : '#c2410c';
    context.strokeStyle = color;
    context.lineWidth = 2.2;
    context.beginPath();
    for (let step = 0; step <= 96; step++) {
      const position = step / 96 * 8 - 0.5;
      const x = left + step / 96 * plotW;
      const y = yOfValue(weight * cosineBasis(k, position));
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();

    for (let i = 0; i < 8; i++) {
      const center = left + (i + 0.5) * slot;
      const value = weight * cosineBasis(k, i);
      context.strokeStyle = color;
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(center, yOfValue(0));
      context.lineTo(center, yOfValue(value));
      context.stroke();
      context.beginPath();
      context.arc(center, yOfValue(value), 2.6, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    }

    const amplitude = Math.abs(weight) * (k === 0 ? 1 / Math.sqrt(8) : 0.5);
    context.fillStyle = '#64748b';
    context.font = '9.5px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText('纵轴 = 这一项对像素的加减量（±128）；' +
      (amplitude < 1 ? '这一项很小，加入后几乎看不出变化'
        : weight >= 0 ? '正系数：波峰处加亮、波谷处压暗' : '负系数：相位相反，波峰处反而压暗'),
      box.x + 14, bottom + 24);
  }

  function rowDct(block) {
    const output = new Float64Array(64);
    for (let y = 0; y < 8; y++) {
      for (let u = 0; u < 8; u++) {
        let sum = 0;
        for (let x = 0; x < 8; x++) sum += Codec.T[u][x] * block[y * 8 + x];
        output[y * 8 + u] = sum;
      }
    }
    return output;
  }

  function renderDctTwoPass() {
    const block = encodedBlock();
    stage.innerHTML = '<div class="dct-use-row">' +
      '<span class="note">逐行 → 逐列，可单步查看</span>' +
      '<button data-tp="prev">◀ 上一步</button>' +
      '<button data-tp="next">下一步 ▶</button>' +
      '<button data-tp="play" id="tpPlay">暂停</button>' +
      '<button data-tp="reset">从头</button>' +
      '</div>' +
      '<div class="grid-3">' +
      figure('passOriginal', '原块 f(x,y)（已 −128）') +
      figure('passTemp', '第 1 次：对每行做 1D DCT（行=y，列=u）') +
      figure('passFinal', '第 2 次：对每列做 1D DCT（行=u，列=v）') +
      '</div>' +
      figure('passRow', '当前这一行/列：就是上面讲的一维 DCT 在逐行、逐列重复') +
      '<p class="note" id="passReadout"></p>' +
      '<button class="stage-btn" id="passBack">下一张：看这 64 个系数代表什么 →</button>';
    Array.prototype.forEach.call(stage.querySelectorAll('.dct-use-row button'), function (button) {
      button.addEventListener('click', function () {
        const action = button.getAttribute('data-tp');
        if (action === 'prev') { applyTwoPassStep(state.dctPassStep - 1); return; }
        if (action === 'next') { applyTwoPassStep(state.dctPassStep + 1); return; }
        if (action === 'reset') { applyTwoPassStep(0); return; }
        if (state.dctPassTimer || state.dctPassHold) {
          stopVisualAnimations();
          syncTwoPassButtons();
        } else {
          startDctTwoPass(state.dctPassStep);
        }
      });
    });
    document.getElementById('passBack').addEventListener('click', function () {
      if (state.dctPassTimer) {
        clearInterval(state.dctPassTimer);
        state.dctPassTimer = null;
      }
      state.dctRowStep = 8;
      state.dctColStep = 8;
      gotoChapter('dct:3');
    });
    drawCells(setupCanvas('passOriginal', 380, 380), block.pixels, function (value) {
      return grayColor(value + 128);
    }, {
      text: function (value) { return String(Math.round(value + 128)); },
      gridColor: 'rgba(255,255,255,0.55)'
    });
    setupCanvas('passTemp', 380, 380);
    setupCanvas('passFinal', 380, 380);
    setupCanvas('passRow', 760, 200);
    refreshDctTwoPass();
    syncTwoPassButtons();
  }

  function drawPassMatrix(target, values, processed, axis) {
    const context = target.ctx;
    const cellWidth = target.w / 8;
    const cellHeight = target.h / 8;
    let maximum = 1;
    for (let i = 0; i < 64; i++) maximum = Math.max(maximum, Math.abs(values[i]));
    context.clearRect(0, 0, target.w, target.h);
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        const index = row * 8 + column;
        const done = axis === 'row' ? row < processed : column < processed;
        const rgb = done ? heatColor(values[index], maximum) : RGB.empty;
        context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
        context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
        if (done) {
          context.fillStyle = textColor(rgb);
          context.font = '600 11px Consolas, monospace';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(formatValue(values[index]),
            column * cellWidth + cellWidth / 2, row * cellHeight + cellHeight / 2);
        }
      }
    }
    context.strokeStyle = 'rgba(255,255,255,0.68)';
    context.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      context.beginPath(); context.moveTo(i * cellWidth, 0); context.lineTo(i * cellWidth, target.h); context.stroke();
      context.beginPath(); context.moveTo(0, i * cellHeight); context.lineTo(target.w, i * cellHeight); context.stroke();
    }
    if (processed > 0 && processed < 8) {
      /* 正在处理的那一行/列：淡橙覆盖 + 粗边框，扫过一遍就完成 */
      context.fillStyle = 'rgba(194,65,12,0.14)';
      if (axis === 'row') {
        context.fillRect(0, (processed - 1) * cellHeight, target.w, cellHeight);
      } else {
        context.fillRect((processed - 1) * cellWidth, 0, cellWidth, target.h);
      }
      context.strokeStyle = '#c2410c';
      context.lineWidth = 2.5;
      if (axis === 'row') {
        context.strokeRect(1.5, (processed - 1) * cellHeight + 1.5, target.w - 3, cellHeight - 3);
      } else {
        context.strokeRect((processed - 1) * cellWidth + 1.5, 1.5, cellWidth - 3, target.h - 3);
      }
    }
  }

  function refreshDctTwoPass() {
    const block = encodedBlock();
    const temporary = rowDct(block.pixels);
    const finalCanvas = document.getElementById('passFinal');
    const tempCanvas = document.getElementById('passTemp');
    const rowCanvas = document.getElementById('passRow');
    if (!finalCanvas || !tempCanvas) return;
    drawPassMatrix({ canvas: tempCanvas, ctx: tempCanvas.getContext('2d'), w: 380, h: 380 }, temporary, state.dctRowStep, 'row');
    drawPassMatrix({ canvas: finalCanvas, ctx: finalCanvas.getContext('2d'), w: 380, h: 380 }, block.coefficients, state.dctColStep, 'col');
    const axis = state.dctRowStep < 8 ? 'row' : 'col';
    const index = clamp((axis === 'row' ? state.dctRowStep : state.dctColStep) - 1, 0, 7);
    if (rowCanvas) {
      drawPassRow({ canvas: rowCanvas, ctx: rowCanvas.getContext('2d'), w: 760, h: 200 }, axis, index);
    }
    const readout = document.getElementById('passReadout');
    if (!readout) return;
    if (state.dctRowStep < 8) {
      readout.textContent = '第一遍逐行：已处理 ' + state.dctRowStep + '/8 行，下方画的是第 ' + (index + 1) + ' 行。';
    } else if (state.dctColStep < 8) {
      readout.textContent = '第二遍逐列：已处理 ' + state.dctColStep + '/8 列，同一套余弦基换到纵向。';
    } else {
      readout.textContent = '完成：64 个系数全部算出，F = T·f·Tᵀ。';
    }
  }

  function drawPassRow(target, axis, index) {
    const context = target.ctx;
    const block = encodedBlock();
    const temporary = rowDct(block.pixels);
    const input = new Float64Array(8);
    const output = new Float64Array(8);
    for (let i = 0; i < 8; i++) {
      if (axis === 'row') {
        input[i] = block.pixels[index * 8 + i] + 128;
        output[i] = temporary[index * 8 + i];
      } else {
        input[i] = temporary[i * 8 + index];
        output[i] = block.coefficients[i * 8 + index];
      }
    }
    context.clearRect(0, 0, target.w, target.h);
    const halfWidth = (target.w - 36) / 2;
    /* 色块与柱状图都用和上方矩阵同一个量程：同一个数在三处颜色完全一致 */
    const tempScale = maxAbsCoefficient(temporary);
    const finalScale = maxAbsCoefficient(block.coefficients);
    const chipsScale = axis === 'row' ? 255 : tempScale;
    drawValueChips(context, { x: 10, y: 6, w: halfWidth, h: target.h - 12 },
      axis === 'row'
        ? '第 ' + (index + 1) + ' 行的 8 个像素（0–255，灰阶）'
        : '第 ' + (index + 1) + ' 列的 8 个中间系数（蓝 = 负 · 红 = 正）',
      input, axis === 'row', chipsScale);
    drawStemStrip(context, { x: 26 + halfWidth, y: 6, w: halfWidth, h: target.h - 12 },
      axis === 'row'
        ? '→ 这一行的一维 DCT 结果（红 = 正 · 蓝 = 负）'
        : '→ 这一列的一维 DCT 结果（最终系数；红 = 正 · 蓝 = 负）',
      output, true, axis === 'row' ? tempScale : finalScale);
  }

  /* 8 个正方形色块拼成一条：像素行用灰阶（0–255 本身就是亮度），
     系数列沿用全站发散色标（蓝 = 负、红 = 正、浅中性 = 接近 0），
     避免把带符号的系数画成“越暗越负”的灰度，和上面的系数矩阵语义对齐。 */
  function drawValueChips(context, box, title, values, isPixelRow, scale, activeCount) {
    context.fillStyle = '#fff';
    context.fillRect(box.x, box.y, box.w, box.h);
    context.strokeStyle = '#e3eaf4';
    context.lineWidth = 1;
    context.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);

    const topPad = title ? 30 : 14;
    if (title) {
      context.fillStyle = '#64748b';
      context.font = '600 11px "Microsoft YaHei", sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'top';
      context.fillText(title, box.x + 10, box.y + 8);
    }

    let maximum = maxAbsCoefficient(values);
    if (isFinite(scale) && scale > 0) maximum = Math.max(maximum, scale);

    const gap = 4;
    const available = box.h - topPad - 24;
    const slot = (box.w - 16 - gap * (values.length - 1)) / values.length;
    const size = Math.max(18, Math.min(slot, available));
    const totalWidth = size * values.length + gap * (values.length - 1);
    const startX = box.x + (box.w - totalWidth) / 2;
    const cellTop = box.y + topPad + (available - size) / 2;
    const labelSize = size >= 46 ? 12 : size >= 36 ? 10.5 : 9;

    function roundedRect(x, y, w, h, radius) {
      const r = Math.min(radius, w / 2, h / 2);
      context.beginPath();
      context.moveTo(x + r, y);
      context.lineTo(x + w - r, y);
      context.quadraticCurveTo(x + w, y, x + w, y + r);
      context.lineTo(x + w, y + h - r);
      context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      context.lineTo(x + r, y + h);
      context.quadraticCurveTo(x, y + h, x, y + h - r);
      context.lineTo(x, y + r);
      context.quadraticCurveTo(x, y, x + r, y);
      context.closePath();
    }

    const active = isFinite(activeCount) ? clamp(activeCount, 0, values.length) : values.length;
    for (let i = 0; i < values.length; i++) {
      const x = startX + i * (size + gap);
      const shown = i < active;
      const rgb = shown ? (isPixelRow ? grayColor(values[i]) : heatColor(values[i], maximum)) : RGB.empty;
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      roundedRect(x, cellTop, size, size, 6);
      context.fill();
      if (!shown) {
        context.save();
        context.strokeStyle = '#cbd5e1';
        context.lineWidth = 1;
        context.setLineDash([3, 3]);
        context.stroke();
        context.restore();
      }

      context.fillStyle = shown ? textColor(rgb) : '#94a3b8';
      context.font = '600 ' + labelSize + 'px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(shown ? formatValue(values[i]) : '—', x + size / 2, cellTop + size / 2);

      context.fillStyle = '#94a3b8';
      context.font = '9px Consolas, monospace';
      context.textBaseline = 'top';
      context.fillText('X' + i, x + size / 2, cellTop + size + 6);
    }
  }

  /* 带符号柱状图：红 = 正、蓝 = 负，与矩阵/色块的发散色标同义。
     柱色直接取和矩阵格子同一个色标函数与量程，同一个数在两处颜色完全一致；
     柱高按本组最大值归一（只为了看清形状）。 */
  function drawStemStrip(context, box, title, values, signed, scale) {
    context.fillStyle = '#fff';
    context.fillRect(box.x, box.y, box.w, box.h);
    context.strokeStyle = '#e3eaf4';
    context.lineWidth = 1;
    context.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    context.fillStyle = '#64748b';
    context.font = '600 11px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText(title, box.x + 10, box.y + 8);

    const maximum = maxAbsCoefficient(values);
    /* colorScale 与矩阵同一量程；柱高仍按本组最大值，避免小柱子看不见 */
    const colorScale = isFinite(scale) && scale > 0 ? scale : maximum;
    const plotTop = box.y + 30;
    const plotBottom = box.y + box.h - 22;
    const baseline = signed ? (plotTop + plotBottom) / 2 : plotBottom;
    const half = signed ? (plotBottom - plotTop) / 2 - 8 : (plotBottom - plotTop) - 8;
    const slot = (box.w - 28) / values.length;
    context.strokeStyle = 'rgba(148,163,184,0.8)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(box.x + 14, baseline);
    context.lineTo(box.x + box.w - 14, baseline);
    context.stroke();
    for (let i = 0; i < values.length; i++) {
      const center = box.x + 14 + (i + 0.5) * slot;
      const height = Math.abs(values[i]) / maximum * half;
      const width = slot * 0.5;
      const barRGB = heatColor(values[i], colorScale);
      const top = values[i] >= 0 ? baseline - height : baseline;
      context.fillStyle = rgbCss(barRGB);
      context.fillRect(center - width / 2, top, width, Math.max(1.5, height));
      if (height >= 3) {
        context.strokeStyle = rgbCss(darkenRGB(barRGB, 0.28));
        context.lineWidth = 1;
        context.strokeRect(center - width / 2 + 0.5, top + 0.5, width - 1, Math.max(1, height) - 1);
      }
      context.fillStyle = rgbCss(darkenRGB(barRGB, 0.55));
      context.font = '600 10px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = values[i] >= 0 ? 'bottom' : 'top';
      context.fillText(formatValue(values[i]), center,
        values[i] >= 0 ? baseline - height - 4 : baseline + height + 4);
      context.fillStyle = '#94a3b8';
      context.textBaseline = 'top';
      context.fillText(String(i), center, plotBottom + 6);
    }
  }

  const QUANT_MATRIX_SIZE = 320;
  const QUANT_RULER_WIDTH = 640;
  const QUANT_RULER_HEIGHT = 88;

  /* 量化页：把 F → q → F/q → Fq 四个 8×8 矩阵并排，再给出一格的完整算式。
   * 点选任意格 = 把那一格的 F、q、商、取整结果、反量化回看与误差一起摊开。 */
  function renderQuantStep() {
    const block = encodedBlock();
    stage.innerHTML = '<div class="grid-4">' +
      figure('quantSource', '① DCT 原始系数 F(u,v)（蓝负红正）') +
      figure('quantTable', '② 量化步长 q(u,v)：颜色越暖步长越大') +
      figure('quantQuotient', '③ F ÷ q（取整前；浅橙底 = 不足半个步长，必被置零）') +
      figure('quantCoeff', '④ 四舍五入后的 Fq(u,v)（红叉 = 0）') +
      '</div>' +
      '<div class="quant-work">' +
      '<div class="quant-work-head"><span id="quantWorkPos">算术过程：点击任意格子可固定查看这一格</span>' +
      '<span>round 取最近整数：|F ÷ q| &lt; 0.5 → 0，该格整格丢弃</span></div>' +
      '<div class="quant-equation">' +
      '<span class="q-chip"><em>F(u,v)</em><b id="qValueIn">—</b></span>' +
      '<span class="q-op">÷</span>' +
      '<span class="q-chip"><em>q(u,v)</em><b id="qValueQ">—</b></span>' +
      '<span class="q-op">=</span>' +
      '<span class="q-chip"><em>F ÷ q</em><b id="qValueDiv">—</b></span>' +
      '<span class="q-op">→ round →</span>' +
      '<span class="q-chip q-out"><em>Fq(u,v)</em><b id="qValueOut">—</b></span>' +
      '<span class="q-op">× q →</span>' +
      '<span class="q-chip"><em>反量化回看</em><b id="qValueBack">—</b></span>' +
      '</div>' +
      '<p class="note" id="quantReadout"></p>' +
      '<p class="note" id="quantError"></p>' +
      '<canvas id="quantRuler" role="img" aria-label="量化步长标尺：当前质量因子 QF 对应的位置"></canvas>' +
      '</div>' +
      '<div style="margin-top:8px">' + statBlock([
        ['质量因子 QF', state.Q],
        ['q(u,v) 范围', Math.min.apply(null, Array.from(block.quant)) + '–' + Math.max.apply(null, Array.from(block.quant))],
        ['置零系数', countZero(block.quantized) + ' / 64'],
        ['零系数占比', (100 * countZero(block.quantized) / 64).toFixed(1) + '%']
      ]) + '</div>';
    ['quantSource', 'quantTable', 'quantQuotient', 'quantCoeff'].forEach(function (id) {
      setupCanvas(id, QUANT_MATRIX_SIZE, QUANT_MATRIX_SIZE);
    });
    setupCanvas('quantRuler', QUANT_RULER_WIDTH, QUANT_RULER_HEIGHT);
    ['quantSource', 'quantTable', 'quantQuotient', 'quantCoeff'].forEach(function (id) {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      canvas.addEventListener('click', function (event) {
        const rectangle = canvas.getBoundingClientRect();
        const column = clamp(Math.floor((event.clientX - rectangle.left) / rectangle.width * 8), 0, 7);
        const row = clamp(Math.floor((event.clientY - rectangle.top) / rectangle.height * 8), 0, 7);
        state.quantFocus = row * 8 + column;
        state.quantStep = 64;
        paintQuantStep();
      });
    });
    paintQuantStep();
  }

  function quantTarget(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const ruler = id === 'quantRuler';
    return {
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      w: ruler ? QUANT_RULER_WIDTH : QUANT_MATRIX_SIZE,
      h: ruler ? QUANT_RULER_HEIGHT : QUANT_MATRIX_SIZE
    };
  }

  /* 当前要讲解的格子：优先用户点选，其次动画游标，最后退到 |F| 最大的那格。 */
  function quantFocusIndex(block) {
    if (typeof state.quantFocus === 'number' && state.quantFocus >= 0 && state.quantFocus < 64) return state.quantFocus;
    if (state.quantStep > 0 && state.quantStep < 64) return state.quantStep - 1;
    let best = 0;
    for (let i = 1; i < 64; i++) {
      if (Math.abs(block.coefficients[i]) > Math.abs(block.coefficients[best])) best = i;
    }
    return best;
  }

  function paintQuantStep() {
    const source = quantTarget('quantSource');
    if (!source) return;
    const block = encodedBlock();
    const focus = quantFocusIndex(block);
    drawQuantSource(source, block, focus);
    drawQuantTable(quantTarget('quantTable'), block, focus);
    drawQuantQuotient(quantTarget('quantQuotient'), block, focus);
    drawQuantizedCells(quantTarget('quantCoeff'), block, focus);
    drawQuantRuler(quantTarget('quantRuler'), block, focus);
    updateQuantWork(block, focus);
  }

  function markQuantFocus(target, index) {
    if (!target || typeof index !== 'number' || index < 0) return;
    const context = target.ctx;
    const cellWidth = target.w / 8;
    const cellHeight = target.h / 8;
    const row = Math.floor(index / 8);
    const column = index % 8;
    context.strokeStyle = '#c2410c';
    context.lineWidth = 3;
    context.strokeRect(column * cellWidth + 2, row * cellHeight + 2, cellWidth - 4, cellHeight - 4);
  }

  function drawQuantSource(target, block, focus) {
    if (!target) return;
    let maximum = 1;
    for (let i = 0; i < 64; i++) maximum = Math.max(maximum, Math.abs(block.coefficients[i]));
    drawCells(target, block.coefficients, function (value) { return heatColor(value, maximum); }, {
      text: function (value) { return formatValue(value); },
      gridColor: 'rgba(255,255,255,0.68)'
    });
    markQuantFocus(target, focus);
  }

  function drawQuantTable(target, block, focus) {
    if (!target) return;
    let maximum = 1;
    for (let i = 0; i < 64; i++) maximum = Math.max(maximum, block.quant[i]);
    drawCells(target, block.quant, function (value) { return magnitudeColor(value, maximum); }, {
      text: function (value) { return String(Math.round(value)); },
      gridColor: 'rgba(255,255,255,0.6)'
    });
    markQuantFocus(target, focus);
  }

  function drawQuantQuotient(target, block, focus) {
    if (!target) return;
    const quotient = new Float64Array(64);
    let maximum = 1;
    for (let i = 0; i < 64; i++) {
      quotient[i] = block.coefficients[i] / block.quant[i];
      maximum = Math.max(maximum, Math.abs(quotient[i]));
    }
    drawCells(target, quotient, function (value) { return heatColor(value, maximum); }, {
      text: function (value) { return Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2); },
      gridColor: 'rgba(255,255,255,0.68)'
    });
    const context = target.ctx;
    const cellWidth = target.w / 8;
    const cellHeight = target.h / 8;
    context.fillStyle = 'rgba(194,65,12,0.16)';
    for (let i = 0; i < 64; i++) {
      if (Math.abs(quotient[i]) >= 0.5) continue;
      const row = Math.floor(i / 8);
      const column = i % 8;
      context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
    }
    markQuantFocus(target, focus);
  }

  function drawQuantizedCells(target, block, focus) {
    if (!target) return;
    const step = state.quantStep;
    const context = target.ctx;
    const cellWidth = target.w / 8;
    const cellHeight = target.h / 8;
    let maximum = 1;
    for (let i = 0; i < 64; i++) maximum = Math.max(maximum, Math.abs(block.quantized[i]));
    context.clearRect(0, 0, target.w, target.h);
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8);
      const column = i % 8;
      const processed = step >= 64 || i < step;
      const value = block.quantized[i];
      const rgb = processed ? heatColor(value, maximum) : RGB.empty;
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
      if (processed && value === 0) {
        context.strokeStyle = '#dc2626';
        context.lineWidth = 1.6;
        const padding = 5;
        context.beginPath();
        context.moveTo(column * cellWidth + padding, row * cellHeight + padding);
        context.lineTo((column + 1) * cellWidth - padding, (row + 1) * cellHeight - padding);
        context.moveTo((column + 1) * cellWidth - padding, row * cellHeight + padding);
        context.lineTo(column * cellWidth + padding, (row + 1) * cellHeight - padding);
        context.stroke();
      }
      context.fillStyle = textColor(rgb);
      context.font = '600 10px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(processed && value !== 0 ? String(value) : '', column * cellWidth + cellWidth / 2, row * cellHeight + cellHeight / 2);
    }
    context.strokeStyle = 'rgba(255,255,255,0.68)';
    context.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      context.beginPath(); context.moveTo(i * cellWidth, 0); context.lineTo(i * cellWidth, target.h); context.stroke();
      context.beginPath(); context.moveTo(0, i * cellHeight); context.lineTo(target.w, i * cellHeight); context.stroke();
    }
    markQuantFocus(target, focus);
  }

  /* 数轴：一眼看出 F/q 落在 ±0.5 之内（必为 0）还是之外（保留 1 步以上）。 */
  function drawQuantRuler(target, block, focus) {
    if (!target) return;
    const context = target.ctx;
    const width = target.w;
    const quotient = block.coefficients[focus] / block.quant[focus];
    const left = 44;
    const right = width - 44;
    const middle = (left + right) / 2;
    const unit = (right - left) / 2;
    context.clearRect(0, 0, width, target.h);

    context.fillStyle = 'rgba(194,65,12,0.10)';
    context.fillRect(middle - 0.5 * unit, 30, unit, 32);
    context.strokeStyle = 'rgba(194,65,12,0.4)';
    context.lineWidth = 1;
    context.setLineDash([4, 3]);
    [-0.5, 0.5].forEach(function (value) {
      context.beginPath();
      context.moveTo(middle + value * unit, 26);
      context.lineTo(middle + value * unit, 64);
      context.stroke();
    });
    context.setLineDash([]);

    context.strokeStyle = '#94a3b8';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(left, 46);
    context.lineTo(right, 46);
    context.stroke();

    context.fillStyle = '#94a3b8';
    context.font = '10px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    [[-1, '−1'], [-0.5, '−0.5'], [0, '0'], [0.5, '0.5'], [1, '1']].forEach(function (pair) {
      const x = middle + pair[0] * unit;
      context.strokeStyle = '#cbd5e1';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, 42);
      context.lineTo(x, 50);
      context.stroke();
      context.fillText(pair[1], x, 68);
    });

    const clamped = clamp(quotient, -1, 1);
    const x = middle + clamped * unit;
    context.strokeStyle = '#1d4ed8';
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(x, 28);
    context.lineTo(x, 62);
    context.stroke();
    context.fillStyle = '#1d4ed8';
    context.beginPath();
    context.arc(x, 46, 4, 0, Math.PI * 2);
    context.fill();

    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.font = '600 11px Consolas, monospace';
    context.fillText('F ÷ q = ' + quotient.toFixed(3) + (Math.abs(quotient) > 1 ? '（超出 ±1，游标夹在端点）' : ''), 12, 6);
  }

  function quantNumber(value, digits) {
    return Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(digits);
  }

  function updateQuantWork(block, focus) {
    const original = block.coefficients[focus];
    const step = block.quant[focus];
    const quotient = original / step;
    const quantized = block.quantized[focus];
    const restored = quantized * step;
    const row = Math.floor(focus / 8);
    const column = focus % 8;
    const position = document.getElementById('quantWorkPos');
    if (position) {
      position.textContent = '当前格：第 ' + (row + 1) + ' 行第 ' + (column + 1) + ' 列（u=' + row + ', v=' + column +
        '）· 半个步长 = ±' + (step / 2).toFixed(1);
    }
    const setText = function (id, text) {
      const node = document.getElementById(id);
      if (node) node.textContent = text;
    };
    setText('qValueIn', quantNumber(original, 2));
    setText('qValueQ', String(Math.round(step)));
    setText('qValueDiv', quantNumber(quotient, 3));
    setText('qValueOut', String(quantized));
    setText('qValueBack', quantNumber(restored, 2));
    const readout = document.getElementById('quantReadout');
    if (readout) {
      readout.textContent = '算式：' + quantNumber(original, 2) + ' ÷ ' + Math.round(step) + ' = ' +
        quantNumber(quotient, 3) + ' → round → ' + quantized +
        (quantized === 0
          ? '（|商| = ' + Math.abs(quotient).toFixed(3) + ' < 0.5，不足半个步长，整格置零）'
          : '（商离 ' + quantized + ' 最近）');
    }
    const error = document.getElementById('quantError');
    if (error) {
      error.textContent = '反量化只能回到 ' + quantNumber(restored, 2) + '，与原始 ' + quantNumber(original, 2) +
        ' 相差 ' + quantNumber(original - restored, 2) +
        (quantized === 0 ? '；这一整格被丢掉。' : '；这一格保留下来，只丢了这点尾数。');
    }
  }

  function renderZigzagStep() {
    const block = encodedBlock();
    stage.innerHTML = '<div class="stage-flex" style="justify-content:center"><div class="stage-col hug">' +
      figure('zigMain', 'Zigzag 路径（数字为扫描序号）') +
      '</div><div style="width:320px">' +
      figure('zigSeq', '一维扫描序列（按 8×8 排布）') +
      '<p class="note" id="zigReadout"></p>' +
      statBlock([
        ['非零', countNonZero(block.scan) + ' / 64'],
        ['尾部零', trailingZeros(block.scan)]
      ]) + '</div></div>';
    drawZigzagMain(setupCanvas('zigMain', 520, 520));
    drawZigzagSequence(setupCanvas('zigSeq', 320, 300));
    refreshZigzag();
  }

  function refreshZigzag() {
    const main = document.getElementById('zigMain');
    const sequence = document.getElementById('zigSeq');
    if (!main || !sequence) return;
    drawZigzagMain({ canvas: main, ctx: main.getContext('2d'), w: 520, h: 520 });
    drawZigzagSequence({ canvas: sequence, ctx: sequence.getContext('2d'), w: 320, h: 300 });
    const readout = document.getElementById('zigReadout');
    if (readout) {
      const block = encodedBlock();
      readout.textContent = '扫描 ' + state.zigStep + '/64 · 当前值 ' +
        formatValue(block.scan[Math.max(0, state.zigStep - 1)]);
    }
  }

  function drawZigzagMain(target) {
    const block = encodedBlock();
    const context = target.ctx;
    const cellWidth = target.w / 8;
    const cellHeight = target.h / 8;
    context.clearRect(0, 0, target.w, target.h);
    let maximum = 1;
    for (let i = 0; i < 64; i++) maximum = Math.max(maximum, Math.abs(block.scan[i]));
    for (let order = 0; order < 64; order++) {
      const row = Codec.ZIG[order][0];
      const column = Codec.ZIG[order][1];
      const value = block.scan[order];
      const rgb = heatColor(value, maximum);
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
      if (order < state.zigStep) {
        context.fillStyle = 'rgba(29,78,216,0.12)';
        context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
      }
      context.fillStyle = textColor(rgb);
      context.font = '600 9px Consolas, monospace';
      context.textAlign = 'left';
      context.textBaseline = 'top';
      context.fillText(String(order + 1), column * cellWidth + 3, row * cellHeight + 2);
      context.font = '600 10px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(formatValue(value), column * cellWidth + cellWidth / 2, row * cellHeight + cellHeight / 2 + 4);
    }
    context.strokeStyle = 'rgba(255,255,255,0.7)';
    context.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      context.beginPath(); context.moveTo(i * cellWidth, 0); context.lineTo(i * cellWidth, target.h); context.stroke();
      context.beginPath(); context.moveTo(0, i * cellHeight); context.lineTo(target.w, i * cellHeight); context.stroke();
    }
    function center(order) {
      return {
        x: Codec.ZIG[order][1] * cellWidth + cellWidth / 2,
        y: Codec.ZIG[order][0] * cellHeight + cellHeight / 2
      };
    }
    context.strokeStyle = 'rgba(100,116,139,0.45)';
    context.lineWidth = 1.5;
    context.setLineDash([4, 3]);
    context.beginPath();
    for (let order = 0; order < 63; order++) {
      const a = center(order);
      const b = center(order + 1);
      if (order === 0) context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
    }
    context.stroke();
    context.setLineDash([]);
    if (state.zigStep > 0) {
      context.strokeStyle = '#1d4ed8';
      context.lineWidth = 2.2;
      context.beginPath();
      for (let order = 0; order < Math.min(63, state.zigStep - 1); order++) {
        const a = center(order);
        const b = center(order + 1);
        if (order === 0) context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
      }
      context.stroke();
      const current = center(state.zigStep - 1);
      context.strokeStyle = '#c2410c';
      context.lineWidth = 2.6;
      context.strokeRect(current.x - cellWidth / 2 + 1.5, current.y - cellHeight / 2 + 1.5, cellWidth - 3, cellHeight - 3);
    }
  }

  function drawZigzagSequence(target) {
    const block = encodedBlock();
    const context = target.ctx;
    const cellWidth = target.w / 8;
    const cellHeight = target.h / 8;
    context.clearRect(0, 0, target.w, target.h);
    let maximum = 1;
    for (let i = 0; i < 64; i++) maximum = Math.max(maximum, Math.abs(block.scan[i]));
    for (let index = 0; index < 64; index++) {
      const row = Math.floor(index / 8);
      const column = index % 8;
      const value = block.scan[index];
      const rgb = value === 0 ? RGB.empty : heatColor(value, maximum);
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
      context.fillStyle = textColor(rgb);
      context.font = '600 8px Consolas, monospace';
      context.textAlign = 'left';
      context.textBaseline = 'top';
      context.fillText(String(index + 1), column * cellWidth + 2, row * cellHeight + 2);
      context.font = '600 10px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(formatValue(value), column * cellWidth + cellWidth / 2, row * cellHeight + cellHeight / 2 + 3);
      if (index === state.zigStep - 1) {
        context.strokeStyle = '#c2410c';
        context.lineWidth = 2.5;
        context.strokeRect(column * cellWidth + 1.5, row * cellHeight + 1.5, cellWidth - 3, cellHeight - 3);
      }
    }
    context.strokeStyle = 'rgba(255,255,255,0.7)';
    context.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      context.beginPath(); context.moveTo(i * cellWidth, 0); context.lineTo(i * cellWidth, target.h); context.stroke();
      context.beginPath(); context.moveTo(0, i * cellHeight); context.lineTo(target.w, i * cellHeight); context.stroke();
    }
  }

  function renderRleStep() {
    const block = encodedBlock();
    stage.innerHTML = '<figure>' + canvasTag('rleStrip', '64 个 Zigzag 系数与符号分组（橙框=当前符号）') +
      '<figcaption>64 个 Zigzag 系数与符号分组（橙框=当前符号）</figcaption></figure>' +
      '<div class="rle-dc">' +
      '<div class="card"><span>前块 DC</span><b>' + block.previousDC + '</b></div>' +
      '<div class="card"><span>当前 DC</span><b>' + block.scan[0] + '</b></div>' +
      '<div class="card"><span>DC 差分</span><b>' + (block.difference > 0 ? '+' : '') + block.difference + '</b><small>类别 ' + block.symbols[0].size + '</small></div>' +
      '<div class="card"><span>符号数</span><b>' + block.symbols.length + '</b></div>' +
      '</div>' + '<div id="rleWrap">' + symbolTable(block.symbols, block.symbols.length) + '</div>' +
      '<p class="note" id="rleReadout"></p>';
    drawRleStrip(setupCanvas('rleStrip', 1000, 200), block, -1);
  }

  function rleSpans(block) {
    const spans = [{ start: 0, end: 0, symbolIndex: 0, kind: 'DC' }];
    let position = 1;
    for (let i = 1; i < block.symbols.length; i++) {
      const symbol = block.symbols[i];
      if (symbol.kind === 'AC') {
        position += symbol.run;
        spans.push({ start: position, end: position, symbolIndex: i, kind: 'AC' });
        position += 1;
      } else if (symbol.kind === 'ZRL') {
        spans.push({ start: position, end: Math.min(63, position + 15), symbolIndex: i, kind: 'ZRL' });
        position += 16;
      } else if (symbol.kind === 'EOB') {
        spans.push({ start: position, end: 63, symbolIndex: i, kind: 'EOB' });
        position = 64;
      }
    }
    return spans;
  }

  function drawRleStrip(target, block, activeIndex) {
    const context = target.ctx;
    const cellWidth = target.w / 64;
    const top = 10;
    const height = Math.max(56, target.h - 52);
    let maximum = 1;
    for (let i = 0; i < 64; i++) maximum = Math.max(maximum, Math.abs(block.scan[i]));
    context.clearRect(0, 0, target.w, target.h);
    const spans = rleSpans(block);
    for (let i = 0; i < 64; i++) {
      const value = block.scan[i];
      const rgb = value === 0 ? RGB.empty : heatColor(value, maximum);
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      context.fillRect(i * cellWidth, top, cellWidth + 0.4, height);
    }
    spans.forEach(function (span) {
      if (span.symbolIndex === activeIndex) {
        context.fillStyle = 'rgba(194,65,12,0.22)';
        context.fillRect(span.start * cellWidth, top, (span.end - span.start + 1) * cellWidth, height);
        context.strokeStyle = '#c2410c';
        context.lineWidth = 2.5;
        context.strokeRect(span.start * cellWidth + 1, top + 1, (span.end - span.start + 1) * cellWidth - 2, height - 2);
      }
      context.strokeStyle = 'rgba(255,255,255,0.65)';
      context.lineWidth = 0.8;
      context.beginPath();
      context.moveTo(span.start * cellWidth, top);
      context.lineTo(span.start * cellWidth, top + height);
      context.stroke();
      const width = (span.end - span.start + 1) * cellWidth;
      if (width > 16 || span.symbolIndex === activeIndex) {
        context.fillStyle = span.symbolIndex === activeIndex ? '#c2410c' : '#64748b';
        context.font = '600 9px Consolas, monospace';
        context.textAlign = 'left';
        context.textBaseline = 'top';
        const label = span.kind === 'DC' ? 'DC' : span.kind === 'EOB' ? 'EOB' : span.kind === 'ZRL' ? 'ZRL' : '#' + span.symbolIndex;
        context.fillText(label, span.start * cellWidth + 2, top + height + 6);
      }
    });
    context.fillStyle = '#64748b';
    context.font = '10px Consolas, monospace';
    context.textAlign = 'left';
    context.fillText('0', 0, 2);
    context.textAlign = 'right';
    context.fillText('63', target.w, 2);
    if (activeIndex >= 0 && spans.length) {
      const span = spans.find(function (item) { return item.symbolIndex === activeIndex; });
      if (span) {
        context.strokeStyle = '#c2410c';
        context.lineWidth = 2;
        context.strokeRect(span.start * cellWidth + 1, top + 1, (span.end - span.start + 1) * cellWidth - 2, height - 2);
      }
    }
  }

  function refreshRleStrip() {
    const canvas = document.getElementById('rleStrip');
    if (!canvas) return;
    const block = encodedBlock();
    drawRleStrip({ canvas: canvas, ctx: canvas.getContext('2d'), w: 1000, h: 200 }, block, state.rleStep - 1);
  }

  function renderHuffmanStep() {
    const block = encodedBlock();
    const unique = [];
    const seen = new Set();
    block.symbols.forEach(function (symbol) {
      const key = symbolLabel(symbol) + '|' + symbol.code;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(symbol);
      }
    });
    stage.innerHTML = '<div class="stage-flex"><div class="stage-col">' +
      '<div class="scroll"><table class="data"><thead><tr><th>符号</th><th>码字</th><th>码长</th><th>幅值位</th></tr></thead><tbody>' +
      unique.slice(0, 24).map(function (symbol) {
        return '<tr><td>' + symbolLabel(symbol) + '</td><td><code>' + symbol.code + '</code></td><td>' + symbol.code.length +
          '</td><td><code>' + (symbol.amplitude || '—') + '</code></td></tr>';
      }).join('') + '</tbody></table></div></div>' +
      '<div style="width:250px">' + statBlock([
        ['符号数', block.symbols.length],
        ['唯一码字', unique.length],
        ['本块位数', block.bits.length + ' bit'],
        ['平均码长', (block.bits.length / block.symbols.length).toFixed(2) + ' bit']
      ]) + '</div></div>' +
      '<figure style="margin-top:14px"><canvas id="huffTree" role="img" aria-label="规范 Huffman 码树：由码长表唯一生成，橙色为本块实际用到的码字"></canvas>' +
      '<figcaption>规范 Huffman 码树：由码长表按「码长递增、同长按符号递增值」唯一生成，从根到叶读出的 0/1 就是码字；' +
      '越常用的符号离根越近。橙色 = 本块实际用到的码字。</figcaption></figure>' +
      '<p class="subcap" style="margin-top:12px">本块位流</p><div class="bits" id="huffBits">' + colorBits(block.bits) + '</div>' +
      '<div class="grid-2" style="margin-top:8px"><div><p class="subcap">当前写入符号</p><div class="note" id="huffCurrent"></div></div>' +
      '<div><p class="subcap">已完成字节（十六进制）</p><div class="bits" id="huffBytes"></div></div></div>' +
      '<p class="note" id="huffReadout"></p>';
    drawHuffmanTree(setupCanvas('huffTree', 1000, 470), block);
  }

  const AC_TREE_CODES = 14;
  const acCountCache = new WeakMap();

  function acSymbolCounts(encoded) {
    let counts = acCountCache.get(encoded);
    if (counts) return counts;
    counts = new Map();
    encoded.mcus.forEach(function (mcu) {
      mcu.blocks.forEach(function (block) {
        block.symbols.forEach(function (symbol) {
          let value = -1;
          if (symbol.kind === 'AC') value = symbol.run * 16 + symbol.size;
          else if (symbol.kind === 'EOB') value = 0x00;
          else if (symbol.kind === 'ZRL') value = 0xF0;
          if (value < 0) return;
          counts.set(value, (counts.get(value) || 0) + 1);
        });
      });
    });
    acCountCache.set(encoded, counts);
    return counts;
  }

  function huffmanLabel(kind, value) {
    if (kind === 'DC') return 'DC(' + value + ')';
    if (value === 0x00) return 'EOB';
    if (value === 0xF0) return 'ZRL';
    return '(' + Math.floor(value / 16) + ',' + (value % 16) + ')';
  }

  function huffmanEntries(kind, block) {
    const table = kind === 'DC' ? Codec.DC_TABLE : Codec.AC_TABLE;
    const used = new Set();
    block.symbols.forEach(function (symbol) {
      if (symbol.kind === 'DC') {
        if (kind === 'DC') used.add(symbol.size);
      } else if (symbol.kind === 'AC') {
        if (kind === 'AC') used.add(symbol.run * 16 + symbol.size);
      } else if (symbol.kind === 'EOB') {
        if (kind === 'AC') used.add(0x00);
      } else if (symbol.kind === 'ZRL') {
        if (kind === 'AC') used.add(0xF0);
      }
    });
    const values = [];
    if (kind === 'DC') {
      table.encode.forEach(function (entry, value) { values.push(value); });
    } else {
      used.forEach(function (value) { values.push(value); });
      const counts = acSymbolCounts(state.encoded);
      const ranked = Array.from(counts.keys()).sort(function (a, b) {
        return (counts.get(b) - counts.get(a)) || (b - a);
      });
      ranked.forEach(function (value) {
        if (values.length >= AC_TREE_CODES) return;
        if (values.indexOf(value) < 0) values.push(value);
      });
    }
    return values.filter(function (value) { return table.encode.has(value); }).map(function (value) {
      const entry = table.encode.get(value);
      return { code: entry.code, label: huffmanLabel(kind, value), used: used.has(value) };
    });
  }

  function drawCodeTreePanel(context, rect, entries, options) {
    const root = { children: [null, null], code: '', depth: 0, label: '', used: false, hasUsed: false };
    entries.forEach(function (entry) {
      let node = root;
      for (let index = 0; index < entry.code.length; index++) {
        const bit = entry.code.charAt(index) === '1' ? 1 : 0;
        if (!node.children[bit]) {
          node.children[bit] = {
            children: [null, null], code: node.code + entry.code.charAt(index),
            depth: node.depth + 1, label: '', used: false, hasUsed: false
          };
        }
        node = node.children[bit];
      }
      node.label = entry.label;
      node.used = entry.used === true;
    });
    function markUsed(node) {
      const zero = node.children[0] ? markUsed(node.children[0]) : false;
      const one = node.children[1] ? markUsed(node.children[1]) : false;
      node.hasUsed = node.used || zero || one;
      return node.hasUsed;
    }
    markUsed(root);

    let leaves = 0;
    let maxDepth = 0;
    function place(node) {
      maxDepth = Math.max(maxDepth, node.depth);
      const kids = [];
      if (node.children[0]) kids.push(node.children[0]);
      if (node.children[1]) kids.push(node.children[1]);
      if (!kids.length) {
        node.slot = leaves;
        leaves += 1;
        return node.slot;
      }
      let first = 0;
      let last = 0;
      kids.forEach(function (kid, index) {
        const slot = place(kid);
        if (index === 0) first = slot;
        last = slot;
      });
      node.slot = (first + last) / 2;
      return node.slot;
    }
    place(root);

    const top = rect.y + 50;
    const bottom = rect.y + rect.h - 28;
    const rowHeight = maxDepth > 0 ? (bottom - top) / maxDepth : 0;
    const slotWidth = Math.min(50, (rect.w - 26) / Math.max(1, leaves - 1));
    const originX = rect.x + rect.w / 2 - (leaves - 1) * slotWidth / 2;
    const xOf = function (node) { return originX + node.slot * slotWidth; };
    const yOf = function (node) { return top + node.depth * rowHeight; };

    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#334155';
    context.font = '600 12px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
    context.fillText(options.title, rect.x + 4, rect.y + 20);
    context.fillStyle = '#64748b';
    context.font = '11px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
    context.fillText(options.note, rect.x + 4, rect.y + 36);

    function drawEdges(node) {
      [0, 1].forEach(function (bit) {
        const kid = node.children[bit];
        if (!kid) return;
        const x1 = xOf(node);
        const y1 = yOf(node);
        const x2 = xOf(kid);
        const y2 = yOf(kid);
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.strokeStyle = kid.hasUsed ? '#c2410c' : '#cbd5e1';
        context.lineWidth = kid.hasUsed ? 2 : 1.1;
        context.stroke();
        if (y2 - y1 >= 15) {
          context.fillStyle = kid.hasUsed ? '#ea580c' : '#94a3b8';
          context.font = '9px Consolas, monospace';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(String(bit), (x1 + x2) / 2 + (bit === 1 ? 5 : -5), (y1 + y2) / 2);
        }
        drawEdges(kid);
      });
    }
    drawEdges(root);

    function drawNodes(node) {
      const x = xOf(node);
      const y = yOf(node);
      context.beginPath();
      if (node.label) {
        context.arc(x, y, 3, 0, Math.PI * 2);
        context.fillStyle = node.used ? '#c2410c' : '#94a3b8';
        context.fill();
        context.font = (node.used ? '600 ' : '') + '10px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
        context.fillStyle = node.used ? '#c2410c' : '#475569';
        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.fillText(node.label, x, y + 7);
      } else {
        context.arc(x, y, 2.4, 0, Math.PI * 2);
        context.fillStyle = node.hasUsed ? '#fff7ed' : '#ffffff';
        context.strokeStyle = node.hasUsed ? '#fb923c' : '#cbd5e1';
        context.lineWidth = node.hasUsed ? 1.6 : 1;
        context.fill();
        context.stroke();
      }
      [0, 1].forEach(function (bit) { if (node.children[bit]) drawNodes(node.children[bit]); });
    }
    drawNodes(root);
  }

  function drawHuffmanTree(target, block) {
    if (!target) return;
    const context = target.ctx;
    context.clearRect(0, 0, target.w, target.h);
    const margin = 6;
    const gap = 24;
    const panelWidth = (target.w - margin * 2 - gap) / 2;
    const dcEntries = huffmanEntries('DC', block);
    const acEntries = huffmanEntries('AC', block);
    const dcUsed = dcEntries.filter(function (entry) { return entry.used; }).length;
    const acUsed = acEntries.filter(function (entry) { return entry.used; }).length;
    drawCodeTreePanel(context, { x: margin, y: 0, w: panelWidth, h: target.h }, dcEntries, {
      title: 'DC 亮度表 · ' + dcEntries.length + ' 个码字全展开',
      note: '橙 = 本块用到的 ' + dcUsed + ' 个 DC 码字，灰 = 表中其余码字'
    });
    drawCodeTreePanel(context, { x: margin + panelWidth + gap, y: 0, w: panelWidth, h: target.h }, acEntries, {
      title: 'AC 亮度表 · 展开 ' + acEntries.length + ' 个码字',
      note: '橙 = 本块用到的 ' + acUsed + ' 个码字，灰 = 全图高频码字（表中共 162 个）'
    });
  }

  function renderBitstreamStep() {
    const stats = state.encoded.stats;
    stage.innerHTML = metricCards([
      ['总位数', stats.totalBits, '熵编码段'],
      ['字节数', stats.entropyBytes, '不含文件头'],
      ['压缩比', (state.width * state.height * 24 / (8 * stats.entropyBytes)).toFixed(1) + '×', '相对 RGB 原始数据'],
      ['Y 分量位数', stats.bitsPerComponent.Y, (100 * stats.bitsPerComponent.Y / stats.totalBits).toFixed(1) + '%'],
      ['Cb 分量位数', stats.bitsPerComponent.Cb, (100 * stats.bitsPerComponent.Cb / stats.totalBits).toFixed(1) + '%'],
      ['Cr 分量位数', stats.bitsPerComponent.Cr, (100 * stats.bitsPerComponent.Cr / stats.totalBits).toFixed(1) + '%']
    ]) + '<div class="grid-2" style="margin-top:12px">' +
      figure('bitBars', '各分量位数占比') +
      figure('bitHist', '块位数分布') + '</div>' +
      '<figure style="margin-top:12px"><canvas id="bitAssembly" role="img" aria-label="按 MCU 顺序拼接位流（每格一个 MCU，橙框为当前写入）"></canvas>' +
      '<figcaption>按 MCU 顺序拼接位流（每格一个 MCU，橙框=当前写入）</figcaption></figure>' +
      '<p class="note" id="assemblyReadout"></p>';
    drawBitBars(setupCanvas('bitBars', 520, 300));
    drawBitHistogram(setupCanvas('bitHist', 520, 300));
    drawBitAssembly(setupCanvas('bitAssembly', 1000, 300), state.assemblyStep);
    refreshAssemblyReadout();
  }

  function drawBitAssembly(target, step) {
    const mcus = state.encoded.mcus;
    const context = target.ctx;
    const columns = Math.ceil(Math.sqrt(mcus.length));
    const rows = Math.ceil(mcus.length / columns);
    const cellWidth = target.w / columns;
    const cellHeight = (target.h - 24) / rows;
    let maximum = 1;
    mcus.forEach(function (mcu) {
      let bits = 0;
      mcu.blocks.forEach(function (block) { bits += block.bits.length; });
      maximum = Math.max(maximum, bits);
    });
    context.clearRect(0, 0, target.w, target.h);
    mcus.forEach(function (mcu, index) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      let bits = 0;
      mcu.blocks.forEach(function (block) { bits += block.bits.length; });
      const processed = step >= mcus.length || index < step;
      const level = Math.min(1, Math.sqrt(bits / maximum));
      const rgb = processed
        ? [Math.round(220 - 160 * level), Math.round(232 - 170 * level), 255]
        : RGB.empty;
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      context.fillRect(column * cellWidth + 0.6, row * cellHeight + 0.6, cellWidth - 1.2, cellHeight - 1.2);
      if (step > 0 && step < mcus.length && index === step - 1) {
        context.strokeStyle = '#c2410c';
        context.lineWidth = 2.5;
        context.strokeRect(column * cellWidth + 1, row * cellHeight + 1, cellWidth - 2, cellHeight - 2);
      }
    });
    context.fillStyle = '#64748b';
    context.font = '10px Consolas, monospace';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText(step + ' / ' + mcus.length + ' MCU', 2, target.h - 16);
  }

  function refreshAssemblyReadout() {
    const readout = document.getElementById('assemblyReadout');
    if (!readout) return;
    const mcus = state.encoded.mcus;
    let bits = 0;
    for (let i = 0; i < state.assemblyStep && i < mcus.length; i++) {
      mcus[i].blocks.forEach(function (block) { bits += block.bits.length; });
    }
    readout.textContent = '已拼接 ' + state.assemblyStep + ' / ' + mcus.length + ' 个 MCU，累计 ' + bits + ' bit。';
  }

  function drawBitBars(target) {
    const context = target.ctx;
    const bits = state.encoded.stats.bitsPerComponent;
    const names = ['Y', 'Cb', 'Cr'];
    const colors = ['#1d4ed8', '#0f766e', '#c2410c'];
    const maximum = Math.max(bits.Y, bits.Cb, bits.Cr, 1);
    context.clearRect(0, 0, target.w, target.h);
    const base = target.h - 34;
    const slot = target.w / 3;
    const width = Math.min(100, slot * 0.42);
    for (let i = 0; i < 3; i++) {
      const value = bits[names[i]];
      const height = (base - 28) * value / maximum;
      const x = slot * i + (slot - width) / 2;
      context.fillStyle = colors[i];
      context.fillRect(x, base - height, width, height);
      context.fillStyle = '#152033';
      context.font = '600 12px Consolas, monospace';
      context.textAlign = 'center';
      context.fillText(value + ' bit', x + width / 2, base - height - 8);
      context.fillStyle = '#64748b';
      context.fillText(names[i], x + width / 2, base + 16);
    }
  }

  function drawBitHistogram(target) {
    const context = target.ctx;
    const all = Array.from(state.encoded.blocks.values()).map(function (block) { return block.bits.length; });
    const maximum = Math.max.apply(null, all);
    const bins = 16;
    const counts = new Array(bins).fill(0);
    all.forEach(function (value) { counts[Math.min(bins - 1, Math.floor(value / (maximum + 1) * bins))] += 1; });
    const peak = Math.max.apply(null, counts);
    context.clearRect(0, 0, target.w, target.h);
    const base = target.h - 26;
    const barWidth = (target.w - 40) / bins;
    for (let i = 0; i < bins; i++) {
      const height = (base - 20) * counts[i] / peak;
      context.fillStyle = '#1d4ed8';
      context.fillRect(20 + i * barWidth, base - height, barWidth - 3, height);
    }
    context.fillStyle = '#64748b';
    context.font = '11px Consolas, monospace';
    context.textAlign = 'left';
    context.fillText('0', 20, base + 16);
    context.textAlign = 'right';
    context.fillText(maximum + ' bit', target.w - 10, base + 16);
  }

  function renderDecEntropyStep() {
    const block = encodedBlock();
    const decoded = decodedBlock();
    const same = sameSymbols(block.symbols, decoded.symbols);
    const rows = block.symbols.map(function (symbol, index) {
      const other = decoded.symbols[index] || {};
      return '<tr><td>' + symbolLabel(symbol) + '</td><td>' + symbol.code + '</td><td>' +
        (other.kind ? symbolLabel(other) : '—') + '</td><td>' + (other.code || '—') + '</td><td>' +
        (other.value !== undefined ? other.value : '—') + '</td></tr>';
    }).join('');
    const start = Math.max(0, block.bitStart - 8);
    const end = Math.min(state.encoded.bitstream.length, block.bitEnd + 8);
    const snippet = state.encoded.bitstream.slice(start, end);
    const usedStart = block.bitStart - start;
    const usedEnd = block.bitEnd - start;
    stage.innerHTML = '<div class="rle-dc">' +
      '<div class="card"><span>位范围</span><b>' + block.bitStart + '–' + block.bitEnd + '</b></div>' +
      '<div class="card"><span>编码符号</span><b>' + block.symbols.length + '</b></div>' +
      '<div class="card"><span>解码符号</span><b>' + decoded.symbols.length + '</b></div>' +
      '<div class="card"><span>一致性</span><b class="' + (same ? 'ok' : 'warn') + '">' + (same ? '一致' : '不一致') + '</b></div>' +
      '</div>' +
      '<div id="decodeWrap"><div class="scroll"><table class="data"><thead><tr><th>编码符号</th><th>编码码字</th><th>解码符号</th><th>解码码字</th><th>值</th></tr></thead><tbody>' +
      rows + '</tbody></table></div></div>' +
      '<p class="note" id="decodeReadout"></p>' +
      '<p class="subcap" style="margin-top:10px">位流片段（浅色为本块消耗的位）</p>' +
      '<div class="bits" id="decodeBitStrip">' + snippet.split('').map(function (bit, index) {
        const used = index >= usedStart && index < usedEnd;
        return '<span class="' + (bit === '1' ? 'one' : 'zero') + (used ? ' used' : '') + '">' + bit + '</span>';
      }).join('') + '</div>';
  }

  function renderDequantStep() {
    const block = encodedBlock();
    const decoded = decodedBlock();
    stage.innerHTML = '<div class="grid-4">' +
      figure('dqOriginal', '原始 DCT 系数 F') +
      figure('dqQuantized', '量化系数 Fq') +
      figure('dqTable', '量化表 Q（颜色越暖步长越大）') +
      figure('dqRestored', '反量化 Fq×Q') +
      '</div>';
    let maximum = 1;
    for (let i = 0; i < 64; i++) maximum = Math.max(maximum, Math.abs(block.coefficients[i]), Math.abs(decoded.dequantized[i]));
    drawCells(setupCanvas('dqOriginal', 380, 380), block.coefficients, function (value) {
      return heatColor(value, maximum);
    }, { text: function (value) { return formatValue(value); }, gridColor: 'rgba(255,255,255,0.7)' });
    let quantizedMaximum = 1;
    for (let i = 0; i < 64; i++) quantizedMaximum = Math.max(quantizedMaximum, Math.abs(block.quantized[i]));
    drawCells(setupCanvas('dqQuantized', 380, 380), block.quantized, function (value) {
      return heatColor(value, quantizedMaximum);
    }, { zeroMark: true, text: function (value) { return value === 0 ? '' : String(value); }, gridColor: 'rgba(255,255,255,0.7)' });
    let quantMaximum = 1;
    for (let i = 0; i < 64; i++) quantMaximum = Math.max(quantMaximum, block.quant[i]);
    drawCells(setupCanvas('dqTable', 380, 380), block.quant, function (value) {
      return magnitudeColor(value, quantMaximum);
    }, { text: function (value) { return String(Math.round(value)); }, gridColor: 'rgba(255,255,255,0.7)' });
    drawCells(setupCanvas('dqRestored', 380, 380), decoded.dequantized, function (value) {
      return heatColor(value, maximum);
    }, { text: function (value) { return formatValue(value); }, gridColor: 'rgba(255,255,255,0.7)' });
  }

  /* 静态页与逐项动画共用同一误差量程，避免颜色含义在播放过程中漂移。 */
  function idctErrorMaximum(block, decoded) {
    let maximum = 1;
    for (let i = 0; i < 64; i++) {
      const restored = clamp(Math.round(decoded.pixels[i] + 128), 0, 255);
      maximum = Math.max(maximum, Math.abs(restored - (block.pixels[i] + 128)));
    }
    return maximum;
  }

  function renderIdctStep() {
    const block = encodedBlock();
    const decoded = decodedBlock();
    const original = new Float64Array(64);
    const reconstructed = new Float64Array(64);
    const error = new Float64Array(64);
    for (let i = 0; i < 64; i++) {
      original[i] = block.pixels[i] + 128;
      reconstructed[i] = clamp(Math.round(decoded.pixels[i] + 128), 0, 255);
      error[i] = reconstructed[i] - original[i];
    }
    const maximumError = idctErrorMaximum(block, decoded);
    stage.innerHTML = '<div class="grid-3">' +
      figure('idctOriginal', '原始像素块') +
      figure('idctRestored', 'IDCT 重建块') +
      figure('idctError', '像素误差（重建−原始）') +
      '</div><p class="note" id="idctReadout"></p><div style="margin-top:8px">' + statBlock([
        ['分量', state.component],
        ['块 MSE', mean(Array.from(error).map(function (v) { return v * v; })).toFixed(2)],
        ['块 PSNR', blockPsnr(original, reconstructed).toFixed(2) + ' dB'],
        ['最大误差', maximumError]
      ]) + '</div>';
    drawCells(setupCanvas('idctOriginal', 360, 360), original, grayColor, {
      text: function (value) { return String(Math.round(value)); }, gridColor: 'rgba(255,255,255,0.55)'
    });
    drawCells(setupCanvas('idctRestored', 360, 360), reconstructed, grayColor, {
      text: function (value) { return String(Math.round(value)); }, gridColor: 'rgba(255,255,255,0.55)'
    });
    drawCells(setupCanvas('idctError', 360, 360), error, function (value) {
      return heatColor(value, maximumError);
    }, {
      text: function (value) { return value === 0 ? '' : formatValue(value); }, gridColor: 'rgba(255,255,255,0.55)'
    });
  }

  function blockPsnr(original, reconstructed) {
    let squared = 0;
    for (let i = 0; i < 64; i++) {
      const difference = original[i] - reconstructed[i];
      squared += difference * difference;
    }
    const mse = squared / 64;
    return mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse);
  }

  function renderRecolorStep() {
    const stats = state.encoded.stats;
    stage.innerHTML = '<div class="grid-3">' +
      figure('finalOriginal', '原始 RGB') +
      figure('finalDecoded', '解码重建 RGB') +
      figure('finalError', '误差 ×10') +
      '</div><div style="margin-top:12px">' + metricCards([
        ['PSNR', state.psnr.toFixed(2) + ' dB', 'RGB 全通道'],
        ['压缩比', (state.width * state.height * 3 / stats.fileBytes).toFixed(1) + '×', '原始RGB / 完整文件字节'],
        ['总位数', stats.totalBits, 'bit'],
        ['采样格式', state.subsampling === '444' ? '4:4:4' : state.subsampling === '422' ? '4:2:2' : '4:2:0', '色度分辨率'],
        ['质量因子 QF', state.Q, '控制量化步长'],
        ['块效应', state.Q < 30 ? '低 QF 通常更明显' : state.Q < 70 ? '可能有轻微块效应' : '通常较弱', '主观观察']
      ]) + '</div>' + matlabReferenceHTML();
    drawRGBInto(setupCanvas('finalOriginal', 440, 440), state.rgb, state.width, state.height);
    drawRGBInto(setupCanvas('finalDecoded', 440, 440), state.decoded.rgb, state.width, state.height);
    drawRGBDifference(setupCanvas('finalError', 440, 440));
  }

  function subsamplingText(mode) {
    return mode === '444' ? '4:4:4' : mode === '422' ? '4:2:2' : '4:2:0';
  }

  /* MATLAB 实测对照：只在“1024 风景示例 + 页面像素与实验输入同一份”时出现。 */
  function matlabReferenceHTML() {
    const reference = window.COLOR_REFERENCE;
    if (!reference || !Array.isArray(reference.cases)) return '';
    if (state.width !== reference.width || state.height !== reference.height) return '';
    if (state.imageName.indexOf('风景示例') !== 0) return '';
    const stats = state.encoded.stats;
    const zeroFraction = stats.zeroCount / Math.max(1, stats.coefficientCount);
    const current = reference.cases.filter(function (item) {
      return item.subsampling === state.subsampling && item.quality === state.Q;
    })[0];
    let live;
    if (current) {
      const bitDifference = stats.totalBits - current.entropyBits;
      const psnrDifference = state.psnr - current.psnr;
      const fileDifference = stats.fileBytes - current.fileBytes;
      live = '<b>当前设置</b>（' + subsamplingText(state.subsampling) + ' · QF ' + state.Q + '）：' +
        '熵位 ' + stats.totalBits + ' / ' + current.entropyBits + '（差 ' + bitDifference + '）、' +
        '文件 ' + stats.fileBytes + ' / ' + current.fileBytes + ' B（差 ' + fileDifference + '）、' +
        'PSNR ' + state.psnr.toFixed(4) + ' / ' + current.psnr.toFixed(4) + ' dB（差 ' + Math.abs(psnrDifference).toFixed(4) + '）、' +
        '零系数 ' + (100 * zeroFraction).toFixed(2) + ' / ' + (100 * current.zeroFraction).toFixed(2) + '%';
    } else {
      live = '当前 QF ' + state.Q + ' 不在 MATLAB 采样档位（' + reference.qualities.join(' / ') +
        '）内，下表为已实测档位。';
    }
    const rows = reference.cases.map(function (item) {
      const hit = item.subsampling === state.subsampling && item.quality === state.Q;
      return '<tr class="' + (hit ? 'hit' : '') + '">' +
        '<td>' + subsamplingText(item.subsampling) + '</td>' +
        '<td>' + item.quality + '</td>' +
        '<td>' + item.entropyBits + '</td>' +
        '<td>' + item.fileBytes + '</td>' +
        '<td>' + (state.width * state.height * 3 / item.fileBytes).toFixed(1) + '×</td>' +
        '<td>' + item.psnr.toFixed(3) + '</td>' +
        '<td>' + (100 * item.zeroFraction).toFixed(2) + '</td></tr>';
    }).join('');
    return '<details class="matlab-ref">' +
      '<summary class="matlab-ref-head">MATLAB 实测对照<span>同一份 1024×1024 像素（无损 PNG 导出）、同一套量化表与 Huffman 表；着色行 = 当前设置（点此展开）</span></summary>' +
      '<p class="matlab-ref-live">' + live + '</p>' +
      '<div class="matlab-ref-scroll"><table><thead><tr><th>采样</th><th>QF</th><th>熵位</th>' +
      '<th>文件字节</th><th>压缩比</th><th>PSNR</th><th>零系数%</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' +
      '<p class="matlab-ref-foot">数据来源：src/run_color_experiment.m（' + reference.generatedBy + '，' +
      reference.generatedAt + '）；网页复算与 MATLAB 逐位相同，差值应为 0。</p>' +
      '</details>';
  }

  function drawRGBDifference(target) {
    const offscreen = document.createElement('canvas');
    offscreen.width = state.width;
    offscreen.height = state.height;
    const context = offscreen.getContext('2d');
    const imageData = context.createImageData(state.width, state.height);
    for (let i = 0; i < state.width * state.height; i++) {
      const difference = Math.abs(state.rgb[i * 4] - state.decoded.rgb[i * 4]) +
        Math.abs(state.rgb[i * 4 + 1] - state.decoded.rgb[i * 4 + 1]) +
        Math.abs(state.rgb[i * 4 + 2] - state.decoded.rgb[i * 4 + 2]);
      const value = clamp(Math.round(difference * 10 / 3), 0, 255);
      imageData.data[i * 4] = value;
      imageData.data[i * 4 + 1] = value;
      imageData.data[i * 4 + 2] = value;
      imageData.data[i * 4 + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);
    target.ctx.imageSmoothingEnabled = false;
    target.ctx.drawImage(offscreen, 0, 0, target.w, target.h);
  }

  let visualCache = null;

  function halfScale(plane, width, height, upsample, factor, nearest) {
    const step = factor || 2;
    const halfW = Math.ceil(width / step);
    const halfH = Math.ceil(height / step);
    const small = new Float32Array(halfW * halfH);
    for (let y = 0; y < halfH; y++) {
      for (let x = 0; x < halfW; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = 0; dy < step; dy++) {
          for (let dx = 0; dx < step; dx++) {
            const sx = Math.min(width - 1, x * step + dx);
            const sy = Math.min(height - 1, y * step + dy);
            sum += plane[sy * width + sx];
            count += 1;
          }
        }
        small[y * halfW + x] = sum / count;
      }
    }
    if (!upsample) return { plane: small, width: halfW, height: halfH };
    const full = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (nearest) {
          full[y * width + x] = small[
            Math.min(halfH - 1, Math.floor(y / step)) * halfW + Math.min(halfW - 1, Math.floor(x / step))
          ];
          continue;
        }
        const fx = x / step - 0.5;
        const fy = y / step - 0.5;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx0 = clamp(x0, 0, halfW - 1);
        const sx1 = clamp(x0 + 1, 0, halfW - 1);
        const sy0 = clamp(y0, 0, halfH - 1);
        const sy1 = clamp(y0 + 1, 0, halfH - 1);
        const top = small[sy0 * halfW + sx0] * (1 - tx) + small[sy0 * halfW + sx1] * tx;
        const bottom = small[sy1 * halfW + sx0] * (1 - tx) + small[sy1 * halfW + sx1] * tx;
        full[y * width + x] = top * (1 - ty) + bottom * ty;
      }
    }
    return { plane: full, width: width, height: height };
  }

  function frequencyFiltered(plane, width, height, keepLow, keepCount) {
    const out = new Float32Array(width * height);
    const block = new Float64Array(64);
    const kept = new Uint8Array(64);
    for (let k = 0; k < 64; k++) {
      const index = Codec.ZIG[k][0] * 8 + Codec.ZIG[k][1];
      kept[index] = (k < keepCount) === keepLow ? 1 : 0;
    }
    for (let by = 0; by < Math.ceil(height / 8); by++) {
      for (let bx = 0; bx < Math.ceil(width / 8); bx++) {
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            block[y * 8 + x] = plane[
              Math.min(height - 1, by * 8 + y) * width + Math.min(width - 1, bx * 8 + x)
            ];
          }
        }
        const coefficients = Codec.dct2(block);
        const filtered = new Float64Array(64);
        for (let i = 0; i < 64; i++) filtered[i] = kept[i] ? coefficients[i] : 0;
        const rebuilt = Codec.idct2(filtered);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            out[Math.min(height - 1, by * 8 + y) * width + Math.min(width - 1, bx * 8 + x)] = rebuilt[y * 8 + x];
          }
        }
      }
    }
    return out;
  }

  function buildVisualData() {
    const key = state.imageId + '|' + state.width + 'x' + state.height;
    if (visualCache && visualCache.key === key) return visualCache;
    const width = state.width;
    const height = state.height;
    const planes = Codec.rgbToYCbCr(state.rgb, width, height);
    const grayHalf = halfScale(planes.y, width, height, false);
    const onlyHigh = frequencyFiltered(grayHalf.plane, grayHalf.width, grayHalf.height, false, 10);
    for (let i = 0; i < onlyHigh.length; i++) onlyHigh[i] += 128;
    visualCache = {
      key: key,
      original: state.rgb,
      planes: planes,
      gray: grayHalf.plane,
      onlyLow: frequencyFiltered(grayHalf.plane, grayHalf.width, grayHalf.height, true, 10),
      onlyHigh: onlyHigh,
      grayWidth: grayHalf.width,
      grayHeight: grayHalf.height
    };
    return visualCache;
  }

  /* 原理 01：照视频的讲法——一张图分两路，同样 ±5% 自动来回跳，让人自己感受亮度 / 颜色谁更扎眼。 */
  let lumaDemoTimer = null;
  const LUMA_DEMO_DELTA = 5;
  const LUMA_DEMO_PERIOD = 900;

  function stopLumaDemo() {
    if (lumaDemoTimer) {
      clearInterval(lumaDemoTimer);
      lumaDemoTimer = null;
    }
  }

  function renderVisualLumaStep() {
    const data = buildVisualData();
    stopLumaDemo();
    stage.innerHTML =
      '<div class="hvs-block"><div class="hvs-head">① 亮度 / 颜色感知<span>上排是原图，下排只动一个通道，同步 ±5%</span>' +
      '<div class="hvs-sliders" style="margin-left:auto;margin-top:0">' +
      '<div class="hvs-auto-group"><b>亮度</b><output id="hvsBrightValue">+5%</output><span>自动来回跳</span></div>' +
      '<div class="hvs-auto-group"><b>饱和度</b><output id="hvsSatValue">+5%</output><span>自动来回跳</span></div>' +
      '<button class="stage-btn" id="hvsPause">暂停</button>' +
      '</div>' +
      '</div>' +
      '<div class="hvs-luma-pairs">' +
      '<div class="hvs-luma-pair">' +
      figure('hvsLumaOrigA', '原图（下面只动亮度）') +
      figure('hvsLumaY', '② 只动亮度 ±5%') +
      '</div>' +
      '<div class="hvs-luma-pair">' +
      figure('hvsLumaOrigB', '原图（下面只动饱和度）') +
      figure('hvsLumaColor', '③ 只动饱和度 ±5%') +
      '</div>' +
      '</div>' +
      '</div>';
    /* 两张原图与下面两张调整图用同一尺寸、同一比例，方便上下逐格对照 */
    const picW = 420;
    const picH = clamp(Math.round(picW * state.height / Math.max(1, state.width)), 230, 450);
    ['hvsLumaOrigA', 'hvsLumaOrigB', 'hvsLumaY', 'hvsLumaColor'].forEach(function (id) {
      const target = setupCanvas(id, picW, picH);
      if (!target) return;
      /* setupCanvas 在宽屏会把画布放大 2.2 倍铺满列；这里两行并排，固定成同一尺寸更整齐 */
      target.canvas.style.maxWidth = picW + 'px';
      drawRGBInto(target, data.original, state.width, state.height);
    });
    const brightValue = document.getElementById('hvsBrightValue');
    const satValue = document.getElementById('hvsSatValue');
    const pause = document.getElementById('hvsPause');
    const brightPicture = document.getElementById('hvsLumaY');
    const satPicture = document.getElementById('hvsLumaColor');
    if (brightValue && satValue && pause && brightPicture && satPicture) {
      // 两张图严格同步：同一时刻一起亮、一起暗，剩下的差别只能来自“看得见 / 看不见”。
      let raised = true;
      const paint = function () {
        const delta = raised ? LUMA_DEMO_DELTA : -LUMA_DEMO_DELTA;
        brightPicture.style.filter = 'brightness(' + (100 + delta) / 100 + ')';
        satPicture.style.filter = 'saturate(' + (100 + delta) / 100 + ')';
        const text = (delta > 0 ? '+' : '−') + Math.abs(delta) + '%';
        brightValue.textContent = text;
        satValue.textContent = text;
      };
      const tick = function () {
        raised = !raised;
        paint();
      };
      paint();
      lumaDemoTimer = setInterval(tick, LUMA_DEMO_PERIOD);
      pause.addEventListener('click', function () {
        if (lumaDemoTimer) {
          stopLumaDemo();
          pause.textContent = '继续';
        } else {
          lumaDemoTimer = setInterval(tick, LUMA_DEMO_PERIOD);
          pause.textContent = '暂停';
        }
      });
    }
  }

  /* 原理 02：照视频的讲法——棋盘格设问 → 你的照片删高频 → 亮度曲线落到“频率”。 */
  function renderVisualFreqStep() {
    const data = buildVisualData();
    stopZoomDemo();
    ZOOM_DEMO.progress = 0;
    ZOOM_DEMO.direction = 1;
    ZOOM_DEMO.hold = 0;
    stage.innerHTML = renderFrequencySolidHTML(data);
    paintFrequencySolid(data);
    const zoomCanvas = setupCanvas('hvsZoomCanvas', 400, 400);
    const play = document.getElementById('hvsZoomPlay');
    const info = document.getElementById('hvsZoomInfo');
    zoomUpdate = function () {
      const display = drawZoomDemo(zoomCanvas, data, ZOOM_DEMO.progress);
      const displayHeight = Math.round(display * state.height / Math.max(1, state.width));
      if (info) {
        info.textContent = '原图 ' + state.width + '×' + state.height + ' → 显示 ' +
          display + '×' + displayHeight + ' 像素 · ' + zoomDemoText(display);
      }
    };
    zoomUpdate();
    if (play) {
      play.addEventListener('click', function () {
        if (ZOOM_DEMO.playing) {
          stopZoomDemo();
          play.textContent = '继续缩小';
        } else {
          startZoomDemo(play);
        }
      });
      if (!ANIM.reduced) startZoomDemo(play);
    }
  }

  function drawCheckerInto(target, cell) {
    const context = target.ctx;
    context.clearRect(0, 0, target.w, target.h);
    for (let y = 0; y < target.h; y += cell) {
      for (let x = 0; x < target.w; x += cell) {
        const odd = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 1;
        context.fillStyle = odd ? '#111827' : '#f8fafc';
        context.fillRect(x, y, cell, cell);
      }
    }
  }

  /* 视频里那条“这行像素的亮度值”曲线：平缓处是低频，跳变处是高频。 */
  function drawRowLumaCurve(target, planes) {
    const context = target.ctx;
    const width = state.width;
    const height = state.height;
    const plane = planes.y;
    // 就取画面正中间那一行，观众可以直接和上面的图对上位置。
    const bestRow = Math.floor(height / 2);
    const left = 48;
    const right = target.w - 18;
    const top = 24;
    const bottom = target.h - 30;
    context.clearRect(0, 0, target.w, target.h);

    context.font = '10px Consolas, monospace';
    context.strokeStyle = 'rgba(148,163,184,0.45)';
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    [0, 64, 128, 192, 255].forEach(function (value) {
      const y = bottom - value / 255 * (bottom - top);
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
      context.fillStyle = '#94a3b8';
      context.textAlign = 'right';
      context.textBaseline = 'middle';
      context.fillText(String(value), left - 6, y);
    });
    context.setLineDash([]);

    const scaleX = (right - left) / Math.max(1, width - 1);
    for (let x = 1; x < width; x++) {
      const previous = plane[bestRow * width + x - 1];
      const current = plane[bestRow * width + x];
      const jump = Math.abs(current - previous);
      context.strokeStyle = jump >= 18 ? 'rgba(194,65,12,0.9)' : 'rgba(29,78,216,0.85)';
      context.lineWidth = jump >= 18 ? 1.8 : 1.2;
      context.beginPath();
      context.moveTo(left + (x - 1) * scaleX, bottom - previous / 255 * (bottom - top));
      context.lineTo(left + x * scaleX, bottom - current / 255 * (bottom - top));
      context.stroke();
    }

    context.fillStyle = '#334155';
    context.font = '600 11px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('第 ' + (bestRow + 1) + ' 行的亮度值（0–255）', left, 15);
    context.font = '10.5px "Microsoft YaHei", sans-serif';
    context.fillStyle = '#1d4ed8';
    context.fillText('蓝：走得平 → 低频', left + 240, 15);
    context.fillStyle = '#c2410c';
    context.fillText('橙：跳得急 → 高频', left + 400, 15);
    context.fillStyle = '#94a3b8';
    context.font = '10px Consolas, monospace';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText('像素位 0', left, bottom + 6);
    context.textAlign = 'right';
    context.fillText('像素位 ' + (width - 1), right, bottom + 6);
  }

  /* ------------------------------------------------------------------ */
  /* 原理 03 追加：把两块区域“立”起来看（z 轴 = 亮度）                     */
  /* ------------------------------------------------------------------ */

  const HFIELD_VIEW = { azimuth: 0.68, elevation: 0.58 };
  let hfieldRepaint = null;

  /* 在照片里自动挑两块：相邻像素差最小 = 最平缓（低频），最大 = 最细密（高频）。 */
  function pickFrequencyRegions(plane, width, height) {
    const small = downsamplePlaneBy2(plane, width, height);
    const span = Math.min(small.width, small.height);
    const win = Math.max(8, Math.round(span / 10));
    const step = Math.max(2, Math.round(win / 4));
    const scaleX = width / small.width;
    const scaleY = height / small.height;
    const records = [];
    for (let y = 0; y + win <= small.height; y += step) {
      for (let x = 0; x + win <= small.width; x += step) {
        const stats = regionStats(small.plane, small.width, x, y, win);
        // 死黑、过曝的白块虽然最平，但没有可看的层次，跳过
        if (stats.mean < 24 || stats.mean > 205) continue;
        records.push({ x: x, y: y, activity: stats.activity, mean: stats.mean, peak: stats.peak });
      }
    }
    if (!records.length) records.push({ x: 0, y: 0, activity: 0, mean: 128, peak: 0 });
    records.sort(function (a, b) { return a.activity - b.activity; });
    // 最平缓的 25% 里挑起伏最明显的一块：是“缓坡”，而不是一块死板
    const poolSize = Math.max(1, Math.round(records.length * 0.25));
    let calmest = records[0];
    for (let i = 0; i < poolSize; i++) {
      if (records[i].peak > calmest.peak) calmest = records[i];
    }
    let busiest = records[records.length - 1];
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i];
      const apart = record.x + win <= calmest.x || calmest.x + win <= record.x ||
        record.y + win <= calmest.y || calmest.y + win <= record.y;
      if (apart) { busiest = record; break; }
    }
    const toRegion = function (record) {
      const sizeX = Math.round(win * scaleX);
      const sizeY = Math.round(win * scaleY);
      const size = Math.max(8, Math.min(sizeX, sizeY));
      return {
        x: clamp(Math.round(record.x * scaleX), 0, Math.max(0, width - size)),
        y: clamp(Math.round(record.y * scaleY), 0, Math.max(0, height - size)),
        size: size,
        activity: record.activity,
        mean: record.mean
      };
    };
    return { low: toRegion(calmest), high: toRegion(busiest) };
  }

  function downsamplePlaneBy2(plane, width, height) {
    const halfWidth = Math.max(1, width >> 1);
    const halfHeight = Math.max(1, height >> 1);
    const output = new Float64Array(halfWidth * halfHeight);
    for (let y = 0; y < halfHeight; y++) {
      const rowA = Math.min(height - 1, y * 2) * width;
      const rowB = Math.min(height - 1, y * 2 + 1) * width;
      for (let x = 0; x < halfWidth; x++) {
        const left = Math.min(width - 1, x * 2);
        const right = Math.min(width - 1, x * 2 + 1);
        output[y * halfWidth + x] =
          (plane[rowA + left] + plane[rowA + right] + plane[rowB + left] + plane[rowB + right]) / 4;
      }
    }
    return { plane: output, width: halfWidth, height: halfHeight };
  }

  function regionStats(plane, width, x, y, size) {
    let sum = 0;
    let diff = 0;
    let count = 0;
    let minimum = 255;
    let maximum = 0;
    for (let row = 0; row < size; row++) {
      const base = (y + row) * width + x;
      let previous = plane[base];
      sum += previous;
      if (previous < minimum) minimum = previous;
      if (previous > maximum) maximum = previous;
      for (let col = 1; col < size; col++) {
        const value = plane[base + col];
        sum += value;
        if (value < minimum) minimum = value;
        if (value > maximum) maximum = value;
        diff += Math.abs(value - previous);
        previous = value;
        count++;
      }
      if (row > 0) {
        const above = (y + row - 1) * width + x;
        for (let col = 0; col < size; col++) {
          diff += Math.abs(plane[base + col] - plane[above + col]);
        }
        count += size;
      }
    }
    return {
      mean: sum / (size * size),
      activity: diff / Math.max(1, count),
      peak: maximum - minimum
    };
  }

  /* 把一块矩形区域重采样成 n×n 高度场，同时统计峰谷差与相邻差（“变化得多快”）。 */
  function sampleRegionField(plane, width, height, region, sampleSize) {
    const n = sampleSize;
    const values = new Float64Array(n * n);
    const span = Math.max(1, region.size - 1);
    for (let j = 0; j < n; j++) {
      const y = clamp(region.y + Math.round(j * span / (n - 1)), 0, height - 1);
      for (let i = 0; i < n; i++) {
        const x = clamp(region.x + Math.round(i * span / (n - 1)), 0, width - 1);
        values[j * n + i] = plane[y * width + x];
      }
    }
    return summarizeField(values, n);
  }

  function summarizeField(values, n) {
    let minimum = Infinity;
    let maximum = -Infinity;
    let sum = 0;
    let diff = 0;
    let count = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const value = values[j * n + i];
        if (value < minimum) minimum = value;
        if (value > maximum) maximum = value;
        sum += value;
        if (i > 0) { diff += Math.abs(value - values[j * n + i - 1]); count++; }
        if (j > 0) { diff += Math.abs(value - values[(j - 1) * n + i]); count++; }
      }
    }
    return {
      size: n,
      values: values,
      min: minimum,
      max: maximum,
      peak: maximum - minimum,
      mean: sum / (n * n),
      activity: diff / Math.max(1, count)
    };
  }

  function frequencySolidFields(data) {
    if (data.solidFields) return data.solidFields;
    const regions = pickFrequencyRegions(data.planes.y, state.width, state.height);
    data.solidFields = {
      regions: regions,
      photoLow: sampleRegionField(data.planes.y, state.width, state.height, regions.low, 41),
      photoHigh: sampleRegionField(data.planes.y, state.width, state.height, regions.high, 41)
    };
    return data.solidFields;
  }

  function renderFrequencySolidHTML(data) {
    const fields = frequencySolidFields(data);
    const regions = fields.regions;
    const boxSize = regions.low.size + '×' + regions.low.size;
    return '<div class="hvs-block" id="hvsSolidBlock">' +
      '<div class="hvs-head">立体看频率<span>z = 亮度 · 可拖动旋转</span>' +
      '<div class="hvs-pager">' +
      '<button type="button" data-freq-page="0" class="on">第 1 页 · 找区域</button>' +
      '<button type="button" data-freq-page="1">第 2 页 · 立体对比</button>' +
      '</div></div>' +
      '<div class="hvs-page" data-freq-view="0">' +
      '<div class="freq-region-row">' +
      '<div class="freq-pane">' +
      '<div class="freq-pane-head">① 找区域<span>自动挑出两块</span></div>' +
      figure('hvsRegionMap', '<span style="color:#1d4ed8">蓝框</span>平缓 · <span style="color:#c2410c">橙框</span>细密') +
      '</div>' +
      '<div class="freq-pane">' +
      '<div class="freq-pane-head">② 整体缩小<span>看谁先糊掉</span></div>' +
      figure('hvsZoomCanvas', '整幅等比缩小') +
      '</div>' +
      '</div>' +
      '<div class="freq-zoom-side">' +
      '<button class="stage-btn" id="hvsZoomPlay">暂停</button>' +
      '<p class="note" id="hvsZoomInfo">原图 ' + state.width + '×' + state.height +
      ' → 显示 388×388 像素 · 橙框密纹就是高频。</p>' +
      '<p class="note">山脊始终认得出。会自动放大回去，可随时暂停。</p>' +
      '</div>' +
      '</div>' +
      '<div class="hvs-page" data-freq-view="1" hidden>' +
      '<div class="freq-pairs">' +
      '<div class="freq-pair">' +
      figure('hvsCropLow', '蓝框裁剪 ' + boxSize + '<br><span class="ok">缓坡 · 相邻像素差 ' + fields.photoLow.activity.toFixed(1) + '</span>', 'hvs-crop') +
      figure('hvsSolidPhotoLow', '蓝框三维高度场（z = 亮度）<br><span class="ok">峰谷差 ' + Math.round(fields.photoLow.peak) + '（0–255）</span>', 'hvs-solid') +
      '</div>' +
      '<div class="freq-pair">' +
      figure('hvsCropHigh', '橙框裁剪 ' + boxSize + '<br><span class="warn">密锯齿 · 相邻像素差 ' + fields.photoHigh.activity.toFixed(1) + '</span>', 'hvs-crop') +
      figure('hvsSolidPhotoHigh', '橙框三维高度场（z = 亮度）<br><span class="warn">峰谷差 ' + Math.round(fields.photoHigh.peak) + '（0–255）</span>', 'hvs-solid') +
      '</div>' +
      '</div>' +
      '<div class="hvs-conclusion">同一把尺子（z 轴 0–255）：蓝框相邻像素差 ' +
      fields.photoLow.activity.toFixed(1) + '，是缓坡；橙框 ' + fields.photoHigh.activity.toFixed(1) +
      '，是密锯齿。人眼跟得上坡、跟不上锯齿——所以敢删高频</div>' +
      '<div class="hvs-hint">按住任意一幅拖动，所有三维视角一起旋转</div>' +
      '</div>' +
      '</div>';
  }

  /* 两页切换：只切显示，不重绘，滚动位置不跳 */
  function bindFrequencyPager() {
    const block = document.getElementById('hvsSolidBlock');
    if (!block) return;
    const buttons = block.querySelectorAll('.hvs-pager button');
    const pages = block.querySelectorAll('.hvs-page');
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function () {
        const page = button.getAttribute('data-freq-page');
        Array.prototype.forEach.call(buttons, function (item) {
          item.classList.toggle('on', item === button);
        });
        Array.prototype.forEach.call(pages, function (item) {
          item.hidden = item.getAttribute('data-freq-view') !== page;
        });
        if (page === '1') {
          stopZoomDemo();
          const play = document.getElementById('hvsZoomPlay');
          if (play) play.textContent = '继续缩小';
        }
        /* 第 2 页的画布在整页渲染时是 hidden（rect=0），一屏装下算法量不到它们，
           只留下满尺寸。切页后必须补算一次，否则四张图会突然放大到满尺寸、页面
           从一屏变成一屏半。窄屏下 fit 自身会直接返回，这里等同空操作。 */
        fitStageToViewport();
      });
    });
  }

  function paintFrequencySolid(data) {
    const fields = frequencySolidFields(data);
    hfieldRepaint = function () {
      drawHeightField3D(setupCanvas('hvsSolidPhotoLow', 400, 320), fields.photoLow);
      drawHeightField3D(setupCanvas('hvsSolidPhotoHigh', 400, 320), fields.photoHigh);
    };
    hfieldRepaint();
    const mapW = 400;
    drawRegionMapInto(setupCanvas('hvsRegionMap', mapW, mapW), state.rgb, data.planes.y, state.width, state.height, fields.regions);
    const low = fields.regions.low;
    const high = fields.regions.high;
    drawRGBCropInto(setupCanvas('hvsCropLow', 220, 220), state.rgb, state.width, state.height, low);
    drawRGBCropInto(setupCanvas('hvsCropHigh', 220, 220), state.rgb, state.width, state.height, high);
    ['hvsSolidPhotoLow', 'hvsSolidPhotoHigh']
      .forEach(function (id) { bindHeightFieldDrag(document.getElementById(id)); });
    bindFrequencyPager();
  }

  /* 整体缩小演示：整幅图等比例缩小再放大回去，画面中心与内容都不动。 */
  /* 缩到满画幅的 26%：既看得出“画面在缩小”，又还认得清山脊与天空 */
  const ZOOM_SHRINK = 0.74;
  let zoomTimer = null;
  let zoomUpdate = null;
  let zoomSource = { key: '', canvas: null };
  const ZOOM_DEMO = { playing: false, progress: 0, direction: 1, hold: 0, last: 0 };

  function stopZoomDemo() {
    if (zoomTimer) {
      clearInterval(zoomTimer);
      zoomTimer = null;
    }
    ZOOM_DEMO.playing = false;
  }

  function zoomSourceCanvas() {
    const key = state.imageId + '|' + state.width + 'x' + state.height;
    if (zoomSource.key === key && zoomSource.canvas) return zoomSource.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = state.width;
    canvas.height = state.height;
    const context = canvas.getContext('2d');
    const imageData = context.createImageData(state.width, state.height);
    imageData.data.set(state.rgb.subarray(0, state.width * state.height * 4));
    context.putImageData(imageData, 0, 0);
    zoomSource = { key: key, canvas: canvas };
    return canvas;
  }

  function zoomDemoText(display) {
    if (display >= 240) return '整幅清晰：橙框密纹就是高频。';
    if (display >= 130) return '缩小中：细纹先糊。';
    return '已经很小：只剩山脊与天空。';
  }

  function drawZoomDemo(target, data, progress) {
    if (!target) return 0;
    const regions = frequencySolidFields(data).regions;
    const t = ANIM.ease.easeInOutSine(clamp(progress, 0, 1));
    const aspect = state.height / Math.max(1, state.width);

    /* 只做画面尺寸缩放：整幅等比缩小再放大回满画幅，不重采样、不加任何额外效果 */
    const scale = 1 - ZOOM_SHRINK * t;

    const context = target.ctx;
    context.clearRect(0, 0, target.w, target.h);
    const pad = 6;
    const fullWidth = Math.min(target.w - pad * 2, (target.h - pad * 2) / Math.max(1e-6, aspect));
    const drawWidth = fullWidth * scale;
    const drawHeight = drawWidth * aspect;
    const offsetX = (target.w - drawWidth) / 2;
    const offsetY = (target.h - drawHeight) / 2;
    context.imageSmoothingEnabled = true;
    context.drawImage(zoomSourceCanvas(), offsetX, offsetY, drawWidth, drawHeight);

    const scaleX = drawWidth / Math.max(1, state.width);
    [['low', '#1d4ed8'], ['high', '#c2410c']].forEach(function (entry) {
      const box = regions[entry[0]];
      context.save();
      context.strokeStyle = entry[1];
      context.lineWidth = 1.5;
      context.strokeRect(offsetX + box.x * scaleX, offsetY + box.y * scaleX,
        Math.max(1.5, box.size * scaleX), Math.max(1.5, box.size * scaleX));
      context.restore();
    });
    return Math.round(drawWidth);
  }

  function startZoomDemo(button) {
    ZOOM_DEMO.playing = true;
    ZOOM_DEMO.last = Date.now();
    if (button) button.textContent = '暂停';
    const tick = function () {
      if (!ZOOM_DEMO.playing) return;
      const now = Date.now();
      const delta = Math.min(50, now - ZOOM_DEMO.last);
      ZOOM_DEMO.last = now;
      if (ZOOM_DEMO.hold > 0) {
        ZOOM_DEMO.hold -= delta;
      } else {
        ZOOM_DEMO.progress += ZOOM_DEMO.direction * delta / ANIM.duration('freqZoom');
        if (ZOOM_DEMO.progress >= 1) {
          ZOOM_DEMO.progress = 1;
          ZOOM_DEMO.direction = -1;
          ZOOM_DEMO.hold = 700;
        } else if (ZOOM_DEMO.progress <= 0) {
          ZOOM_DEMO.progress = 0;
          ZOOM_DEMO.direction = 1;
          ZOOM_DEMO.hold = 700;
        }
      }
      if (zoomUpdate) zoomUpdate();
    };
    zoomTimer = setInterval(tick, ANIM.interval('freqZoom', 120));
  }

  /* 等轴测投影 + 由远及近排序的画家算法，纯 2D 上下文画高度场。 */
  function drawHeightField3D(target, field) {
    if (!target || !field) return;
    const context = target.ctx;
    const width = target.w;
    const height = target.h;
    const azimuth = HFIELD_VIEW.azimuth;
    const elevation = HFIELD_VIEW.elevation;
    const cosAz = Math.cos(azimuth);
    const sinAz = Math.sin(azimuth);
    const sinEl = Math.sin(elevation);
    const cosEl = Math.cos(elevation);
    const scale = Math.min((width - 26) / 2.9, (height - 46) / 2.3);
    const centerX = width / 2;
    const centerY = height * 0.55;
    const zAmp = 0.56;
    const n = field.size;
    const last = Math.max(1, n - 1);

    context.clearRect(0, 0, width, height);

    function project(u, v, z) {
      const a = u * cosAz - v * sinAz;
      const b = u * sinAz + v * cosAz;
      return {
        x: centerX + a * scale,
        y: centerY + (b * sinEl - z * cosEl) * scale,
        depth: b
      };
    }

    /* 底面参考框：高度有参照物才看得出“立起来” */
    const baseZ = -zAmp;
    const corners = [
      project(-1, -1, baseZ), project(1, -1, baseZ), project(1, 1, baseZ), project(-1, 1, baseZ)
    ];
    context.save();
    context.strokeStyle = 'rgba(148,163,184,0.8)';
    context.lineWidth = 1;
    context.setLineDash([4, 3]);
    context.beginPath();
    context.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) context.lineTo(corners[i].x, corners[i].y);
    context.closePath();
    context.stroke();
    context.setLineDash([]);
    context.restore();

    const points = new Array(n * n);
    for (let j = 0; j < n; j++) {
      const v = j / last * 2 - 1;
      for (let i = 0; i < n; i++) {
        const u = i / last * 2 - 1;
        const z = clamp((field.values[j * n + i] - 128) / 128, -1, 1) * zAmp;
        points[j * n + i] = project(u, v, z);
      }
    }

    const quads = [];
    for (let j = 0; j < last; j++) {
      for (let i = 0; i < last; i++) {
        const p0 = points[j * n + i];
        const p1 = points[j * n + i + 1];
        const p2 = points[(j + 1) * n + i + 1];
        const p3 = points[(j + 1) * n + i];
        quads.push({
          i: i, j: j, p0: p0, p1: p1, p2: p2, p3: p3,
          depth: (p0.depth + p1.depth + p2.depth + p3.depth) / 4
        });
      }
    }
    quads.sort(function (p, q) { return p.depth - q.depth; });

    const lightX = -0.42;
    const lightY = -0.66;
    const lightZ = 0.62;
    const showGrid = scale * 2 / last >= 1.6;
    for (let index = 0; index < quads.length; index++) {
      const quad = quads[index];
      const i = quad.i;
      const j = quad.j;
      const h00 = field.values[j * n + i];
      const h10 = field.values[j * n + i + 1];
      const h01 = field.values[(j + 1) * n + i];
      const h11 = field.values[(j + 1) * n + i + 1];
      const slopeX = (h10 + h11 - h00 - h01) / 510 * 3;
      const slopeY = (h01 + h11 - h00 - h10) / 510 * 3;
      const normal = Math.sqrt(slopeX * slopeX + slopeY * slopeY + 1);
      const lambert = clamp((-slopeX * lightX - slopeY * lightY + lightZ) / normal, 0, 1);
      const luma = (h00 + h10 + h01 + h11) / 4;
      const tone = Math.round(clamp((34 + luma / 255 * 216) * (0.58 + 0.42 * lambert), 0, 255));
      context.beginPath();
      context.moveTo(quad.p0.x, quad.p0.y);
      context.lineTo(quad.p1.x, quad.p1.y);
      context.lineTo(quad.p2.x, quad.p2.y);
      context.lineTo(quad.p3.x, quad.p3.y);
      context.closePath();
      context.fillStyle = 'rgb(' + tone + ',' + (tone + 2) + ',' + Math.min(255, tone + 8) + ')';
      context.fill();
      if (showGrid) {
        context.strokeStyle = 'rgba(15,23,42,0.15)';
        context.lineWidth = 0.5;
        context.stroke();
      }
    }

    /* 高度标尺：固定在画布左侧，任何视角都不会被曲面挡住 */
    const rulerX = 11;
    const rulerTop = height * 0.30;
    const rulerBottom = height * 0.72;
    context.strokeStyle = 'rgba(100,116,139,0.75)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(rulerX, rulerBottom);
    context.lineTo(rulerX, rulerTop);
    context.stroke();
    context.beginPath();
    context.moveTo(rulerX, rulerTop);
    context.lineTo(rulerX - 3, rulerTop + 6);
    context.lineTo(rulerX + 3, rulerTop + 6);
    context.closePath();
    context.fillStyle = 'rgba(100,116,139,0.75)';
    context.fill();
    context.font = '9.5px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = '#94a3b8';
    context.fillText('亮', rulerX + 5, rulerTop + 2);
    context.fillText('暗', rulerX + 5, rulerBottom - 2);

    context.textBaseline = 'alphabetic';
    context.fillStyle = '#64748b';
    context.font = '600 10.5px "Microsoft YaHei", sans-serif';
    context.fillText('z = 亮度', 10, 18);
    context.font = '10px Consolas, monospace';
    context.fillStyle = '#94a3b8';
    context.fillText('峰谷差 ' + Math.round(field.peak) + ' / 255', 10, 32);
  }

  /* 从原图裁一块彩色区域，放大画到画布（不插值，保留像素颗粒，方便与 3D 高度场对照） */
  function drawRGBCropInto(target, rgb, width, height, region) {
    if (!target || !rgb) return;
    const context = target.ctx;
    const size = Math.max(1, Math.min(region.size, width, height));
    const startX = clamp(region.x, 0, Math.max(0, width - size));
    const startY = clamp(region.y, 0, Math.max(0, height - size));
    const offscreen = document.createElement('canvas');
    offscreen.width = size;
    offscreen.height = size;
    const offContext = offscreen.getContext('2d');
    const imageData = offContext.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const source = ((startY + y) * width + (startX + x)) * 4;
        const destination = (y * size + x) * 4;
        imageData.data[destination] = rgb[source];
        imageData.data[destination + 1] = rgb[source + 1];
        imageData.data[destination + 2] = rgb[source + 2];
        imageData.data[destination + 3] = 255;
      }
    }
    offContext.putImageData(imageData, 0, 0);
    context.clearRect(0, 0, target.w, target.h);
    context.imageSmoothingEnabled = false;
    context.drawImage(offscreen, 0, 0, target.w, target.h);
  }

  function drawRegionMapInto(target, rgb, plane, width, height, regions) {
    if (!target) return;
    const context = target.ctx;
    context.clearRect(0, 0, target.w, target.h);
    const scale = Math.min(target.w / width, target.h / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const offsetX = (target.w - drawWidth) / 2;
    const offsetY = (target.h - drawHeight) / 2;

    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const offContext = offscreen.getContext('2d');
    const imageData = offContext.createImageData(width, height);
    if (rgb && rgb.length >= width * height * 4) {
      imageData.data.set(rgb.subarray(0, width * height * 4));
    } else {
      for (let i = 0; i < width * height; i++) {
        const value = clamp(Math.round(plane[i]), 0, 255);
        imageData.data[i * 4] = value;
        imageData.data[i * 4 + 1] = value;
        imageData.data[i * 4 + 2] = value;
        imageData.data[i * 4 + 3] = 255;
      }
    }
    offContext.putImageData(imageData, 0, 0);
    context.fillStyle = '#0f172a';
    context.fillRect(0, 0, target.w, target.h);
    context.imageSmoothingEnabled = true;
    context.drawImage(offscreen, offsetX, offsetY, drawWidth, drawHeight);

    const marks = [[regions.low, '#1d4ed8', '低频'], [regions.high, '#c2410c', '高频']];
    context.lineWidth = 2.5;
    context.font = '600 11px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    marks.forEach(function (mark) {
      const region = mark[0];
      const x = offsetX + region.x * scale;
      const y = offsetY + region.y * scale;
      const size = region.size * scale;
      context.strokeStyle = mark[1];
      context.strokeRect(x + 1, y + 1, size - 2, size - 2);
      const labelWidth = context.measureText(mark[2]).width + 12;
      const labelY = y > 22 ? y - 19 : y + 4;
      context.fillStyle = 'rgba(255,255,255,0.92)';
      context.fillRect(x, labelY, labelWidth, 16);
      context.fillStyle = mark[1];
      context.fillText(mark[2], x + 6, labelY + 8);
    });
  }

  function bindHeightFieldDrag(canvas) {
    if (!canvas || canvas.dataset.hfieldBound === '1') return;
    canvas.dataset.hfieldBound = '1';
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';
    let drag = null;
    canvas.addEventListener('pointerdown', function (event) {
      drag = {
        x: event.clientX,
        y: event.clientY,
        azimuth: HFIELD_VIEW.azimuth,
        elevation: HFIELD_VIEW.elevation
      };
      try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* 不支持指针捕获时忽略 */ }
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', function (event) {
      if (!drag) return;
      HFIELD_VIEW.azimuth = drag.azimuth + (event.clientX - drag.x) * 0.011;
      HFIELD_VIEW.elevation = clamp(drag.elevation + (event.clientY - drag.y) * 0.007, 0.22, 1.3);
      if (hfieldRepaint) hfieldRepaint();
    });
    function release() {
      if (!drag) return;
      drag = null;
      canvas.style.cursor = 'grab';
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  const RENDERERS = [
    renderSourceStep, renderColorStep, renderSubsampleStep, renderBlockStep,
    renderDctStep, renderQuantStep, renderZigzagStep, renderRleStep,
    renderHuffmanStep, renderBitstreamStep, renderDecEntropyStep,
    renderDequantStep, renderIdctStep, renderRecolorStep,
    renderVisualLumaStep, renderVisualFreqStep
  ];

  /* ------------------------------------------------------------------ */
  /* 左侧说明                                                            */
  /* ------------------------------------------------------------------ */

  function renderLeft() {
    const entry = FLOW_ENTRIES[state.flowIndex] || { chapterShort: '' };
    const step = flowStep(state.flowIndex);
    document.getElementById('stepKicker').textContent = 'CHAPTER ' + chapterLabel(entry) + ' ' + entry.chapterShort + ' · ' + step.tag;
    document.getElementById('stepTitle').textContent = step.title;
    /* 只把“换了教学节点”这件事播报给读屏用户，动画过程中的重复刷新不再重复播报 */
    const status = document.getElementById('a11yStatus');
    if (status) {
      const message = '第 ' + chapterLabel(entry) + ' 章：' + step.title;
      if (status.textContent !== message) status.textContent = message;
    }
    document.getElementById('stepLead').textContent = step.lead;
    document.getElementById('stepPrinciple').innerHTML = step.principle;
    document.getElementById('stepFormula').textContent = step.formula;
    refreshStepParams();
    document.getElementById('stepTips').innerHTML = step.tips.map(function (tip) {
      return '<li>' + escapeHTML(tip) + '</li>';
    }).join('');
    const tools = document.getElementById('stepTools');
    tools.innerHTML = step.tools();
    Array.prototype.forEach.call(tools.querySelectorAll('button'), function (button) {
      button.addEventListener('click', function () {
        const action = button.getAttribute('data-action');
        if (action === 'prevBlock') moveBlock(-1);
        else if (action === 'nextBlock') moveBlock(1);
        else if (action === 'basis') startBasis();
        else if (action === 'zigzag') playZigzag();
        else if (action === 'quant') startQuantAnim();
        else if (action === 'rle') startRleAnim();
        else if (action === 'bitwrite') startBitWriteAnim();
        else if (action === 'assembly') startAssemblyAnim();
        else if (action === 'decode') startDecodeAnim();
        else if (action === 'idct') startIdctAnim();
        else if (action === 'tour') startBlockTour();
        else if (action === 'twopass') startDctTwoPass();
        else if (action === 'goto') gotoChapter(button.getAttribute('data-target'));
        else if (action === 'basissum') startBasisSum();
      });
    });
  }

  /* 只刷新左侧参数卡，动画过程中每几帧调一次，避免整页重绘 */
  function refreshStepParams() {
    const step = flowStep(state.flowIndex);
    const container = document.getElementById('stepParams');
    if (!container) return;
    container.innerHTML = step.params().map(function (row) {
      return '<div><span>' + escapeHTML(row[0]) + '</span><b>' + row[1] + '</b></div>';
    }).join('');
  }

  function moveBlock(delta) {
    stopVisualAnimations();
    const columns = Math.ceil(state.width / 8);
    let index = state.blockY * columns + state.blockX + delta;
    const total = columns * Math.ceil(state.height / 8);
    index = (index + total) % total;
    state.blockX = index % columns;
    state.blockY = Math.floor(index / columns);
    state.hoverBlock = null;
    state.selectedCoeff = -1;
    state.dctUseCount = 8;
    state.dctSumStep = 64;
    state.quantFocus = -1;
    state.quantStep = 64;
    state.basis = null;
    if (state.step === 0) {
      refreshSourceCanvas();
      renderLeft();
    } else {
      render();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 步骤导航                                                            */
  /* ------------------------------------------------------------------ */

  /* 步进条只在首次渲染时建 DOM，之后仅同步选中态：
     省掉每次切步的 N 次节点重建与 N 个监听，同时让被点按钮保住键盘焦点。 */
  let stepperBuilt = false;

  function renderStepper() {
    const container = document.getElementById('stepper');
    if (!container) return;
    if (!stepperBuilt) {
      container.innerHTML = FLOW_ENTRIES.map(function (entry, index) {
        const step = flowStep(index);
        return '<button type="button" data-index="' + index + '"><span class="n">' +
          chapterLabel(entry) + '</span>' + step.short + '</button>';
      }).join('');
      /* 事件委托：一次监听覆盖全部按钮，新增节点无需重新绑定 */
      container.addEventListener('click', function (event) {
        const button = event.target.closest ? event.target.closest('button[data-index]') : null;
        if (!button) return;
        setStep(Number(button.getAttribute('data-index')));
      });
      stepperBuilt = true;
    }
    syncStepperActive(container);
  }

  /* 选中态与 aria-current 的单一同步点 */
  function syncStepperActive(container) {
    Array.prototype.forEach.call(container.children, function (button) {
      const active = Number(button.getAttribute('data-index')) === state.flowIndex;
      button.classList.toggle('on', active);
      if (active) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
  }

  /* DCT 拆成 5 张演示页，每页共用 STEPS[4]，靠子步骤决定画哪一版 */
  const DCT_VIEWS = ['shift', 'oneD', 'twopass', 'coeff', 'rebuild'];

  /* 当前教学节点对应的 DCT 子页；非 DCT 章节沿用系数页 */
  function currentDctView() {
    const entry = FLOW_ENTRIES[state.flowIndex];
    if (!entry || entry.chapter !== 'dct') return 'coeff';
    return DCT_VIEWS[clamp(entry.subIndex, 0, DCT_VIEWS.length - 1)];
  }

  function dctRowLabel(row) {
    return '第 ' + (row + 1) + ' 行';
  }

  function gotoChapter(target) {
    const parts = String(target).split(':');
    const chapter = parts[0];
    const sub = parts.length > 1 ? Number(parts[1]) : 0;
    for (let i = 0; i < FLOW_ENTRIES.length; i++) {
      const entry = FLOW_ENTRIES[i];
      if (entry.chapter === chapter && (entry.subIndex || 0) === sub) { setStep(i); return; }
    }
  }

  function setStep(index) {
    state.flowIndex = clamp(index, 0, FLOW_ENTRIES.length - 1);
    const entry = FLOW_ENTRIES[state.flowIndex];
    state.step = entry.step;
    state.selectedCoeff = -1;
    state.dctView = currentDctView();
    state.dctRow = -1;
    state.dctUseCount = 8;
    state.dctRowStep = 8;
    state.dctColStep = 8;
    state.dctPassStep = 16;
    state.dctSumStep = 64;
    state.quantStep = 64;
    state.quantFocus = -1;
    state.assemblyStep = state.encoded ? state.encoded.mcus.length : 0;
    stopVisualAnimations();
    render();
    if (mainScroll) mainScroll.scrollTop = 0;
    /* 行列分解页：进来就自动播一遍逐行 → 逐列的动图，之后循环 */
    if (entry.chapter === 'dct' && entry.subIndex === 2 && !ANIM.reduced) {
      state.dctPassHold = setTimeout(function () {
        state.dctPassHold = null;
        const current = FLOW_ENTRIES[state.flowIndex];
        if (current && current.chapter === 'dct' && current.subIndex === 2) startDctTwoPass();
      }, 600);
    }
  }

  function render(options) {
    /* 整页重绘：画布会重新创建/重建位图，压窄记录作废，统一从满尺寸重新算一遍 */
    canvasFitWidth.clear();
    renderStepper();
    renderLeft();
    RENDERERS[state.step]();
    fitStageToViewport();
    if (!options || options.animate !== false) {
      stage.classList.remove('enter');
      void stage.offsetWidth;
      stage.classList.add('enter');
    }
  }

  /* ------------------------------------------------------------------ */
  /* 一屏装下                                                            */
  /* ------------------------------------------------------------------ */

  /* 演示台的最小高度就是一屏可用高度；内容更高时按比例压低画布，直到装下。
     画布内部按固定像素绘制，缩小只是 CSS 尺寸变化，不会糊成马赛克。 */
  const STAGE_MIN_CANVAS = 170;

  function fitStageToViewport() {
    if (!stage) return;
    shrinkStageToViewport();
    /* 记下这次最终显示的宽度，之后点步进按钮只重画位图时沿用同一尺寸 */
    Array.prototype.forEach.call(stage.querySelectorAll('canvas'), function (canvas) {
      const width = canvas.getBoundingClientRect().width;
      if (canvas.id && isFinite(width) && width > 0) canvasFitWidth.set(canvas.id, Math.round(width));
    });
  }

  function shrinkStageToViewport() {
    if (!stage) return;
    /* 窄屏本来就是上下滚动的单手布局，强行压到一屏只会把画布缩成邮票 */
    if ((window.innerWidth || document.documentElement.clientWidth || 1200) < 900) return;
    /* 上下两排对比图本来就要占两行高度，强行压到一屏会把四张图缩成邮票 */
    if (stage.querySelector('.hvs-luma-pairs')) return;
    const minHeight = parseFloat(getComputedStyle(stage).minHeight);
    if (!isFinite(minHeight) || minHeight <= 0) return;
    stage.classList.remove('compact');
    const canvases = Array.prototype.slice.call(stage.querySelectorAll('canvas')).map(function (canvas) {
      const rect = canvas.getBoundingClientRect();
      const ratio = rect.height > 0 ? rect.width / rect.height : 1;
      /* 折线/条形这类“图表”画布内部写满了小字，缩太狠会看不清，留更高下限 */
      const chart = ratio > 1.5;
      return {
        canvas: canvas,
        width: rect.width,
        height: rect.height,
        floor: chart ? Math.max(STAGE_MIN_CANVAS * 2.6, Math.round(rect.width * 0.45)) : STAGE_MIN_CANVAS
      };
    });
    const shrink = function (passes) {
      let guard = 0;
      while (stage.scrollHeight > minHeight + 2 && guard < passes) {
        let changed = false;
        canvases.forEach(function (item) {
          /* 必须逐轮实测：写入的 max-width 会被容器宽度反向约束（渲染宽度常常小于
             刚写入的值），用缓存值推算会让 14 档收紧的结果偏大几个百分点。 */
          const width = item.canvas.getBoundingClientRect().width;
          if (!isFinite(width) || width <= item.floor) return;
          /* 又宽又扁的条带（位流、游程条）占的高度很少，缩了只会更难读，跳过 */
          if (item.height > 0 && item.height < 120) return;
          const next = Math.max(item.floor, Math.round(width * 0.92));
          if (next >= Math.round(width)) return;
          item.canvas.style.maxWidth = next + 'px';
          changed = true;
        });
        if (!changed) break;
        guard += 1;
      }
    };
    shrink(canvases.length ? 14 : 0);
    if (stage.scrollHeight > minHeight + 2) {
      /* 画布已经到下限还装不下：收紧字号与留白再试一次 */
      stage.classList.add('compact');
      shrink(6);
    }
    if (stage.scrollHeight > minHeight + 2) {
      /* 还是差一点：把图表的保护下限再放宽一档，宁可字小一点也要整屏放下 */
      canvases.forEach(function (item) {
        item.floor = Math.max(STAGE_MIN_CANVAS, Math.round(item.floor * 0.72));
      });
      shrink(8);
    }
    if (stage.scrollHeight > minHeight + 2) {
      /* 最后一档：取消所有保护，只保证不出现滚动条 */
      canvases.forEach(function (item) {
        item.floor = STAGE_MIN_CANVAS;
        item.height = 0;
      });
      shrink(8);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 视口变化：换显示器 / 全屏 / 投影 / 旋转屏幕都要重新排版              */
  /* ------------------------------------------------------------------ */

  let lastViewport = null;
  let resizeTimer = null;

  function handleViewportChange() {
    if (resizeTimer) clearTimeout(resizeTimer);
    /* 防抖：拖动窗口时只在停下来后重排一次，避免每帧重建画布 */
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      const width = window.innerWidth || document.documentElement.clientWidth || 1200;
      const height = window.innerHeight || document.documentElement.clientHeight || 800;
      const dpr = window.devicePixelRatio || 1;
      const key = width + 'x' + dpr.toFixed(2);
      /* 宽度或像素比变了必须重排；高度小幅变化（手机地址栏收起）忽略 */
      const heightJumped = !lastViewport || Math.abs(height - lastViewport.height) >= 160;
      const changed = !lastViewport || key !== lastViewport.key || heightJumped;
      lastViewport = { key: key, height: height };
      if (!changed) return;
      refreshViewportFlags();
      stopVisualAnimations();
      render({ animate: false });
    }, 220);
  }

  /* ------------------------------------------------------------------ */
  /* 动画                                                                */
  /* ------------------------------------------------------------------ */

  let zigzagTimer = null;
  function stopZigzag() {
    if (zigzagTimer) {
      clearInterval(zigzagTimer);
      zigzagTimer = null;
    }
  }

  function playZigzag() {
    stopZigzag();
    const total = 64;
    let tick = 0;
    state.zigStep = 0;
    if (state.step === 6) renderZigzagStep();
    zigzagTimer = setInterval(function () {
      tick += 1;
      state.zigStep = ANIM.progress('zigzag', tick, total);
      if (state.step === 6) refreshZigzag();
      if (tick >= total) stopZigzag();
    }, ANIM.interval('zigzag', total));
  }

  let basisFrame = null;
  let basisCleanupTimer = null;
  function startBasis() {
    if (state.step !== 4) return;
    stopVisualAnimations();
    /* 之前在别的 DCT 子页（例如快捷键 B）：必须按整页流程跳到一维页，
       否则新布局既不重算“一屏装下”（画布拿到满尺寸），步骤条与左侧说明也停在原页。 */
    if (state.dctView !== 'oneD') {
      gotoChapter('dct:1');
      if (state.step !== 4 || state.dctView !== 'oneD') return;
      stopVisualAnimations();
    }
    state.dctUseCount = 0;
    const basis = { active: true, step: 0, row: state.dctRow, start: performance.now() };
    state.basis = basis;
    const target = setupCanvas('dctRowBasis', 1240, 850);
    if (!target) { state.basis = null; return; }
    function frame(now) {
      if (state.basis !== basis) return;
      if (state.step !== 4) { state.basis = null; return; }
      const raw = Math.min(1, (now - basis.start) / ANIM.duration('basis'));
      const progressValue = ANIM.ease.easeInOutCubic(raw);
      basis.step = Math.min(8, Math.ceil(progressValue * 8));
      state.dctUseCount = basis.step;
      drawRowBasis(target);
      syncUseButtons(basis.step);
      refreshRowReadout();
      if (raw < 1) {
        basisFrame = requestAnimationFrame(frame);
      } else {
        basisCleanupTimer = setTimeout(function () {
          basisCleanupTimer = null;
          if (state.basis === basis) {
            state.basis = null;
            if (state.step === 4) renderDctOneD();
          }
        }, Math.round(900 * ANIM.scale));
      }
    }
    basisFrame = requestAnimationFrame(frame);
  }

  function startBasisSum() {
    if (state.step !== 4) return;
    stopVisualAnimations();
    /* 同 startBasis：换子页一律走整页渲染，尺寸与导航才会一致 */
    if (state.dctView !== 'rebuild') {
      gotoChapter('dct:4');
      if (state.step !== 4 || state.dctView !== 'rebuild') return;
      stopVisualAnimations();
    }
    state.dctSumStep = 0;
    drawDctRebuildViews();
    syncRebuildButtons();
    refreshStepParams();
    const total = 64;
    let tick = 0;
    state.dctSumTimer = setInterval(function () {
      tick += 1;
      state.dctSumStep = Math.min(total, Math.ceil(ANIM.progress('basissum', tick, total) * total));
      if (state.step === 4 && state.dctView === 'rebuild') {
        drawDctRebuildViews();
        syncRebuildButtons();
        if (tick % 4 === 0) refreshStepParams();
      }
      if (tick >= total) {
        state.dctSumStep = total;
        if (state.step === 4 && state.dctView === 'rebuild') {
          drawDctRebuildViews();
          syncRebuildButtons();
          refreshStepParams();
        }
        clearInterval(state.dctSumTimer);
        state.dctSumTimer = null;
      }
    }, ANIM.interval('basissum', total));
  }

  function stopVisualAnimations() {
    stopZigzag();
    stopLumaDemo();
    stopZoomDemo();
    ['quantTimer', 'rleTimer', 'bitTimer', 'decodeTimer', 'idctTimer', 'tourTimer', 'dctPassTimer', 'dctPassHold', 'dctSumTimer', 'assemblyTimer'].forEach(function (key) {
      if (state[key]) {
        clearInterval(state[key]);
        state[key] = null;
      }
    });
    if (basisFrame) {
      cancelAnimationFrame(basisFrame);
      basisFrame = null;
    }
    if (basisCleanupTimer) {
      clearTimeout(basisCleanupTimer);
      basisCleanupTimer = null;
    }
    state.basis = null;
  }

  function startDctTwoPass(startTick) {
    if (state.step !== 4) return;
    stopVisualAnimations();
    if (state.dctView !== 'twopass') {
      /* 这一页只有本页按钮会调到这里，导航本来就对；但重新布局必须走整页渲染，
         才能重算“一屏装下”。不用 gotoChapter：它会给 dct:2 再排一次自动播放，
         万一在状态不一致的时刻进来就会反复重排。 */
      state.dctView = 'twopass';
      render();
    }
    const from = clamp(Math.round(typeof startTick === 'number' ? startTick : 0), 0, 16);
    state.dctPassStep = from;
    state.dctRowStep = Math.min(8, from);
    state.dctColStep = clamp(from - 8, 0, 8);
    refreshDctTwoPass();
    syncTwoPassButtons();
    runDctTwoPassTicks(from);
  }

  /* 一轮 = 8 行 + 8 列；跑完后停 1.6 秒自动重播，形成持续的行列分解动图 */
  function runDctTwoPassTicks(startTick) {
    if (state.dctPassTimer) {
      clearInterval(state.dctPassTimer);
      state.dctPassTimer = null;
    }
    const total = 16;
    let tick = clamp(Math.round(typeof startTick === 'number' ? startTick : 0), 0, total);
    if (tick >= total) tick = 0;
    state.dctPassTimer = setInterval(function () {
      /* 严格每拍加一行/一列：不套 easing，否则会出现前面慢、中间跳两步的情况 */
      tick += 1;
      const done = Math.min(total, tick);
      state.dctPassStep = done;
      state.dctRowStep = Math.min(8, done);
      state.dctColStep = Math.min(8, Math.max(0, done - 8));
      refreshDctTwoPass();
      syncTwoPassButtons();
      if (tick >= total) {
        clearInterval(state.dctPassTimer);
        state.dctPassTimer = null;
        syncTwoPassButtons();
        if (state.step === 4 && state.dctView === 'twopass') {
          state.dctPassHold = setTimeout(function () {
            state.dctPassHold = null;
            if (state.step === 4 && state.dctView === 'twopass') startDctTwoPass();
          }, 1600);
        }
      }
    }, ANIM.interval('twopass', total));
  }

  /* 手动单步：t = 已处理的行数 + 列数（0–16），会自动暂停自动播放 */
  function applyTwoPassStep(target) {
    stopVisualAnimations();
    const t = clamp(Math.round(target), 0, 16);
    state.dctPassStep = t;
    state.dctRowStep = Math.min(8, t);
    state.dctColStep = clamp(t - 8, 0, 8);
    refreshDctTwoPass();
    syncTwoPassButtons();
    refreshStepParams();
  }

  function syncTwoPassButtons() {
    const play = document.getElementById('tpPlay');
    if (play) play.textContent = (state.dctPassTimer || state.dctPassHold) ? '暂停' : '播放';
    const prev = stage.querySelector('.dct-use-row button[data-tp="prev"]');
    const next = stage.querySelector('.dct-use-row button[data-tp="next"]');
    if (prev) prev.disabled = state.dctPassStep <= 0;
    if (next) next.disabled = state.dctPassStep >= 16;
  }

  function startQuantAnim() {
    if (state.step !== 5) return;
    if (state.quantTimer) clearInterval(state.quantTimer);
    state.quantStep = 0;
    state.quantFocus = -1;
    paintQuantStep();
    const total = 64;
    let tick = 0;
    state.quantTimer = setInterval(function () {
      tick += 1;
      state.quantStep = ANIM.progress('quant', tick, total);
      if (tick >= total) {
        state.quantStep = 64;
        state.quantFocus = 63;
      }
      paintQuantStep();
      if (tick >= total) {
        clearInterval(state.quantTimer);
        state.quantTimer = null;
      }
    }, ANIM.interval('quant', total));
  }

  function startRleAnim() {
    if (state.step !== 7) return;
    if (state.rleTimer) clearInterval(state.rleTimer);
    state.rleStep = 0;
    const rows = document.querySelectorAll('#rleWrap tbody tr');
    Array.prototype.forEach.call(rows, function (row) { row.classList.remove('active', 'done'); });
    updateRleReadout(rows);
    const total = Math.max(1, rows.length);
    let tick = 0;
    state.rleTimer = setInterval(function () {
      tick += 1;
      const next = ANIM.progress('rle', tick, total);
      if (next !== state.rleStep) {
        if (state.rleStep > 0 && rows[state.rleStep - 1]) {
          rows[state.rleStep - 1].classList.remove('active');
          rows[state.rleStep - 1].classList.add('done');
        }
        if (next < rows.length && rows[next]) {
          rows[next].classList.add('active');
          if (rows[next].scrollIntoView) rows[next].scrollIntoView({ block: 'nearest' });
        }
        state.rleStep = next;
        updateRleReadout(rows);
        refreshRleStrip();
      }
      if (tick >= total) {
        clearInterval(state.rleTimer);
        state.rleTimer = null;
      }
    }, ANIM.interval('rle', total));
  }

  function updateRleReadout(rows) {
    const readout = document.getElementById('rleReadout');
    if (!readout) return;
    const block = encodedBlock();
    if (state.rleStep <= 0) {
      readout.textContent = '开始扫描 64 个 Zigzag 系数，逐个生成 (run, size) 符号。';
      return;
    }
    const index = Math.min(state.rleStep, block.symbols.length);
    const symbol = block.symbols[index - 1];
    readout.textContent = '第 ' + index + '/' + block.symbols.length + ' 个符号：' +
      symbolLabel(symbol) + '，值 ' + (symbol.kind === 'AC' || symbol.kind === 'DC' ? symbol.value : '—') +
      '，码字 ' + symbol.code;
  }

  function startBitWriteAnim() {
    if (state.step !== 8) return;
    if (state.bitTimer) clearInterval(state.bitTimer);
    const block = encodedBlock();
    const bits = block.bits;
    state.bitWriteStep = 0;
    const box = document.getElementById('huffBits');
    const readout = document.getElementById('huffReadout');
    const currentBox = document.getElementById('huffCurrent');
    const byteBox = document.getElementById('huffBytes');
    function paint() {
      if (box) {
        box.innerHTML = colorBits(bits.slice(0, state.bitWriteStep)) +
          (state.bitWriteStep < bits.length ? '<span class="zero"> …</span>' : '');
      }
      let cumulative = 0;
      let current = null;
      let currentStart = 0;
      for (let i = 0; i < block.symbols.length; i++) {
        const symbol = block.symbols[i];
        const length = symbol.code.length + symbol.amplitude.length;
        if (state.bitWriteStep <= cumulative + length) {
          current = symbol;
          currentStart = cumulative;
          break;
        }
        cumulative += length;
      }
      if (currentBox) {
        if (current) {
          currentBox.innerHTML = '<b>' + symbolLabel(current) + '</b> 值 ' +
            (current.kind === 'AC' || current.kind === 'DC' ? current.value : '—') +
            '<br>码字 <code>' + current.code + '</code> + 幅值 <code>' + (current.amplitude || '—') +
            '</code><br>位区间 ' + currentStart + '–' + (currentStart + current.code.length + current.amplitude.length);
        } else {
          currentBox.textContent = '本块位流写入完成。';
        }
      }
      if (byteBox) {
        const bytes = [];
        for (let i = 0; i + 8 <= state.bitWriteStep; i += 8) {
          bytes.push(parseInt(bits.slice(i, i + 8), 2).toString(16).padStart(2, '0').toUpperCase());
        }
        byteBox.textContent = bytes.length ? bytes.join(' ') : '（等待凑满 8 bit）';
      }
      if (readout) {
        readout.textContent = '已写入 ' + state.bitWriteStep + ' / ' + bits.length + ' bit（' +
          (100 * state.bitWriteStep / bits.length).toFixed(1) + '%）';
      }
    }
    paint();
    const total = Math.max(1, Math.ceil(bits.length / 6));
    let tick = 0;
    state.bitTimer = setInterval(function () {
      tick += 1;
      const next = Math.min(bits.length, ANIM.progress('bitwrite', tick, total) * 6);
      if (next !== state.bitWriteStep) {
        state.bitWriteStep = next;
        paint();
      }
      if (tick >= total) {
        state.bitWriteStep = bits.length;
        paint();
        clearInterval(state.bitTimer);
        state.bitTimer = null;
      }
    }, ANIM.interval('bitwrite', total));
  }

  function startAssemblyAnim() {
    if (state.step !== 9) return;
    if (state.assemblyTimer) clearInterval(state.assemblyTimer);
    state.assemblyStep = 0;
    renderBitstreamStep();
    const total = state.encoded.mcus.length;
    const ticks = Math.max(1, Math.min(120, total));
    let tick = 0;
    state.assemblyTimer = setInterval(function () {
      tick += 1;
      const next = Math.round(ANIM.progress('assembly', tick, ticks) * total);
      if (next !== state.assemblyStep) {
        state.assemblyStep = next;
        const canvas = document.getElementById('bitAssembly');
        if (canvas) {
          drawBitAssembly({ canvas: canvas, ctx: canvas.getContext('2d'), w: 760, h: 240 }, state.assemblyStep);
        }
        refreshAssemblyReadout();
      }
      if (tick >= ticks) {
        state.assemblyStep = total;
        clearInterval(state.assemblyTimer);
        state.assemblyTimer = null;
      }
    }, ANIM.interval('assembly', ticks));
  }

  function startDecodeAnim() {
    if (state.step !== 10) return;
    if (state.decodeTimer) clearInterval(state.decodeTimer);
    state.decodeStep = 0;
    const rows = document.querySelectorAll('#decodeWrap tbody tr');
    Array.prototype.forEach.call(rows, function (row) { row.classList.remove('active', 'done'); });
    updateDecodeReadout(rows);
    refreshDecodeBits();
    const total = Math.max(1, rows.length);
    let tick = 0;
    state.decodeTimer = setInterval(function () {
      tick += 1;
      const next = ANIM.progress('decode', tick, total);
      if (next !== state.decodeStep) {
        if (state.decodeStep > 0 && rows[state.decodeStep - 1]) {
          rows[state.decodeStep - 1].classList.remove('active');
          rows[state.decodeStep - 1].classList.add('done');
        }
        if (next < rows.length && rows[next]) rows[next].classList.add('active');
        state.decodeStep = next;
        updateDecodeReadout(rows);
        refreshDecodeBits();
      }
      if (tick >= total) {
        clearInterval(state.decodeTimer);
        state.decodeTimer = null;
      }
    }, ANIM.interval('decode', total));
  }

  function updateDecodeReadout(rows) {
    const readout = document.getElementById('decodeReadout');
    if (!readout) return;
    const block = encodedBlock();
    let used = 0;
    for (let i = 0; i < state.decodeStep && i < block.symbols.length; i++) {
      used += block.symbols[i].code.length + block.symbols[i].amplitude.length;
    }
    if (state.decodeStep <= 0) {
      readout.textContent = '从位位置 ' + block.bitStart + ' 开始逐位解码。';
      return;
    }
    readout.textContent = '位位置 ' + (block.bitStart + used) + ' / ' + block.bitEnd +
      ' · 已解码 ' + Math.min(state.decodeStep, rows.length) + '/' + rows.length + ' 个符号';
  }

  function refreshDecodeBits() {
    const container = document.getElementById('decodeBitStrip');
    if (!container) return;
    const block = encodedBlock();
    const start = Math.max(0, block.bitStart - 8);
    const end = Math.min(state.encoded.bitstream.length, block.bitEnd + 8);
    const snippet = state.encoded.bitstream.slice(start, end);
    let used = 0;
    for (let i = 0; i < state.decodeStep && i < block.symbols.length; i++) {
      used += block.symbols[i].code.length + block.symbols[i].amplitude.length;
    }
    const blockStart = block.bitStart - start;
    const cursor = Math.max(0, Math.min(snippet.length, blockStart + used));
    let html = '';
    for (let i = 0; i < snippet.length; i++) {
      const bit = snippet[i];
      const isUsed = i >= blockStart && i < cursor;
      html += '<span class="' + (bit === '1' ? 'one' : 'zero') + (isUsed ? ' used' : '') + '">' + bit + '</span>';
      if (i === cursor - 1) html += '<span class="cursor">▮</span>';
    }
    if (cursor === 0) html = '<span class="cursor">▮</span>' + html;
    container.innerHTML = html;
  }

  function accumulatedPixels(decoded, order, step) {
    const sum = new Float64Array(64);
    for (let k = 0; k < step; k++) {
      const index = order[k];
      const u = Math.floor(index / 8);
      const v = index % 8;
      const coefficient = decoded.dequantized[index];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          sum[y * 8 + x] += coefficient * Codec.T[u][x] * Codec.T[v][y];
        }
      }
    }
    return sum;
  }

  function startIdctAnim() {
    if (state.step !== 12) return;
    if (state.idctTimer) clearInterval(state.idctTimer);
    const decoded = decodedBlock();
    state.idctOrder = Array.from({ length: 64 }, function (_, index) { return index; })
      .sort(function (a, b) { return Math.abs(decoded.dequantized[b]) - Math.abs(decoded.dequantized[a]); });
    state.idctStep = 0;
    refreshIdct();
    const total = 32;
    let tick = 0;
    state.idctTimer = setInterval(function () {
      tick += 1;
      const next = Math.min(64, Math.round(ANIM.progress('idct', tick, total) * 2));
      if (next !== state.idctStep) {
        state.idctStep = next;
        refreshIdct();
      }
      if (tick >= total) {
        state.idctStep = 64;
        refreshIdct();
        clearInterval(state.idctTimer);
        state.idctTimer = null;
      }
    }, ANIM.interval('idct', total));
  }

  function refreshIdct() {
    const block = encodedBlock();
    const decoded = decodedBlock();
    const restoredCanvas = document.getElementById('idctRestored');
    const errorCanvas = document.getElementById('idctError');
    const readout = document.getElementById('idctReadout');
    if (!restoredCanvas || !errorCanvas) return;
    const reconstructed = new Float64Array(64);
    if (state.idctStep >= 64) {
      for (let i = 0; i < 64; i++) reconstructed[i] = clamp(Math.round(decoded.pixels[i] + 128), 0, 255);
    } else {
      const sum = accumulatedPixels(decoded, state.idctOrder, state.idctStep);
      for (let i = 0; i < 64; i++) reconstructed[i] = clamp(Math.round(sum[i] + 128), 0, 255);
    }
    drawCells({ canvas: restoredCanvas, ctx: restoredCanvas.getContext('2d'), w: 260, h: 260 },
      reconstructed, grayColor, { text: function (value) { return String(Math.round(value)); }, gridColor: 'rgba(255,255,255,0.55)' });
    const error = new Float64Array(64);
    for (let i = 0; i < 64; i++) error[i] = reconstructed[i] - (block.pixels[i] + 128);
    const errorMaximum = idctErrorMaximum(block, decoded);
    drawCells({ canvas: errorCanvas, ctx: errorCanvas.getContext('2d'), w: 260, h: 260 },
      error, function (value) { return heatColor(value, errorMaximum); },
      { gridColor: 'rgba(255,255,255,0.55)' });
    if (readout) {
      readout.textContent = '已叠加 ' + state.idctStep + '/64 个基函数' +
        (state.idctStep >= 64 ? '，IDCT 完成。' : '。');
    }
  }

  function refreshSourceCanvas() {
    const canvas = document.getElementById('sourceCanvas');
    if (!canvas) return;
    const target = { canvas: canvas, ctx: canvas.getContext('2d'), w: SOURCE_CANVAS_WIDTH, h: SOURCE_CANVAS_HEIGHT };
    drawRGBInto(target, state.rgb, state.width, state.height);
    drawGridAndBlock(target, state.width, state.height);
    const preview = document.getElementById('blockPreview');
    if (preview) {
      drawRGBBlockPreview({ canvas: preview, ctx: preview.getContext('2d'), w: 240, h: 240 }, state.blockX, state.blockY);
      const head = document.getElementById('blockPreviewHead');
      if (head) head.innerHTML = '当前 8×8 块 <b>(' + state.blockX + ', ' + state.blockY + ')</b>';
    }
  }

  function startBlockTour() {
    if (state.step !== 0) return;
    if (state.tourTimer) clearInterval(state.tourTimer);
    const columns = Math.ceil(state.width / 8);
    const rows = Math.ceil(state.height / 8);
    const xs = [];
    const ys = [];
    const sampleCount = 20;
    for (let i = 0; i < sampleCount; i++) {
      xs.push(Math.round(i * (columns - 1) / (sampleCount - 1)));
      ys.push(Math.round(i * (rows - 1) / (sampleCount - 1)));
    }
    const positions = [];
    ys.forEach(function (y) {
      xs.forEach(function (x) { positions.push({ x: x, y: y }); });
    });
    const total = positions.length;
    let tick = 0;
    state.tourTimer = setInterval(function () {
      tick += 1;
      const index = Math.min(total - 1, Math.round(ANIM.progress('tour', tick, total) * (total - 1)));
      const position = positions[index];
      state.blockX = position.x;
      state.blockY = position.y;
      if (state.step === 0) refreshSourceCanvas();
      if (tick >= total) {
        clearInterval(state.tourTimer);
        state.tourTimer = null;
        state.hoverBlock = null;
        renderLeft();
      }
    }, ANIM.interval('tour', total));
  }

  /* ------------------------------------------------------------------ */
  /* 事件绑定                                                            */
  /* ------------------------------------------------------------------ */

  window.addEventListener('keydown', function (event) {
    if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT')) return;
    if (event.key === 'ArrowRight') { setStep(state.flowIndex + 1); event.preventDefault(); }
    else if (event.key === 'ArrowLeft') { setStep(state.flowIndex - 1); event.preventDefault(); }
    else if (event.key === 'ArrowUp') { state.Q = clamp(state.Q + 2, 1, 100); rebuild(); event.preventDefault(); }
    else if (event.key === 'ArrowDown') { state.Q = clamp(state.Q - 2, 1, 100); rebuild(); event.preventDefault(); }
    else if (event.key === 'z' || event.key === 'Z') playZigzag();
    else if (event.key === 'b' || event.key === 'B') startBasis();
  });

  /* ------------------------------------------------------------------ */
  /* 单一教学流程：编码优先顺序驱动原步骤界面                            */
  /* ------------------------------------------------------------------ */

  const FLOW_CHAPTERS = [
    { id: 'luma', short: '亮度与色度', title: '亮度与色度：人眼更依赖亮度', steps: [14] },
    { id: 'freq', short: '低频与高频', title: '低频与高频：人眼靠低频认物体', steps: [15] },
    { id: 'input', short: '输入解码', title: '输入：从 JPG 解码出 RGB', steps: [0] },
    { id: 'prep', short: '编码准备', title: '编码准备：YCbCr、色度采样与分块', steps: [1, 2, 3] },
    { id: 'dct', short: 'DCT', title: 'DCT：把 8×8 块换成 64 个余弦权重', steps: [4, 4, 4, 4, 4] },
    { id: 'quant', short: '量化', title: '量化：系数域中真正丢信息的一步', steps: [5] },
    { id: 'packResult', short: '码流与结果', title: 'Zigzag/Huffman 与熵编码输出', steps: [6, 7, 8, 9] },
    { id: 'decode', short: '解码原理', title: '解码：位流如何变回像素', steps: [10, 11, 12, 13] },
    { id: 'result', short: '二次压缩结果', title: '二次压缩结果', steps: [13] }
  ];

  FLOW_ENTRIES = FLOW_CHAPTERS.reduce(function (list, chapter, chapterIndex) {
    chapter.steps.forEach(function (step, subIndex) {
      list.push({
        chapter: chapter.id,
        chapterShort: chapter.short,
        chapterIndex: chapterIndex,
        chapterCount: chapter.steps.length,
        subIndex: subIndex,
        step: step
      });
    });
    return list;
  }, []);

  /* 章节号 + 子步骤号，例如 05.2；单步章节只显示 05 */
  function chapterLabel(entry) {
    if (!entry || typeof entry.chapterIndex !== 'number') return '';
    const base = String(entry.chapterIndex + 1).padStart(2, '0');
    return entry.chapterCount > 1 ? base + '.' + (entry.subIndex + 1) : base;
  }


  /* ------------------------------------------------------------------ */
  /* 初始化                                                              */
  /* ------------------------------------------------------------------ */

  function init() {
    buildSamples();
    lastViewport = {
      key: (window.innerWidth || 1200) + 'x' + (window.devicePixelRatio || 1).toFixed(2),
      height: window.innerHeight || 800
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    loadImage(sampleRGB(samples[0]), samples[0].name, samples[0].width, samples[0].height);
  }

  init();
})();
