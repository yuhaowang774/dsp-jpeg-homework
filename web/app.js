/*!
 * JPEG 编解码流程实验台 —— 交互与渲染逻辑
 *
 * 依赖（均为 window 上的全局对象，按 index.html 中的 defer 顺序加载）：
 *   window.DEMO_PHOTOS      样例照片像素（photos.js）
 *   window.DEMO_DATA        合成样例像素（demo_data.js）
 *   window.COLOR_REFERENCE  色彩参考数据（color_reference.js）
 *   window.MATLAB_RESULTS   MATLAB 批量实测数据（matlab_results.js）
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
      basis: { trigger: '步骤05 余弦叠加按钮', duration: 2800, easing: 'linear', transition: '一维余弦波逐项累加 + 残差回落（匀速，每 1/8 时长加一项）' },
      /* 64 项铺满 10.24 秒，一项一拍 160ms，匀速不跳格 */
      basissum: { trigger: '步骤05 逐项叠加重建按钮', duration: 10240, easing: 'linear', transition: '二维 64 项按 |F| 降序叠加 + 重建块逼近原块' },
      /* 64 项铺满 9.6 秒，一格一拍 150ms，走完一轮停一下再从头巡览 */
      coefftour: { trigger: '步骤05 逐项巡览按钮', duration: 9600, easing: 'linear', transition: '64 张基图按 (u,v) 顺序逐个高亮 + 三联图同步更换' },
      /* 16 拍（8 行 + 8 列）铺满 12.8 秒，一拍 800ms，够看清每行/每列的结果 */
      twopass: { trigger: '步骤05 行列分解按钮', duration: 12800, easing: 'linear', transition: '每拍一行/一列，匀速扫过' },
      quant: { trigger: '步骤06 量化按钮', duration: 2300, easing: 'steps', transition: '量化系数逐格替换' },
      /* QF 从 100 匀速走到 5：四宫格、三档对照与曲线标线同步变，40 拍铺满 3.2 秒 */
      qfsweep: { trigger: '步骤06 QF 扫掠按钮', duration: 3200, easing: 'easeInOutSine', transition: 'QF 100 → 5，量化步长变大、置零格增多' },
      /* 64 个系数铺满 6.4 秒，一拍 100ms；自动循环播放时能逐个看清填进右图的数 */
      zigzag: { trigger: '步骤07 Zigzag 按钮', duration: 6400, easing: 'steps', transition: '扫描游标 + 序列条带' },
      rle: { trigger: '步骤08 游程按钮', duration: 3200, easing: 'steps', transition: '符号表行高亮 + 条带游标' },
      bitwrite: { trigger: '步骤09 位流写入按钮', duration: 1400, easing: 'steps', transition: '位串增长 + 字节分组' },
      /* 这里的调用方要的是 0→1 的进度再乘 MCU 总数，所以用 linear；
         换成 steps 会返回「第几拍」的整数，乘上去直接溢出成 6 位数 */
      assembly: { trigger: '步骤10 拼接按钮', duration: 3600, easing: 'linear', transition: 'MCU 格点顺序点亮' },
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
    /* 真实初值在 FLOW_ENTRIES 建好后按第一节同步，这里只是占位 */
    step: 0,
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
    qfTimer: null,
    qfReturn: null,
    /* 上一次真正参与编码的 QF：拖动拉杆后编码结果可能落后于 state.Q，
       切页前用它判断要不要先补一次重编码 */
    encodedQuality: null,
    rleTimer: null,
    bitTimer: null,
    decodeTimer: null,
    idctTimer: null,
    tourTimer: null,
    zigTimer: null,
    zigHold: null,
    dctPassTimer: null,
    dctPassHold: null,
    dctBasisHold: null,
    dctSumHold: null,
    coeffTourTimer: null,
    coeffTourHold: null,
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

  /* 色差平面伪彩：128 = 中性灰，偏离越多越向本分量自己的强调色靠拢
     （Cb 橄榄绿、Cr 粉红）。灰底让「哪里有颜色」一眼可见，
     强调色只表示偏离幅度，不代表画面真实颜色。 */
  const CHROMA_NEUTRAL = [154, 154, 154];
  const CHROMA_ACCENT = {
    cb: [179, 176, 63],
    cr: [208, 114, 143]
  };
  const CHROMA_SPAN = 48;

  function chromaRampColor(value, tint) {
    const level = clamp(Math.abs(value - 128) / CHROMA_SPAN, 0, 1);
    return mixRGB(CHROMA_NEUTRAL, CHROMA_ACCENT[tint === 'cr' ? 'cr' : 'cb'], level);
  }

  function drawChromaInto(target, plane, width, height, tint) {
    const offscreen = offscreenTarget(width, height);
    const imageData = offscreen.imageData;
    for (let i = 0; i < width * height; i++) {
      const rgb = chromaRampColor(clamp(Math.round(plane[i]), 0, 255), tint);
      imageData.data[i * 4] = rgb[0];
      imageData.data[i * 4 + 1] = rgb[1];
      imageData.data[i * 4 + 2] = rgb[2];
      imageData.data[i * 4 + 3] = 255;
    }
    offscreen.ctx.putImageData(imageData, 0, 0);
    target.ctx.imageSmoothingEnabled = false;
    target.ctx.drawImage(offscreen.canvas, 0, 0, target.w, target.h);
  }

  /* 8×8 网格与采样示意图沿用同一条色带，全站「什么颜色 = 什么色差」只有一套口径 */
  function chromaColor(value, tint) {
    return chromaRampColor(clamp(Math.round(value), 0, 255), tint);
  }

  /* 一格 = 一个色度样本。options 让它同时能当“采样方法”的示意图：
     groupCols × groupRows 每隔几格画一条粗线（= 一个采样组），focus 高亮当前组，
     labels 在指定格里写数值（焦点组的样本值与取平均后的结果）。 */
  function drawSampleGrid(target, values, width, height, tint, options) {
    options = options || {};
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
    const groupCols = options.groupCols || 0;
    const groupRows = options.groupRows || 0;
    if (groupCols && groupRows) {
      /* 采样组的分界线：4:2:0 每 2 列 + 每 2 行，4:2:2 每 2 列 */
      context.save();
      context.strokeStyle = 'rgba(15,23,42,0.52)';
      context.lineWidth = 2;
      for (let i = 0; i <= width; i += groupCols) {
        context.beginPath(); context.moveTo(i * cellWidth, 0); context.lineTo(i * cellWidth, target.h); context.stroke();
      }
      for (let i = 0; i <= height; i += groupRows) {
        context.beginPath(); context.moveTo(0, i * cellHeight); context.lineTo(target.w, i * cellHeight); context.stroke();
      }
      context.restore();
    }
    if (options.focus && groupCols && groupRows) {
      const x = options.focus.x * groupCols * cellWidth;
      const y = options.focus.y * groupRows * cellHeight;
      context.save();
      context.strokeStyle = '#0f172a';
      context.lineWidth = 3;
      context.strokeRect(x + 1.5, y + 1.5, groupCols * cellWidth - 3, groupRows * cellHeight - 3);
      context.restore();
    }
    (options.labels || []).forEach(function (label) {
      const cellX = label.x * cellWidth;
      const cellY = label.y * cellHeight;
      const size = Math.max(9, Math.round(Math.min(cellWidth, cellHeight) * 0.48));
      context.font = '700 ' + size + 'px Consolas,"Cascadia Mono",monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      /* 格子里写不下（例如 4×4 里的 “114.5”）就按实测宽度收一档，别让它被画布边缘裁掉 */
      const limit = cellWidth * 0.86;
      const measured = context.measureText(label.text).width;
      if (measured > limit) {
        context.font = '700 ' + Math.max(8, Math.floor(size * limit / measured)) + 'px Consolas,"Cascadia Mono",monospace';
      }
      const value = values[label.y * width + label.x];
      context.fillStyle = textColor(chromaColor(value, tint));
      context.fillText(label.text, cellX + cellWidth / 2, cellY + cellHeight / 2 + 0.5);
    });
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

  /* rows = [标签, 数值, 可选 id]：给出 id 的项留在 DOM 里，拖动 QF 时可原地刷新 */
  function statBlock(rows) {
    return '<div class="stats">' + rows.map(function (row) {
      return '<div><span>' + escapeHTML(row[0]) + '</span><b' +
        (row[2] ? ' id="' + row[2] + '"' : '') + '>' + row[1] + '</b></div>';
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

  /* 只按当前 state.Q / 采样格式重新编码，不动演示台的播放状态。
     量化页拖 QF 拉杆时先在前端现算这一块，松手后靠它把整幅编码补齐。 */
  function encodeCurrent() {
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
    state.encodedQuality = state.Q;
    state.assemblyStep = state.encoded.mcus.length;
    const maxBlockX = Math.ceil(state.width / 8) - 1;
    const maxBlockY = Math.ceil(state.height / 8) - 1;
    state.blockX = clamp(state.blockX, 0, maxBlockX);
    state.blockY = clamp(state.blockY, 0, maxBlockY);
  }

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
      encodeCurrent();
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

  /* 整幅图的三个分量平面（1024×1024 = 104 万次转换，切页/换图才重算一次）。
     取整口径与 Codec.rgbToYCbCr 一致，和编码器内部用的是同一套公式。 */
  let fullPlanesCache = { key: '', planes: null };

  function fullImagePlanes() {
    const key = state.imageId + '|' + state.width + 'x' + state.height;
    if (fullPlanesCache.key === key && fullPlanesCache.planes) return fullPlanesCache.planes;
    const planes = Codec.rgbToYCbCr(state.rgb, state.width, state.height);
    fullPlanesCache = { key: key, planes: planes };
    return planes;
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
      id: 'source', short: '源图', tag: '输入 02',
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
      lead: '把 Cb/Cr 的采样点减半或减到 1/4，亮度 Y 一个都不动。',
      principle: '<p>4:2:0 在水平和垂直方向各减半，色度样本数降到 1/4；4:2:2 只水平减半；4:4:4 不变。人眼对色度不敏感，这一步几乎看不出差别，码率却明显下降。</p>' +
        '<p><b>具体做法：分组取平均。</b>4:2:0 把每 2×2 个像素的色度样本当成一组，组内 4 个数取平均变 1 个；4:2:2 只把水平相邻的 2 个平均，垂直方向不动。右图用粗框画出采样组，鼠标移到网格上就能看到组内 4 个样本怎么变成一个。</p>',
      formula: '4:2:0  每个 2×2 组 → 1 个样本\n  Cb′(i,j) = [ Cb(2i, 2j) + Cb(2i, 2j+1)\n              + Cb(2i+1, 2j) + Cb(2i+1, 2j+1) ] / 4\n4:2:2  每个 1×2 组 → 1 个样本（水平平均）\n  Cb′(i,j) = [ Cb(i, 2j) + Cb(i, 2j+1) ] / 2\n4:4:4  Cb′ = Cb，不降采样\n样本数：8×8 → 4×4（25%） / 4×8（50%） / 8×8（100%）',
      tips: ['粗框是一个采样组：4:2:0 把 2×2 的 4 个样本平均成 1 个', '只处理当前 8×8 块，Y 一个样本都不丢', '4:2:0 是码率与观感最常用的折中', '彩色边缘会最先变糊'],
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
        '<p><b>所以 DCT 本身无损。</b>真正的损失在下一步量化——那里才把系数取整、把小系数砍成 0。五个细节分别在后面五页展开：基函数 → 一维 → 行列分解 → 二维系数 → 叠加重建。</p>',
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
        return '<button class="primary" data-action="goto" data-target="dct:1">下一张：一行像素画在坐标系里</button>' +
          '<button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
      }
    },
    {
      id: 'quant', short: '量化', tag: '编码 05',
      title: '量化：系数域中的有损步骤',
      lead: '同一个 8×8 块，F 一个数都不改，只把质量因子 QF 从 100 拖到 1：步长变大 → 商变小 → 归零的格越来越多。',
      principle: '<p><b>一条四格流水线。</b>原始系数 F 除以这一格的量化步长 q，得到商 F/q，再四舍五入成整数 Fq。商落在 ±0.5 之内就归 0，这一格整格被丢掉。</p>' +
        '<p><b>量化表按人眼设计。</b>低频步长小、高频步长大，所以高频的 F/q 更容易落进 ±0.5 被清零——这条与第 02 章「人眼对高频不敏感」对上了。</p>' +
        '<p><b>QF 不改 F，只缩放量化表。</b>scale(QF) 在 QF &lt; 50 段取 5000/QF（双曲，越往小越陡），QF ≥ 50 段取 200−2QF（线性），所以 <b>QF = 50 是斜率换挡点</b>。同一格：q 变大 → 半个步长 q/2 变大 → 更多系数掉进 |F| &lt; q/2 的置零区。右侧拉杆与曲线就是把这条因果链一路走给观众看。</p>',
      formula: 'Fq(u,v) = round( F(u,v) / q(u,v) )\n' +
        'round(x)：x ≥ 0 时 ⌊x+0.5⌋，x < 0 时 ⌈x−0.5⌉\n' +
        '置零条件：|F ÷ q| < 0.5  ⇔  |F(u,v)| < q(u,v)/2\n' +
        'q(u,v) = round( Qbase(u,v) × scale(QF) / 100 )\n' +
        'QF<50  scale=5000/QF；QF≥50  scale=200−2QF',
      tips: ['拖动右侧拉杆或点三个参考档，四宫格与置零数会跟着重算', 'q 变大 → 半个步长 q/2 变大 → 更多格落进置零区', '曲线在 QF = 50 处换挡：左侧双曲、右侧线性', 'QF=100 也不保证逐像素无损，取整误差始终存在'],
      params: function () {
        const view = quantView();
        return [
          ['质量因子 QF', state.Q],
          ['q(u,v) 范围', view.minimum + '–' + view.maximum],
          ['置零系数', view.zeros + ' / 64'],
          ['零系数占比', (100 * view.zeros / 64).toFixed(1) + '%']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="quant">播放量化过程</button>' +
          '<button data-action="qfsweep">QF 扫掠 100 → 5</button>';
      }
    },
    {
      id: 'zigzag', short: 'Zigzag', tag: '编码 06',
      title: 'Zigzag 扫描',
      lead: '同一批 64 个数，左图按「在矩阵里的位置」摆，右图按「被扫描到的先后」摆——底色一一对应，只是换了个排法。',
      principle: '<p><b>为什么非要从对角线走。</b>DCT 之后能量集中在左上角，右下角大多是 0。按行读会把零打散；沿对角线往返走，零就被赶到了序列末尾，下一步游程编码才有「一长串连续 0」可压。</p>' +
        '<p><b>两张图怎么对照。</b>左图每格是系数原本的位置（行 u、列 v），大字是它的值，右下角的小灰字是它第几个被扫到；空白格表示 0。右图是扫描的出口：按扫描次序把数值一个个填进一维序列，第 1 行是第 1–8 个，第 2 行接着第 9–16 个，还没扫到的格子先空着，扫到哪一格才亮出哪一格的值，行优先读下来正好是 #1…#64；底色与左图同色，可以顺着颜色在两张图之间找到同一个系数。</p>' +
        '<p><b>扫描本身不压缩。</b>它只是把二维矩阵摊成一维，真正的压缩留给下一步。</p>',
      formula: '路径：从 (0,0) 起，沿对角线上下往返\n第 1 个 = (0,0)，第 2 个 = (0,1)，第 3 个 = (1,0) …\n一维序列 s[0..63]：序号 k ↔ 矩阵坐标 (u,v)',
      tips: ['左图看「在哪」：红 = 正值、蓝 = 负值、越深绝对值越大，空白格就是 0', '右图看「扫描的出口」：数值随扫描一格格填进来，行优先读下来即 #1…#64', '未扫到的格子会变淡，光标推进时亮起来的一串就是扫描路径', '右图右下方那一大片浅色 0，就是下一步游程编码的原料'],
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
      lead: '量化之后，一块 8×8 的 64 个数里常常有五十多个 0。游程编码不写这些 0，只写「跳过几个 0」加上「后面那个非零数」。',
      principle: '<p><b>问题从哪来。</b>Zigzag 把能量集中到前面，越往后越接近 0：一块 8×8 量化后常是「前几个数有值，后面一长串 0」。如果照原样写 64 个数，等于用大半篇幅反复记录同一个 0。</p>' +
        '<p><b>思路：把连续重复的东西折叠成计数。</b>一串 0 不必逐个写，写「4 个 0」就够了。但只写个数，解码端没法往下走——它不知道这串 0 什么时候结束、后面那个数是多少。所以 JPEG 把「前面有几个 0」和「后面那个非零数」绑成一个符号一起发。</p>' +
        '<p><b>一个 AC 符号 = (run, size) 加一段幅值位。</b>run 是这个非零数前面有几个 0（0–15）；size 是它需要几位二进制（数值类别）；幅值位就是它本身。例如 …, 0, 0, 0, −5, … 记成 (3, 3) 加幅值位 010：跳过 3 个 0，−5 用 3 位写出。</p>' +
        '<p><b>两种特殊情况。</b>连续 16 个 0 用一个固定符号 ZRL（0xF0）打包；后面全是 0 就写 EOB (0,0) 收尾，剩下的格子不必再写。<b>DC 不参与游程：</b>它是整块的平均亮度，与上一块高度相关，只存「差值」，通常只要 1–2 位。</p>' +
        '<p><b>省下来的到底是什么。</b>64 个数变成十几个符号——省的是 0 的重复；符号再交给下一步 Huffman 配短码——省的是常用符号的出现频率。两步各管一段，互不重复。</p>',
      formula: 'AC 符号 = (run, size) + size 位幅值\nrun = 这个非零数前面有几个 0（0–15）\nsize = floor(log2|v|) + 1\nZRL：固定符号 0xF0 = 16 个连续 0\nEOB：(0, 0) = 后面全是 0\nDC：diff = DC(k) − DC(k−1)',
      tips: ['run 数的是 0 的个数，不是第几个系数', 'size 决定后面还要跟几位幅值位', 'ZRL 打包 16 个 0，EOB 提前收尾', 'DC 存差值，不走游程'],
      params: function () {
        const block = encodedBlock();
        let zrl = 0;
        let eob = 0;
        block.symbols.forEach(function (symbol) {
          if (symbol.kind === 'ZRL') zrl += 1;
          if (symbol.kind === 'EOB') eob += 1;
        });
        return [
          ['当前 DC', block.scan[0]],
          ['DC 差分', block.difference],
          ['符号数', block.symbols.length + ' 个（原 64 个数）'],
          ['ZRL / EOB', zrl + ' / ' + eob]
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="rle">播放游程编码</button>';
      }
    },
    {
      id: 'huffman', short: 'Huffman', tag: '编码 09',
      title: '规范 Huffman 编码',
      lead: '常见的符号配短码，罕见的配长码；码长表由 JPEG 标准给定，不为当前图像重新统计。一个系数最终写出的是「Huffman 码 + 幅值位」两段拼起来的比特。',
      principle: '<p><b>和教科书 Huffman 的关键区别：不现场统计。</b>传统 Huffman 先统计这张图的符号频率，再反复合并建树，还得把树写进码流。JPEG 不这么做：它用 T.81 附录 K 给定的<b>码长表</b>——「长度为 1 的有几个、长度为 2 的有几个……」。这张表是标准制定时按大量自然图像统计出来的，任何图像、任何块都用同一张，所以编码前不需要统计当前图像，也不用传树。</p>' +
        '<p><b>码字怎么定。</b>解码端按「码长递增、同长按符号值递增」的规则，从码长表唯一地重建出同一棵树，因此编解码的码字完全一致。DC 与 AC 各一张表，本页用亮度表。演示台最上方并排贴出 T.81 附录 K 的 Table K.3 / K.5 原文截图，位流里的每个码字都能对照查到。页面上方「几个唯一码字 / 多少个符号」只是展示本块用了多少种符号、省了多少位，<b>不参与码字生成</b>。</p>' +
        '<p><b>一个符号写出多少位。</b>Huffman 码只编码「这是什么符号」；这个数具体多大，还要再看幅值位。比如 −5 记作 (0,3)，码字是 ' + bitChip('100') + '（3 位），幅值位是 ' + bitChip('010', 'amp') + '（3 位），写进流里就是 ' + bitChip('100010') + ' 共 6 位。所以块位数 = Σ码字长度 + Σ幅值位数。</p>' +
        '<p><b>位流那一条怎么读。</b>每一段就是一个符号：前段是 Huffman 码，后段（浅黄底）是幅值位。段越短，说明这类符号在标准表的统计里越常见——这正是变长编码压缩的来源。</p>',
      formula: '码长表：T.81 标准给定（不按当前图像统计）\n每个符号 → 码字 + 幅值位\nw = codeLen(symbol) + ampLen(value)\n块位数 = Σ w\n码字分配：码长递增，同长按符号值递增',
      tips: ['码长表来自 T.81 标准，不是从当前图像统计出来的', '文件头只写「每种长度几个」，不传整棵树', '码字与幅值位是两段，拼起来才是完整信息', '位流里每格 = 一个符号，前蓝后黄', '常用符号码字短，这就是变长编码省下的地方'],
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
      id: 'bitstream', short: '位流', tag: '编码 10',
      title: '熵编码输出',
      lead: '每块写完就是一段比特，按 MCU 顺序首尾相接，拼成文件里真正的熵编码数据。',
      principle: '<p><b>三级量级，从下往上数。</b>一个 8×8 块约几百 bit；一个 MCU（4:2:0 下含 4 个 Y 块 + 1 个 Cb + 1 个 Cr）是几十到几千 bit；整幅图就是全部 MCU 的累加。</p>' +
        '<p><b>这一页数的是哪一段。</b>只统计熵编码段（Huffman 码 + 幅值位）。真实 JPEG 还要在文件头写 SOI、DQT、SOF0、DHT、SOS 等标记段，那些不计入这里的位数。</p>' +
        '<p><b>三张图各看什么。</b>柱状图看哪个分量吃掉了最多比特；直方图看块与块之间的差异有多大（越宽说明画面里的块越不均匀）；最下面的方块图是空间分布，一格一个 MCU，颜色越深这块越费比特——通常就是纹理密的区域。</p>',
      formula: '总位数 = Σ 块位数\n字节数 = ceil(总位数 / 8)\n压缩比 = (W·H·24) / (8·字节数)　← 基准是 RGB 原始数据',
      tips: ['Y 分量通常占最多位数（人眼对亮度最敏感，量化最细）', '直方图越宽，说明画面里块的复杂度差别越大', '方块图上颜色深的区域 = 纹理密集、难压的地方', '压缩比只算熵编码段，实际文件还要加表与标记'],
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
      tools: function () { return ''; }
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
      id: 'recolor', short: '重建与二次压缩', tag: '解码 04',
      title: '色度上采样、逆颜色变换与二次压缩',
      lead: 'Cb/Cr 上采样回原尺寸，与 Y 合成 RGB 得到解码图像；展开下方「二次压缩」还能看再压一次的额外损失。',
      principle: '<p>Cb/Cr 先双线性插值回原尺寸，再按逆矩阵恢复 RGB。编码端的下采样前做过平均，相当于先低通再抽取，避免混叠。</p><p>色度损失只让彩色边缘略微发糊，亮度细节基本都在。误差图放大 10 倍，块效应与色度误差才看得清。</p><p><b>二次压缩。</b>把第一次重建出的 RGB 用同样 QF 与采样再编解码一遍，模拟“转存后再保存”。这里不再单独占一页：第一次重建就是上面第二张图，下面只补两张对照图与额外损失。</p>',
      formula: 'R = Y + 1.402(Cr−128)\nG = Y − 0.344136(Cb−128) − 0.714136(Cr−128)\nB = Y + 1.772(Cb−128)',
      tips: ['PSNR 以 RGB 全部通道计算', '色度误差在彩色边缘更明显', 'QF 与采样格式共同决定最终码率', '展开下方「二次压缩」看再压一次的额外损失（第一次重建就是上面第二张图）'],
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
      lead: '接着开篇的第 ① 条往下看：同样 ±5% 的幅度，一张只动亮度、一张只动饱和度——哪张更容易被看出来？',
      principle: '<p>两张图都是你的照片：一张只动<b>亮度</b>，颜色还在；一张只动<b>饱和度</b>，明暗还在，区别只在“动了哪个通道”。</p>' +
        '<p>视网膜上<b>视杆细胞</b>管明暗约 1.25 亿个，<b>视锥细胞</b>管颜色只有约 600 万个——这正是开篇第 ① 条说的“亮度敏感、颜色迟钝”。两张图同步按 <b>±5%</b> 跳动：亮度那张一眼就闪，饱和度那张几乎看不出来。这就是 JPEG 把 RGB 换成 <b>Y + Cb/Cr</b>、并只对色度下采样的理由。</p>',
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
    },
    /* 00 开篇：放在整个教学流最前面，先把全课的两条心理视觉原理立起来 */
    {
      id: 'opening', short: '开篇', tag: '总纲',
      title: 'JPEG 压缩：只省人眼看不清的那部分',
      lead: '整门课只讲两条心理视觉原理：人眼对亮度比颜色敏感，对低频轮廓比高频细节敏感。JPEG 的每一步，都是在把这两处“看不清”换成省下来的体积。',
      principle: '<p><b>JPEG 是有损压缩，但它只敢丢人眼分辨不出的东西。</b>下面两条心理视觉原理，就是后面所有步骤的依据。</p>' +
        '<p>① <b>亮度 / 颜色感知</b>：视网膜上管明暗的视杆细胞约 1.25 亿个，管颜色的视锥细胞只有约 600 万个。所以先把 RGB 换成 <b>Y + Cb/Cr</b>：亮度照原样留着，色度还能再下采样——文件小一截，肉眼几乎不觉得。</p>' +
        '<p>② <b>低 / 高频信号感知</b>：人靠低频轮廓认出“这是什么”，高频只决定“有多细”。所以 DCT 之后把 8×8 块的高频系数大量取整成 0——细纹与噪声被丢掉，轮廓与明暗还在。</p>' +
        '<p><b>两条合起来就是取舍：</b>亮度全留、颜色少留、低频多留、高频少留。接下来两节分别用 ±5% 的通道对比、以及整幅图缩小再放大来验证它们。</p>',
      formula: '① 亮度 / 颜色感知 → RGB 换成 Y + Cb/Cr，色度可下采样\n② 低 / 高频信号感知 → DCT 后高频系数可大量置零\nJPEG 有损，但丢掉的是人眼本来就分不出的部分',
      tips: ['先记住这两条，后面每一步都能挂上其中一条', '左卡：颜色全部扔掉，仍认得出是山', '右卡：高频细节全部抹掉，轮廓与明暗还在'],
      params: function () {
        return [
          ['示例图像', escapeHTML(state.imageName)],
          ['主线 01', '颜色可以少采'],
          ['主线 02', '高频可以多删'],
          ['本课结构', '两条原理 → 编码 → 解码']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="goto" data-target="luma">下一节：亮度 / 颜色感知</button>' +
          '<button data-action="goto" data-target="freq">跳到 02 低 / 高频</button>';
      }
    },
    /* 10 章：MATLAB 批量实测结果。四页只做绘图，不重算实验：
       页 1 读 web/color_reference.js（run_color_experiment.m 生成的自编频率加权 30 组），
       页 2–4 读 web/matlab_results.js（tools/export_matlab_results.py 从 results/*.csv 导出的 70 组），
       数值都能和 results/ 里的 CSV、纪要逐行对照。 */
    {
      id: 'matlabColor', short: '彩色实测', tag: '实测 01',
      title: 'MATLAB 实测：风景照片的彩色率失真',
      lead: '同一张 1024×1024 的风景照片，在 QF = 5…100 与 4:4:4 / 4:2:2 / 4:2:0 三种采样下各压一遍，共 30 组实测：体积与画质怎么换。',
      principle: '<p><b>为什么先看这一页。</b>网页的默认示例就是这张照片（同一份像素，由无损 PNG 导出），所以这里的每个点都能和页面上的编码结果对上：网页复算的熵位数、零系数占比、PSNR 与 MATLAB 完全相同，<code>tests/web/test_color_reference.js</code> 逐位断言过。</p>' +
        '<p><b>左图怎么读。</b>一条线是同一采样格式下 10 个 QF 的实测点，横轴是完整文件码率，纵轴是 PSNR。低码率端三条线几乎挤在一起——此时误差主要来自量化，色度降不降采样只差零点几 dB。</p>' +
        '<p><b>右图是色度降采样的价码。</b>纵轴是同 QF 下 4:2:2 / 4:2:0 的文件体积占 4:4:4 的百分比。<b>它不是一条水平线</b>：两端约 55–70%、中段约 71%，所以「4:2:0 省 30% 体积」只在特定 QF 成立，别当成常数。</p>' +
        '<p><b>高码率端的反转。</b>QF = 100 时 4:4:4 已接近无损，4:2:0 仍差十几 dB：这时主要误差不再是量化，而是被砍掉的色度细节。三种采样的亮度 PSNR 完全相同，差距全在 Cb/Cr。</p>',
      formula: 'bpp = 完整文件字节 × 8 / (1024 × 1024)\n体积占比 = 子采样文件字节 / 同 QF 的 4:4:4 文件字节\n亮度 PSNR 三种采样相同 → 差异只在色度通道',
      tips: ['左图三条线低码率端几乎重合，高码率端才拉开', '右图不是 70% 一条水平线，占比随 QF 变化', 'QF = 100 时 4:2:0 比 4:4:4 低十几 dB', '亮度 PSNR 三者相同，差别全在色度'],
      params: function () {
        const data = colorReferenceData();
        return [
          ['实测组数', data ? data.points.length + ' 组' : '未找到数据'],
          ['输入', data ? data.reference.width + '×' + data.reference.height + ' 风景照片（与页面默认示例同源）' : '—'],
          ['Q / 采样', '10 档 / 4:4:4、4:2:2、4:2:0'],
          ['生成时间', data && data.reference.generatedAt ? data.reference.generatedAt : '—']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="goto" data-target="matlab:1">下一节：70 组彩色率失真</button>' +
          '<button data-action="goto" data-target="decode:3">回 08.4 看逐位对照表与二次压缩</button>';
      }
    },
    {
      id: 'matlabRate', short: '彩色率失真', tag: '实测 02',
      title: 'MATLAB 实测：70 组彩色率失真曲线',
      lead: '同一张 1024×1024 风景照片 × 4:4:4 / 4:2:2 / 4:2:0 × 10 个 QF：自编频率加权 30 组、自编等步长 30 组，再加 imwrite 基线 10 组。',
      principle: '<p><b>数据从哪来。</b><code>run_project.m</code> 在 QF = 5…100 上跑三种量化策略，结果写进 <code>results/measurements.csv</code>，本页图表直接由这张表重绘（与 <code>results/figures/02_rate_distortion.png</code> 同一份数据，没有平滑或拟合）。</p>' +
        '<p><b>为什么分成三块面板。</b>三种采样的样本数不同（3N / 2N / 1.5N），把 4:2:0 的点混进 4:4:4 的坐标系会把「采样收益」算成「量化表收益」。同一条线只连同一采样、同一方法的 10 个实测点。</p>' +
        '<p><b>imwrite 只有一条。</b>MATLAB <code>imwrite</code> 不暴露采样因子，本轮从生成的 SOF0 段解析出它实际用 4:2:0，所以它只出现在 4:2:0 面板里，不伪造另外两条。<b>等步长表在 QF ≤ 10</b> 被 255 上限截断，这两档是同一个点，所以两条线在低码率端起点重合。</p>',
      formula: 'bpp = 完整文件字节 × 8 / (1024 × 1024)\n压缩比 = 原始RGB字节 / 完整文件字节\nPSNR = 10 · log10( 255² / MSE )\n连线仅辅助阅读，实测点之间未插值',
      tips: ['横轴比的是完整文件字节，不是零系数比例', '三种采样分开画：采样率不同不能混进同一坐标系', '同一个 QF 下三种策略的字节数不同，别把同 QF 当同码率', 'imwrite 只实测了 4:2:0，另两块面板没有它的线'],
      params: function () {
        const data = matlabData();
        return [
          ['实测组数', data ? data.rows.length + ' 组（60 自编 + 10 imwrite）' : '未找到数据'],
          ['输入 / QF', '1024×1024 风景照片 / 10 档'],
          ['采样 / 方法', '3 种 / 3 种（imwrite 仅 4:2:0）'],
          ['实验环境', data && data.environment ? data.environment : 'MATLAB R2024b']
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="goto" data-target="matlab:2">下一节：稀疏度与文件大小</button>' +
          '<button data-action="goto" data-target="matlab:0">上一节：彩色实测</button>';
      }
    },
    {
      id: 'matlabSparsity', short: '稀疏度与体积', tag: '实测 03',
      title: 'MATLAB 实测：稀疏度与文件大小',
      lead: '同一批实测换两个纵轴：左边看量化后零系数占多少，右边看真正写出的完整文件有多大。',
      principle: '<p><b>零系数比例只是中间量。</b>它统计的是量化之后有多少格变成 0，还没经过熵编码。真正决定文件大小的是剩下那些非零系数落在什么符号上、Huffman 给每个符号多长的码字。</p>' +
        '<p><b>同一张图、同一个 QF，三种采样的零系数比例几乎一样。</b>QF = 5 时 4:4:4 是 98.8%、4:2:0 是 98.4%，但完整文件压缩比分别是 73.8:1 与 132.9:1，差了近一倍。差别不在「有多少个零」，而在剩下的非零系数幅值、游程与符号分布。<b>不能用零系数比例代替压缩比</b>，这也是答辩时常被追问的一点。</p>',
      formula: '零系数比例 = count(量化后 = 0) / 全部系数\n压缩比 = 原始RGB字节 / JPEG 完整文件字节\n文件字节 = 熵编码字节 + 头与标记 + FF00 填充',
      tips: ['左轴的单位是百分比，右轴是压缩比（倍）', '零系数几乎相同，压缩比仍可差近一倍', '零系数多不等于文件小，要看非零系数的幅值与分布', 'QF 不是画质百分比：QF = 100 仍可能因取整而丢信息'],
      params: function () {
        const data = matlabData();
        return [
          ['统计对象', '自编频率加权（3 采样 × 10 档）'],
          ['左图纵轴', '零系数比例 / %'],
          ['右图纵轴', '压缩比 = 原始 / 文件'],
          ['实测点数', data ? (data.subsamplings.length * data.qualities.length) + ' 点' : '未找到数据']
        ];
      },
      tools: function () {
        return '<button data-action="goto" data-target="matlab:1">回上一节：彩色率失真</button>' +
          '<button class="primary" data-action="goto" data-target="matlab:3">下一节：等码率比较</button>';
      }
    },
    {
      id: 'matlabMatchedRate', short: '等码率比较', tag: '实测 04',
      title: 'MATLAB 实测：等码率下的量化策略比较',
      lead: '三种采样各自把两条实测曲线按同一目标 bpp 插值，再比 PSNR——这才是「同码率」的比较，共 12 个插值点。',
      principle: '<p><b>为什么必须换坐标系。</b>加权表与等步长表在同一个 QF 下量化步长不同，写出的字节数也不同。直接比同 QF 的 PSNR，等于让两种方法在不同码率上比赛。</p>' +
        '<p><b>怎么比。</b>按采样分别取两条实测曲线共同覆盖的 bpp 区间，各取 4 个目标码率做线性插值，得到同一码率下的两个 PSNR。<b>插值点不是实测点</b>，也没有外推，所以柱状图只说明趋势，不能当新数据引用。</p>' +
        '<p><b>结论按图说话。</b>这张图上三种采样、12 个点的 ΔPSNR 全为负（−1.44～−0.18 dB）：同一码率下等步长表的 PSNR 反而更高。本轮数据不支持「频率加权总是更好」，报告里也照实写了这一点。</p>',
      formula: 'ΔPSNR = PSNR(频率加权) − PSNR(等步长)\nΔ > 0：同等码率下加权画质更高\n仅在两条曲线的共同覆盖区间内线性插值',
      tips: ['Δ 为负表示等步长在该码率下更好', '柱高只表示插值差值，不是实测点', '三种采样共 12 个点，本轮全为负', '同一采样内 ①②③④ 是它自己的 4 个目标 bpp，跨采样不可平移比较'],
      params: function () {
        const data = matlabData();
        return [
          ['插值点数', data ? data.matchedRate.length + ' 个（3 采样 × 4 点）' : '未找到数据'],
          ['比较量', 'ΔPSNR = 加权 − 等步长'],
          ['插值方式', '按采样分别插值，不外推'],
          ['数据来源', 'results/matched_rate_comparison.csv']
        ];
      },
      tools: function () {
        return '<button data-action="goto" data-target="matlab:2">回上一节：稀疏度</button>';
      }
    },
    /* 整幅图的颜色空间转换：排在「源图像与 8×8 分块」之前，
       先把一张 RGB 原图换成 Y / Cb / Cr 三张同尺寸分量图，后面的分块、DCT、
       色度下采样才有明确的处理对象。步骤号 21，插在流程里而不动既有索引。 */
    {
      id: 'yccPlanes', short: '三分量', tag: '输入 01',
      title: 'RGB → YCbCr：整幅图的三张分量图',
      lead: '把整幅原图逐像素代入转换公式，一次得到三张同尺寸的分量图：一张 Y 亮度、两张色差 Cb 与 Cr。',
      principle: '<p><b>为什么不直接压 RGB。</b>RGB 三个通道里都混着亮度，人眼对亮度最敏感、对颜色的分辨率却不敏感。换成「亮度 Y + 色差 Cb/Cr」之后，亮度可以全保留、色差稍后降采样，画质几乎不变而数据量明显减少——JPEG 的压缩率有一半来自这一步。</p>' +
        '<p><b>三张图同尺寸、同像素数。</b>Y 就是灰度图（0 全黑、255 全白）；Cb、Cr 是以 128 为中性的色差，值越小越偏黄/偏青、越大越偏蓝/偏红。三张图各 8 bit，样本总数与 RGB 相同，所以这一步<b>无损</b>，只是换了一种表示。</p>' +
        '<p><b>为什么 Cb/Cr 是「灰底 + 彩色斑块」。</b>色差以 128 为中性，本页把 128 画成中性灰，偏离 128 越多越向该分量自己的强调色靠拢（Cb 橄榄绿、Cr 粉红）。所以灰 = 这里几乎是黑白，彩色斑块 = 这里有明显的色差；颜色只表示偏离幅度，不是画面真实颜色。</p>',
      formula: 'Y  =  0.299R + 0.587G + 0.114B\nCb = 128 − 0.168736R − 0.331264G + 0.500B\nCr = 128 + 0.500R − 0.418688G − 0.081312B\n\n逆变换：\nR = Y + 1.402(Cr − 128)\nG = Y − 0.344136(Cb − 128) − 0.714136(Cr − 128)\nB = Y + 1.772(Cb − 128)',
      tips: [
        'Y 通道看起来就是灰度图，轮廓与细节全在这里',
        'Cb 图里橄榄绿、Cr 图里粉红，都是“偏离 128”的地方',
        '灰底表示该处几乎无色差，颜色不代表画面真实颜色',
        '四张图边长一致，原图与三张分量可直接对照',
        '这一步可逆、不丢信息，下一张才开始降采样与量化'
      ],
      params: function () {
        const planes = fullImagePlanes();
        return [
          ['图像', escapeHTML(state.imageName)],
          ['分辨率', state.width + ' × ' + state.height],
          ['Y 均值 / 范围', mean(planes.y).toFixed(1) + ' / ' + rangeText(planes.y, 0)],
          ['Cb / Cr 均值', mean(planes.cb).toFixed(1) + ' / ' + mean(planes.cr).toFixed(1)]
        ];
      },
      tools: function () {
        return '<button class="primary" data-action="goto" data-target="input:1">下一张：8×8 分块</button>';
      }
    },
    /* 22：02 章的独立第 2 页，把原来藏在分页里的「立体对比」单独拿出来展示 */
    {
      id: 'freqSolid', short: '立体对比', tag: '原理 02',
      title: '立体看频率：低频缓坡，高频密锯齿',
      lead: '把亮度当高度立起来：同一把尺子（z 轴 0–255）下，平缓区是一整片缓坡，细密区是密锯齿。',
      principle: '<p><b>同一把尺子。</b>两幅三维高度场的 z 轴都取 0–255，所以可以直接比较起伏，而不是各画各的刻度。</p>' +
        '<p><b>低频是缓坡。</b>相邻像素亮度差小，立起来是大片平缓的山丘，人眼跟得上这种变化。高频是密锯齿：相邻像素差大，立起来满是尖刺，人眼本来就看不清这些细节。</p>' +
        '<p><b>所以 JPEG 敢删高频。</b>DCT 后高频系数幅值小，量化时先被置零；重建后只剩缓坡轮廓，画面还是认得出来。</p>',
      formula: '高度场：z = Y(x, y)，z ∈ [0, 255]\n相邻像素差小 → 低频缓坡（保留）\n相邻像素差大 → 高频密锯齿（可删）\n两块使用同一 z 轴量程，便于直接比较',
      tips: ['两幅图共用 z 轴 0–255，起伏可以直接比', '蓝框区域相邻像素差小，是缓坡', '橙框区域相邻像素差大，是密锯齿', '按住任意一幅拖动，两个三维视角一起转'],
      params: function () {
        const fields = frequencySolidFields(buildVisualData());
        return [
          ['蓝框相邻差', fields.photoLow.activity.toFixed(1)],
          ['橙框相邻差', fields.photoHigh.activity.toFixed(1)],
          ['蓝框峰谷差', Math.round(fields.photoLow.peak)],
          ['橙框峰谷差', Math.round(fields.photoHigh.peak)]
        ];
      },
      tools: function () { return '<button data-action="goto" data-target="freq:0">上一页：低频与高频</button>'; }
    },
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
          return '<button class="primary" data-action="goto" data-target="dct:1">下一张：一行像素画在坐标系里</button>' +
            '<button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
        }
      };
    },
    'dct:3': function () {
      return {
        short: 'DCT·一维',
        title: 'DCT ④：一行像素拆成 8 个余弦波',
        lead: '③ 页的 8 个余弦基就是 8 根轴；这一页把这一行的权重算出来，再一项一项加回去。',
        principle: '<p><b>接着前面两页。</b>② 页把这一行画成坐标系里的 8 个采样点，③ 页给出 8 个余弦基。现在把两者合起来：这 8 个数 = 8 个基各乘一个权重再相加。</p>' +
          '<p><b>为什么 8 个数一定拆得开？</b>8 点 DCT 的变换矩阵 T 是<b>正交矩阵</b>，它的 8 列就是 8 个余弦基 C(0)…C(7)：两两垂直（正交）、长度都归一。这 8 根轴合起来刚好撑满 8 维空间，构成一组<b>完备正交基</b>——就像平面上的 x、y 轴，只是搬到了 8 维。所以<b>任意 8 个采样点，都一定能写成这 8 个基的加权和，而且写法唯一</b>，一根轴都不用多、一根也不能少。</p>' +
          '<p><b>权重为什么好算？</b>两两垂直，投影互不干扰：某个基上的权重 = 这一行与它逐点相乘再求和（内积）。不用解 8 元方程组，8 个系数各算各的。</p>' +
          '<p><b>所以 DCT 本身不丢信息。</b>8 项全用残差为 0，像素原样回来；JPEG 省码率不是“表示不了”，而是主动把小权重丢掉（下一步量化）。右图演示的正是「一项一项加回来」的过程。</p>',
        formula: 'X(k) = Σn f(n)·C(k,n)       ← 内积 = 投影，直接得权重\nf(n) = Σk X(k)·C(k,n)       ← 8 项全用 = 原行\n正交：Σn C(i,n)·C(j,n) = 0（i ≠ j）\nT·Tᵀ = I → 完备正交基，表示唯一\n8 项全用：残差 = 0；少用几项：先丢高频',
        tips: [
          '8 个像素 = 8 维空间的一个点，8 个余弦基是 8 根互相垂直的轴',
          '正交且完备 → 任意 8 个数都拆得开，且拆法唯一',
          '权重 = 与某个基做内积，不必解方程组',
          '8 项全用残差为 0；只有少用项才会失真',
          'X(0) 是这行减 128 后的平均值，为负说明整行偏暗'
        ],
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
            '<button data-action="goto" data-target="dct:4">下一张：行列分解</button>' +
            '<button data-action="prevBlock">上一块</button>';
        }
      };
    },
    /* ② 只画数据：一行 8 个像素画在坐标系里，不叠加任何余弦波。
       先把「原始数据长什么样」看清楚，③ 才把余弦基端上来。 */
    'dct:1': function () {
      return {
        short: 'DCT·一行',
        title: 'DCT ②：一行像素画在坐标系里',
        lead: '把一行 8 个像素画到坐标系上：横轴是位置 n = 0…7，纵轴是灰度值 0–255，8 个点连成一条折线。',
        principle: '<p><b>先不谈变换，只看数据。</b>一行像素就是 8 个采样点：(0, f(0))、(1, f(1)) … (7, f(7))。画到坐标系里，一眼就能看出这一行是从暗到亮、还是中间塌了个坑。</p>' +
          '<p><b>这 8 个数就是一个 8 维向量。</b>按顺序把它们排成一列 [f(0), f(1), …, f(7)]，它描述的是 8 维空间里的一个点；图里只画了「位置 → 数值」两个维度，完整形状得靠 8 个分量一起看。</p>' +
          '<p><b>下一页开始换坐标轴。</b>现在用的是「位置 n」这条轴；DCT 会换成 8 条余弦波作轴，把这同样的 8 个数改写成 8 个权重——数据一个都没变，只是换一种说法。</p>',
        formula: '采样点：(n, f(n))，n = 0…7\n一行像素 = 8 维向量 [f(0), f(1), …, f(7)]\n灰度范围 0（黑）–255（白），中灰 = 128',
        tips: [
          '横轴是位置、纵轴是灰度，折线只是把相邻点连起来看趋势',
          '8 个点 = 这个 8 维向量的 8 个分量',
          '换一行、换一块，折线跟着变，坐标系不变',
          '这一页还没有余弦波，下一页才把 8 根轴端上来'
        ],
        params: function () {
          const row = state.dctRow < 0 ? bestRowOfBlock() : state.dctRow;
          const pixels = dctRowValues(row).pixels;
          const average = mean(pixels);
          return [
            ['当前行', dctRowLabel(row)],
            ['最大 / 最小', Math.round(Math.max.apply(null, Array.from(pixels))) + ' / ' +
              Math.round(Math.min.apply(null, Array.from(pixels)))],
            ['平均值', average.toFixed(1)],
            ['与中灰 128 之差', (average - 128).toFixed(1)]
          ];
        },
        tools: function () {
          return '<button class="primary" data-action="goto" data-target="dct:2">下一张：8 根坐标轴</button>' +
            '<button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
        }
      };
    },
    'dct:2': function () {
      return {
        short: 'DCT·基函数',
        title: 'DCT ③：八种固定的余弦模式',
        lead: '上一页把一行 8 个数画成了坐标系里的点；这一页看 DCT 要换上去的 8 根轴：k=0 是平的，k 越大，一个 8 点行里塞进的半波越多。',
        principle: '<p><b>为什么是余弦。</b>一维 DCT 把每个 8 点行假想成左右对称延拓的偶函数，偶函数只用余弦就能拼出来，不需要正弦项——这正是“离散余弦变换”名字的由来。</p>' +
          '<p><b>8 个波 = 8 根轴。</b>C(0) 是常数、C(1) 半个周期、…、C(7) 最密。它们两两正交（不同的波逐点相乘再求和为 0），8 根轴撑起整个 8 维空间、不多不少——这是一组<b>完备正交基</b>：任意 8 个像素都能唯一写成它们的加权和，下一页就把权重真的算出来。</p>' +
          '<p><b>图上只有 8 个采样点。</b>蓝线是连续余弦，黄点才是 DCT 真正取值的位置 n = 0…7。换任何图像、任何块，这 8 个波都不变，变的只是权重 X(0)…X(7)。</p>',
        formula: 'C(k, n) = αk · cos[π(n + 1/2)k / 8]\nα0 = 1/√8，αk = 1/2（k > 0）\nn = 0…7：每个波取 8 个点\n正交：Σn C(i,n)·C(j,n) = 0（i ≠ j）',
        tips: ['k 是频率序号：k 越大，波越密', 'k=0 是一条平线，只表示平均值', '这 8 个波与图像无关，换块也不变', '两两正交，权重才能各自独立算出来'],
        params: function () {
          return [
            ['基函数个数', '8（k = 0…7）'],
            ['k = 0 峰值', '1/√8 ≈ 0.354'],
            ['k > 0 峰值', '1/2 = 0.5'],
            ['正交性', 'Σ C(i)·C(j) = 0（i ≠ j）']
          ];
        },
        tools: function () {
          return '<button class="primary" data-action="goto" data-target="dct:3">下一张：一行像素怎么拆</button>' +
            '<button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
        }
      };
    },
    'dct:5': function () {
      return {
        short: 'DCT·二维',
        title: 'DCT ⑥：64 张基图，64 个权重',
        lead: '这一页看 64 个系数各自代表什么图案、单独一项能贡献多少。',
        principle: '<p><b>基图 = 纵向余弦 × 横向余弦。</b>u 管纵向条纹密度、v 管横向；(0,0) 是一片均匀，(7,7) 是最密的棋盘格。系数是权重而非亮度，负值只表示相位相反。</p>' +
          '<p><b>下方三联图：</b>① 基图长什么样；② 乘上系数后对像素的加减，白提亮、黑压暗；③ 只留这一项能画出什么。</p>' +
          '<p><b>能量集中在左上。</b>自然图像的系数从左上往右下迅速变小，低频十几项常占九成能量——这正是高频可以被砍掉的前提。</p>',
        formula: 'F(u,v) = ΣxΣy f(x,y)·B_uv(x,y)\n单项贡献 = F(u,v)·B_uv(x,y)\n反变换：f = ΣuΣv F(u,v)·B_uv\n能量守恒：Σf² = ΣF²（帕塞瓦尔）',
        tips: ['系数是权重：正=同相位，负=反相位', '|F| 越大，这一项对还原越重要', '单项画不出原块，64 项相加才行', '「逐项巡览」按 (u,v) 顺序自动走完 64 项，三联图同步换'],
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
          return '<button class="primary" data-action="coefftour">逐项巡览</button>' +
            '<button data-action="goto" data-target="dct:6">下一张：叠加重建</button>' +
            '<button data-action="prevBlock">上一块</button><button data-action="nextBlock">下一块</button>';
        }
      };
    },
    'dct:4': function () {
      return {
        short: 'DCT·行列',
        title: 'DCT ⑤：二维 = 先逐行、再逐列做两次一维',
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
            '<button data-action="goto" data-target="dct:5">下一张：二维系数</button>';
        }
      };
    },
    'dct:6': function () {
      return {
        short: 'DCT·重建',
        title: 'DCT ⑦：64 项加权相加 = 原块',
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
        lead: '把第一次重建出的像素再编码一次：文件大小几乎不变，PSNR 只掉零点几 dB——第一次量化已经把高频抹掉了，第二次没有更多细节可丢。',
        principle:
          '<p><b>什么叫二次压缩。</b>把第一次解码出来的 RGB 当作新输入，用同样的 QF 和采样再走一遍编码→解码。这模拟的是「图片被转存、转发、再保存一次」的真实场景，不是把文件重复压缩，而是对已经损失过的像素再量化一遍。</p>' +
          '<p><b>为什么几乎不掉画质。</b>量化是可重复的：同一个系数再 round 一次还是同一个值，第一次量化已经让大多数高频系数归零，第二次没有更多可丢。真正造成差异的是 RGB ↔ YCbCr 往返的取整，误差只在 8×8 块边界上一点点累积。</p>' +
          '<p><b>三张图怎么读。</b>左 = 第一次重建；中 = 二次重建；右 = 两次重建之差（放大 20 倍）。右图几乎全黑就是结论：肉眼看不到差别，损失集中在块边界。</p>',
        tag: '收尾',
        formula: '一次：Fq = round(F / q) → 重建像素\n二次：Fq′ = round(DCT(重建) / q)\n同一格子上 round 两次 ≈ 同一个值\n→ 熵位几乎不变，PSNR 只掉零点几 dB',
        params: function () {
          if (!state.encoded || !state.decoded) return [['状态', '等待编码']];
          const second = secondPassResult();
          return [
            ['一次 PSNR', state.psnr.toFixed(2) + ' dB'],
            ['二次 PSNR', second.psnr.toFixed(2) + ' dB'],
            ['文件字节', state.encoded.stats.fileBytes + ' → ' + second.encoded.stats.fileBytes + ' B'],
            ['采样 / QF', subsamplingText(state.subsampling) + ' / ' + state.Q]
          ];
        },
        tips: [
          '二次 PSNR 几乎等于一次 PSNR，说明信息不是第二次丢的',
          '看第三张图：差异只在 8×8 块边界上',
          '反复转存不会线性掉质，但每次都会累积一点点',
          'PSNR 高不等于看着好，块边界才是人眼敏感处'
        ],
        /* 本页末尾接上 MATLAB 批量实验：整条编码流程讲完后，正好用实测数据收口 */
        tools: function () {
          return '<button class="primary" data-action="goto" data-target="matlab">下一章：MATLAB 实测数据</button>';
        }
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

  function colorBits(bits) {
    return bits.split('').map(function (bit) {
      return '<span class="' + (bit === '1' ? 'one' : 'zero') + '">' + bit + '</span>';
    }).join('');
  }

  /* 位流按「一个符号一组」切开：蓝段 = Huffman 码，黄段 = 幅值位。
     参数 limit 供写入动画逐位显示；截断落在符号中间时只渲染已写出的那一段。 */
  function bitGroupsHTML(block, limit) {
    const total = typeof limit === 'number' ? limit : block.bits.length;
    const parts = [];
    let position = 0;
    block.symbols.forEach(function (symbol) {
      const start = position;
      const codeEnd = start + symbol.code.length;
      const end = codeEnd + symbol.amplitude.length;
      position = end;
      if (start >= total) return;
      const code = block.bits.slice(start, Math.min(total, codeEnd));
      const amplitude = block.bits.slice(Math.min(total, codeEnd), Math.min(total, end));
      /* DC / AC 的幅值位对应一个真实系数：−4 写成 011，(0,3) 里的 3 就是它的位数。
         把数值标在幅值位右边，读者不必自己按补码还原就能对上原始系数。 */
      const hasValue = symbol.kind === 'DC' || symbol.kind === 'AC';
      /* 写入动画写到一半时，这个符号的比特还没齐，先不标数值，免得对不上 */
      const complete = amplitude.length === (symbol.amplitude || '').length;
      const valueText = hasValue ? String(symbol.value) : '';
      const title = symbolLabel(symbol) + '：码字 ' + symbol.code +
        ' + 幅值位 ' + (symbol.amplitude || '（无）') + (hasValue ? ' = ' + valueText : '');
      /* 每组上方标出符号名：读者不用回头查表，就能把「这一小段比特」和「哪个符号」对上 */
      parts.push('<span class="bitgroup" title="' + escapeHTML(title) + '">' +
        '<em class="groupname">' + escapeHTML(symbolLabel(symbol)) + '</em>' +
        (code ? '<i class="codebits">' + colorBits(code) + '</i>' : '') +
        (amplitude
          ? '<span class="amprow"><i class="ampbits">' + colorBits(amplitude) + '</i>' +
            (hasValue && complete ? '<em class="ampvalue">= ' + escapeHTML(valueText) + '</em>' : '') +
            '</span>'
          : '') +
        '</span>');
    });
    if (position < total) {
      parts.push('<span class="bitgroup"><i class="codebits">' + colorBits(block.bits.slice(position, total)) + '</i></span>');
    }
    return parts.join('');
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

  /* 码字 / 幅值位的展示：不用 <code>。
     部分环境（深色模式扩展、强制配色、缺等宽字体）会把 <code> 的默认外观改成
     深色实心块，0/1 串就变成一排黑方块。这里用内联样式的浅色胶囊，颜色与页面位流一致。 */
  function bitChip(bits, tone) {
    const background = tone === 'amp' ? '#fff3d6' : '#e6edfa';
    const text = bits === undefined || bits === null || bits === '' ? '—' : String(bits);
    return '<span style="display:inline-block;min-width:16px;font-family:Consolas,\'Cascadia Mono\',monospace;' +
      'font-size:12px;letter-spacing:1px;line-height:1.5;color:#1e3a8a;background:' + background + ';' +
      'border-radius:4px;padding:0 5px">' + text + '</span>';
  }

  function symbolTable(symbols, limit) {
    const rows = symbols.slice(0, limit || 24).map(function (symbol) {
      return '<tr><td>' + symbolLabel(symbol) + '</td><td>' + (symbol.kind === 'AC' || symbol.kind === 'DC' ? symbol.value : '—') +
        '</td><td>' + bitChip(symbol.code) + '</td><td>' + symbol.code.length + '</td><td>' +
        bitChip(symbol.amplitude, 'amp') + '</td></tr>';
    }).join('');
    return '<div class="scroll"><table class="data"><thead><tr><th>符号</th><th>值</th><th>码字</th><th>码长</th><th>幅值位</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' + (symbols.length > (limit || 24) ? '<p class="note">仅显示前 ' + (limit || 24) + ' 个符号，共 ' + symbols.length + ' 个。</p>' : '');
  }

  /* ------------------------------------------------------------------ */
  /* 各步骤可视化                                                        */
  /* ------------------------------------------------------------------ */

  /* ---- 整幅图：原图 + RGB → YCbCr 的三张分量图 ------------------------
     三列网格：第一列上排是原图、下排是 Y 分量，原图正好压在 Y 头上、左边缘对齐；
     转换公式横跨第二、三列，落在 Cb / Cr 上方。四张图边长完全一致（按可用高度反推，
     上下两排各占一半）。Y 是真实亮度（灰阶），Cb/Cr 用伪彩标出色差方向。 */
  function renderYccPlanesStep() {
    const planes = fullImagePlanes();
    /* 四张图同一个边长：整页要塞进一屏，上下两排各占一半高度。
       200px 是图注、说明文字与排间距的预留，剩下的一半分给每排的方形图。 */
    const sidePx = clamp(Math.floor((stageViewportHeight() - 200) / 2), 150, 460);
    const side = SMALL_SCREEN ? 'min(100%, 420px)' : sidePx + 'px';
    /* 三列宽度都写成图宽，整个网格居中，原图与 Y 因此严丝合缝地对齐 */
    const boardStyle = SMALL_SCREEN ? '' : ' style="--ycc-cols:repeat(3,' + sidePx + 'px)"';
    function planeFigure(id, tag, name, values, accent) {
      return '<figure class="ycc-fig ' + accent + '">' +
        canvasTag(id, tag + ' ' + name) +
        '<figcaption><span class="ycc-tag">' + tag + '</span>' + name +
        ' · 均值 ' + mean(values).toFixed(1) +
        '</figcaption></figure>';
    }
    stage.innerHTML =
      '<div class="ycc-board"' + boardStyle + '>' +
        '<figure class="ycc-fig ycc-src">' +
          '<canvas id="yccSource" role="img" aria-label="原图 ' + escapeHTML(state.imageName) + '，彩色 RGB 参考"></canvas>' +
          '<figcaption><span class="ycc-tag">原图</span>RGB · ' + state.width + ' × ' + state.height + '</figcaption>' +
        '</figure>' +
        '<div class="ycc-formula-card">' +
          '<div class="ycc-eq" role="img" aria-label="Y、Cb、Cr 等于 3×3 系数矩阵乘 R、G、B 再加偏移量 0、128、128">' +
            '<span class="ycc-mat vec"><i class="var">Y</i><i class="var">C<sub>b</sub></i><i class="var">C<sub>r</sub></i></span>' +
            '<span class="ycc-op">=</span>' +
            '<span class="ycc-mat mat3">' +
              '<i class="num">0.299</i><i class="num">0.587</i><i class="num">0.114</i>' +
              '<i class="num">−0.168736</i><i class="num">−0.331264</i><i class="num">0.500</i>' +
              '<i class="num">0.500</i><i class="num">−0.418688</i><i class="num">−0.081312</i>' +
            '</span>' +
            '<span class="ycc-mat vec"><i class="var">R</i><i class="var">G</i><i class="var">B</i></span>' +
            '<span class="ycc-op">+</span>' +
            '<span class="ycc-mat vec"><i class="num">0</i><i class="num">128</i><i class="num">128</i></span>' +
          '</div>' +
          '<p class="ycc-formula-note">Y 占 <b>0.587G</b> 的权重，说明亮度主要由绿色贡献；Cb/Cr 只做色差，<b>128 为中性</b>。这一步可逆，不丢信息。</p>' +
        '</div>' +
        planeFigure('yccY', 'Y', '亮度（灰阶）', planes.y, 'ycc-y') +
        planeFigure('yccCb', 'Cb', '蓝色差 · 橄榄绿 = 偏离 128', planes.cb, 'ycc-cb') +
        planeFigure('yccCr', 'Cr', '红色差 · 粉红 = 偏离 128', planes.cr, 'ycc-cr') +
      '</div>' +
      '<p class="note">四张图同尺寸，各 ' + (state.width * state.height).toLocaleString() +
        ' 个样本。Y 是灰度图；<b>Cb/Cr 以 128 为中性灰</b>，偏离越多越向本分量的强调色靠拢' +
        '（Cb 橄榄绿、Cr 粉红），所以灰底 = 这里几乎没有色差、彩色斑块 = 色差明显，' +
        '<b>颜色不代表画面真实颜色</b>。下一页三张图各自被切成 8×8 块，色差通道还可以降采样。</p>';

    const planesByCanvas = { yccY: planes.y, yccCb: planes.cb, yccCr: planes.cr };
    Object.keys(planesByCanvas).forEach(function (id) {
      /* 位图按 512 边长存即可：最终显示宽度不超过 460 CSS px，放大会按设备像素比同步加密 */
      const target = setupCanvas(id, 512, 512);
      if (!target) return;
      target.canvas.style.maxWidth = side;
      if (id === 'yccY') drawPlaneInto(target, planesByCanvas[id], state.width, state.height);
      else drawChromaInto(target, planesByCanvas[id], state.width, state.height, id === 'yccCb' ? 'cb' : 'cr');
    });
    const source = setupCanvas('yccSource', 512, 512);
    if (source) {
      source.canvas.style.maxWidth = side;
      drawRGBInto(source, state.rgb, state.width, state.height);
    }
  }

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
      figure('subCbOriginal', 'Cb 原 8×8 · 粗框 = 采样组') +
      figure('subCbSmall', 'Cb 下采样 ' + sampleSize) +
      figure('subCrOriginal', 'Cr 原 8×8 · 同样的分组') +
      figure('subCrSmall', 'Cr 下采样 ' + sampleSize) + '</div>' +
      '<p class="note" id="subGroupNote"></p>' + compare;

    /* ---- 采样方法演示：粗框标出采样组，鼠标指到哪组就展开哪组 ----
       4:2:0 每 2×2 个色度样本取平均成 1 个，4:2:2 每 1×2 个取平均。
       焦点组里的 4（或 2）个值直接写在格子上，取平均的结果写在右侧小图对应格里。 */
    const groupCols = 2;
    const groupRows = mode === '420' ? 2 : 1;
    const groupText = groupRows === 2 ? '2×2 的 4 个样本' : '水平 2 个样本，垂直不合并';
    const cbOriginal = setupCanvas('subCbOriginal', 200, 200);
    const crOriginal = setupCanvas('subCrOriginal', 200, 200);
    const cbSmall = setupCanvas('subCbSmall', 200, 200);
    const crSmall = setupCanvas('subCrSmall', 200, 200);
    const groupNote = document.getElementById('subGroupNote');
    const focus = { x: 0, y: 0 };

    function groupCellPositions() {
      const startX = focus.x * groupCols;
      const startY = focus.y * groupRows;
      const cells = [];
      for (let dy = 0; dy < groupRows; dy++) {
        for (let dx = 0; dx < groupCols; dx++) {
          cells.push({ x: startX + dx, y: startY + dy });
        }
      }
      return { startX: startX, startY: startY, cells: cells };
    }

    function paintGroup() {
      if (!cbOriginal || !crOriginal || !cbSmall || !crSmall) return;
      const group = groupCellPositions();
      const cbValues = group.cells.map(function (cell) { return block.cb[cell.y * 8 + cell.x]; });
      const crValues = group.cells.map(function (cell) { return block.cr[cell.y * 8 + cell.x]; });
      const cbAverage = cbSample.data[focus.y * cbSample.width + focus.x];
      const crAverage = crSample.data[focus.y * crSample.width + focus.x];
      const labelsOf = function (values) {
        return group.cells.map(function (cell, index) {
          return { x: cell.x, y: cell.y, text: String(Math.round(values[index])) };
        });
      };
      const gridOptions = { groupCols: groupCols, groupRows: groupRows, focus: focus };
      drawSampleGrid(cbOriginal, block.cb, 8, 8, 'cb',
        Object.assign({}, gridOptions, { labels: labelsOf(cbValues) }));
      drawSampleGrid(crOriginal, block.cr, 8, 8, 'cr',
        Object.assign({}, gridOptions, { labels: labelsOf(crValues) }));
      drawSampleGrid(cbSmall, cbSample.data, cbSample.width, cbSample.height, 'cb',
        { labels: [{ x: focus.x, y: focus.y, text: cbAverage.toFixed(1) }] });
      drawSampleGrid(crSmall, crSample.data, crSample.width, crSample.height, 'cr',
        { labels: [{ x: focus.x, y: focus.y, text: crAverage.toFixed(1) }] });
      if (groupNote) {
        groupNote.innerHTML = '<b>当前采样组：第 ' + (group.startY + 1) + ' 行、第 ' + (group.startX + 1) +
          ' 列</b>（' + groupText + '）：Cb ' + cbValues.map(function (value) { return Math.round(value); }).join(' / ') +
          ' → 平均 <b>' + cbAverage.toFixed(1) + '</b>，写成 Cb′ (' + (focus.y + 1) + ', ' + (focus.x + 1) + ')；' +
          'Cr ' + crValues.map(function (value) { return Math.round(value); }).join(' / ') +
          ' → 平均 <b>' + crAverage.toFixed(1) + '</b>。' +
          (groupRows === 2
            ? '这 4 个像素的亮度 Y 各存 1 个样本、一个不丢，只有色度被合并。'
            : '这 2 个像素的亮度 Y 各存 1 个样本，只有色度在水平方向被合并。') +
          '鼠标移到任一色度网格上可切换采样组。';
      }
    }

    paintGroup();

    function focusAt(event, canvas) {
      const rect = canvas.getBoundingClientRect();
      const gx = (event.clientX - rect.left) / rect.width * 8;
      const gy = (event.clientY - rect.top) / rect.height * 8;
      return {
        x: clamp(Math.floor(gx / groupCols), 0, 8 / groupCols - 1),
        y: clamp(Math.floor(gy / groupRows), 0, 8 / groupRows - 1)
      };
    }

    [cbOriginal, crOriginal].forEach(function (target) {
      if (!target) return;
      target.canvas.style.cursor = 'crosshair';
      target.canvas.addEventListener('mousemove', function (event) {
        const next = focusAt(event, target.canvas);
        if (next.x === focus.x && next.y === focus.y) return;
        focus.x = next.x;
        focus.y = next.y;
        paintGroup();
      });
    });

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
    if (view === 'basisGrid') { renderDctCosinePage(); return; }
    if (view === 'rowPlot') { renderDctRowPlot(); return; }
    if (view === 'oneD') { renderDctOneD(); return; }
    if (view === 'rebuild') { renderDctRebuild(); return; }
    renderDctBasisView();
  }

  /* ② 基函数页：8 个固定的余弦模式。
     这一页不讲某一行像素，只回答「DCT 用的那 8 个波长什么样」；
     拆出来以后，一维页不用再挤 8 张小图，两张主图能各占半屏。 */
  function renderDctCosinePage() {
    stage.innerHTML = '<figure class="dct-1d-figure">' +
      canvasTag('dctCosineGrid', '八种固定余弦模式 k=0…7，每个波在 n=0…7 上取 8 个点') +
      '<figcaption>8 个波完全由公式决定：k 越大，一个 8 点行里塞进的半波越多；黄点是 n = 0…7 的采样位置</figcaption>' +
      '</figure>' +
      '<div class="dct-cosine-formula">' +
      '<div class="dcf-eq" role="math" aria-label="C(k,n) 等于 αk 乘以 cos 的 π(n+1/2)k 除以 8">' +
      '<span><i>C</i>(<i>k</i>, <i>n</i>)</span>' +
      '<span class="dcf-op">=</span>' +
      '<span><i>α</i><sub><i>k</i></sub></span>' +
      '<span class="dcf-op">·</span>' +
      '<span class="dcf-cos">cos</span>' +
      '<span class="dcf-bracket"></span>' +
      '<span class="dcf-frac"><span class="dcf-num">π(<i>n</i> + 1/2)<i>k</i></span><span class="dcf-den">8</span></span>' +
      '<span class="dcf-bracket end"></span>' +
      '</div>' +
      '<div class="dcf-legend">' +
      '<span class="dcf-note"><span class="dcf-m"><i>α</i><sub>0</sub> = 1/<span class="dcf-sqrt">√<span class="dcf-rad">8</span></span>，<i>α</i><sub>k</sub> = 1/2（<i>k</i> &gt; 0）</span></span>' +
      '<span class="dcf-sep">·</span>' +
      '<span class="dcf-note"><span class="dcf-m">Σ<sub><i>n</i></sub> <i>C</i>(<i>i</i>,<i>n</i>)·<i>C</i>(<i>j</i>,<i>n</i>) = 0</span>（<span class="dcf-m"><i>i</i> ≠ <i>j</i></span>），两两正交</span>' +
      '</div>' +
      '</div>';
    drawCosineGrid(setupCanvas('dctCosineGrid', 1240, 620));
  }

  function drawCosineGrid(target) {
    const context = target.ctx;
    context.clearRect(0, 0, target.w, target.h);
    const gap = 12;
    const cellWidth = (target.w - gap * 5) / 4;
    const cellHeight = (target.h - gap * 3) / 2;
    for (let k = 0; k < 8; k++) {
      drawCosineCell(context, gap + (k % 4) * (cellWidth + gap), gap + Math.floor(k / 4) * (cellHeight + gap),
        cellWidth, cellHeight, k);
    }
  }

  function drawCosineCell(context, x, y, w, h, k) {
    context.fillStyle = '#fff';
    context.fillRect(x, y, w, h);
    context.strokeStyle = '#e3eaf4';
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    context.fillStyle = '#152033';
    context.font = '700 15px Consolas, monospace';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText('k = ' + k, x + 16, y + 12);
    context.fillStyle = '#94a3b8';
    context.font = '10.5px "Microsoft YaHei", sans-serif';
    context.textAlign = 'right';
    context.fillText(k === 0 ? '平直：只表示平均值' : k === 7 ? '最密：最高频' : '一个行里 ' + k + ' 个半波', x + w - 16, y + 15);

    const left = x + 26;
    const right = x + w - 20;
    const top = y + 48;
    const bottom = y + h - 40;
    const mid = (top + bottom) / 2;
    const amplitude = (bottom - top) / 2 * 0.88;
    const peak = k === 0 ? 1 / Math.sqrt(8) : 0.5;

    /* 零轴 + 上下两条参考线，读者能看出每个波围绕 0 起伏 */
    context.strokeStyle = 'rgba(100,116,139,0.55)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, mid);
    context.lineTo(right, mid);
    context.stroke();
    context.strokeStyle = 'rgba(148,163,184,0.22)';
    context.setLineDash([3, 4]);
    [mid - amplitude, mid + amplitude].forEach(function (lineY) {
      context.beginPath();
      context.moveTo(left, lineY);
      context.lineTo(right, lineY);
      context.stroke();
    });
    context.setLineDash([]);

    const pointX = function (n) { return left + (n + 0.5) / 8 * (right - left); };
    const pointY = function (n) { return mid - (cosineBasis(k, n) / peak) * amplitude; };

    context.strokeStyle = '#1d4ed8';
    context.lineWidth = 2;
    context.beginPath();
    for (let step = 0; step <= 96; step++) {
      const position = step / 96 * 8 - 0.5;
      const px = left + step / 96 * (right - left);
      const py = mid - (cosineBasis(k, position) / peak) * amplitude;
      if (step === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.stroke();

    /* 采样点：DCT 只在这 8 个位置取值，不是连续曲线 */
    for (let n = 0; n < 8; n++) {
      const px = pointX(n);
      const py = pointY(n);
      context.strokeStyle = 'rgba(29,78,216,0.35)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(px, mid);
      context.lineTo(px, py);
      context.stroke();
      context.beginPath();
      context.arc(px, py, 3.6, 0, Math.PI * 2);
      context.fillStyle = '#f5b942';
      context.fill();
      context.strokeStyle = '#b7791f';
      context.lineWidth = 1.2;
      context.stroke();
    }

    context.fillStyle = '#94a3b8';
    context.font = '10px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    for (let n = 0; n < 8; n++) context.fillText(String(n), pointX(n), bottom + 12);
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

  /* 这一页是“系数矩阵 + 64 张基图 + 三联图”三层方形图叠起来，两个主图按满宽放任时
     总高超过一屏，一屏装下算法只能把三块一起压到 0.4 倍——矩阵格子里的数字会小到
     看不清、左侧还留一片空白。先按可用高度给两张主图一个上限，让矩阵保持可读尺寸，
     fit 只做小幅修正；窗口变化时会随整页重绘重新计算。 */
  function dctPictureCap() {
    return (window.innerWidth || document.documentElement.clientWidth || 1200) >= 900
      ? clamp(Math.round(stageViewportHeight() * 0.42), 240, 620)
      : 0;
  }

  /* ③ 二维视角：系数矩阵 + 64 张基图 + 单项贡献三联图 */
  function renderDctBasisView() {
    stage.innerHTML = '<div class="dct-use-row">' +
      '<span class="note" id="coeffTourInfo"></span>' +
      '<button data-coeff="prev">◀ 上一项</button>' +
      '<button data-coeff="next">下一项 ▶</button>' +
      '<button data-coeff="play" id="coeffPlay">播放</button>' +
      '</div>' +
      '<div class="dct-2d-top"><div class="dct-2d-col">' +
      figure('dctMain', 'DCT 系数矩阵 F(u,v)：点任意一格（或右侧基图）看这一项的贡献') +
      '</div><div class="dct-2d-col">' +
      figure('dctBasis', '64 张余弦基图像 B(u,v)：行 u = 纵向频率，列 v = 横向频率，点任意一张选中它') +
      '</div></div>' +
      '<div class="dct-term-row">' +
      figure('dctTermBasis', '① 基图 B(u,v)：固定图案') +
      figure('dctTermContribution', '② 基图 × 系数 F(u,v)：白=加亮，黑=压暗') +
      figure('dctTermRebuild', '③ 只留这一项能画出的块（+128）') +
      '</div>';
    Array.prototype.forEach.call(stage.querySelectorAll('.dct-use-row button'), function (button) {
      button.addEventListener('click', function () {
        const kind = button.getAttribute('data-coeff');
        if (kind === 'play') { toggleCoeffTour(); return; }
        stopVisualAnimations();
        stepCoeffSelection(kind === 'next' ? 1 : -1);
      });
    });
    /* 两列同宽同尺寸：删掉左侧的读数与统计卡后，矩阵和基图等高才不显得左轻右重 */
    const target = setupCanvas('dctMain', 520, 520, dctPictureCap());
    if (target) {
      target.canvas.addEventListener('click', function (event) {
        const rectangle = target.canvas.getBoundingClientRect();
        const x = (event.clientX - rectangle.left) / rectangle.width * target.w;
        const y = (event.clientY - rectangle.top) / rectangle.height * target.h;
        const column = clamp(Math.floor(x / (target.w / 8)), 0, 7);
        const row = clamp(Math.floor(y / (target.h / 8)), 0, 7);
        /* 手动点选 = 巡览停在选中的这一项，只重画位图，不重建整页 */
        stopVisualAnimations();
        state.selectedCoeff = row * 8 + column;
        refreshDctBasisView();
      });
    }
    const gallery = setupCanvas('dctBasis', 520, 520, dctPictureCap());
    if (gallery) {
      gallery.canvas.addEventListener('click', function (event) {
        const rectangle = gallery.canvas.getBoundingClientRect();
        const x = (event.clientX - rectangle.left) / rectangle.width * gallery.w;
        const y = (event.clientY - rectangle.top) / rectangle.height * gallery.h;
        const cell = (gallery.w - BASIS_GAP * 9) / 8;
        const column = clamp(Math.floor((x - BASIS_GAP) / (cell + BASIS_GAP)), 0, 7);
        const row = clamp(Math.floor((y - BASIS_GAP) / (cell + BASIS_GAP)), 0, 7);
        stopVisualAnimations();
        state.selectedCoeff = row * 8 + column;
        refreshDctBasisView();
      });
    }
    refreshDctBasisView();
  }

  /* 只重画这一页的五张画布（矩阵 / 基图 / 三联图）：巡览一拍换一项，
     整页重建 DOM 太贵，还会把控件上的监听一起丢掉再重绑。
     三联图是补充说明，别让它抢到比主图还大：上限取主图上限的 2/3。 */
  function refreshDctBasisView() {
    const coefficients = encodedBlock().coefficients;
    const cap = dctPictureCap();
    const termCap = cap ? Math.round(cap * 0.66) : 0;
    const matrix = setupCanvas('dctMain', 520, 520, cap);
    const gallery = setupCanvas('dctBasis', 520, 520, cap);
    if (!matrix || !gallery) return;
    drawCoefficientMatrix(matrix);
    drawBasisGallery(gallery);
    drawDctTermViews(setupCanvas('dctTermBasis', 260, 260, termCap),
      setupCanvas('dctTermContribution', 260, 260, termCap),
      setupCanvas('dctTermRebuild', 260, 260, termCap), resolvedSelectedCoeff(coefficients));
    syncCoeffTourControls();
  }

  /* 手动步进：64 项里前后挪一格，环形回绕 */
  function stepCoeffSelection(delta) {
    const current = resolvedSelectedCoeff(encodedBlock().coefficients);
    state.selectedCoeff = (current + delta + 64) % 64;
    refreshDctBasisView();
  }

  /* 读数条与播放按钮的唯一同步点：巡览每拍都会调一次 */
  function syncCoeffTourControls() {
    const coefficients = encodedBlock().coefficients;
    const index = resolvedSelectedCoeff(coefficients);
    const info = document.getElementById('coeffTourInfo');
    if (info) {
      info.textContent = '逐项巡览 第 ' + (index + 1) + ' / 64 项：F(' + Math.floor(index / 8) + ',' +
        (index % 8) + ') = ' + formatValue(coefficients[index]) + '；蓝框 = 当前项';
    }
    const play = document.getElementById('coeffPlay');
    if (play) play.textContent = (state.coeffTourTimer || state.coeffTourHold) ? '暂停' : '播放';
  }

  /* 一轮 = 64 项：按 (u,v) 行优先一格一拍，走完停 1.6 秒再从 (0,0) 重来。
     矩阵高亮、基图蓝框、三联图跟着一起换，形成步进循环的巡览动图。 */
  function startCoeffTour(startIndex) {
    if (state.step !== 4 || state.dctView !== 'coeff') return;
    stopVisualAnimations();
    const total = 64;
    let index = clamp(Math.round(typeof startIndex === 'number' ? startIndex : state.selectedCoeff), 0, total - 1);
    state.selectedCoeff = index;
    refreshDctBasisView();
    state.coeffTourTimer = setInterval(function () {
      index += 1;
      if (index >= total) {
        clearInterval(state.coeffTourTimer);
        state.coeffTourTimer = null;
        syncCoeffTourControls();
        state.coeffTourHold = setTimeout(function () {
          state.coeffTourHold = null;
          if (state.step === 4 && state.dctView === 'coeff') startCoeffTour(0);
        }, 1600);
        return;
      }
      state.selectedCoeff = index;
      if (state.step === 4 && state.dctView === 'coeff') refreshDctBasisView();
    }, ANIM.interval('coefftour', total));
  }

  function toggleCoeffTour() {
    if (state.coeffTourTimer || state.coeffTourHold) {
      stopVisualAnimations();
      syncCoeffTourControls();
      return;
    }
    startCoeffTour(state.selectedCoeff);
  }

  /* ⑤ 重建：64 项按 |F| 降序叠加，看它怎样一步步逼回原块 */
  function renderDctRebuild() {
    if (typeof state.dctSumStep !== 'number') state.dctSumStep = 64;
    stage.innerHTML = '<div class="dct-use-row">' +
      '<span class="note">逐项叠加：按 |F| 从大到小，一次加一项</span>' +
      rebuildStepButtons(state.dctSumStep) +
      '</div>' +
      '<div class="dct-rebuild-row4">' +
      figure('rebuildTarget', '① 原块目标（+128 显示）') +
      figure('rebuildSum', '② 当前重建块：已叠加项之和（+128）') +
      figure('rebuildTerm', '③ 刚加入的那一项 F(u,v)·B(u,v)：白=加亮，黑=压暗（按该项峰值归一化）') +
      figure('rebuildBasisIndex', '④ 64 张基图 B(u,v)：行 u = 纵向频率，列 v = 横向频率；蓝框 = 本步加入的那一项，淡色 = 还没轮到，点任意一张跳到它加入的那一步') +
      '</div>' +
      figure('rebuildBars', '64 项按 |F| 从大到小排开：柱高 = 系数大小，蓝 = 已叠加，灰 = 还没用上') +
      '<p class="note" id="rebuildInfo"></p>';
    Array.prototype.forEach.call(stage.querySelectorAll('.dct-use-row button'), function (button) {
      button.addEventListener('click', function () {
        const set = button.getAttribute('data-set');
        if (set !== null) { applyRebuildStep(Number(set)); return; }
        if (button.getAttribute('data-play') !== null) {
          if (state.dctSumTimer || state.dctSumHold) {
            stopVisualAnimations();
            syncRebuildButtons();
          } else {
            startBasisSum(state.dctSumStep);
          }
          return;
        }
        applyRebuildStep(state.dctSumStep + Number(button.getAttribute('data-step')));
      });
    });
    /* 点基图索引里的任意一格 = 跳到“这一项刚被加入”的那一步：
       ③ 号图立刻变成它的贡献，蓝框也落在它身上 */
    const indexCanvas = document.getElementById('rebuildBasisIndex');
    if (indexCanvas) {
      indexCanvas.addEventListener('click', function (event) {
        const geometry = rebuildBasisGeometry(REBUILD_BASIS_SIZE);
        const rectangle = indexCanvas.getBoundingClientRect();
        if (!rectangle.width || !rectangle.height) return;
        const x = (event.clientX - rectangle.left) / rectangle.width * REBUILD_BASIS_SIZE;
        const y = (event.clientY - rectangle.top) / rectangle.height * REBUILD_BASIS_SIZE;
        /* 行列号所在的边距区不算格点，点空不跳 */
        if (x < geometry.left || y < geometry.top) return;
        const column = clamp(Math.floor((x - geometry.left) / geometry.step), 0, 7);
        const row = clamp(Math.floor((y - geometry.top) / geometry.step), 0, 7);
        const order = dctSumOrder(encodedBlock().coefficients);
        const position = order.indexOf(row * 8 + column);
        if (position >= 0) applyRebuildStep(position + 1);
      });
    }
    drawDctRebuildViews();
    syncRebuildButtons();
  }

  function rebuildStepButtons(count) {
    function cls(value) { return value === count ? ' class="on"' : ''; }
    return '<button data-set="0"' + cls(0) + '>清空</button>' +
      '<button data-step="-1">◀ 上一步</button>' +
      '<button data-step="1">下一步 ▶</button>' +
      '<button data-play="1" id="rsPlay">播放</button>' +
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
    const play = document.getElementById('rsPlay');
    if (play) play.textContent = (state.dctSumTimer || state.dctSumHold) ? '暂停' : '播放';
  }

  /* 没点选时默认展示“AC 里最大的那一项”：DC 是一整片均匀，看不出图案差别 */
  function resolvedSelectedCoeff(coefficients) {
    if (state.selectedCoeff >= 0) return state.selectedCoeff;
    let best = 1;
    for (let i = 2; i < 64; i++) if (Math.abs(coefficients[i]) > Math.abs(coefficients[best])) best = i;
    return best;
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

  /* ------------------------------------------------------------------ */
  /* ⑤ 重建页：64 张基图索引                                             */
  /* ------------------------------------------------------------------ */

  const REBUILD_BASIS_SIZE = 340;
  /* 左侧留给行号 u、顶部留给列号 v，剩下的正方形平分给 8×8 张基图 */
  const REBUILD_BASIS_GUTTER = 15;
  const REBUILD_BASIS_GAP = 4;

  function rebuildBasisGeometry(size) {
    const cell = (size - REBUILD_BASIS_GUTTER - REBUILD_BASIS_GAP * 8) / 8;
    return {
      left: REBUILD_BASIS_GUTTER,
      top: REBUILD_BASIS_GUTTER,
      cell: cell,
      step: cell + REBUILD_BASIS_GAP
    };
  }

  /* 与 05.3 的画廊同一套归一化（每张按自身峰值拉满 128 ± BASIS_CONTRAST），
     多了两层状态：已叠加的项保持原对比度，还没轮到的压淡；本步加入的那一项套蓝框。
     count = 0 时蓝框改成虚线，预告“下一步会加入哪一张”。 */
  function drawRebuildBasisIndex(target, order, count) {
    if (!target) return;
    const context = target.ctx;
    const geometry = rebuildBasisGeometry(target.w);
    const used = new Uint8Array(64);
    for (let i = 0; i < count; i++) used[order[i]] = 1;
    const active = order[count > 0 ? count - 1 : 0];
    const activeU = Math.floor(active / 8);
    const activeV = active % 8;
    const pixel = geometry.cell / 8;
    context.clearRect(0, 0, target.w, target.h);
    for (let u = 0; u < 8; u++) {
      for (let v = 0; v < 8; v++) {
        const index = u * 8 + v;
        const originX = geometry.left + v * geometry.step;
        const originY = geometry.top + u * geometry.step;
        let tileMaximum = 1 / 64;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) tileMaximum = Math.max(tileMaximum, Math.abs(basisValue(u, v, x, y)));
        }
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            let level = clamp(Math.round(128 + BASIS_CONTRAST * basisValue(u, v, x, y) / tileMaximum), 0, 255);
            /* 还没轮到的项往白里退一半，条纹仍看得清，又能一眼分出已叠加的那一片 */
            if (!used[index]) level = Math.round(level + (255 - level) * 0.52);
            context.fillStyle = 'rgb(' + level + ',' + level + ',' + level + ')';
            context.fillRect(originX + x * pixel, originY + y * pixel, pixel + 0.5, pixel + 0.5);
          }
        }
        if (index === active) {
          context.strokeStyle = '#1d4ed8';
          context.lineWidth = 2.5;
          if (count === 0) context.setLineDash([4, 3]);
          context.strokeRect(originX - 1.5, originY - 1.5, geometry.cell + 3, geometry.cell + 3);
          context.setLineDash([]);
        } else {
          context.strokeStyle = used[index] ? 'rgba(71,85,105,0.55)' : 'rgba(148,163,184,0.4)';
          context.lineWidth = 1;
          context.strokeRect(originX + 0.5, originY + 0.5, geometry.cell - 1, geometry.cell - 1);
        }
      }
    }
    /* 行/列号：本步加入项所在的行 u、列 v 用蓝色点出来，蓝框不会指错 */
    context.font = '600 9.5px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let v = 0; v < 8; v++) {
      context.fillStyle = v === activeV ? '#1d4ed8' : '#7c8ba1';
      context.fillText(String(v), geometry.left + v * geometry.step + geometry.cell / 2, geometry.top / 2);
    }
    for (let u = 0; u < 8; u++) {
      context.fillStyle = u === activeU ? '#1d4ed8' : '#7c8ba1';
      context.fillText(String(u), geometry.left / 2, geometry.top + u * geometry.step + geometry.cell / 2);
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

    drawRebuildBasisIndex(setupCanvas('rebuildBasisIndex', REBUILD_BASIS_SIZE, REBUILD_BASIS_SIZE), order, count);
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

  /* ---- ② 一行像素画在坐标系里 ----------------------------------------
     这一页只画数据：横轴 n = 0…7（位置）、纵轴灰度 0–255（数值），
     8 个采样点 + 一条把相邻点连起来的折线。不叠任何余弦波，
     余弦基留到下一张单独讲。 */
  const DCT_ROWPLOT_CANVAS = { w: 1240, h: 420 };

  function renderDctRowPlot() {
    if (typeof state.dctRow !== 'number' || state.dctRow < 0 || state.dctRow > 7) state.dctRow = bestRowOfBlock();
    const row = state.dctRow;
    const pixels = dctRowValues(row).pixels;
    stage.innerHTML = '<div class="dct-1d-top"><div class="dct-row-picker">' +
      Array.from({ length: 8 }, function (_, index) {
        return '<button data-index="' + index + '" class="' + (index === row ? 'on' : '') + '">第 ' + (index + 1) + ' 行</button>';
      }).join('') +
      '<span class="note">任选一行：换个分析对象，坐标系不变</span></div></div>' +
      /* 空间域色带：和 04.3 一维页同一套样式，这里只放一条，压成矮条把高度让给下方坐标系 */
      '<div class="dct-strips single"><div class="dct-strip-col">' +
      '<p class="dct-strip-head">空间域<em>' + dctRowLabel(row) + ' · 0–255 灰阶</em></p>' +
      '<div class="dct-cells">' +
      Array.from(pixels).map(function (value) {
        const level = Math.round(clamp(value, 0, 255));
        return '<span style="background:rgb(' + level + ',' + level + ',' + level + ');color:' +
          (level > 140 ? '#1f2937' : '#ffffff') + '">' + level + '</span>';
      }).join('') +
      '</div></div></div>' +
      '<figure class="dct-1d-figure">' +
      canvasTag('dctRowPlot', '一行 8 个像素画在坐标系里：横轴是位置 n = 0…7，纵轴是灰度值 0–255') +
      '</figure>' +
      '<p class="note">上方 8 格 = 这一行的 8 个像素（灰阶就是数值），下方把它们按位置画进坐标系；' +
      '这 8 个数就是一个 <b>8 维向量</b>，折线只把相邻点连起来看趋势，不是插值。' +
      '下一页换上 8 根余弦轴，把这 8 个数改写成 8 个权重。</p>';
    Array.prototype.forEach.call(stage.querySelectorAll('.dct-row-picker button'), function (button) {
      button.addEventListener('click', function () {
        const index = Number(button.getAttribute('data-index'));
        if (!isFinite(index) || index === state.dctRow) return;
        state.dctRow = index;
        renderDctRowPlot();
      });
    });
    drawRowPlot(setupCanvas('dctRowPlot', DCT_ROWPLOT_CANVAS.w, DCT_ROWPLOT_CANVAS.h));
  }

  function drawRowPlot(target) {
    const context = target.ctx;
    const data = dctRowValues(state.dctRow);
    const pixels = data.pixels;
    context.clearRect(0, 0, target.w, target.h);

    const cardX = 14;
    const cardY = 14;
    const cardWidth = target.w - 28;
    const cardHeight = target.h - 28;
    const plotLeft = cardX + 60;
    const plotRight = cardX + cardWidth - 24;
    const plotTop = cardY + 62;
    const plotBottom = cardY + cardHeight - 46;
    const slot = (plotRight - plotLeft) / 8;
    const yOf = function (value) { return plotBottom - (value / 255) * (plotBottom - plotTop); };

    context.fillStyle = '#fff';
    context.fillRect(cardX, cardY, cardWidth, cardHeight);
    context.strokeStyle = '#e3eaf4';
    context.lineWidth = 1;
    context.strokeRect(cardX + 0.5, cardY + 0.5, cardWidth - 1, cardHeight - 1);

    context.fillStyle = '#334155';
    context.font = '600 13px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(dctRowLabel(state.dctRow) + ' · 8 个采样点', cardX + 16, cardY + 25);
    context.fillStyle = '#64748b';
    context.font = '11px Consolas, monospace';
    context.fillText('横轴 = 位置 n（0…7）    纵轴 = 灰度值（0–255）', cardX + 16, cardY + 43);

    /* 横向参考线：0 / 64 / 128 / 192 / 255，中灰 128 用蓝线标出 */
    const levels = [0, 64, 128, 192, 255];
    context.font = '10px Consolas, monospace';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const y = yOf(level);
      context.strokeStyle = level === 128 ? 'rgba(29,78,216,0.32)' : 'rgba(148,163,184,0.3)';
      context.setLineDash(level === 128 ? [] : [3, 4]);
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(plotLeft, y);
      context.lineTo(plotRight, y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = level === 128 ? 'rgba(29,78,216,0.85)' : '#94a3b8';
      context.fillText(String(level), plotLeft - 8, y);
    }

    /* 纵轴与横轴 */
    context.strokeStyle = 'rgba(148,163,184,0.85)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plotLeft + 0.5, plotTop);
    context.lineTo(plotLeft + 0.5, plotBottom + 0.5);
    context.lineTo(plotRight, plotBottom + 0.5);
    context.stroke();

    /* 折线：只连采样点，说明「相邻位置之间」的走势 */
    context.beginPath();
    for (let n = 0; n < 8; n++) {
      const x = plotLeft + (n + 0.5) * slot;
      const y = yOf(clamp(pixels[n], 0, 255));
      if (n === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = 'rgba(29,78,216,0.75)';
    context.lineWidth = 2;
    context.lineJoin = 'round';
    context.stroke();

    /* 采样点与数值 */
    context.font = '600 11px Consolas, monospace';
    context.textAlign = 'center';
    for (let n = 0; n < 8; n++) {
      const value = clamp(pixels[n], 0, 255);
      const x = plotLeft + (n + 0.5) * slot;
      const y = yOf(value);
      context.beginPath();
      context.arc(x, y, 4.5, 0, Math.PI * 2);
      context.fillStyle = '#fff';
      context.fill();
      context.strokeStyle = '#1d4ed8';
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = '#1e3a8a';
      const above = y - 14 > plotTop;
      context.textBaseline = above ? 'bottom' : 'top';
      context.fillText(String(Math.round(value)), x, above ? y - 8 : y + 8);
      /* 横轴刻度 */
      context.fillStyle = '#64748b';
      context.font = '10px Consolas, monospace';
      context.textBaseline = 'top';
      context.fillText(String(n), x, plotBottom + 8);
      context.font = '600 11px Consolas, monospace';
    }
    context.fillStyle = '#94a3b8';
    context.font = '10px Consolas, monospace';
    context.textAlign = 'right';
    context.fillText('n', plotRight, plotBottom + 22);
  }

  /* 一维视角：一行像素 → 8 个系数 → 余弦波加权求和 */
  function renderDctOneD() {
    if (typeof state.dctRow !== 'number' || state.dctRow < 0 || state.dctRow > 7) state.dctRow = bestRowOfBlock();
    if (typeof state.dctUseCount !== 'number') state.dctUseCount = 8;
    const row = state.dctRow;
    stage.innerHTML = '<div class="dct-1d-top">' +
      '<div class="dct-row-picker">' +
      Array.from({ length: 8 }, function (_, index) {
        return '<button data-index="' + index + '" class="' + (index === row ? 'on' : '') + '">第 ' + (index + 1) + ' 行</button>';
      }).join('') +
      '<span class="note">任选一行：同一套余弦波，只是权重不同</span></div>' +
      '<div class="dct-strips">' +
      '<div class="dct-strip-col">' +
      '<p class="dct-strip-head">空间域<em>' + dctRowLabel(row) + ' · 0–255 灰阶</em></p>' +
      '<div class="dct-cells" id="dctPixelCells">' +
      Array.from(dctRowValues(row).pixels).map(function (value) {
        const level = Math.round(clamp(value, 0, 255));
        return '<span style="background:rgb(' + level + ',' + level + ',' + level + ');color:' +
          (level > 140 ? '#1f2937' : '#ffffff') + '">' + level + '</span>';
      }).join('') +
      '</div>' +
      '</div>' +
      '<div class="dct-strip-col">' +
      '<p class="dct-strip-head">频率域<em>蓝 = 负 · 红 = 正</em></p>' +
      '<div class="dct-cells" id="dctRowCoeff"></div>' +
      '</div></div>' +
      '<div class="dct-use-row">' +
      '<span class="note" id="dctRowCoeffInfo"></span>' + rowUseButtons(state.dctUseCount) +
      '</div></div>' +
      '<figure class="dct-1d-figure">' +
      canvasTag('dctRowBasis', '8 个余弦波加权叠加的逐步逼近过程') +
      '</figure>' +
      '<p class="note">这 8 个点 = 8 维空间里的一个点；8 个余弦基两两垂直、刚好撑满 8 维（完备正交基），' +
      '所以任意 8 个采样点都能唯一拆成「8 个基 × 8 个权重」，8 项全用时残差必为 0。</p>';
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
    drawRowBasis(setupCanvas('dctRowBasis', DCT_ROW_CANVAS.w, DCT_ROW_CANVAS.h));
    drawDctRowCoeff();
  }

  /* 系数条与步进动画同步：只显示已经加进来的 X(k)，其余留灰色空框。
     用 DOM 方块而不是画布，才能和左边的像素带逐格对齐。 */
  function drawDctRowCoeff() {
    const host = document.getElementById('dctRowCoeff');
    if (!host) return;
    const values = dctRowValues(state.dctRow).coefficients;
    const maximum = maxAbsCoefficient(rowDct(encodedBlock().pixels));
    const active = clamp(typeof state.dctUseCount === 'number' ? state.dctUseCount : 8, 0, 8);
    let html = '';
    for (let k = 0; k < values.length; k++) {
      if (k >= active) {
        html += '<span class="pending">—</span>';
        continue;
      }
      const rgb = heatColor(values[k], maximum);
      html += '<span style="background:rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ');color:' +
        textColor(rgb) + '">' + formatValue(values[k]) + '</span>';
    }
    host.innerHTML = html;
    const info = document.getElementById('dctRowCoeffInfo');
    if (info) {
      info.textContent = active >= 8
        ? '逐步逼近：8 个余弦波已全部加入'
        : '逐步逼近：已加入 ' + active + ' / 8 个余弦波';
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
    const target = setupCanvas('dctRowBasis', DCT_ROW_CANVAS.w, DCT_ROW_CANVAS.h);
    if (target) drawRowBasis(target);
    drawDctRowCoeff();
    syncUseButtons(state.dctUseCount);
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

  /* 一维页只留两张主图：左边「叠加到哪了」，右边「这一项长什么样」。
     8 个基函数的小图已经单独成一页，这里不再挤进同一块画布。 */
  const DCT_ROW_CANVAS = { w: 1240, h: 430 };

  function drawRowBasis(target) {
    const context = target.ctx;
    const data = dctRowValues(state.dctRow);
    const used = state.basis && state.basis.active
      ? state.basis.step
      : clamp(typeof state.dctUseCount === 'number' ? state.dctUseCount : 8, 0, 8);
    context.clearRect(0, 0, target.w, target.h);
    const gap = 14;
    const half = (target.w - gap * 3) / 2;
    drawRowSumCard(context, data, used, { x: gap, y: gap, w: half, h: target.h - gap * 2 });
    drawRowNextCard(context, data, used, { x: gap * 2 + half, y: gap, w: half, h: target.h - gap * 2 });
  }

  const ROW_SIGN_POSITIVE = '#dc2626';
  const ROW_SIGN_NEGATIVE = '#1d4ed8';

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
    /* 8 项全加完后没有「下一项」，与其留一张空图，不如把这一行的 8 个权重画成条形图 */
    if (done) {
      drawRowCoeffBars(context, data, box);
      return;
    }
    const k = Math.min(used, 7);
    const weight = data.coefficients[k];

    context.fillStyle = '#6d28d9';
    context.font = '600 12px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('下一次要加入：X' + k + ' × C' + k, box.x + 14, box.y + 22);
    context.fillStyle = '#64748b';
    context.font = '11px "Microsoft YaHei", sans-serif';
    context.fillText('系数 ' + formatValue(weight) + ' 乘上余弦波 C' + k + '，下面就是它加进曲线的形状',
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

    const color = weight >= 0 ? ROW_SIGN_POSITIVE : ROW_SIGN_NEGATIVE;
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

  /* 完成态：这一行的 8 个权重。右侧原位置是「下一项」，8 项加完后改为结果总结 */
  function drawRowCoeffBars(context, data, box) {
    const values = data.coefficients;
    let maximum = 1;
    for (let k = 0; k < 8; k++) maximum = Math.max(maximum, Math.abs(values[k]));

    context.fillStyle = '#334155';
    context.font = '600 12px "Microsoft YaHei", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('这一行的 8 个权重 X(k)', box.x + 14, box.y + 22);
    context.fillStyle = '#64748b';
    context.font = '11px "Microsoft YaHei", sans-serif';
    context.fillText('已经加完 8 项，曲线与原行重合；这些就是它的频域表示', box.x + 14, box.y + 39);

    const left = box.x + 46;
    const right = box.x + box.w - 26;
    const plotTop = box.y + 62;
    const plotBottom = box.y + box.h - 56;
    const half = (plotBottom - plotTop) / 2 * 0.92;
    const zeroY = (plotTop + plotBottom) / 2;
    const slot = (right - left) / 8;

    context.strokeStyle = 'rgba(100,116,139,0.65)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, zeroY);
    context.lineTo(right, zeroY);
    context.stroke();

    for (let k = 0; k < 8; k++) {
      const value = values[k];
      const height = Math.abs(value) / maximum * half;
      const width = slot * 0.52;
      const barX = left + (k + 0.5) * slot - width / 2;
      const top = value >= 0 ? zeroY - height : zeroY;
      context.fillStyle = value >= 0 ? 'rgba(220,38,38,0.75)' : 'rgba(29,78,216,0.75)';
      context.fillRect(barX, top, width, Math.max(2, height));

      context.fillStyle = '#475569';
      context.font = '600 10px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = value >= 0 ? 'bottom' : 'top';
      context.fillText(formatValue(value), barX + width / 2,
        value >= 0 ? top - 5 : top + Math.max(2, height) + 5);

      context.fillStyle = '#94a3b8';
      context.font = '10px Consolas, monospace';
      context.textBaseline = 'top';
      context.fillText('k=' + k, left + (k + 0.5) * slot, plotBottom + 16);
    }

    context.fillStyle = '#94a3b8';
    context.font = '9.5px "Microsoft YaHei", sans-serif';
    context.textAlign = 'right';
    context.textBaseline = 'top';
    context.fillText('红 = 正权重（同相位） · 蓝 = 负权重（相位相反）', box.x + box.w - 16, box.y + 12);
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

  /* 页面底部“当前这一行/列”的画布：与上方三张矩阵同宽，两张小卡各占一半 */
  const DCT_PASS_ROW = { w: 1120, h: 236 };

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
      '<div class="dct-pass-row">' +
      canvasTag('passRow', '当前正在处理的那一行（或一列）：8 个像素与它的一维 DCT 结果') +
      '</div>';
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
    drawPassOriginal(setupCanvas('passOriginal', 380, 380).canvas, block, -1);
    setupCanvas('passTemp', 380, 380);
    setupCanvas('passFinal', 380, 380);
    setupCanvas('passRow', DCT_PASS_ROW.w, DCT_PASS_ROW.h);
    refreshDctTwoPass();
    syncTwoPassButtons();
  }

  /* 红框标记「当前正在处理的那一行/列」：淡橙覆盖 + 2.5px 边框。
     三个矩阵共用同一个函数，第一遍画在原图与中间图的同一行，第二遍画在中间图与最终图的同一列。 */
  function drawPassHighlight(context, width, height, axis, index) {
    if (!(index >= 0 && index < 8)) return;
    const cellWidth = width / 8;
    const cellHeight = height / 8;
    context.save();
    context.fillStyle = 'rgba(220,38,38,0.16)';
    context.strokeStyle = '#dc2626';
    context.lineWidth = 2.5;
    if (axis === 'row') {
      context.fillRect(0, index * cellHeight, width, cellHeight);
      context.strokeRect(1.5, index * cellHeight + 1.5, width - 3, cellHeight - 3);
    } else {
      context.fillRect(index * cellWidth, 0, cellWidth, height);
      context.strokeRect(index * cellWidth + 1.5, 1.5, cellWidth - 3, height - 3);
    }
    context.restore();
  }

  function drawPassMatrix(target, values, processed, axis, highlightAxis, highlightIndex) {
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
    drawPassHighlight(context, target.w, target.h, highlightAxis, highlightIndex);
  }

  /* 原块图：每帧重绘一次（8×8，代价极小），这样第一遍扫描时红框能跟着行走 */
  function drawPassOriginal(canvas, block, highlightRow) {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    drawCells({ canvas: canvas, ctx: context, w: 380, h: 380 }, block.pixels, function (value) {
      return grayColor(value + 128);
    }, {
      text: function (value) { return String(Math.round(value + 128)); },
      gridColor: 'rgba(255,255,255,0.55)'
    });
    drawPassHighlight(context, 380, 380, 'row', highlightRow);
  }

  function refreshDctTwoPass() {
    const block = encodedBlock();
    const temporary = rowDct(block.pixels);
    const finalCanvas = document.getElementById('passFinal');
    const tempCanvas = document.getElementById('passTemp');
    const originalCanvas = document.getElementById('passOriginal');
    const rowCanvas = document.getElementById('passRow');
    if (!finalCanvas || !tempCanvas) return;
    const rowStep = clamp(state.dctRowStep, 0, 8);
    const colStep = clamp(state.dctColStep, 0, 8);
    const inSecondPass = colStep > 0;
    /* 两阶段各自同步：第一遍原图 + 中间图框同一行，第二遍中间图 + 最终图框同一列 */
    drawPassOriginal(originalCanvas, block, inSecondPass ? -1 : rowStep - 1);
    drawPassMatrix({ canvas: tempCanvas, ctx: tempCanvas.getContext('2d'), w: 380, h: 380 },
      temporary, rowStep, 'row',
      inSecondPass ? 'col' : 'row', inSecondPass ? colStep - 1 : rowStep - 1);
    drawPassMatrix({ canvas: finalCanvas, ctx: finalCanvas.getContext('2d'), w: 380, h: 380 },
      block.coefficients, colStep, 'col', 'col', colStep - 1);
    const axis = rowStep < 8 ? 'row' : 'col';
    const index = clamp((axis === 'row' ? state.dctRowStep : state.dctColStep) - 1, 0, 7);
    if (rowCanvas) {
      drawPassRow({
        canvas: rowCanvas,
        ctx: rowCanvas.getContext('2d'),
        w: DCT_PASS_ROW.w,
        h: DCT_PASS_ROW.h
      }, axis, index);
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
      /* 首尾两根柱子的数值贴边会被裁掉，改成向内侧对齐 */
      context.textAlign = i === 0 ? 'left' : i === values.length - 1 ? 'right' : 'center';
      context.textBaseline = values[i] >= 0 ? 'bottom' : 'top';
      const labelX = i === 0 ? Math.max(box.x + 2, center - width / 2)
        : i === values.length - 1 ? Math.min(box.x + box.w - 2, center + width / 2) : center;
      context.fillText(formatValue(values[i]), labelX,
        values[i] >= 0 ? baseline - height - 4 : baseline + height + 4);
      context.fillStyle = '#94a3b8';
      context.textBaseline = 'top';
      context.fillText(String(i), center, plotBottom + 6);
    }
  }

  const QUANT_MATRIX_SIZE = 320;
  const QUANT_RULER_WIDTH = 640;
  const QUANT_RULER_HEIGHT = 88;

  /* 当前分量的量化表基数：亮度用 K.1，色度用 K.2 */
  function quantBaseTable() {
    return state.component === 'Y' ? Codec.QL_BASE : Codec.QC_BASE;
  }

  /* 按给定 QF 现算这一块的 q 与 Fq：F 与 QF 无关，所以拖拉杆时只要重算
     量化表与那一遍除法，不必把整幅图重新编码。 */
  function quantAtQuality(coefficients, quality) {
    const quant = Codec.qualityTable(quantBaseTable(), quality);
    const quantized = new Int16Array(64);
    let zeros = 0;
    let total = 0;
    let minimum = quant[0];
    let maximum = quant[0];
    for (let i = 0; i < 64; i++) {
      quantized[i] = Codec.matlabRound(coefficients[i] / quant[i]);
      if (quantized[i] === 0) zeros += 1;
      total += quant[i];
      if (quant[i] < minimum) minimum = quant[i];
      if (quant[i] > maximum) maximum = quant[i];
    }
    return {
      quant: quant,
      quantized: quantized,
      zeros: zeros,
      mean: total / 64,
      minimum: Math.round(minimum),
      maximum: Math.round(maximum)
    };
  }

  /* 四宫格、算式与参数卡统一读这个视图：始终按 state.Q 现算，
     所以拖拉杆的瞬间四张矩阵就已经是新 QF 的结果。 */
  function quantView() {
    const block = encodedBlock();
    const preview = quantAtQuality(block.coefficients, state.Q);
    return {
      coefficients: block.coefficients,
      quant: preview.quant,
      quantized: preview.quantized,
      zeros: preview.zeros,
      mean: preview.mean,
      minimum: preview.minimum,
      maximum: preview.maximum
    };
  }

  /* scale 与 QF 的换挡关系，页面上要直接读出来 */
  function qualityScale(quality) {
    return quality < 50 ? Math.floor(5000 / quality) : 200 - 2 * quality;
  }

  /* 右侧 QF 面板：只有一条拉杆，配 scale / 平均步长 / 置零三个即时读数 */
  function quantQfPanelMarkup() {
    return '<aside class="quant-qf" aria-label="质量因子 QF 对量化的影响">' +
      '<div class="qf-head"><h3>质量因子 QF</h3><span>QF =<b id="qfHeadValue">' + state.Q + '</b></span></div>' +
      '<label class="qf-range"><input type="range" id="quantQfRange" min="1" max="100" step="1" value="' + state.Q +
      '" aria-label="质量因子 QF，1 到 100"><span class="qf-ends"><em>1 最粗</em><em>100 最细</em></span></label>' +
      '<div class="qf-meta">' +
      '<div><span>scale</span><b id="qfScale">' + qualityScale(state.Q) + '</b></div>' +
      '<div><span>平均步长</span><b id="qfMean">—</b></div>' +
      '<div><span>置零</span><b id="qfZeros">—</b></div>' +
      '</div>' +
      '<p>拖动即重算左边四张图：q 变大 → 半个步长 q/2 变大 → 更多格落进置零区。</p>' +
      '</aside>';
  }

  /* 算式区 + 统计卡：量化页把它们放进左侧说明面板（首屏只留四宫格，下滚到面板才看见算例）。
     渲染时机由 renderLeft 掌握，这里只负责产出片段。 */
  function quantWorkMarkup() {
    const view = quantView();
    return '<div class="quant-work">' +
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
      '<div class="quant-foot">' + statBlock([
        ['质量因子 QF', state.Q, 'qfFootQuality'],
        ['q(u,v) 范围', view.minimum + '–' + view.maximum, 'qfFootRange'],
        ['置零系数', view.zeros + ' / 64', 'qfFootZeros'],
        ['零系数占比', (100 * view.zeros / 64).toFixed(1) + '%', 'qfFootRatio']
      ]) + '</div>';
  }

  /* 量化页：左边 F → q → F/q → Fq 四宫格，右边一整列专门讲 QF 怎么改量化；
   * 点选任意格 = 把那一格的 F、q、商、取整结果、反量化回看与误差一起摊在下方面板里。 */
  function renderQuantStep() {
    stage.innerHTML = '<div class="quant-layout">' +
      '<div class="quant-grid">' +
      figure('quantSource', '① DCT 原始系数 F(u,v)（蓝负红正）') +
      figure('quantTable', '② 量化步长 q(u,v)：颜色越暖步长越大') +
      figure('quantQuotient', '③ F ÷ q（取整前；浅橙底 = 不足半个步长，必被置零）') +
      figure('quantCoeff', '④ 四舍五入后的 Fq(u,v)（红叉 = 0）') +
      '</div>' +
      quantQfPanelMarkup() +
      '</div>';
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
    bindQuantQfControls();
    syncQfSweepButton();
    paintQuantStep();
    paintQuantQf();
  }

  /* QF 面板的交互：拖动时只现算这一块，松手（change）才整幅重编码 */
  function bindQuantQfControls() {
    const range = document.getElementById('quantQfRange');
    if (!range) return;
    range.addEventListener('input', function () {
      applyQuantQuality(Number(range.value), false);
    });
    range.addEventListener('change', function () {
      applyQuantQuality(Number(range.value), true);
    });
  }

  /* commit = true：整幅图跟着重编码并重绘（松手时用）。
     commit = false：只重画量化页这几块画布，拖动时不卡手。 */
  function applyQuantQuality(quality, commit) {
    state.Q = clamp(Math.round(Number(quality) || 50), 1, 100);
    const range = document.getElementById('quantQfRange');
    if (range && Number(range.value) !== state.Q) range.value = String(state.Q);
    if (commit) {
      rebuild();
      return;
    }
    paintQuantStep();
    paintQuantQf();
    refreshStepParams();
  }

  /* 扫掠：QF 从 100 匀速走到 5 看「格怎么被清光」，结束后回到开播前的 QF——
     不然整份演示会停在 QF=5，后面每节的 PSNR 与文件体积都被这次演示带走。 */
  function startQfSweep() {
    if (state.step !== 5) return;
    if (state.qfTimer) {
      stopQfSweep(true);
      return;
    }
    /* 减少动态效果偏好下不做动画：直接落到最粗一档，再点一次回到原来的 QF */
    if (ANIM.reduced) {
      if (typeof state.qfReturn === 'number') {
        const back = state.qfReturn;
        state.qfReturn = null;
        applyQuantQuality(back, true);
      } else {
        state.qfReturn = state.Q;
        applyQuantQuality(5, true);
      }
      return;
    }
    const total = 40;
    let tick = 0;
    state.qfReturn = state.Q;
    applyQuantQuality(100, false);
    state.qfTimer = setInterval(function () {
      tick += 1;
      const progress = ANIM.progress('qfsweep', tick, total);
      applyQuantQuality(Math.round(100 + (5 - 100) * progress), false);
      if (tick >= total) stopQfSweep(true);
    }, ANIM.interval('qfsweep', total));
    syncQfSweepButton();
  }

  /* restore = true：停下来的同时把 QF 复位到开播前的值，并重编码一次 */
  function stopQfSweep(restore) {
    const running = !!state.qfTimer;
    if (state.qfTimer) {
      clearInterval(state.qfTimer);
      state.qfTimer = null;
    }
    syncQfSweepButton();
    if (!restore || !running) return;
    const target = typeof state.qfReturn === 'number' ? state.qfReturn : 50;
    state.qfReturn = null;
    applyQuantQuality(target, true);
  }

  /* 扫掠按钮在左侧工具区：扫掠进行时把它改写成「停止」 */
  function syncQfSweepButton() {
    const tools = document.getElementById('stepTools');
    if (!tools) return;
    Array.prototype.forEach.call(tools.querySelectorAll('button'), function (item) {
      if (item.getAttribute('data-action') !== 'qfsweep') return;
      item.textContent = state.qfTimer ? '停止 QF 扫掠' : 'QF 扫掠 100 → 5';
    });
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
    const view = quantView();
    const focus = quantFocusIndex(view);
    drawQuantSource(source, view, focus);
    drawQuantTable(quantTarget('quantTable'), view, focus);
    drawQuantQuotient(quantTarget('quantQuotient'), view, focus);
    drawQuantizedCells(quantTarget('quantCoeff'), view, focus);
    drawQuantRuler(quantTarget('quantRuler'), view, focus);
    updateQuantWork(view, focus);
  }

  /* QF 面板随 state.Q 刷新：QF 值、scale、平均步长、置零数，以及下方面板的统计卡 */
  function paintQuantQf() {
    const view = quantView();
    const setText = function (id, text) {
      const node = document.getElementById(id);
      if (node) node.textContent = text;
    };
    setText('qfHeadValue', String(state.Q));
    setText('qfScale', String(qualityScale(state.Q)));
    setText('qfMean', view.mean.toFixed(1));
    setText('qfZeros', view.zeros + ' / 64');
    /* 统计卡（在下方面板里）跟着同一个 QF 走 */
    setText('qfFootQuality', String(state.Q));
    setText('qfFootRange', view.minimum + '–' + view.maximum);
    setText('qfFootZeros', view.zeros + ' / 64');
    setText('qfFootRatio', (100 * view.zeros / 64).toFixed(1) + '%');

    const range = document.getElementById('quantQfRange');
    if (range && Number(range.value) !== state.Q) range.value = String(state.Q);
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
    stage.innerHTML = '<div class="stage-flex" style="justify-content:center"><div class="stage-col hug">' +
      figure('zigMain', '左图：系数在矩阵里「原本的位置」<br><span style="color:#64748b">大字 = 非零值（空白格 = 0），右下角 #n = 扫描次序</span>') +
      '</div><div style="width:320px">' +
      figure('zigSeq', '右图：扫描得到的一维序列「按次序排队」<br><span style="color:#64748b">格内大字 = 扫到这一格得到的数值（未扫到的先空着），行优先读下来就是 #1…#64，底色 = 系数大小</span>') +
      '</div></div>';
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
      const scanned = order < state.zigStep;
      const rgb = heatColor(value, maximum);
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
      /* 未扫到的格子压一层白：已扫的保持原色，路径推进时"亮起来的轨迹"就是扫描顺序 */
      if (!scanned) {
        context.fillStyle = 'rgba(255,255,255,0.66)';
        context.fillRect(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
      }
      /* 零值不写字：矩阵里大半是 0，留白反而让非零系数跳出来 */
      if (value !== 0) {
        context.fillStyle = scanned ? textColor(rgb) : '#8fa0b6';
        context.font = '700 13px Consolas, monospace';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(formatValue(value), column * cellWidth + cellWidth / 2, row * cellHeight + cellHeight / 2 - 3);
      }
      context.fillStyle = scanned ? 'rgba(30,41,59,0.32)' : 'rgba(148,163,184,0.55)';
      context.font = '600 7px Consolas, monospace';
      context.textAlign = 'right';
      context.textBaseline = 'bottom';
      context.fillText('#' + (order + 1), column * cellWidth + cellWidth - 3, row * cellHeight + cellHeight - 2);
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
    context.strokeStyle = 'rgba(148,163,184,0.55)';
    context.lineWidth = 1.2;
    context.setLineDash([3, 3]);
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
    /* 数值随扫描逐个填进来：还没扫到的格子只留空槽，扫到哪一格才显示哪一格的值 */
    const revealed = clamp(Math.round(typeof state.zigStep === 'number' ? state.zigStep : 64), 0, 64);
    for (let index = 0; index < 64; index++) {
      const row = Math.floor(index / 8);
      const column = index % 8;
      const x = column * cellWidth;
      const y = row * cellHeight;
      if (index >= revealed) {
        /* 空槽与「值为 0 的格」要一眼分得开：浅底 + 一个灰点，表示这一格还没轮到 */
        context.fillStyle = 'rgba(241,245,249,0.92)';
        context.fillRect(x, y, cellWidth, cellHeight);
        context.fillStyle = 'rgba(148,163,184,0.55)';
        context.font = '700 12px "Segoe UI", system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('·', x + cellWidth / 2, y + cellHeight / 2);
        continue;
      }
      const value = block.scan[index];
      const rgb = value === 0 ? RGB.empty : heatColor(value, maximum);
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      context.fillRect(x, y, cellWidth, cellHeight);
      /* 格内大字 = 扫描得到的数值本身；行优先读下来就是 #1…#64，不再逐格标序号 */
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = value === 0 ? 'rgba(100,116,139,0.75)' : textColor(rgb);
      context.font = '700 ' + Math.round(clamp(cellHeight * 0.44, 11, 16)) + 'px Consolas, monospace';
      context.fillText(formatValue(value), x + cellWidth / 2, y + cellHeight / 2 + 1);
      if (index === revealed - 1) {
        context.strokeStyle = '#c2410c';
        context.lineWidth = 2.5;
        context.strokeRect(x + 1.5, y + 1.5, cellWidth - 3, cellHeight - 3);
      }
    }
    context.strokeStyle = 'rgba(255,255,255,0.7)';
    context.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      context.beginPath(); context.moveTo(i * cellWidth, 0); context.lineTo(i * cellWidth, target.h); context.stroke();
      context.beginPath(); context.moveTo(0, i * cellHeight); context.lineTo(target.w, i * cellHeight); context.stroke();
    }
  }

  /* 双轨图逻辑画布：宽 1240 让 64 格每格接近 20 个单位宽（两位数能写到 12px），
     高 300 给上轨系数带与下轨符号格各自留出可读的两行高度 */
  const RLE_STRIP_WIDTH = 1240;
  const RLE_STRIP_HEIGHT = 300;

  function renderRleStep() {
    const block = encodedBlock();
    /* 本页只用双轨图讲「一个符号管哪几个系数」，符号明细表留给后面的 Huffman 页 */
    state.rleStep = 0;
    stage.innerHTML = '<figure>' +
      canvasTag('rleStrip', '上排是 64 个 Zigzag 系数，下排每个格子是一个符号：AC 写作 (run, size)，run 是前面跳过的零个数，size 是幅值位数；第二行是该符号的数值。橙色连线表示当前符号负责哪几个系数') +
      '<figcaption>上排 = 64 个 Zigzag 系数（#1 低频 → #64 高频，浅灰 = 0）；下排 = 符号序列，格内两行是「符号 / 它代表的数值」，橙线 = 当前符号管着哪几个系数</figcaption></figure>' +
      '<div class="rle-anatomy" id="rleAnatomy">' + rleAnatomyHTML(block) + '</div>' +
      '<p class="note" id="rleReadout"></p>';
    drawRleStrip(setupCanvas('rleStrip', RLE_STRIP_WIDTH, RLE_STRIP_HEIGHT), block, -1);
    updateRleReadout();
  }

  /* 「符号怎么读」：把本块前 4 个符号逐个拆成 run / size / 幅值位，
     比只看 (3,3) 这种编号更容易对上右侧的数值 */
  function rleAnatomyHTML(block) {
    const symbols = block.symbols;
    if (!symbols.length) return '';
    /* 固定取开头 1 个 DC + 2 个 AC，再补一个 run > 0 的 AC：
       否则前几项常常全是 (0,size)，看不出“跳过几个 0”到底在说什么 */
    const picked = [{ symbol: symbols[0], index: 0 }];
    for (let i = 1; i < symbols.length && picked.length < 3; i++) {
      picked.push({ symbol: symbols[i], index: i });
    }
    for (let i = 1; i < symbols.length; i++) {
      if (symbols[i].kind === 'AC' && symbols[i].run > 0 &&
          !picked.some(function (item) { return item.index === i; })) {
        picked.push({ symbol: symbols[i], index: i });
        break;
      }
    }
    const cards = picked.map(function (entry) {
      const symbol = entry.symbol;
      let label;
      let lines = [];
      let bits = symbol.amplitude;
      if (symbol.kind === 'DC') {
        label = 'DC(' + symbol.size + ')';
        lines.push('不数 0：这是整块的平均亮度');
        lines.push('与上一块差 ' + (symbol.value > 0 ? '+' : '') + symbol.value + '，占 ' + symbol.size + ' 位');
      } else if (symbol.kind === 'ZRL') {
        label = 'ZRL';
        lines.push('固定符号 0xF0：16 个连续 0');
        lines.push('一个符号打包带走');
      } else if (symbol.kind === 'EOB') {
        label = 'EOB';
        lines.push('(0,0)：后面全是 0');
        lines.push('到此收尾，不必再写');
      } else {
        label = '(' + symbol.run + ',' + symbol.size + ')';
        lines.push('run = ' + symbol.run + ' → ' +
          (symbol.run > 0 ? '前面跳过 ' + symbol.run + ' 个 0' : '前面没有 0'));
        lines.push('size = ' + symbol.size + ' → 数值 ' + symbol.value + ' 要 ' + symbol.size + ' 位');
      }
      return '<div class="rle-anatomy-card">' +
        '<div class="rle-anatomy-head"><b>' + label + '</b><em>#' + (entry.index + 1) + '</em></div>' +
        lines.map(function (line) { return '<p>' + line + '</p>'; }).join('') +
        (bits ? '<p class="rle-anatomy-bits">幅值位 <b>' + bits + '</b></p>' : '') +
        '</div>';
    }).join('');
    return '<p class="subcap">符号怎么读：挑 4 个典型符号拆开（含一个跳过 0 的例子）</p>' +
      '<div class="rle-anatomy-row">' + cards + '</div>';
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

  /* 下轨格内第二行：这个符号实际代表的数值。
     DC/AC 就是系数的量化值；ZRL/EOB 覆盖的全是 0，直接标出 0 的个数。 */
  function symbolValueText(symbol, span) {
    if (symbol.kind === 'DC' || symbol.kind === 'AC') return String(symbol.value);
    const zeros = span ? Math.max(1, span.end - span.start + 1) : 16;
    return '0×' + zeros;
  }

  /* 双轨图：上轨 = 64 个系数（按扫描顺序），下轨 = 符号序列（按符号等分）。
     两轨用同一条橙色折线连起来，表示「这个符号替我们覆盖了哪几个系数」。
     下轨每格两行：符号 / 它代表的数值，不必来回对照下面的表。 */
  function drawRleStrip(target, block, activeIndex) {
    const context = target.ctx;
    const width = target.w;
    const cellWidth = width / 64;
    /* 标题行 32 + 上轨 100 + 连线区 42 + 下轨（余下高度）：300 的高度里
       两条轨道各占三分之一上下，中间留出橙线折弯的走廊 */
    const titleBaseline = 20;
    const laneTop = 34;
    const laneHeight = Math.max(72, Math.round(target.h * 0.33));
    const symTop = laneTop + laneHeight + 42;
    const symHeight = Math.max(64, target.h - symTop - 10);
    const symbols = block.symbols;
    const spans = rleSpans(block);
    const symWidth = width / Math.max(1, symbols.length);
    let maximum = 1;
    for (let i = 0; i < 64; i++) maximum = Math.max(maximum, Math.abs(block.scan[i]));
    context.clearRect(0, 0, width, target.h);

    context.fillStyle = '#52627a';
    context.font = '600 13px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('上排 · 64 个 Zigzag 系数（#1 = 低频 … #64 = 高频，浅灰 = 0）', 0, titleBaseline);
    context.textAlign = 'right';
    context.fillText('下排 · AC = (run, size)：run = 跳过几个 0，size = 幅值位数', width, titleBaseline);

    for (let i = 0; i < 64; i++) {
      const value = block.scan[i];
      const rgb = value === 0 ? RGB.empty : heatColor(value, maximum);
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      context.fillRect(i * cellWidth, laneTop, cellWidth + 0.4, laneHeight);
      /* 数值直接写在格子里，零也写出来：一眼能看出"后半截全是 0"；
         字号从 12 起逐档缩小，直到实测宽度塞进格子，三位数也不会压到邻居格 */
      const numberText = String(value);
      let numberSize = 12;
      context.font = '700 ' + numberSize + 'px Consolas, monospace';
      while (numberSize > 8 && context.measureText(numberText).width > cellWidth - 3) {
        numberSize -= 0.5;
        context.font = '700 ' + numberSize + 'px Consolas, monospace';
      }
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = value === 0 ? '#94a3b8' : textColor(rgb);
      context.fillText(numberText, i * cellWidth + cellWidth / 2, laneTop + laneHeight / 2);
      /* 零系数在底部补一条浅灰：连续零读起来就是一排空槽，而不是一片白 */
      if (value === 0) {
        context.fillStyle = 'rgba(148,163,184,0.3)';
        context.fillRect(i * cellWidth, laneTop + laneHeight - 4, cellWidth + 0.4, 4);
      }
    }
    /* 格内文字按实测宽度收字号：(15,11) 这类长符号也不会顶出格边 */
    const fitTextSize = function (text, maximum, floor) {
      let size = maximum;
      context.font = '700 ' + size.toFixed(1) + 'px Consolas, monospace';
      while (size > floor && context.measureText(text).width > symWidth - 10) {
        size -= 0.5;
        context.font = '700 ' + size.toFixed(1) + 'px Consolas, monospace';
      }
    };
    symbols.forEach(function (symbol, index) {
      const x = index * symWidth;
      const active = index === activeIndex;
      const color = symbol.kind === 'DC' ? '#1d4ed8' : symbol.kind === 'ZRL' ? '#7c3aed' :
        symbol.kind === 'EOB' ? '#475569' : '#c2410c';
      context.fillStyle = active ? 'rgba(194,65,12,0.16)' : '#f8fafc';
      context.fillRect(x + 1, symTop, Math.max(2, symWidth - 2), symHeight);
      context.strokeStyle = active ? '#c2410c' : '#dbe4ef';
      context.lineWidth = active ? 2 : 1;
      context.strokeRect(x + 1.5, symTop + 0.5, Math.max(2, symWidth - 3), symHeight - 1);
      const centerY = symTop + symHeight / 2;
      const labelText = symbolLabel(symbol);
      const valueText = symbolValueText(symbol, spans[index]);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      if (symWidth > 24) {
        context.fillStyle = active ? '#c2410c' : color;
        fitTextSize(labelText, Math.min(14, symWidth / 4.8), 8);
        context.fillText(labelText, x + symWidth / 2, centerY - 11);
      }
      /* 第二行直接写这个符号代表的数值，两行在格内上下居中 */
      if (symWidth > 18) {
        context.fillStyle = active ? '#c2410c' : '#334155';
        fitTextSize(valueText, Math.min(13, symWidth / 5.4), 8);
        context.fillText(valueText, x + symWidth / 2, centerY + 11);
      }
    });

    if (activeIndex >= 0 && spans[activeIndex]) {
      const span = spans[activeIndex];
      const left = span.start * cellWidth;
      const right = (span.end + 1) * cellWidth;
      context.strokeStyle = '#c2410c';
      context.lineWidth = 2.2;
      context.strokeRect(left + 1.2, laneTop + 1.2, Math.max(2, right - left - 2.4), laneHeight - 2.4);
      const middle = (left + right) / 2;
      const cx = activeIndex * symWidth + symWidth / 2;
      context.lineWidth = 1.5;
      context.setLineDash([4, 3]);
      context.beginPath();
      context.moveTo(middle, laneTop + laneHeight);
      context.lineTo(middle, symTop - 8);
      context.lineTo(cx, symTop - 8);
      context.lineTo(cx, symTop);
      context.stroke();
      context.setLineDash([]);
    }
  }

  function refreshRleStrip() {
    const canvas = document.getElementById('rleStrip');
    if (!canvas) return;
    const block = encodedBlock();
    drawRleStrip({
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      w: RLE_STRIP_WIDTH,
      h: RLE_STRIP_HEIGHT
    }, block, state.rleStep - 1);
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
    /* 版面：标准表在上，位流与码字清单在下；标题与收益读数已按演示需要移除 */
    const chips = unique.map(function (symbol) {
      const value = symbol.kind === 'AC' || symbol.kind === 'DC' ? symbol.value : '—';
      return '<span class="huff-code" title="值 ' + value + '，码字 ' + symbol.code +
        '，合计 ' + (symbol.code.length + symbol.amplitude.length) + ' bit">' +
        '<b>' + symbolLabel(symbol) + '</b>' +
        '<i>' + symbol.code + '</i>' +
        '<em>' + (symbol.code.length + symbol.amplitude.length) + 'b</em></span>';
    }).join('');
    stage.innerHTML = huffmanTableHTML() +
      '<div class="bits bitstream" id="huffBits">' + bitGroupsHTML(block) + '</div>' +
      huffStreamHTML(block) +
      '<div class="huff-codes">' +
      '<span class="huff-stat">' + unique.length + ' 个唯一码字 · ' +
      block.symbols.length + ' 个符号 · ' + block.bits.length + ' bit · 平均 ' +
      (block.bits.length / block.symbols.length).toFixed(2) + ' bit/符号</span>' +
      chips + '</div>' +
      '<p class="note" id="huffReadout"></p>';
  }

  /* 编码后的数据样式：把本块的十几个小段首尾相接，得到真正写进码流的 0/1 串。
     蓝 = 查表得到的 Huffman 码字，黄 = 紧跟其后的幅值位；
     虚线按整幅码流的真实字节边界插入（起点偏移取该块的 bitStart），
     所以读者看到的就是这一块落在 .jpg 熵编码段里的样子。 */
  function huffStreamHTML(block) {
    const bits = block.bits;
    const kinds = new Array(bits.length);
    let position = 0;
    block.symbols.forEach(function (symbol) {
      let i;
      for (i = 0; i < symbol.code.length; i++) kinds[position + i] = 'c';
      position += symbol.code.length;
      for (i = 0; i < symbol.amplitude.length; i++) kinds[position + i] = 'a';
      position += symbol.amplitude.length;
    });
    const offset = (block.bitStart || 0) % 8;
    let html = '';
    let index = 0;
    while (index < bits.length) {
      if (index > 0 && (index + offset) % 8 === 0) html += '<i class="bytegap"></i>';
      const kind = kinds[index] || 'c';
      /* 同类比特连成一段，但到字节边界就断开，好让虚线正好落在 8 位分组处 */
      let stop = index + 1;
      while (stop < bits.length && (kinds[stop] || 'c') === kind && (stop + offset) % 8 !== 0) stop += 1;
      /* 首段不满 8 位 = 本块从该字节中途开始，前面几位属于上一块 */
      const head = index === 0 && offset > 0 ? ' partial' : '';
      html += '<span class="' + kind + head + '">' + bits.slice(index, stop) + '</span>';
      index = stop;
    }
    const stats = state.encoded.stats;
    return '<div class="huff-stream">' +
      '<div class="huff-stream-head">编码后的数据：' + block.symbols.length +
      ' 个符号首尾相接 → <b>' + bits.length + ' bit</b>，原样写进码流</div>' +
      '<div class="huff-bitline">' + html + '</div>' +
      '<p class="huff-legend">' +
      '<span class="lg-c"><i></i>Huffman 码字</span>' +
      '<span class="lg-a"><i></i>幅值位（系数本身的数值）</span>' +
      '<span class="lg-g"><i></i>字节边界（每 8 位）</span>' +
      (offset > 0 ? '<span class="lg-note">灰底那段只有 ' + (8 - offset) +
        ' 位：该字节前 ' + offset + ' 位已被上一块用掉</span>' : '') +
      '</p>' +
      '<p class="note">块与块之间不补位：这 ' + bits.length + ' 位后面直接接下一块的码字。' +
      '整幅 ' + stats.totalBits + ' bit 全部写完后，末尾补 ' + stats.paddingBits +
      ' 个 1 凑满最后一字节，共 ' + stats.entropyBytes + ' 字节熵编码数据（不含表与标记）。</p>' +
      '</div>';
  }

  /* 07.3 Huffman 表页：先看 BITS 分布（每个码长几个码字），再看 DC/AC 码字清单 */

  /* 原 07.3 的标准原文表，放在 Huffman 页最上方：K.3 全表 + K.5 上下两半，固定三列。
     三列并排时每张只有列宽那么大，扫描件里的小字会糊成一团，
     因此每张都可以点开按原尺寸看（Esc 或点空白处关闭）。 */
  /* 表图只留图片本身，图注与“原版整页”链接都不再显示；
     表格名称仍写进 alt 与放大层的标签，读屏与放大视图仍能知道这是哪张表 */
  function tableFigureHTML(id, source, alt, label) {
    return '<figure class="t81-fig" id="' + id + '" data-zoom="' + source + '" data-zoom-label="' + label + '"' +
      ' tabindex="0" role="button" aria-label="放大查看 ' + label + '">' +
      '<img src="' + source + '" alt="' + alt + '"></figure>';
  }

  function huffmanTableHTML() {
    return '<div class="t81-tables">' +
      tableFigureHTML('t81DcTable', 'assets/t81_table_k3_dc.png',
        'ITU-T T.81 Table K.3 亮度 DC Huffman 表', 'Table K.3') +
      tableFigureHTML('t81AcTable', 'assets/t81_k5_top.png',
        'ITU-T T.81 Table K.5 亮度 AC Huffman 表上半 0/0–1/7', 'Table K.5 上半') +
      tableFigureHTML('t81AcTable2', 'assets/t81_k5_bottom.png',
        'ITU-T T.81 Table K.5 亮度 AC Huffman 表下半 1/8–3/A', 'Table K.5 下半') +
      '</div>';
  }

  /* 标准表原图放大层：只用到页面里的一层覆盖，不改变列表本身的尺寸，
     所以“一屏装下”不会被破坏，需要看小字时再点开。 */
  let zoomLayer = null;

  function closeTableZoom() {
    if (!zoomLayer) return;
    zoomLayer.classList.remove('on');
    document.body.classList.remove('zoom-open');
    document.removeEventListener('keydown', zoomKeydown);
  }

  function zoomKeydown(event) {
    if (event.key === 'Escape') {
      closeTableZoom();
      event.preventDefault();
    }
  }

  function openTableZoom(source, label) {
    if (!zoomLayer) {
      zoomLayer = document.createElement('div');
      zoomLayer.className = 'zoom-layer';
      zoomLayer.setAttribute('role', 'dialog');
      zoomLayer.setAttribute('aria-modal', 'true');
      zoomLayer.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure>' +
        '<p class="zoom-hint">点击任意处或按 Esc 关闭</p>';
      zoomLayer.addEventListener('click', closeTableZoom);
      document.body.appendChild(zoomLayer);
    }
    const image = zoomLayer.querySelector('img');
    image.src = source;
    image.alt = label || '标准表原图';
    zoomLayer.querySelector('figcaption').textContent = label || '';
    zoomLayer.classList.add('on');
    document.body.classList.add('zoom-open');
    document.addEventListener('keydown', zoomKeydown);
  }

  /* 图与文字每次切步都会重建，放大层用 document 级委托，绑一次就够 */
  function bindTableZoomEvents() {
    if (typeof document.addEventListener !== 'function') return;
    document.addEventListener('click', function (event) {
      if (!event.target.closest) return;
      /* 图注里还留着“原版整页”的外链，点链接就让它照常新开标签 */
      if (event.target.closest('a')) return;
      const target = event.target.closest('[data-zoom]');
      if (!target) return;
      event.preventDefault();
      openTableZoom(target.getAttribute('data-zoom'), target.getAttribute('data-zoom-label'));
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target.closest && event.target.closest('[data-zoom]');
      if (!target) return;
      event.preventDefault();
      openTableZoom(target.getAttribute('data-zoom'), target.getAttribute('data-zoom-label'));
    });
  }


  /* MCU 方块图的逻辑边长：正方形画布，64×64 个 MCU 各占一个正方形格子 */
  const BIT_ASSEMBLY_SIZE = 900;

  function renderBitstreamStep() {
    const stats = state.encoded.stats;
    stage.innerHTML = metricCards([
      ['总位数', stats.totalBits, '熵编码段'],
      ['字节数', stats.entropyBytes, '不含文件头'],
      ['压缩比', (state.width * state.height * 24 / (8 * stats.entropyBytes)).toFixed(1) + '×', '相对 RGB 原始数据'],
      ['Y 分量位数', stats.bitsPerComponent.Y, (100 * stats.bitsPerComponent.Y / stats.totalBits).toFixed(1) + '%'],
      ['Cb 分量位数', stats.bitsPerComponent.Cb, (100 * stats.bitsPerComponent.Cb / stats.totalBits).toFixed(1) + '%'],
      ['Cr 分量位数', stats.bitsPerComponent.Cr, (100 * stats.bitsPerComponent.Cr / stats.totalBits).toFixed(1) + '%']
    ]) + '<p class="note" style="margin-top:10px">下面三张图是同一个数的三种看法：按分量拆（柱状）、按块看分布（直方）、按空间位置铺开（方块图）。全部只统计熵编码段，不含文件头。</p>' +
      '<div class="grid-3 bit-overview" style="margin-top:12px">' +
      figure('bitBars', '各分量位数占比（柱高 = 该分量占用的总位数）') +
      figure('bitHist', '块位数分布（横轴 = 每块位数，纵轴 = 有多少块落在这一档）') +
      '<figure><canvas id="bitAssembly" role="img" aria-label="按 MCU 顺序拼接位流，一格一个 MCU，正方形网格，颜色越深位数越多"></canvas>' +
      '<figcaption>整个画面按 MCU 铺开：一格 = 一个 MCU（正方形），颜色越深 = 这一块位数越多</figcaption></figure>' +
      '</div>' +
      '<p class="note" id="assemblyReadout"></p>';
    drawBitBars(setupCanvas('bitBars', 520, 360));
    drawBitHistogram(setupCanvas('bitHist', 520, 360));
    /* 画布取正方形：64×64 个 MCU 各占一个正方形格子，整张图与画面本身同比例 */
    drawBitAssembly(setupCanvas('bitAssembly', BIT_ASSEMBLY_SIZE, BIT_ASSEMBLY_SIZE), state.assemblyStep);
    refreshAssemblyReadout();
  }

  function drawBitAssembly(target, step) {
    const mcus = state.encoded.mcus;
    const context = target.ctx;
    const columns = Math.ceil(Math.sqrt(mcus.length));
    const rows = Math.ceil(mcus.length / columns);
    /* 一格 = 一个正方形：边长取「可用宽」与「可用高（扣掉底部读数）」里较小的那个，
       再把网格整体水平居中，格子因此永远宽高相等，不会被画布形状拉扁。 */
    const labelHeight = 22;
    const cellSide = Math.max(1, Math.floor(Math.min(target.w, target.h - labelHeight) / Math.max(columns, rows)));
    const gridWidth = cellSide * columns;
    const gridHeight = cellSide * rows;
    const originX = (target.w - gridWidth) / 2;
    const originY = Math.max(0, (target.h - labelHeight - gridHeight) / 2);
    let maximum = 1;
    let minimum = Infinity;
    mcus.forEach(function (mcu) {
      let bits = 0;
      mcu.blocks.forEach(function (block) { bits += block.bits.length; });
      maximum = Math.max(maximum, bits);
      minimum = Math.min(minimum, bits);
    });
    if (!isFinite(minimum)) minimum = 0;
    /* 块位数高度集中（多数落在很窄的区间），直接按 0→最大值 上色会一片同色。
       改成按最小→最大拉伸，再用平方根抬一点中间调，块与块之间的差异才看得出来。 */
    const span = Math.max(1, maximum - minimum);
    /* 格子之间的白缝随格子变大：小图时不至于把格子吃光，大图时也不至于黏成一整块 */
    const inset = Math.max(0.45, Math.min(1.4, cellSide * 0.07));
    context.clearRect(0, 0, target.w, target.h);
    mcus.forEach(function (mcu, index) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      let bits = 0;
      mcu.blocks.forEach(function (block) { bits += block.bits.length; });
      const processed = step >= mcus.length || index < step;
      const level = Math.min(1, Math.sqrt(Math.max(0, bits - minimum) / span));
      const rgb = processed ? mixRGB([236, 242, 252], [29, 78, 216], level) : RGB.empty;
      const x = originX + column * cellSide;
      const y = originY + row * cellSide;
      context.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      context.fillRect(x + inset, y + inset, cellSide - inset * 2, cellSide - inset * 2);
      if (step > 0 && step < mcus.length && index === step - 1) {
        context.strokeStyle = '#c2410c';
        context.lineWidth = 2;
        context.strokeRect(x + inset, y + inset, cellSide - inset * 2, cellSide - inset * 2);
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
      context.textBaseline = 'alphabetic';
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

  /* 熵解码页：静态展示整块的解码结果，不做逐步播放。
     三段内容从上到下：指标卡 → 逐符号码字格 → 位流片段；
     重复的进度条与汇总卡已去掉，幅值位统计并入码字格标题。 */
  function renderDecEntropyStep() {
    const block = encodedBlock();
    const decoded = decodedBlock();
    const same = sameSymbols(block.symbols, decoded.symbols);
    let ampBits = 0;
    block.symbols.forEach(function (symbol) { ampBits += symbol.amplitude.length; });
    const ampShare = Math.round(100 * ampBits / Math.max(1, block.bitEnd - block.bitStart));
    const start = Math.max(0, block.bitStart - 8);
    const end = Math.min(state.encoded.bitstream.length, block.bitEnd + 8);
    const snippet = state.encoded.bitstream.slice(start, end);
    const usedStart = block.bitStart - start;
    const usedEnd = block.bitEnd - start;
    stage.innerHTML = '<div class="decode-layout">' +
      '<div class="decode-stats">' + statBlock([
        ['位范围', block.bitStart + '–' + block.bitEnd],
        ['本块位数', (block.bitEnd - block.bitStart) + ' bit'],
        ['符号数（编码 → 解码）', block.symbols.length + ' → ' + decoded.symbols.length],
        ['一致性', '<span class="' + (same ? 'ok' : 'warn') + '">' + (same ? '逐位一致' : '不一致') + '</span>']
      ]) + '</div>' +
      /* 逐符号读法：沿用 07.3 熵编码页的码字格——序号 + 符号名 + Huffman 码字 + 幅值位(=数值)。
         幅值位统计并入标题，避免和上面的指标卡重复。 */
      '<div class="decode-symbols">' +
      '<div class="decode-symbols-head"><b>本块逐符号读法</b>' +
      '<span>' + block.symbols.length + ' 个符号首尾相接 = ' + (block.bitEnd - block.bitStart) +
      ' bit；其中幅值位 ' + ampBits + ' bit（' + ampShare + '%），按编码顺序从左到右读出</span></div>' +
      '<div class="bits bitstream" id="decodeChips">' +
      block.symbols.map(decodeChipHTML).join('') +
      '</div>' +
      '<p class="huff-legend">' +
      '<span><i class="lg-c"></i>Huffman 码字</span>' +
      '<span><i class="lg-a"></i>幅值位（= 还原出的系数）</span>' +
      '<span class="lg-note">每格对应一个已解码符号，悬停可看完整位串</span></p>' +
      '</div>' +
      '<div class="decode-stream">' +
      '<div class="decode-stream-head"><b>位流片段</b>' +
      '<span>本块占第 ' + block.bitStart + '–' + block.bitEnd + ' 位，前后各取 8 位当上下文</span></div>' +
      '<div class="bits" id="decodeBitStrip">' + snippet.split('').map(function (bit, index) {
        const used = index >= usedStart && index < usedEnd;
        return '<span class="' + (bit === '1' ? 'one' : 'zero') + (used ? ' used' : '') + '">' + bit + '</span>';
      }).join('') + '</div>' +
      '<p class="decode-legend">' +
      '<span><i class="lg-used"></i>本块已解码</span>' +
      '<span><i class="lg-cursor">▮</i>读游标</span>' +
      '<span><i class="lg-rest"></i>上下文（不属于本块）</span></p>' +
      '<p class="note" id="decodeReadout"></p>' +
      '</div>' +
      '</div>';
    /* 本页静态展示完整解码结果：所有格子都已读出，位游标落在块尾 */
    state.decodeStep = block.symbols.length;
    updateDecodeReadout();
    refreshDecodeBits();
    refreshDecodeChips(true);
  }

  /* 熵解码页沿用 07.3 熵编码页的位流格：一格一个符号，竖排
     「符号名 / 码字 / 幅值位(=系数值)」。static 进页时状态由 refreshDecodeChips 填。 */
  function decodeChipHTML(symbol, index) {
    const hasValue = symbol.kind === 'DC' || symbol.kind === 'AC';
    const valueText = hasValue ? String(symbol.value) : '';
    const order = typeof index === 'number' ? index + 1 : 1;
    const title = '第 ' + order + ' 个符号 · ' + symbolLabel(symbol) + '：码字 ' + symbol.code +
      (symbol.amplitude ? ' + 幅值位 ' + symbol.amplitude : '（无幅值位）') +
      (hasValue ? ' = ' + valueText : '');
    return '<span class="bitgroup" title="' + escapeHTML(title) + '">' +
      '<span class="chip-head"><i class="chip-no">' + String(order).padStart(2, '0') + '</i>' +
      '<em class="groupname">' + escapeHTML(symbolLabel(symbol)) + '</em></span>' +
      '<i class="codebits">' + colorBits(symbol.code) + '</i>' +
      (symbol.amplitude
        ? '<span class="amprow"><i class="ampbits">' + colorBits(symbol.amplitude) + '</i>' +
          (hasValue ? '<em class="ampvalue">= ' + escapeHTML(valueText) + '</em>' : '') + '</span>'
        : '') +
      '</span>';
  }

  /* 本页静态展示完整结果：所有格子统一标成已读；completed 参数只留作收尾语义。 */
  function refreshDecodeChips(completed) {
    const host = document.getElementById('decodeChips');
    if (!host) return;
    /* completed 用于动画收尾：最后一步也算「已读」，不再留橙框 */
    const step = completed ? Infinity : state.decodeStep;
    Array.prototype.forEach.call(host.querySelectorAll('.bitgroup'), function (chip, index) {
      const order = index + 1;
      chip.classList.toggle('done', step > 0 && order < step);
      chip.classList.toggle('active', order === step);
      chip.classList.toggle('pending', step > 0 && order > step);
    });
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

  /* 原 08.4 与原 09 合并为一页：第一遍解码结果是主视图，二次压缩收进可展开区。
     “第一次重建”就是上面第二张图，不再重复画第三遍。 */
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
      ]) + '</div>' + matlabReferenceHTML() + secondPassDetailsHTML();
    drawRGBInto(setupCanvas('finalOriginal', 440, 440), state.rgb, state.width, state.height);
    drawRGBInto(setupCanvas('finalDecoded', 440, 440), state.decoded.rgb, state.width, state.height);
    drawRGBDifference(setupCanvas('finalError', 440, 440));
    if (state.encoded && state.decoded) {
      const second = secondPassResult();
      drawRGBInto(setupCanvas('secondAgain', 440, 440), second.decoded.rgb, state.width, state.height);
      drawRGBDifference(setupCanvas('secondDiff', 440, 440), state.decoded.rgb, second.decoded.rgb, 20);
    }
  }

  /* 二次压缩缓存：把第一次重建出的 RGB 再编解码一遍；键含图像/QF/采样，参数变了才重算。 */
  let secondPass = { key: '', data: null };

  function secondPassResult() {
    const key = state.imageId + '|' + state.Q + '|' + state.subsampling;
    if (secondPass.key === key && secondPass.data) return secondPass.data;
    const encoded = Codec.encode(state.decoded.rgb, state.width, state.height, {
      quality: state.Q,
      subsampling: state.subsampling
    });
    const decoded = Codec.decode(encoded);
    const data = {
      encoded: encoded,
      decoded: decoded,
      psnr: Codec.psnr(state.rgb, decoded.rgb)
    };
    secondPass.key = key;
    secondPass.data = data;
    return data;
  }

  function secondPassDetailsHTML() {
    if (!state.encoded || !state.decoded) return '';
    const second = secondPassResult();
    const firstStats = state.encoded.stats;
    const againStats = second.encoded.stats;
    const drop = state.psnr - second.psnr;
    return '<details class="matlab-ref second-pass">' +
      '<summary class="matlab-ref-head">二次压缩：再压一次会掉多少画质？' +
      '<span>把第一次重建出的 RGB 用同样 QF / 采样再编解码一遍；第一次重建就是上方第二张图，这里只补两张对照（点此展开）</span></summary>' +
      '<div class="second-pass-grid">' +
        figure('secondAgain', '再压一次后的重建') +
        figure('secondDiff', '两次重建之差 ×20（越亮 = 差越大）') +
      '</div><div style="margin-top:12px">' + metricCards([
        ['一次 PSNR', state.psnr.toFixed(2) + ' dB', '重建 vs 原始 RGB'],
        ['二次 PSNR', second.psnr.toFixed(2) + ' dB', '再压一次后 vs 原始 RGB'],
        ['额外损失', (drop >= 0 ? '↓ ' : '↑ ') + Math.abs(drop).toFixed(2) + ' dB', '第二次压缩多掉的'],
        ['一次文件', firstStats.fileBytes + ' B', '含文件头'],
        ['二次文件', againStats.fileBytes + ' B', '含文件头'],
        ['熵位复用', (100 * againStats.totalBits / Math.max(1, firstStats.totalBits)).toFixed(2) + '%', '二次熵位数 / 一次']
      ]) + '</div>' +
      '<p class="note">再压一次几乎不再掉画质：第一次量化已把高频抹成 0，第二次量化作用在几乎相同的值上。' +
      '剩下的额外损失来自颜色转换与取整的累积，在上面第二张图（放大 20 倍）里表现为块边界的细缝。</p>' +
      '</details>';
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

  /* ------------------------------------------------------------------ */
  /* MATLAB 批量实测（10 章）：数据读取与图表                            */
  /* ------------------------------------------------------------------ */

  /* 三种方法的线型与颜色沿用 MATLAB 图的习惯（蓝实线圆点 / 橙虚线方点 / 青点线三角），
     方便把网页和 results/figures/02_rate_distortion.png 对照着看 */
  const MATLAB_METHOD_STYLE = [
    { key: 'custom_jpeg', label: '自编：频率加权', color: '#1d4ed8', dash: [], marker: 'circle' },
    { key: 'custom_uniform', label: '自编：等步长', color: '#c2410c', dash: [6, 4], marker: 'square' },
    { key: 'matlab_jpeg', label: 'MATLAB imwrite', color: '#0f766e', dash: [2, 3], marker: 'triangle' }
  ];
  /* 三种采样格式的线型/颜色在 10.1 已定义，10.2–10.4 直接复用，
     保证“同一种颜色 = 同一种采样”在整章里不变 */
  const MATLAB_SUBSAMPLING_COLORS = ['#1d4ed8', '#c2410c', '#0f766e'];

  function matlabData() {
    const data = window.MATLAB_RESULTS;
    if (!data || !Array.isArray(data.rows) || !data.rows.length) return null;
    return data;
  }

  function matlabSubsamplingLabel(data, index, short) {
    const item = data && data.subsamplings ? data.subsamplings[index] : null;
    if (!item) return '采样 ' + (index + 1);
    return short ? item.short : item.label;
  }

  function matlabSubsamplingStyle(data, index) {
    const item = data && data.subsamplings ? data.subsamplings[index] : null;
    const found = item ? MATLAB_SUBSAMPLING_STYLE.filter(function (style) {
      return style.key === item.key;
    })[0] : null;
    return found || {
      key: item ? item.key : String(index),
      label: matlabSubsamplingLabel(data, index, false),
      color: MATLAB_SUBSAMPLING_COLORS[index % MATLAB_SUBSAMPLING_COLORS.length],
      dash: [], marker: 'circle'
    };
  }

  /* 取一条实测序列：按采样 + 方法过滤，再按横轴（bpp 或 Q）升序；
     imwrite 只在它真实使用的采样里出现，缺值字段（熵位/零系数）直接跳过 */
  function matlabSeries(data, subsamplingIndex, methodIndex, field, axis) {
    return data.rows
      .filter(function (row) {
        return row.subsampling === subsamplingIndex && row.method === methodIndex &&
          row[field] !== null && row[field] !== undefined;
      })
      .sort(function (a, b) { return a[axis] - b[axis]; })
      .map(function (row) { return [row[axis], row[field], row.quality]; });
  }

  function matlabLegendHTML(items) {
    return '<div class="matlab-legend">' + items.map(function (item) {
      return '<span><i style="background:' + item.color + '"></i>' + escapeHTML(item.label) + '</span>';
    }).join('') + '</div>';
  }

  /* 10.2–10.4 每页只留一条结论条，位置固定在图表正下方；
     结论里的数字由调用方按实测数据算好再传进来，不写死 */
  function matlabTakeawayHTML(label, html) {
    return '<p class="matlab-takeaway"><b>' + escapeHTML(label) + '</b><span>' + html + '</span></p>';
  }

  /* 刻度取整：让网格线落在 1/2/2.5/5 这类好读的数上 */
  function niceTicks(minimum, maximum, count) {
    const span = maximum - minimum;
    if (!(span > 0)) return [minimum];
    const raw = span / Math.max(1, count);
    const power = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    const normalized = raw / power;
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * power;
    const ticks = [];
    for (let value = Math.ceil(minimum / step - 1e-9) * step; value <= maximum + step * 1e-6; value += step) {
      ticks.push(Math.round(value * 1e6) / 1e6);
    }
    return ticks;
  }

  /* 画一块带网格、刻度与轴标签的绘图区，返回把数据值映射到画布坐标的两个函数 */
  function drawChartFrame(ctx, box, config) {
    const pad = { left: 42, right: 12, top: config.title ? 18 : 6, bottom: 34 };
    const plot = {
      x: box.x + pad.left,
      y: box.y + pad.top,
      w: Math.max(20, box.w - pad.left - pad.right),
      h: Math.max(20, box.h - pad.top - pad.bottom)
    };
    const toX = function (value) { return plot.x + (value - config.xMin) / (config.xMax - config.xMin) * plot.w; };
    const toY = function (value) { return plot.y + plot.h - (value - config.yMin) / (config.yMax - config.yMin) * plot.h; };

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#e6edf6';
    ctx.fillStyle = '#7c8ba1';
    ctx.font = '10px Consolas, "Cascadia Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    (config.yTicks || []).forEach(function (value) {
      const y = toY(value);
      ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
      ctx.fillText(config.yFormat ? config.yFormat(value) : String(value), plot.x - 6, y);
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    (config.xTicks || []).forEach(function (value) {
      const x = toX(value);
      ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
      ctx.fillText(config.xFormat ? config.xFormat(value) : String(value), x, plot.y + plot.h + 6);
    });

    ctx.strokeStyle = '#b9c6d8';
    ctx.beginPath();
    ctx.moveTo(plot.x, plot.y);
    ctx.lineTo(plot.x, plot.y + plot.h);
    ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
    ctx.stroke();

    ctx.fillStyle = '#52627a';
    ctx.font = '10.5px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(config.xLabel, plot.x + plot.w / 2, plot.y + plot.h + 19);
    ctx.save();
    ctx.translate(plot.x - 28, plot.y + plot.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(config.yLabel, 0, 0);
    ctx.restore();

    if (config.title) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '600 11px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText(config.title, plot.x, plot.y - 7);
    }
    ctx.restore();
    return { x: toX, y: toY };
  }

  function chartMarker(ctx, shape, x, y, color) {
    ctx.beginPath();
    if (shape === 'square') {
      ctx.rect(x - 2.6, y - 2.6, 5.2, 5.2);
    } else if (shape === 'triangle') {
      ctx.moveTo(x, y - 3.4);
      ctx.lineTo(x + 3.4, y + 2.4);
      ctx.lineTo(x - 3.4, y + 2.4);
      ctx.closePath();
    } else {
      ctx.arc(x, y, 2.8, 0, Math.PI * 2);
    }
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  function drawLineSeries(ctx, points, scales, style) {
    if (!points.length) return;
    ctx.save();
    ctx.beginPath();
    points.forEach(function (point, index) {
      const x = scales.x(point[0]);
      const y = scales.y(point[1]);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    ctx.setLineDash(style.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);
    points.forEach(function (point) {
      chartMarker(ctx, style.marker, scales.x(point[0]), scales.y(point[1]), style.color);
    });
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* 10.1 彩色实测（风景照片 30 组）：数据来自 web/color_reference.js    */
  /* ------------------------------------------------------------------ */

  /* 三种采样格式的线型；横轴统一用完整文件 bpp，便于和灰度页对照 */
  const MATLAB_SUBSAMPLING_STYLE = [
    { key: '444', label: '4:4:4 不降采样', color: '#1d4ed8', dash: [], marker: 'circle' },
    { key: '422', label: '4:2:2 水平减半', color: '#c2410c', dash: [6, 4], marker: 'square' },
    { key: '420', label: '4:2:0 水平垂直都减半', color: '#0f766e', dash: [2, 3], marker: 'triangle' }
  ];

  /* color_reference.js 由 src/run_color_experiment.m 生成：每项含 quality / subsampling /
     fileBytes / psnr / yPsnr；这里只按尺寸把字节换成 bpp，不重算任何编码 */
  function colorReferenceData() {
    const reference = window.COLOR_REFERENCE;
    if (!reference || !Array.isArray(reference.cases) || !reference.cases.length) return null;
    const pixels = reference.width * reference.height;
    return {
      reference: reference,
      points: reference.cases.map(function (item) {
        return {
          quality: item.quality,
          subsampling: item.subsampling,
          fileBytes: item.fileBytes,
          bpp: item.fileBytes * 8 / pixels,
          psnr: item.psnr,
          yPsnr: item.yPsnr
        };
      })
    };
  }

  function colorSeries(data, subsampling, field, axis) {
    return data.points
      .filter(function (point) { return point.subsampling === subsampling; })
      .sort(function (a, b) { return a[axis] - b[axis]; })
      .map(function (point) { return [point[axis], point[field], point.quality]; });
  }

  function colorCaseAt(data, quality, subsampling) {
    return data.points.filter(function (point) {
      return point.quality === quality && point.subsampling === subsampling;
    })[0] || null;
  }

  /* 左：三种采样的率失真；右：同 QF 下 4:2:2 / 4:2:0 的体积占 4:4:4 的百分比 */
  function drawColorCostPanels(target, data, columns) {
    const ctx = target.ctx;
    const cols = columns === 1 ? 1 : 2;
    const rows = Math.ceil(2 / cols);
    const gap = { x: 56, y: 44 };
    const panelW = (target.w - 24 - gap.x * (cols - 1)) / cols;
    const panelH = (target.h - 8 - gap.y * (rows - 1)) / rows;
    const qualities = data.reference.qualities;

    const extremes = data.points.reduce(function (acc, point) {
      return {
        minPsnr: Math.min(acc.minPsnr, point.psnr),
        maxPsnr: Math.max(acc.maxPsnr, point.psnr),
        maxBpp: Math.max(acc.maxBpp, point.bpp)
      };
    }, { minPsnr: Infinity, maxPsnr: -Infinity, maxBpp: 0 });
    const xMax = Math.ceil(extremes.maxBpp * 1.04 * 2) / 2;
    const yMin = Math.floor((extremes.minPsnr - 1) / 5) * 5;
    const yMax = Math.ceil((extremes.maxPsnr + 1) / 5) * 5;

    const rateBox = { x: 12, y: 4, w: panelW, h: panelH };
    const rateScales = drawChartFrame(ctx, rateBox, {
      xMin: 0, xMax: xMax, yMin: yMin, yMax: yMax,
      xTicks: niceTicks(0, xMax, 5),
      yTicks: niceTicks(yMin, yMax, 4),
      xLabel: 'bpp（完整文件，1024²）',
      yLabel: 'PSNR / dB',
      xFormat: function (value) { return value < 10 ? value.toFixed(1) : String(Math.round(value)); },
      yFormat: function (value) { return String(Math.round(value)); },
      title: '三种采样的率失真曲线'
    });
    MATLAB_SUBSAMPLING_STYLE.forEach(function (style) {
      drawLineSeries(ctx, colorSeries(data, style.key, 'psnr', 'bpp'), rateScales, style);
    });

    /* 体积比要用 4:4:4 自己当分母，所以先按 QF 建一张基准表 */
    const baseline = {};
    colorSeries(data, '444', 'fileBytes', 'quality').forEach(function (point) {
      baseline[point[2]] = point[1];
    });
    const ratioSeries = ['422', '420'].map(function (key) {
      const style = MATLAB_SUBSAMPLING_STYLE.filter(function (item) { return item.key === key; })[0];
      return {
        style: style,
        points: colorSeries(data, key, 'fileBytes', 'quality')
          .filter(function (point) { return baseline[point[2]] > 0; })
          .map(function (point) { return [point[2], 100 * point[1] / baseline[point[2]], point[2]]; })
      };
    });
    let minRatio = 100;
    let maxRatio = 100;
    ratioSeries.forEach(function (item) {
      item.points.forEach(function (point) {
        minRatio = Math.min(minRatio, point[1]);
      });
    });
    const ratioMin = Math.max(0, Math.floor((minRatio - 4) / 10) * 10);

    const ratioBox = {
      x: 12 + (cols === 2 ? panelW + gap.x : 0),
      y: 4 + (cols === 1 ? panelH + gap.y : 0),
      w: panelW,
      h: panelH
    };
    const ratioScales = drawChartFrame(ctx, ratioBox, {
      xMin: qualities[0], xMax: qualities[qualities.length - 1],
      yMin: ratioMin, yMax: maxRatio + 5,
      xTicks: [qualities[0], qualities[3], qualities[6], qualities[qualities.length - 1]],
      yTicks: niceTicks(ratioMin, maxRatio + 5, 3),
      xLabel: '质量因子 QF',
      yLabel: '体积占 4:4:4 的 %',
      xFormat: function (value) { return String(Math.round(value)); },
      yFormat: function (value) { return value.toFixed(0) + '%'; },
      title: '同 QF 下的体积比'
    });
    ratioSeries.forEach(function (item) { drawLineSeries(ctx, item.points, ratioScales, item.style); });

    /* 100% 参考线：4:4:4 自己，两条线都在它下面 */
    const hundredY = ratioScales.y(100);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ratioScales.x(qualities[0]), hundredY);
    ctx.lineTo(ratioScales.x(qualities[qualities.length - 1]), hundredY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7c8ba1';
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('4:4:4 = 100%', ratioScales.x(qualities[qualities.length - 1]), hundredY - 2);
    ctx.restore();
  }

  function renderMatlabColorStep() {
    const data = colorReferenceData();
    const caption = '同一张 1024×1024 风景照片的 30 组实测：左 = 三种采样的率失真，右 = 同 QF 下的体积比。';
    let note;
    if (data) {
      const qualities = data.reference.qualities;
      const midQuality = qualities.indexOf(50) >= 0 ? 50 : qualities[Math.floor(qualities.length / 2)];
      const topQuality = qualities[qualities.length - 1];
      const midBase = colorCaseAt(data, midQuality, '444');
      const midSmall = colorCaseAt(data, midQuality, '420');
      const topBase = colorCaseAt(data, topQuality, '444');
      const topSmall = colorCaseAt(data, topQuality, '420');
      note = '数据来源：<code>src/run_color_experiment.m</code> → <code>web/color_reference.js</code>' +
        (data.reference.generatedAt
          ? '（' + escapeHTML(data.reference.generatedAt) + '，MATLAB ' + escapeHTML(data.reference.generatedBy || '') + '）'
          : '') + '。';
      if (midBase && midSmall && topBase && topSmall) {
        note += 'QF = ' + midQuality + ' 时 4:2:0 的文件是 4:4:4 的 ' +
          (100 * midSmall.fileBytes / midBase.fileBytes).toFixed(1) + '%，PSNR 低 ' +
          (midBase.psnr - midSmall.psnr).toFixed(2) + ' dB；QF = ' + topQuality + ' 时体积占比 ' +
          (100 * topSmall.fileBytes / topBase.fileBytes).toFixed(1) + '%，PSNR 差却扩大到 ' +
          (topBase.psnr - topSmall.psnr).toFixed(2) + ' dB——此时误差主要来自被砍掉的色度，不是量化。';
      }
    } else {
      note = '未找到彩色实测数据：请先运行 <code>src/export_color_reference.m</code> 重新生成 <code>web/color_reference.js</code>。';
    }
    stage.innerHTML = matlabLegendHTML(MATLAB_SUBSAMPLING_STYLE) +
      '<figure>' + canvasTag('matlabColorChart', caption) + '<figcaption>' + caption + '</figcaption></figure>' +
      '<p class="note">' + note + '</p>';
    if (!data) return;
    const narrow = SMALL_SCREEN;
    drawColorCostPanels(setupCanvas('matlabColorChart', narrow ? 420 : 900, narrow ? 700 : 350),
      data, narrow ? 1 : 2);
  }

  /* 一种采样一块面板（共三块），三种量化策略放同一坐标系对照；
     imwrite 只出现在它真实使用的采样面板里，没有数据就少画一条线，不补假点。
     窄屏改成单列堆叠，避免三块面板被压成邮票大小 */
  function drawRatePanels(target, data, columns) {
    const ctx = target.ctx;
    const cols = columns === 1 ? 1 : 3;
    const rows = Math.ceil(data.subsamplings.length / cols);
    const gap = { x: 52, y: 40 };
    const panelW = (target.w - 24 - gap.x * (cols - 1)) / cols;
    const panelH = (target.h - 10 - gap.y * (rows - 1)) / rows;
    data.subsamplings.forEach(function (subsampling, subsamplingIndex) {
      const box = {
        x: 12 + (subsamplingIndex % cols) * (panelW + gap.x),
        y: 6 + Math.floor(subsamplingIndex / cols) * (panelH + gap.y),
        w: panelW,
        h: panelH
      };
      const series = MATLAB_METHOD_STYLE.map(function (style, methodIndex) {
        return { style: style, points: matlabSeries(data, subsamplingIndex, methodIndex, 'psnr', 'bpp') };
      });
      let maxBpp = 0;
      let minPsnr = Infinity;
      let maxPsnr = -Infinity;
      series.forEach(function (item) {
        item.points.forEach(function (point) {
          if (point[0] > maxBpp) maxBpp = point[0];
          if (point[1] < minPsnr) minPsnr = point[1];
          if (point[1] > maxPsnr) maxPsnr = point[1];
        });
      });
      if (!isFinite(minPsnr)) return;
      const xMax = Math.ceil(maxBpp * 1.04 * 2) / 2;
      const yMin = Math.floor((minPsnr - 2) / 5) * 5;
      const yMax = Math.ceil((maxPsnr + 1) / 5) * 5;
      const scales = drawChartFrame(ctx, box, {
        xMin: 0, xMax: xMax, yMin: yMin, yMax: yMax,
        xTicks: niceTicks(0, xMax, 5),
        yTicks: niceTicks(yMin, yMax, 4),
        xLabel: 'bpp（完整文件）',
        yLabel: 'PSNR / dB',
        xFormat: function (value) { return value < 10 ? value.toFixed(1) : String(Math.round(value)); },
        yFormat: function (value) { return String(Math.round(value)); },
        title: subsampling.short
      });
      series.forEach(function (item) { drawLineSeries(ctx, item.points, scales, item.style); });
    });
  }

  function renderMatlabRateStep() {
    const data = matlabData();
    const caption = '同一张 1024×1024 风景照片的 70 组实测：三块面板依次是 4:4:4 / 4:2:2 / 4:2:0，' +
      '每块里的三条线是三种量化策略，10 个实测点只连线不平滑。';
    let takeaway = '';
    let note = '未找到 MATLAB 实测数据：请先在仓库根目录运行 <code>python tools/export_matlab_results.py</code> 生成 <code>web/matlab_results.js</code>。';
    if (data) {
      /* 边际收益用 4:4:4 自编加权的首两点与末两点现算，避免把 32 dB / 1.5 dB 写死 */
      const curve = matlabSeries(data, 0, 0, 'psnr', 'bpp');
      const first = curve[0];
      const last = curve[curve.length - 1];
      const lowSlope = (curve[1][1] - first[1]) / (curve[1][0] - first[0]);
      const highSlope = (last[1] - curve[curve.length - 2][1]) / (last[0] - curve[curve.length - 2][0]);
      takeaway = matlabTakeawayHTML('结论', '码率越高画质越好，但收益迅速衰减：4:4:4 从 ' +
        first[0].toFixed(2) + ' bpp / ' + first[1].toFixed(1) + ' dB 到 ' +
        last[0].toFixed(1) + ' bpp / ' + last[1].toFixed(1) + ' dB；低码率段每多 1 bpp 换 ' +
        lowSlope.toFixed(1) + ' dB，高码率段只剩 ' + highSlope.toFixed(1) + ' dB。' +
        '同一个 QF 下三种策略的码率不同，不能横比。');
      note = '数据：<code>' + escapeHTML(data.source.measurements) + '</code>（' +
        escapeHTML(data.environment || 'MATLAB R2024b') + '，' + escapeHTML(data.generatedAt || '') +
        '），共 ' + data.rows.length + ' 组，前端只重绘不插值。';
    }
    stage.innerHTML = matlabLegendHTML(MATLAB_METHOD_STYLE) +
      '<figure>' + canvasTag('matlabRateChart', caption) + '<figcaption>' + caption + '</figcaption></figure>' +
      takeaway + '<p class="note">' + note + '</p>';
    if (!data) return;
    const narrow = SMALL_SCREEN;
    drawRatePanels(setupCanvas('matlabRateChart', narrow ? 420 : 940, narrow ? 1000 : 430), data, narrow ? 1 : 3);
  }

  /* 左：零系数比例，右：压缩比；横轴都是 QF，三条线分别是三种采样。
     窄屏同样改成上下两张，免得两块面板挤在一起 */
  function drawSparsityPanels(target, data, columns) {
    const ctx = target.ctx;
    const cols = columns === 1 ? 1 : 2;
    const rows = Math.ceil(2 / cols);
    const gap = { x: 56, y: 44 };
    const panelW = (target.w - 24 - gap.x * (cols - 1)) / cols;
    const panelH = (target.h - 8 - gap.y * (rows - 1)) / rows;
    const qualities = data.qualities;
    let maxRatio = 0;
    data.subsamplings.forEach(function (subsampling, subsamplingIndex) {
      matlabSeries(data, subsamplingIndex, 0, 'compressionRatio', 'quality').forEach(function (point) {
        if (point[1] > maxRatio) maxRatio = point[1];
      });
    });
    const ratioTop = Math.ceil(maxRatio * 1.05 / 10) * 10;
    const panels = [
      {
        field: 'zeroFraction', yMin: 0, yMax: 100,
        yTicks: [0, 25, 50, 75, 100],
        yLabel: '零系数比例 / %',
        yFormat: function (value) { return String(value); },
        title: '量化后零系数占比'
      },
      {
        field: 'compressionRatio', yMin: 0, yMax: ratioTop,
        yTicks: niceTicks(0, ratioTop, 4),
        yLabel: '压缩比（原始 / 文件）',
        yFormat: function (value) { return String(Math.round(value)); },
        title: 'JPEG 完整文件压缩比'
      }
    ];
    panels.forEach(function (panel, panelIndex) {
      const box = {
        x: 12 + (panelIndex % cols) * (panelW + gap.x),
        y: 4 + Math.floor(panelIndex / cols) * (panelH + gap.y),
        w: panelW,
        h: panelH
      };
      const scales = drawChartFrame(ctx, box, {
        xMin: qualities[0], xMax: qualities[qualities.length - 1],
        yMin: panel.yMin, yMax: panel.yMax,
        xTicks: [qualities[0], qualities[3], qualities[6], qualities[qualities.length - 1]],
        yTicks: panel.yTicks,
        xLabel: '质量因子 QF（不是画质百分比）',
        yLabel: panel.yLabel,
        xFormat: function (value) { return String(Math.round(value)); },
        yFormat: panel.yFormat,
        title: panel.title
      });
      data.subsamplings.forEach(function (subsampling, subsamplingIndex) {
        const points = matlabSeries(data, subsamplingIndex, 0, panel.field, 'quality');
        if (panel.field === 'zeroFraction') {
          points.forEach(function (point) { point[1] = point[1] * 100; });
        }
        const style = matlabSubsamplingStyle(data, subsamplingIndex);
        drawLineSeries(ctx, points, scales, {
          color: style.color,
          dash: style.dash,
          marker: style.marker
        });
      });
    });
  }

  function renderMatlabSparsityStep() {
    const data = matlabData();
    const caption = '固定「自编：频率加权」量化表，同一张照片在三种采样下的零系数比例与完整文件压缩比。';
    let takeaway = '';
    let note = '未找到 MATLAB 实测数据：请先运行 <code>python tools/export_matlab_results.py</code>。';
    if (data) {
      /* 取最低 QF 那一档现算，避免把 98.8% / 73.8:1 等数字写死在页面里 */
      const low = data.qualities[0];
      const pick = function (index) {
        return data.rows.filter(function (row) {
          return row.subsampling === index && row.method === 0 && row.quality === low;
        })[0];
      };
      const base = pick(0);
      const lastIndex = data.subsamplings.length - 1;
      const small = pick(lastIndex);
      if (base && small) {
        takeaway = matlabTakeawayHTML('结论', 'QF = ' + low + ' 时，' +
          data.subsamplings[0].short + ' 与 ' + data.subsamplings[lastIndex].short +
          ' 的零系数比例是 ' + (100 * base.zeroFraction).toFixed(1) + '% 与 ' +
          (100 * small.zeroFraction).toFixed(1) + '%，几乎一样；完整文件压缩比却是 ' +
          base.compressionRatio.toFixed(1) + ':1 与 ' + small.compressionRatio.toFixed(1) +
          ':1。零多不等于文件小，压缩比必须用完整字节。');
      }
      note = '数据：' + data.subsamplings.length * data.qualities.length +
        ' 点（3 采样 × 10 档，自编频率加权）；左图是熵编码前的中间量，右图才是写进文件的体积。';
    }
    stage.innerHTML = matlabLegendHTML(data ? data.subsamplings.map(function (subsampling, index) {
      const style = matlabSubsamplingStyle(data, index);
      return { color: style.color, label: subsampling.label };
    }) : []) +
      '<figure>' + canvasTag('matlabSparsityChart', caption) + '<figcaption>' + caption + '</figcaption></figure>' +
      takeaway + '<p class="note">' + note + '</p>';
    if (!data) return;
    const narrow = SMALL_SCREEN;
    drawSparsityPanels(setupCanvas('matlabSparsityChart', narrow ? 420 : 900, narrow ? 700 : 330), data, narrow ? 1 : 2);
  }

  /* 一块面板里画若干组柱：每组 = 一张图的 4 个等码率点，柱高 = 加权 − 等步长的 PSNR 差 */
  function drawBarGroups(ctx, box, groups, options) {
    const values = [];
    groups.forEach(function (group) {
      group.rows.forEach(function (row) { values.push(row.deltaPsnr); });
    });
    if (!values.length) return;
    const lowest = Math.min.apply(null, values);
    const highest = Math.max.apply(null, values);
    const yMin = Math.min(-0.5, Math.floor(lowest - 0.4));
    const yMax = Math.max(0.6, Math.ceil(highest + 0.3));
    const barCount = Math.max.apply(null, groups.map(function (group) { return group.rows.length; }));
    /* perBar：一块面板只放一组时，横轴刻度落在每根柱子上（①②③④），而不是组中心 */
    const perBar = !!options.perBar;
    const slots = perBar ? barCount : groups.length;
    const scales = drawChartFrame(ctx, box, {
      xMin: 0, xMax: slots, yMin: yMin, yMax: yMax,
      xTicks: perBar
        ? groups[0].rows.map(function (row, rank) { return rank + 0.5; })
        : groups.map(function (group, index) { return index + 0.5; }),
      yTicks: niceTicks(yMin, yMax, 4),
      xLabel: options.xLabel,
      yLabel: 'ΔPSNR / dB',
      xFormat: options.xFormat,
      yFormat: function (value) { return value.toFixed(1); },
      title: options.title
    });
    /* 柱子中心必须与上方刻度文字共用同一套坐标映射，否则组名会和柱子错位 */
    const slotWidth = scales.x(1) - scales.x(0);
    const barWidth = Math.min(34, perBar ? slotWidth / 1.7 : slotWidth / (barCount + 1.4));
    const zeroY = scales.y(0);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    groups.forEach(function (group, groupIndex) {
      const center = scales.x(groupIndex + 0.5);
      group.rows.forEach(function (row, rank) {
        const x = perBar ? scales.x(rank + 0.5)
          : center + (rank - (group.rows.length - 1) / 2) * (barWidth + 5);
        const top = scales.y(row.deltaPsnr);
        ctx.fillStyle = row.deltaPsnr < 0 ? '#c2410c' : '#15803d';
        ctx.fillRect(x - barWidth / 2, Math.min(zeroY, top), barWidth, Math.abs(top - zeroY));
        ctx.fillStyle = '#52627a';
        ctx.font = '9px Consolas, "Cascadia Mono", monospace';
        ctx.fillText(row.deltaPsnr.toFixed(1), x, row.deltaPsnr < 0 ? top + 9 : top - 9);
      });
    });
    /* 零线单独描一遍：正负是这张图唯一的判读依据 */
    ctx.strokeStyle = '#8fa0b6';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(scales.x(0), zeroY);
    ctx.lineTo(scales.x(slots), zeroY);
    ctx.stroke();
    ctx.restore();
  }

  /* 一种采样一组柱：每组 = 该采样下的 4 个等码率点，柱高 = 加权 − 等步长的 PSNR 差。
     宽屏三组并排；窄屏每种采样一块面板上下堆叠，柱子才够宽 */
  function drawMatchedBars(target, data, stacked) {
    const ctx = target.ctx;
    ctx.clearRect(0, 0, target.w, target.h);
    const groups = data.subsamplings.map(function (subsampling, subsamplingIndex) {
      return {
        subsamplingIndex: subsamplingIndex,
        rows: data.matchedRate
          .filter(function (row) { return row.subsampling === subsamplingIndex; })
          .sort(function (a, b) { return a.targetBpp - b.targetBpp; })
      };
    }).filter(function (group) { return group.rows.length; });
    if (!groups.length) return;
    if (!stacked) {
      drawBarGroups(ctx, { x: 6, y: 4, w: target.w - 12, h: target.h - 8 }, groups, {
        xLabel: '每种采样从左到右 4 根柱 = 它自己的 4 个目标 bpp（升序，数值见下表）',
        xFormat: function (value) { return matlabSubsamplingLabel(data, groups[Math.floor(value)].subsamplingIndex, true); }
      });
      return;
    }
    const gap = 40;
    const panelH = (target.h - 8 - gap * (groups.length - 1)) / groups.length;
    groups.forEach(function (group, index) {
      drawBarGroups(ctx, { x: 6, y: 4 + index * (panelH + gap), w: target.w - 12, h: panelH }, [group], {
        perBar: true,
        xLabel: '该采样的 4 个目标 bpp（升序）',
        xFormat: function (value) { return '#' + (Math.floor(value) + 1); },
        title: matlabSubsamplingLabel(data, group.subsamplingIndex, false)
      });
    });
  }

  function matlabMatchedTableHTML(data) {
    const rows = data.matchedRate.map(function (row) {
      return '<tr><td>' + escapeHTML(matlabSubsamplingLabel(data, row.subsampling, false)) + '</td>' +
        '<td>' + row.targetBpp.toFixed(3) + '</td>' +
        '<td>' + row.weightedPsnr.toFixed(2) + '</td>' +
        '<td>' + row.uniformPsnr.toFixed(2) + '</td>' +
        '<td class="' + (row.deltaPsnr < 0 ? 'warn' : 'ok') + '">' +
        (row.deltaPsnr > 0 ? '+' : '') + row.deltaPsnr.toFixed(2) + '</td></tr>';
    }).join('');
    return '<details class="matlab-ref">' +
      '<summary class="matlab-ref-head">' + data.matchedRate.length + ' 个插值点明细<span>同一目标 bpp 下两种量化表的 PSNR；Δ = 加权 − 等步长（点此展开）</span></summary>' +
      '<div class="matlab-ref-scroll"><table><thead><tr><th>采样</th><th>目标 bpp</th>' +
      '<th>加权 PSNR</th><th>等步长 PSNR</th><th>ΔPSNR</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="matlab-ref-foot">数据来源：' + escapeHTML(data.source.matchedRate) +
      '；插值仅在两条曲线共同覆盖的区间内进行，不外推，插值点不是实测点。</p>' +
      '</details>';
  }

  function renderMatlabMatchedStep() {
    const data = matlabData();
    const caption = '等码率下的 PSNR 差：柱在零线以下表示该码率点「等步长」反而更好。';
    let takeaway = '';
    let note = '未找到 MATLAB 实测数据：请先运行 <code>python tools/export_matlab_results.py</code>。';
    if (data) {
      const values = data.matchedRate.map(function (row) { return row.deltaPsnr; });
      const allNegative = values.every(function (value) { return value < 0; });
      takeaway = matlabTakeawayHTML('结论', '三种采样、' + data.matchedRate.length + ' 个等码率点的 ΔPSNR ' +
        (allNegative ? '全为负' : '有正有负') + '（' +
        Math.min.apply(null, values).toFixed(2) + '～' + Math.max.apply(null, values).toFixed(2) + ' dB）：' +
        (allNegative
          ? '同一码率下 T.81 标准表反而输给等步长表，评价量化表必须换到同一码率坐标系。'
          : '不能笼统说哪种量化表更好，要按码率点看。'));
      note = '插值只在两条实测曲线的共同覆盖区间内进行，不外推；逐点数值见下表。';
    }
    stage.innerHTML = '<figure>' + canvasTag('matlabMatchedChart', caption) +
      '<figcaption>' + caption + '</figcaption></figure>' +
      takeaway + '<p class="note">' + note + '</p>' + (data ? matlabMatchedTableHTML(data) : '');
    if (!data) return;
    const narrow = SMALL_SCREEN;
    drawMatchedBars(setupCanvas('matlabMatchedChart', narrow ? 420 : 900, narrow ? 940 : 320), data, narrow);
  }

  /* 误差图默认画「原始 vs 解码重建」并放大 10 倍；
     二次压缩页要画「一次重建 vs 二次重建」，所以两组像素与放大倍数都做成可选参数。 */
  function drawRGBDifference(target, from, against, gain) {
    const a = from || state.rgb;
    const b = against || state.decoded.rgb;
    const scale = gain || 10;
    const offscreen = document.createElement('canvas');
    offscreen.width = state.width;
    offscreen.height = state.height;
    const context = offscreen.getContext('2d');
    const imageData = context.createImageData(state.width, state.height);
    for (let i = 0; i < state.width * state.height; i++) {
      const difference = Math.abs(a[i * 4] - b[i * 4]) +
        Math.abs(a[i * 4 + 1] - b[i * 4 + 1]) +
        Math.abs(a[i * 4 + 2] - b[i * 4 + 2]);
      const value = clamp(Math.round(difference * scale / 3), 0, 255);
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

  /* 01 页四张图共用同一个显示尺寸，宽和高两侧都要设上限：
     - 宽度受列宽限制（窄屏列宽小于 420 时，写死宽度会顶破卡片）；
     - 高度受“一屏”剩余空间限制（写死 420 高时，常见的 1440×900 笔记本第二排会被底部导航挡住）；
     - 高度只能由原图宽高比反推，不能再 clamp，否则竖幅/全景照片会被压扁变形。 */
  function lumaPairSize() {
    const aspect = state.width / Math.max(1, state.height);
    const block = stage.querySelector('.hvs-block');
    const pairs = stage.querySelector('.hvs-luma-pairs');
    const head = stage.querySelector('.hvs-head');
    const pairList = Array.prototype.slice.call(stage.querySelectorAll('.hvs-luma-pair'));
    if (!block || !pairs || !head || !pairList.length) {
      return { width: 420, height: Math.max(1, Math.round(420 / aspect)), columnWidth: 420, gap: 14, single: false };
    }
    const blockStyle = getComputedStyle(block);
    const columnGap = parseFloat(getComputedStyle(pairs).columnGap) || 14;
    const inner = block.clientWidth -
      parseFloat(blockStyle.paddingLeft) - parseFloat(blockStyle.paddingRight);
    /* 双列时右列还带一条虚线分隔线（padding-left = columnGap），按更窄的那列当上限。
       这里不写死像素上限：2K/4K 屏列宽能到 1000+，真实列宽要如实传给渲染端，
       由高度预算决定图片多大。 */
    const single = VIEWPORT_WIDTH <= 700;
    const columnWidth = Math.max(120, single ? inner : (inner - columnGap) / 2 - columnGap);
    if (single) {
      /* 窄屏四张图竖排，本来就要滚动，按列宽铺满即可 */
      return {
        width: Math.round(columnWidth),
        height: Math.max(1, Math.round(columnWidth / aspect)),
        columnWidth: columnWidth,
        gap: columnGap,
        single: true
      };
    }

    const stageStyle = getComputedStyle(stage);
    const headStyle = getComputedStyle(head);
    const pairStyle = getComputedStyle(pairList[0]);
    const rowGap = parseFloat(pairStyle.rowGap) || 10;
    const captionHeight = function (pair) {
      let total = 0;
      Array.prototype.forEach.call(pair.querySelectorAll('figcaption'), function (cap) {
        const style = getComputedStyle(cap);
        total += cap.offsetHeight + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0);
      });
      return total;
    };
    /* 除画布外的固定高度：演示台与块的留白、标题行、两行图注、图与图之间的间距 */
    const fixedHeight =
      parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom) +
      parseFloat(blockStyle.paddingTop) + parseFloat(blockStyle.paddingBottom) +
      parseFloat(blockStyle.borderTopWidth) + parseFloat(blockStyle.borderBottomWidth) +
      head.offsetHeight + parseFloat(headStyle.marginBottom || 0) +
      Math.max(captionHeight(pairList[0]), captionHeight(pairList[1] || pairList[0])) + rowGap;
    const targetHeight = stageViewportHeight() -
      parseFloat(stageStyle.borderTopWidth) - parseFloat(stageStyle.borderBottomWidth);
    let height = Math.max(140, Math.floor((targetHeight - fixedHeight) / 2));
    let width = Math.round(height * aspect);
    if (width > columnWidth) {
      width = Math.round(columnWidth);
      height = Math.max(1, Math.round(width / aspect));
    }
    return { width: width, height: height, columnWidth: columnWidth, gap: columnGap, single: false };
  }

  /* ------------------------------------------------------------------ */
  /* 00 开篇：不上图，只用文字把两条心理视觉原理立起来                      */
  /* ------------------------------------------------------------------ */

  function renderOpeningStep() {
    stage.innerHTML =
      '<div class="opening">' +
      '<div class="opening-hero">' +
      '<div class="opening-hero-title"><b>JPEG 压缩</b><span>心理视觉原理</span></div>' +
      '</div>' +
      '<ol class="opening-rules" id="openingRules">' +
      '<li class="opening-rule"><span class="opening-rule-no">01</span><h3>亮度 / 颜色感知</h3></li>' +
      '<li class="opening-rule"><span class="opening-rule-no">02</span><h3>低 / 高频信号感知</h3></li>' +
      '</ol>' +
      '</div>';
  }

  function renderVisualLumaStep() {
    const data = buildVisualData();
    stopLumaDemo();
    stage.innerHTML =
      '<div class="hvs-block"><div class="hvs-head">同一个 ±5%：动亮度 vs 动颜色<span>四张图同一时刻同步跳动，差别只在动了哪个通道</span>' +
      '<div class="hvs-sliders" style="margin-left:auto;margin-top:0">' +
      '<div class="hvs-auto-group"><b>亮度</b><output id="hvsBrightValue">+5%</output><span>自动来回跳</span></div>' +
      '<div class="hvs-auto-group"><b>饱和度</b><output id="hvsSatValue">+5%</output><span>自动来回跳</span></div>' +
      '<button class="stage-btn" id="hvsPause">暂停</button>' +
      '</div>' +
      '</div>' +
      '<div class="hvs-luma-pairs">' +
      '<div class="hvs-luma-pair">' +
      figure('hvsLumaOrigA', '原图（下面只动亮度）') +
      figure('hvsLumaY', '只动亮度 ±5%') +
      '</div>' +
      '<div class="hvs-luma-pair">' +
      figure('hvsLumaOrigB', '原图（下面只动饱和度）') +
      figure('hvsLumaColor', '只动饱和度 ±5%') +
      '</div>' +
      '</div>' +
      '</div>';
    /* 两张原图与下面两张调整图用同一尺寸、同一比例，方便上下逐格对照 */
    const display = lumaPairSize();
    /* 位图分辨率与显示尺寸解耦：按显示宽度取基准（420~700），CSS 只缩放显示大小。
       2K/4K 屏上四张图能撑到 900+ 像素，仍按 420 画会发虚。 */
    const picW = Math.max(420, Math.min(700, Math.round(display.width)));
    const picH = Math.max(1, Math.round(picW * state.height / Math.max(1, state.width)));
    /* 大屏两列各占半屏宽时，图片会孤零零吊在列中央、中间空出一大片：
       把列宽收到图片宽并整体居中，四张图才像一组对照。 */
    const pairsBox = stage.querySelector('.hvs-luma-pairs');
    if (pairsBox && !display.single && display.columnWidth > display.width * 1.6) {
      pairsBox.style.gridTemplateColumns = display.width + 'px ' + (display.width + display.gap) + 'px';
      pairsBox.style.justifyContent = 'center';
    }
    ['hvsLumaOrigA', 'hvsLumaOrigB', 'hvsLumaY', 'hvsLumaColor'].forEach(function (id) {
      const target = setupCanvas(id, picW, picH);
      if (!target) return;
      /* 四张图必须同宽同高：宽度按列宽与一屏预算算好，再交给 CSS 定尺寸 */
      target.canvas.style.width = display.width + 'px';
      target.canvas.style.maxWidth = '100%';
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

  function renderFrequencySolidHTML(data, solidOnly) {
    const fields = frequencySolidFields(data);
    const regions = fields.regions;
    const boxSize = regions.low.size + '×' + regions.low.size;
    const head = solidOnly
      ? '立体频率看板 · 低频 vs 高频'
      : '立体频率看板<span>z = 亮度 · 可拖动旋转</span>';
    let html = '<div class="hvs-block' + (solidOnly ? ' freq-solid-block' : '') + '" id="hvsSolidBlock">' +
      '<div class="hvs-head">' + head + '</div>';

    if (!solidOnly) {
      html += '<div class="hvs-page">' +
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
        '</div>';
    } else {
      html += '<div class="hvs-page">' +
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
        '</div>';
    }
    return html + '</div>';
  }

  function paintFrequencySolid(data, solidOnly) {
    const fields = frequencySolidFields(data);
    hfieldRepaint = function () {
      drawHeightField3D(setupCanvas('hvsSolidPhotoLow', 400, 320), fields.photoLow);
      drawHeightField3D(setupCanvas('hvsSolidPhotoHigh', 400, 320), fields.photoHigh);
    };
    hfieldRepaint();
    if (!solidOnly) {
      drawRegionMapInto(setupCanvas('hvsRegionMap', 400, 400), state.rgb, data.planes.y,
        state.width, state.height, fields.regions);
    }
    const low = fields.regions.low;
    const high = fields.regions.high;
    drawRGBCropInto(setupCanvas('hvsCropLow', 220, 220), state.rgb, state.width, state.height, low);
    drawRGBCropInto(setupCanvas('hvsCropHigh', 220, 220), state.rgb, state.width, state.height, high);
    ['hvsSolidPhotoLow', 'hvsSolidPhotoHigh']
      .forEach(function (id) { bindHeightFieldDrag(document.getElementById(id)); });
  }

  /* 02 章第 2 页：独立的立体对比页，只保留四张图与结论，不做缩放动画 */
  function renderFrequencySolidStep() {
    stopZoomDemo();
    const data = buildVisualData();
    stage.innerHTML = renderFrequencySolidHTML(data, true);
    paintFrequencySolid(data, true);
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

  /* 08.4 与 09 已合并为一页：step 13 只渲染一次，二次压缩收在页内展开区。 */
  function renderRecolorTailStep() {
    renderRecolorStep();
  }

  const RENDERERS = [
    renderSourceStep, renderColorStep, renderSubsampleStep, renderBlockStep,
    renderDctStep, renderQuantStep, renderZigzagStep, renderRleStep,
    renderHuffmanStep, renderBitstreamStep, renderDecEntropyStep,
    renderDequantStep, renderIdctStep, renderRecolorTailStep,
    renderVisualLumaStep, renderVisualFreqStep, renderOpeningStep,
    renderMatlabColorStep, renderMatlabRateStep, renderMatlabSparsityStep,
    renderMatlabMatchedStep,
    /* 21：整幅图 RGB → YCbCr 三分量（流程里排在第 03 章第一页，见 FLOW_CHAPTERS） */
    renderYccPlanesStep,
    /* 22：02 章第 2 页，立体对比（原 02 页的分页内容独立成页） */
    renderFrequencySolidStep
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
        else if (action === 'zigzag') {
          if (state.zigTimer || state.zigHold) stopZigzag();
          else playZigzag(state.zigStep);
        }
        else if (action === 'quant') startQuantAnim();
        else if (action === 'qfsweep') startQfSweep();
        else if (action === 'rle') startRleAnim();
        else if (action === 'bitwrite') startBitWriteAnim();
        else if (action === 'assembly') startAssemblyAnim();
        else if (action === 'idct') startIdctAnim();
        else if (action === 'tour') startBlockTour();
        else if (action === 'twopass') startDctTwoPass();
        else if (action === 'goto') gotoChapter(button.getAttribute('data-target'));
        else if (action === 'basissum') startBasisSum();
        else if (action === 'coefftour') toggleCoeffTour();
      });
    });
    syncZigzagPlayButton();
    renderQuantPanel();
  }

  /* 量化页的算例挂进说明面板：面板顶部照旧是三列说明，算式区与统计卡横跨整行落在下方。
     演示台因此只留四宫格，向下滚动到面板才看见逐格算式。 */
  function renderQuantPanel() {
    const panel = document.getElementById('stepPanel');
    if (!panel) return;
    const previous = document.getElementById('quantPanelBlock');
    if (previous) {
      if (typeof previous.remove === 'function') previous.remove();
      else if (previous.parentNode && previous.parentNode.removeChild) previous.parentNode.removeChild(previous);
    }
    if (!STEPS[state.step] || STEPS[state.step].id !== 'quant') return;
    const block = document.createElement('div');
    block.className = 'panel-col panel-quant';
    block.id = 'quantPanelBlock';
    block.innerHTML = quantWorkMarkup();
    panel.appendChild(block);
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

  /* DCT 拆成 6 张演示页，每页共用 STEPS[4]，靠子步骤决定画哪一版 */
  /* 七页的顺序：① 移位 → ② 一行像素画在坐标系里（只画数据，不叠余弦）→ ③ 8 个余弦基
     → ④ 一维拆解（叠加重建）→ ⑤ 行列分解 → ⑥ 二维系数 → ⑦ 叠加 = 原块 */
  const DCT_VIEWS = ['shift', 'rowPlot', 'basisGrid', 'oneD', 'twopass', 'coeff', 'rebuild'];

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
    /* 二维系数页（DCT ⑥）从 (0,0) 起，进来就自动逐项巡览；其余页沿用“默认选 AC 最大项” */
    state.selectedCoeff = entry.chapter === 'dct' && entry.subIndex === 5 && !ANIM.reduced ? 0 : -1;
    state.dctView = currentDctView();
    state.dctRow = -1;
    /* 一维页（DCT ④）从 0 项开始（进入后自动叠一遍），其余 DCT 页停在「已完成」态 */
    state.dctUseCount = entry.chapter === 'dct' && entry.subIndex === 3 ? 0 : 8;
    state.dctRowStep = 8;
    state.dctColStep = 8;
    state.dctPassStep = 16;
    /* 重建页（DCT ⑦）从 0 项起（进入后自动逐项叠加并循环）；减少动态偏好时直接停在「全部 64」 */
    state.dctSumStep = entry.chapter === 'dct' && entry.subIndex === 6 && !ANIM.reduced ? 0 : 64;
    /* Zigzag 页从 0 格起（进入后自动循环扫描）；减少动态效果时保留完整序列 */
    state.zigStep = entry.chapter === 'packResult' && entry.subIndex === 0 && !ANIM.reduced ? 0 : 64;
    state.quantStep = 64;
    state.quantFocus = -1;
    state.assemblyStep = state.encoded ? state.encoded.mcus.length : 0;
    if (state.dctBasisHold) {
      clearTimeout(state.dctBasisHold);
      state.dctBasisHold = null;
    }
    stopVisualAnimations();
    /* 量化页拖过 QF 还没松手就切页：先把整幅编码补齐，
       后面 Zigzag / 游程 / 解码各节拿到的才是新 QF 的数据 */
    if (state.encoded && state.encodedQuality !== state.Q) encodeCurrent();
    render();
    if (mainScroll) mainScroll.scrollTop = 0;
    /* 底部步骤条不画滚动条后，窄屏上当前节点可能落在可视区外：
       切步时把选中按钮滚到中间，保证「我在第几页」始终看得见。 */
    const stepper = document.getElementById('stepper');
    const current = stepper ? stepper.querySelector('button.on') : null;
    if (current && stepper.scrollWidth > stepper.clientWidth) {
      const left = current.offsetLeft - (stepper.clientWidth - current.offsetWidth) / 2;
      stepper.scrollLeft = Math.max(0, left);
    }
    /* 行列分解页（DCT ⑤，subIndex 4）：进来就自动播一遍逐行 → 逐列的动图，之后循环 */
    if (entry.chapter === 'dct' && entry.subIndex === 4 && !ANIM.reduced) {
      state.dctPassHold = setTimeout(function () {
        state.dctPassHold = null;
        const current = FLOW_ENTRIES[state.flowIndex];
        if (current && current.chapter === 'dct' && current.subIndex === 4) startDctTwoPass();
      }, 600);
    }
    /* 一维分解页（DCT ④，subIndex 3）：从 0 项起自动叠一遍，
       比一进来就停在「8 项已完成」更能说明「逐项逼近」这件事 */
    if (entry.chapter === 'dct' && entry.subIndex === 3 && !ANIM.reduced) {
      state.dctBasisHold = setTimeout(function () {
        state.dctBasisHold = null;
        const current = FLOW_ENTRIES[state.flowIndex];
        if (current && current.chapter === 'dct' && current.subIndex === 3) startBasis();
      }, 700);
    }
    /* 逐项重建页（DCT ⑦，subIndex 6）：进来先清空，再匀速一项一拍叠加，满 64 项后循环 */
    if (entry.chapter === 'dct' && entry.subIndex === 6 && !ANIM.reduced) {
      state.dctSumHold = setTimeout(function () {
        state.dctSumHold = null;
        const current = FLOW_ENTRIES[state.flowIndex];
        if (current && current.chapter === 'dct' && current.subIndex === 6) startBasisSum(0);
      }, 600);
    }
    /* 二维系数页（DCT ⑥，subIndex 5）：进来先按 (u,v) 顺序逐项巡览，
       一拍换一项，走完 64 项停一下再从头循环 */
    if (entry.chapter === 'dct' && entry.subIndex === 5 && !ANIM.reduced) {
      state.coeffTourHold = setTimeout(function () {
        state.coeffTourHold = null;
        const current = FLOW_ENTRIES[state.flowIndex];
        if (current && current.chapter === 'dct' && current.subIndex === 5) startCoeffTour(0);
      }, 600);
    }
    /* Zigzag 页（编码 07.1）：进来 600ms 后自动从 0 扫到 64，之后持续循环 */
    if (entry.chapter === 'packResult' && entry.subIndex === 0 && !ANIM.reduced) {
      state.zigHold = setTimeout(function () {
        state.zigHold = null;
        const current = FLOW_ENTRIES[state.flowIndex];
        if (current && current.chapter === 'packResult' && current.subIndex === 0) playZigzag(0);
      }, 600);
    }
  }

  function render(options) {
    /* 整页重绘：画布会重新创建/重建位图，压窄记录作废，统一从满尺寸重新算一遍 */
    canvasFitWidth.clear();
    /* 熵解码页没有画布，由独立的三段式布局把内容铺满演示台，不走默认的垂直居中 */
    const stepId = STEPS[state.step] && STEPS[state.step].id;
    stage.classList.toggle('decode-view', stepId === 'decEntropy');
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

  /* 底部步骤条要与演示台卡片严丝合缝：只对宽度还不够，横向位置也得跟着卡片走。
     fixed 元素默认按视口居中，而卡片在 .main 的内容区里居中——.main 出现滚动条、
     浏览器缩放或窗口尺寸不同时，两者会差半个滚动条宽。这里直接读卡片的实测位置回写。 */
  let stepperLayoutKey = '';
  let stageResizeObserver = null;

  function syncStepperWidth() {
    const stepper = document.getElementById('stepper');
    if (!stepper || !stage) return;
    /* 入场动画带 scale(.995)，动画期间量到的是缩放后的外框（会永久小 0.5%），
       先跳过，animationend 时再补一次精确同步 */
    if (typeof stage.getAnimations === 'function' &&
      stage.getAnimations().some(function (animation) { return animation.playState === 'running'; })) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width) return;
    const key = rect.width.toFixed(2) + '@' + rect.left.toFixed(2);
    if (key === stepperLayoutKey) return;
    stepperLayoutKey = key;
    stepper.style.width = rect.width + 'px';
    stepper.style.left = rect.left + 'px';
    stepper.style.transform = 'none';
  }

  function fitStageToViewport() {
    if (!stage) return;
    shrinkStageToViewport();
    /* 记下这次最终显示的宽度，之后点步进按钮只重画位图时沿用同一尺寸 */
    Array.prototype.forEach.call(stage.querySelectorAll('canvas'), function (canvas) {
      const width = canvas.getBoundingClientRect().width;
      if (canvas.id && isFinite(width) && width > 0) canvasFitWidth.set(canvas.id, Math.round(width));
    });
    syncStepperWidth();
  }

  function shrinkStageToViewport() {
    if (!stage) return;
    /* 窄屏本来就是上下滚动的单手布局，强行压到一屏只会把画布缩成邮票 */
    if ((window.innerWidth || document.documentElement.clientWidth || 1200) < 900) return;
    const minHeight = parseFloat(getComputedStyle(stage).minHeight);
    if (!isFinite(minHeight) || minHeight <= 0) return;
    stage.classList.remove('compact');
    /* 量化页刻意分屏：四宫格铺满首屏，算式与统计卡留在首屏之外，下滚才看见。
       这一页不接受“压到一屏”的收缩，否则画布会被压缩去迁就下方内容。 */
    if (stage.querySelector('.quant-grid')) return;
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

  function syncZigzagPlayButton() {
    const button = document.querySelector('#stepTools button[data-action="zigzag"]');
    if (button) button.textContent = (state.zigTimer || state.zigHold) ? '暂停扫描' : '播放 Zigzag 扫描';
  }

  function stopZigzag() {
    if (state.zigTimer) {
      clearInterval(state.zigTimer);
      state.zigTimer = null;
    }
    if (state.zigHold) {
      clearTimeout(state.zigHold);
      state.zigHold = null;
    }
    syncZigzagPlayButton();
  }

  /* 一轮 = 64 个系数；扫完停 1.6 秒再清空重来，形成匀速循环的扫描动图 */
  function playZigzag(startStep) {
    if (state.step !== 6) return;
    stopZigzag();
    const total = 64;
    let tick = clamp(Math.round(typeof startStep === 'number' ? startStep : 0), 0, total);
    if (tick >= total) tick = 0;
    state.zigStep = tick;
    renderZigzagStep();
    refreshStepParams();
    state.zigTimer = setInterval(function () {
      tick += 1;
      state.zigStep = Math.min(total, tick);
      refreshZigzag();
      /* 参数卡的「扫描进度」跟着走：每 8 拍刷一次、结束时补一次，避免停在 0 / 64 */
      if (tick % 8 === 0 || tick >= total) refreshStepParams();
      if (tick >= total) {
        clearInterval(state.zigTimer);
        state.zigTimer = null;
        if (!ANIM.reduced) {
          state.zigHold = setTimeout(function () {
            state.zigHold = null;
            if (state.step === 6) playZigzag(0);
          }, 1600);
        }
      }
      syncZigzagPlayButton();
    }, ANIM.interval('zigzag', total));
    syncZigzagPlayButton();
  }

  let basisFrame = null;
  let basisCleanupTimer = null;
  function startBasis() {
    if (state.step !== 4) return;
    stopVisualAnimations();
    /* 之前在别的 DCT 子页（例如快捷键 B）：必须按整页流程跳到一维页，
       否则新布局既不重算“一屏装下”（画布拿到满尺寸），步骤条与左侧说明也停在原页。 */
    if (state.dctView !== 'oneD') {
      gotoChapter('dct:2');
      if (state.step !== 4 || state.dctView !== 'oneD') return;
      stopVisualAnimations();
    }
    state.dctUseCount = 0;
    const basis = { active: true, step: 0, row: state.dctRow, start: performance.now() };
    state.basis = basis;
    const target = setupCanvas('dctRowBasis', DCT_ROW_CANVAS.w, DCT_ROW_CANVAS.h);
    if (!target) { state.basis = null; return; }
    function frame(now) {
      if (state.basis !== basis) return;
      if (state.step !== 4) { state.basis = null; return; }
      /* 匀速播放：不套缓动，8 项按等间隔依次加入（每 1/8 时长加一项），
         不会出现开头慢、中间快、结尾又停住的情况 */
      const raw = Math.min(1, (now - basis.start) / ANIM.duration('basis'));
      basis.step = Math.min(8, Math.ceil(raw * 8));
      state.dctUseCount = basis.step;
      drawRowBasis(target);
      drawDctRowCoeff();
      syncUseButtons(basis.step);
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

  /* 一轮 = 64 项；加满后停 1.6 秒清空重来，形成匀速循环的逐项叠加动图。
     严格每拍加一项：不套 easing，避免出现某一拍加两项或停住不动。 */
  function startBasisSum(startCount) {
    if (state.step !== 4) return;
    stopVisualAnimations();
    /* 同 startBasis：换子页一律走整页渲染，尺寸与导航才会一致 */
    if (state.dctView !== 'rebuild') {
      gotoChapter('dct:5');
      if (state.step !== 4 || state.dctView !== 'rebuild') return;
      stopVisualAnimations();
    }
    const total = 64;
    let count = clamp(Math.round(typeof startCount === 'number' ? startCount : state.dctSumStep), 0, total);
    if (count >= total) count = 0;
    state.dctSumStep = count;
    drawDctRebuildViews();
    syncRebuildButtons();
    refreshStepParams();
    state.dctSumTimer = setInterval(function () {
      count += 1;
      state.dctSumStep = Math.min(total, count);
      if (state.step === 4 && state.dctView === 'rebuild') {
        drawDctRebuildViews();
        syncRebuildButtons();
        refreshStepParams();
      }
      if (count >= total) {
        clearInterval(state.dctSumTimer);
        state.dctSumTimer = null;
        syncRebuildButtons();
        if (state.step === 4 && state.dctView === 'rebuild') {
          state.dctSumHold = setTimeout(function () {
            state.dctSumHold = null;
            if (state.step === 4 && state.dctView === 'rebuild') startBasisSum(0);
          }, 1600);
        }
      }
    }, ANIM.interval('basissum', total));
  }

  function stopVisualAnimations() {
    stopZigzag();
    stopLumaDemo();
    stopZoomDemo();
    ['quantTimer', 'qfTimer', 'rleTimer', 'bitTimer', 'decodeTimer', 'idctTimer', 'tourTimer', 'zigTimer', 'zigHold', 'dctPassTimer', 'dctPassHold', 'dctBasisHold', 'dctSumTimer', 'dctSumHold', 'coeffTourTimer', 'coeffTourHold', 'assemblyTimer'].forEach(function (key) {
      if (state[key]) {
        clearInterval(state[key]);
        state[key] = null;
      }
    });
    /* QF 扫掠被打断（换页、重编码）时不再记着“该回到哪一档”，免得下次误复位 */
    state.qfReturn = null;
    syncQfSweepButton();
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
         才能重算“一屏装下”。不用 gotoChapter：它会给 dct:3 再排一次自动播放，
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

  /* 符号逐个点亮：每拍点亮双轨图下排的一个符号，橙色连线指出它覆盖了哪几个系数 */
  function startRleAnim() {
    if (state.step !== 7) return;
    if (state.rleTimer) clearInterval(state.rleTimer);
    state.rleStep = 0;
    updateRleReadout();
    refreshRleStrip();
    const total = Math.max(1, encodedBlock().symbols.length);
    let tick = 0;
    state.rleTimer = setInterval(function () {
      tick += 1;
      const next = ANIM.progress('rle', tick, total);
      if (next !== state.rleStep) {
        state.rleStep = next;
        updateRleReadout();
        refreshRleStrip();
      }
      if (tick >= total) {
        clearInterval(state.rleTimer);
        state.rleTimer = null;
      }
    }, ANIM.interval('rle', total));
  }

  function updateRleReadout() {
    const readout = document.getElementById('rleReadout');
    if (!readout) return;
    const block = encodedBlock();
    if (state.rleStep <= 0) {
      readout.textContent = '从左往右扫这 64 个数：遇到 0 只计数，遇到非零数就把「跳过几个 0」和「这个数」合成一个符号；点「播放游程编码」看它逐个生成。';
      return;
    }
    const index = Math.min(state.rleStep, block.symbols.length);
    const symbol = block.symbols[index - 1];
    let explain;
    if (symbol.kind === 'DC') {
      explain = 'DC 与上一块相差 ' + (symbol.value > 0 ? '+' : '') + symbol.value + '，占 ' + symbol.size + ' 位';
    } else if (symbol.kind === 'ZRL') {
      explain = '16 个连续 0，一个符号打包带走';
    } else if (symbol.kind === 'EOB') {
      explain = '后面全是 0，到此收尾';
    } else {
      explain = (symbol.run > 0 ? '跳过 ' + symbol.run + ' 个 0，' : '前面没有 0，') +
        '取到 ' + symbol.value + '（幅值占 ' + symbol.size + ' 位）';
    }
    readout.textContent = '第 ' + index + ' / ' + block.symbols.length + ' 个符号：' + symbolLabel(symbol) + '　' +
      explain + '；写出去 = 码字 ' + symbol.code +
      (symbol.amplitude ? ' + 幅值位 ' + symbol.amplitude : '（这个符号没有幅值位）') + '，共 ' +
      (symbol.code.length + symbol.amplitude.length) + ' bit';
  }

  function startBitWriteAnim() {
    if (state.step !== 8) return;
    if (state.bitTimer) clearInterval(state.bitTimer);
    const block = encodedBlock();
    const bits = block.bits;
    state.bitWriteStep = 0;
    const box = document.getElementById('huffBits');
    const readout = document.getElementById('huffReadout');
    function paint() {
      if (box) {
        box.innerHTML = bitGroupsHTML(block, state.bitWriteStep) +
          (state.bitWriteStep < bits.length ? '<span class="zero"> …</span>' : '');
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
      const next = Math.min(total, Math.round(ANIM.progress('assembly', tick, ticks) * total));
      if (next !== state.assemblyStep) {
        state.assemblyStep = next;
        const canvas = document.getElementById('bitAssembly');
        if (canvas) {
          /* 逻辑尺寸必须和 setupCanvas 里一致，否则动画期间格子会被画成非正方形 */
          drawBitAssembly({
            canvas: canvas,
            ctx: canvas.getContext('2d'),
            w: BIT_ASSEMBLY_SIZE,
            h: BIT_ASSEMBLY_SIZE
          }, state.assemblyStep);
        }
        refreshAssemblyReadout();
      }
      if (tick >= ticks) {
        state.assemblyStep = total;
        clearInterval(state.assemblyTimer);
        state.assemblyTimer = null;
        /* 收尾补一帧：把最后几格和读数都落到「全部拼完」的状态 */
        const canvas = document.getElementById('bitAssembly');
        if (canvas) {
          drawBitAssembly({
            canvas: canvas,
            ctx: canvas.getContext('2d'),
            w: BIT_ASSEMBLY_SIZE,
            h: BIT_ASSEMBLY_SIZE
          }, state.assemblyStep);
        }
        refreshAssemblyReadout();
      }
    }, ANIM.interval('assembly', ticks));
  }

  /* 静态页只在位片段下方留一句收口说明，重复的数字都在上方指标卡与码字格标题里 */
  function updateDecodeReadout() {
    const readout = document.getElementById('decodeReadout');
    if (!readout) return;
    const block = encodedBlock();
    readout.textContent = '本块 ' + block.symbols.length + ' 个符号已按码表顺序读出，' +
      '位游标落在块尾 ' + block.bitEnd + '。';
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
    /* 开篇单独成一章，编号 00。每章显式写 code：插入序章也不会让 01–09 与
       子步骤号（如 05.5）整体顺延，步骤条与面板标题里的编号始终稳定。 */
    { id: 'opening', short: '开篇', title: '开篇：JPEG 压缩的两条心理视觉原理', code: '00', steps: [16] },
    { id: 'luma', short: '亮度与色度', title: '亮度与色度：人眼更依赖亮度', code: '01', steps: [14] },
    /* 02 章两页：02.1 找区域/缩小演示，02.2 把两块区域立起来做立体对比 */
    { id: 'freq', short: '低频与高频', title: '低频与高频：人眼靠低频认物体', code: '02', steps: [15, 22] },
    /* 03 章两页：先把整幅 RGB 图换成 Y/Cb/Cr 三张分量图，再进入 8×8 分块 */
    { id: 'input', short: '输入解码', title: '输入：从 JPG 解码出 RGB，再换成 YCbCr 三分量', code: '03', steps: [21, 0] },
    { id: 'prep', short: '编码准备', title: '编码准备：YCbCr、色度采样与分块', code: '04', steps: [1, 2, 3] },
    { id: 'dct', short: 'DCT', title: 'DCT：把 8×8 块换成 64 个余弦权重', code: '05', steps: [4, 4, 4, 4, 4, 4, 4] },
    { id: 'quant', short: '量化', title: '量化：系数域中真正丢信息的一步', code: '06', steps: [5] },
    { id: 'packResult', short: '码流与结果', title: 'Zigzag/Huffman 与熵编码输出', code: '07', steps: [6, 7, 8, 9] },
    { id: 'decode', short: '解码原理', title: '解码：位流如何变回像素', code: '08', steps: [10, 11, 12, 13] },
    /* MATLAB 批量实测：彩色页（风景照片，color_reference.js）排在最前，再是 70 组彩色实测的三页 */
    { id: 'matlab', short: 'MATLAB 实测', title: 'MATLAB 批量实验数据', code: '10', steps: [17, 18, 19, 20] }
  ];

  FLOW_ENTRIES = FLOW_CHAPTERS.reduce(function (list, chapter, chapterIndex) {
    chapter.steps.forEach(function (step, subIndex) {
      list.push({
        chapter: chapter.id,
        chapterShort: chapter.short,
        chapterIndex: chapterIndex,
        chapterCode: chapter.code,
        chapterCount: chapter.steps.length,
        subIndex: subIndex,
        step: step
      });
    });
    return list;
  }, []);

  /* 首屏节点以教学流第一节为准：STEPS 只是步骤库，顺序变了也不会让标题与内容错位 */
  state.step = FLOW_ENTRIES[state.flowIndex].step;

  /* 章节号 + 子步骤号，例如 05.2；单步章节只显示 05。
     开篇章节自带 code = '00'，不参与 01–09 的顺延编号。 */
  function chapterLabel(entry) {
    if (!entry || typeof entry.chapterIndex !== 'number') return '';
    const base = entry.chapterCode || String(entry.chapterIndex + 1).padStart(2, '0');
    return entry.chapterCount > 1 ? base + '.' + (entry.subIndex + 1) : base;
  }


  /* ------------------------------------------------------------------ */
  /* 初始化                                                              */
  /* ------------------------------------------------------------------ */

  function init() {
    buildSamples();
    bindTableZoomEvents();
    lastViewport = {
      key: (window.innerWidth || 1200) + 'x' + (window.devicePixelRatio || 1).toFixed(2),
      height: window.innerHeight || 800
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    /* 卡片宽度会随滚动条、字体缩放、窗口拖动而变，跟着同步步骤条宽度 */
    stage.addEventListener('animationend', syncStepperWidth);
    if (window.ResizeObserver) {
      stageResizeObserver = new ResizeObserver(syncStepperWidth);
      stageResizeObserver.observe(stage);
      /* 滚动条出现/消失只改变 .main 的内容区宽度、不改卡片宽度，也要跟着对齐 */
      if (mainScroll) stageResizeObserver.observe(mainScroll);
    } else {
      window.addEventListener('resize', syncStepperWidth);
    }
    loadImage(sampleRGB(samples[0]), samples[0].name, samples[0].width, samples[0].height);
  }

  init();
})();
