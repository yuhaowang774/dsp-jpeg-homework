'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const store = {};
const timers = [];
const frames = [];
let timerId = 1;

function createContext2D() {
  return new Proxy({}, {
    get: function (target, property) {
      if (property === 'createImageData') {
        return function (width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; };
      }
      if (property === 'getImageData') {
        return function (x, y, width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; };
      }
      if (property === 'measureText') return function () { return { width: 10 }; };
      if (property === 'createLinearGradient') return function () { return { addColorStop: function () {} }; };
      return function () {};
    },
    set: function () { return true; }
  });
}
const context2D = createContext2D();

function element(id, tag) {
  const node = {
    id: id,
    tagName: (tag || 'div').toUpperCase(),
    style: {},
    dataset: {},
    width: 0,
    height: 0,
    offsetWidth: 1,
    offsetHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    value: '0',
    textContent: '',
    _html: '',
    children: [],
    listeners: {},
    attrs: {},
    classList: {
      add: function () {},
      remove: function () {},
      toggle: function () {}
    },
    appendChild: function (child) { node.children.push(child); return child; },
    addEventListener: function (type, callback) {
      (node.listeners[type] = node.listeners[type] || []).push(callback);
    },
    fire: function (type, event) {
      (node.listeners[type] || []).forEach(function (callback) {
        callback(Object.assign({ target: node, preventDefault: function () {} }, event || {}));
      });
    },
    getAttribute: function (key) { return node.attrs[key] !== undefined ? node.attrs[key] : null; },
    setAttribute: function (key, value) { node.attrs[key] = value; },
    removeAttribute: function (key) { delete node.attrs[key]; },
    closest: function (selector) {
      return /data-index/.test(selector) && node.attrs['data-index'] !== undefined ? node : null;
    },
    getContext: function () { return context2D; },
    querySelectorAll: function () { return node.children; },
    querySelector: function (selector) { return node.children.find(function (child) { return child.attrs && child.attrs[selector] !== undefined; }) || node.children[0] || null; },
    scrollIntoView: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 400, height: 400 }; }
  };
  Object.defineProperty(node, 'innerHTML', {
    get: function () { return node._html; },
    set: function (html) {
      node._html = String(html);
      node.children = node.children.filter(function (child) { return !child._parsed; });
      const buttonPattern = /<button([^>]*)>/g;
      let match;
      while ((match = buttonPattern.exec(node._html)) !== null) {
        const attrs = match[1];
        const button = element('', 'button');
        button._parsed = true;
        const idMatch = /id="([^"]+)"/.exec(attrs);
        const actionMatch = /data-action="([^"]+)"/.exec(attrs);
        const indexMatch = /data-index="([^"]+)"/.exec(attrs);
        if (idMatch) { button.id = idMatch[1]; store[button.id] = button; }
        if (actionMatch) button.attrs['data-action'] = actionMatch[1];
        if (indexMatch) button.attrs['data-index'] = indexMatch[1];
        node.children.push(button);
      }
    }
  });
  return node;
}

const document = {
  documentElement: { clientWidth: 1400, clientHeight: 900 },
  getElementById: function (id) {
    if (!store[id]) store[id] = element(id, id.toLowerCase().indexOf('canvas') >= 0 ? 'canvas' : 'div');
    return store[id];
  },
  createElement: function (tag) { return element('', tag); },
  querySelector: function (selector) {
    const id = /^#([\w-]+)$/.exec(String(selector));
    return id ? document.getElementById(id[1]) : null;
  },
  querySelectorAll: function (selector) {
    const id = /^#([\w-]+)\s+/.exec(String(selector));
    const root = id ? document.getElementById(id[1]) : null;
    return root ? root.children : [];
  }
};

['compButtons', 'subButtons'].forEach(function (id) {
  const box = document.getElementById(id);
  const values = id === 'compButtons' ? ['Y', 'Cb', 'Cr'] : ['444', '422', '420'];
  const attribute = id === 'compButtons' ? 'data-comp' : 'data-sub';
  values.forEach(function (value) {
    const button = element('', 'button');
    button.setAttribute(attribute, value);
    box.appendChild(button);
  });
});

const window = { devicePixelRatio: 1, addEventListener: function () {}, location: { search: '' } };
const sandbox = {
  window: window,
  document: document,
  console: console,
  /* 布局读数要给真实数值：亮度对比页按 padding / gap / 图注高度算画布尺寸，
     返回 undefined 会让它算出 NaN，画布位图宽高也跟着变成 NaN */
  getComputedStyle: function () {
    return {
      paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px',
      borderTopWidth: '0px', borderBottomWidth: '0px',
      marginTop: '0px', marginBottom: '0px',
      rowGap: '10px', columnGap: '14px', minHeight: '0px',
      getPropertyValue: function () { return '#94a3b8'; }
    };
  },
  atob: function (text) { return Buffer.from(text, 'base64').toString('binary'); },
  performance: { now: function () { return 0; } },
  requestAnimationFrame: function (callback) { frames.push(callback); return frames.length; },
  cancelAnimationFrame: function () {},
  setTimeout: function (callback) { callback(); return 1; },
  clearTimeout: function () {},
  setInterval: function (callback) {
    const id = timerId++;
    timers.push({ id: id, callback: callback, active: true });
    return id;
  },
  clearInterval: function (id) {
    timers.forEach(function (timer) { if (timer.id === id) timer.active = false; });
  }
};
vm.createContext(sandbox);

['web/photos.js', 'web/demo_data.js', 'web/color_reference.js', 'web/jpeg_codec.js'].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
});

/* 页面脚本已拆到 web/app.js，测试改为直接读取该文件 */
const inline = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');

const rendererBlock = /const RENDERERS = \[([\s\S]*?)\];/.exec(inline);
if (rendererBlock) {
  (rendererBlock[1].match(/[A-Za-z_$][\w$]*/g) || []).forEach(function (name) {
    if (/^render/.test(name) && !new RegExp('function\\s+' + name + '\\s*\\(').test(inline)) {
      sandbox[name] = function () {};
    }
  });
}

const iifeEnd = '})();';
const iifePos = inline.lastIndexOf(iifeEnd);
assert.ok(iifePos >= 0, '未找到页面脚本的 IIFE 结尾');
const instrumented = inline.slice(0, iifePos) +
  '\n;globalThis.__TEST_PAGE__ = {' +
  ' FLOW_ENTRIES: FLOW_ENTRIES,' +
  ' FLOW_CHAPTERS: FLOW_CHAPTERS,' +
  ' STEPS: STEPS,' +
  ' DCT_VIEWS: DCT_VIEWS,' +
  ' chapterLabel: chapterLabel,' +
  ' flowStep: flowStep };\n' +
  inline.slice(iifePos);
vm.runInContext(instrumented, sandbox, { filename: 'web/index.html:inline' });
const page = sandbox.__TEST_PAGE__;
const flowEntries = page.FLOW_ENTRIES;

function pump(times) {
  for (let i = 0; i < times; i++) {
    timers.filter(function (timer) { return timer.active; }).forEach(function (timer) { timer.callback(); });
  }
}

function pumpFrames() {
  frames.splice(0).forEach(function (callback) { callback(0); });
}

function goTo(index) {
  /* 步骤条改为事件委托：在容器上触发，target 指向对应按钮 */
  store.stepper.fire('click', { target: store.stepper.children[index] });
}

function findFlowIndex(predicate) {
  const index = flowEntries.findIndex(predicate);
  assert.ok(index >= 0, '找不到符合条件的教学节点');
  return index;
}

const expectedByStepId = {
  opening: ['openingRules'],
  source: ['sourceCanvas', 'blockPreview'],
  color: ['colorRGB', 'colorY', 'colorCb', 'colorCr'],
  subsample: ['subCbOriginal', 'subCrOriginal', 'subCbSmall', 'subCrSmall', 'subCropBefore', 'subCropAfter'],
  block: ['blockY', 'blockCb', 'blockCr'],
  quant: ['quantTable', 'quantCoeff', 'quantError'],
  zigzag: ['zigMain', 'zigSeq'],
  rle: ['rleStrip', 'rleAnatomy'],
  huffTable: ['t81DcTable', 't81AcTable', 't81AcTable2'],
  huffman: ['huffBits', 't81DcTable', 't81AcTable', 't81AcTable2'],
  bitstream: ['bitBars', 'bitHist', 'bitAssembly'],
  decEntropy: ['decodeWrap', 'decodeBitStrip'],
  dequant: ['dqOriginal', 'dqQuantized', 'dqTable', 'dqRestored'],
  idct: ['idctOriginal', 'idctRestored', 'idctError'],
  recolor: ['finalOriginal', 'finalDecoded', 'finalError'],
  visualLuma: ['hvsLumaOrig', 'hvsLumaY', 'hvsLumaColor'],
  visualLumaCompare: ['hvsOriginal', 'hvsLowChroma', 'hvsLowLuma'],
  visualFreq: ['hvsRegionMap', 'hvsCropLow', 'hvsCropHigh', 'hvsSolidPhotoLow', 'hvsSolidPhotoHigh', 'hvsZoomCanvas', 'hvsZoomPlay', 'hvsZoomInfo']
};

const expectedByDctView = {
  shift: ['shiftOriginal', 'shiftCentered', 'shiftReadout'],
  basisGrid: ['dctCosineGrid'],
  oneD: ['dctRowBasis', 'dctRowCoeff'],
  twopass: ['passOriginal', 'passTemp', 'passFinal', 'passRow'],
  coeff: ['dctMain', 'dctBasis', 'dctTermBasis', 'dctTermContribution', 'dctTermRebuild'],
  rebuild: ['rebuildTarget', 'rebuildSum', 'rebuildTerm', 'rebuildBasisIndex', 'rebuildBars', 'rebuildInfo']
};

function expectedIdsFor(entry) {
  if (entry.chapter === 'dct') {
    const view = page.DCT_VIEWS[entry.subIndex];
    const ids = expectedByDctView[view];
    assert.ok(ids, '未定义的 DCT 视图：' + view);
    return ids;
  }
  /* 09 二次压缩结果复用 step 13，但演示台换成「一次重建 / 二次重建 / 两次之差」，
     不再和 08.4 共用 recolor 的三张画布 */
  if (entry.chapter === 'result') return ['secondFirst', 'secondAgain', 'secondDiff'];
  const stepId = page.STEPS[entry.step].id;
  const ids = expectedByStepId[stepId];
  assert.ok(ids, '未定义的步骤：' + stepId);
  return ids;
}

const sourceIndex = findFlowIndex(function (entry) { return page.STEPS[entry.step].id === 'source'; });
const subsampleIndex = findFlowIndex(function (entry) { return page.STEPS[entry.step].id === 'subsample'; });
const blockIndex = findFlowIndex(function (entry) { return page.STEPS[entry.step].id === 'block'; });
const zigzagIndex = findFlowIndex(function (entry) { return page.STEPS[entry.step].id === 'zigzag'; });
/* DCT 子页按视图名定位：视图顺序调整（插页）不会让用例点到别的页 */
function findDctView(view) {
  return findFlowIndex(function (entry) {
    return entry.chapter === 'dct' && page.DCT_VIEWS[entry.subIndex] === view;
  });
}
const oneDIndex = findDctView('oneD');
const twoPassIndex = findDctView('twopass');
const dctCoeffIndex = findDctView('coeff');
const dctRebuildIndex = findDctView('rebuild');
const rleIndex = findFlowIndex(function (entry) { return page.STEPS[entry.step].id === 'rle'; });

let passed = 0;
let failed = 0;
function test(name, body) {
  try {
    body();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL  ' + name);
    console.error('      ' + error.message);
  }
}

test('初始化：示例数据与教学流节点均由页面配置驱动', function () {
  assert.strictEqual(window.DEMO_PHOTOS.length, 2);
  assert.strictEqual(window.DEMO_PHOTOS[0].width, 1024);
  assert.strictEqual(window.DEMO_PHOTOS[1].width, 640);
  assert.strictEqual(store.stepper.children.length, flowEntries.length);
  store.stepper.children.forEach(function (button, index) {
    assert.strictEqual(button.getAttribute('data-index'), String(index));
  });
  assert.strictEqual(store.stepTitle.textContent, page.flowStep(0).title);
  /* 首节点是纯文字的“00 开篇”，因此这里只校验演示台已渲染出内容 */
  assert.ok(String(store.stage.innerHTML).length > 0, '首个节点未渲染出内容');
});

/* 量化页的算式区与标尺挂在左侧说明面板里（首屏只留四宫格），所以渲染结果要连面板一起看 */
function renderedHTML() {
  const panel = store.stepPanel;
  const panelHTML = panel && panel.children
    ? panel.children.map(function (child) { return child.innerHTML || ''; }).join('')
    : '';
  return store.stage.innerHTML + panelHTML;
}

test('开篇节点单独成页，只用文字点明两条心理视觉原理', function () {
  const entry = flowEntries[0];
  assert.strictEqual(page.STEPS[entry.step].id, 'opening', '教学流第一节应是开篇节点');
  goTo(0);
  const html = store.stage.innerHTML;
  assert.ok(html.indexOf('opening-rule') >= 0, '开篇页缺少两条原理的条目');
  assert.ok(html.indexOf('心理视觉原理') >= 0, '开篇页未点明这是心理视觉原理');
  assert.ok(html.indexOf('亮度 / 颜色感知') >= 0, '缺少 01 亮度/颜色感知');
  assert.ok(html.indexOf('低 / 高频信号感知') >= 0, '缺少 02 低/高频信号感知');
  assert.ok(html.indexOf('<canvas') < 0, '开篇页不应放任何图片/画布');
  assert.ok(page.chapterLabel(entry) === '00', '开篇章节应编号 00，后续 01–09 不顺延');
  assert.strictEqual(page.chapterLabel(flowEntries[1]), '01', '开篇之后的第一节仍应编号 01');
});

test('章节编号稳定：DCT 子页与视图一一对应，编号从 05.1 起', function () {
  const dctEntries = flowEntries.filter(function (entry) { return entry.chapter === 'dct'; });
  assert.strictEqual(dctEntries.length, page.DCT_VIEWS.length, 'DCT 页数与视图数应一致');
  assert.deepStrictEqual(dctEntries.map(page.chapterLabel),
    page.DCT_VIEWS.map(function (view, index) { return '05.' + (index + 1); }));
  assert.strictEqual(page.chapterLabel(dctEntries[0]), '05.1');
});

test('全部教学流节点均渲染出预期画布与容器', function () {
  flowEntries.forEach(function (entry, index) {
    goTo(index);
    assert.strictEqual(store.stepTitle.textContent, page.flowStep(index).title);
    const html = renderedHTML();
    expectedIdsFor(entry).forEach(function (id) {
      assert.ok(html.indexOf(id) >= 0, '第 ' + (index + 1) + ' 节点缺少 ' + id);
    });
  });
});

test('内置 1024×1024 与 640×640 两个原生样例均提供', function () {
  assert.strictEqual(window.DEMO_PHOTOS.length, 2);
  assert.strictEqual(window.DEMO_PHOTOS[0].width, 1024);
  assert.strictEqual(window.DEMO_PHOTOS[0].height, 1024);
  assert.strictEqual(window.DEMO_PHOTOS[1].width, 640);
  assert.strictEqual(window.DEMO_PHOTOS[1].height, 640);
});

test('鼠标悬浮实时预览但不改确认选区', function () {
  goTo(sourceIndex);
  const selected = /\((\d+), (\d+)\)/.exec(store.blockPreviewHead.innerHTML);
  assert.ok(selected, '缺少当前选中块坐标');
  store.sourceCanvas.fire('mousemove', { clientX: 50, clientY: 50 });
  pumpFrames();
  assert.ok(store.blockPreviewHead.innerHTML.indexOf('悬浮') >= 0);
  assert.ok(store.blockPreviewHead.innerHTML.indexOf('(16, 16)') >= 0);
  goTo(blockIndex);
  assert.ok(store.stepParams.innerHTML.indexOf('(' + selected[1] + ', ' + selected[2] + ')') >= 0);
});

test('点击源图同步 8×8 预览与后续块坐标', function () {
  goTo(sourceIndex);
  store.sourceCanvas.fire('click', { clientX: 100, clientY: 300 });
  assert.ok(store.stage.innerHTML.indexOf('blockPreview') >= 0);
  assert.ok(store.blockPreviewHead.innerHTML.indexOf('(32, 96)') >= 0);
  goTo(blockIndex);
  assert.ok(store.stepParams.innerHTML.indexOf('(32, 96)') >= 0);
});

test('切步不会自动跳步或自动播放', function () {
  goTo(sourceIndex);
  const title = store.stepTitle.textContent;
  pump(200);
  assert.strictEqual(store.stepTitle.textContent, title);
});

test('所有工具按钮触发的动画不抛错并产生读数', function () {
  for (let index = 0; index < flowEntries.length; index++) {
    goTo(index);
    const buttons = store.stepTools.children.slice();
    buttons.forEach(function (button) {
      button.fire('click');
      pump(220);
    });
  }
  assert.ok(store.quantReadout.textContent.length > 0);
  assert.ok(store.huffReadout.textContent.length > 0);
  assert.ok(store.assemblyReadout.textContent.length > 0);
  assert.ok(store.decodeReadout.textContent.length > 0);
  assert.ok(store.idctReadout.textContent.length > 0);
});

test('DCT 行列分解视图：三张矩阵 + 当前行宽图，不含图注/读数/返回按钮', function () {
  goTo(twoPassIndex);
  const tools = store.stepTools.children;
  const twoPass = tools.find(function (button) { return button.getAttribute('data-action') === 'twopass'; });
  assert.ok(twoPass, '缺少行列分解按钮');
  twoPass.fire('click');
  pump(40);
  const html = store.stage.innerHTML;
  assert.ok(html.indexOf('passTemp') >= 0);
  assert.ok(html.indexOf('passFinal') >= 0);
  assert.ok(html.indexOf('passRow') >= 0);
  assert.strictEqual(store.passTemp.width, store.passTemp.height);
  assert.strictEqual(store.passFinal.width, store.passFinal.height);
  assert.ok(html.indexOf('passReadout') < 0, '读数行已删除，不应再渲染');
  assert.ok(html.indexOf('passBack') < 0, '底部按钮已删除，不应再渲染');
  assert.ok(!store.passBack, '返回按钮节点不应存在');
  /* 切页改走底部步骤条 */
  goTo(dctCoeffIndex);
  assert.strictEqual(store.stepTitle.textContent, page.flowStep(dctCoeffIndex).title);
  assert.ok(store.stage.innerHTML.indexOf('dctMain') >= 0);
});

test('DCT 一维分解视图：8 个行选择与余弦加权画布', function () {
  goTo(oneDIndex);
  assert.ok(store.stage.innerHTML.indexOf('dctRowBasis') >= 0, '缺少余弦加权画布');
  assert.ok(store.stage.innerHTML.indexOf('dctRowReadout') < 0, '图注与读数已移除，不应再渲染');
  const rows = store.stage.children.filter(function (node) {
    return node.tagName === 'BUTTON' && node.getAttribute('data-index') !== null;
  });
  assert.ok(rows.length >= 8, '至少应有 8 个行选择按钮（可能另含示例行）');
  rows[2].fire('click');
  assert.ok(store.stage.innerHTML.indexOf('第 3 行') >= 0, '切换行后像素条说明未更新');
});

test('DCT 重建视图：64 张基图索引随步进高亮，点选可定位到该项', function () {
  goTo(dctRebuildIndex);
  assert.ok(store.stage.innerHTML.indexOf('rebuildBasisIndex') >= 0, '缺少 64 张基图索引');
  assert.ok(store.rebuildBasisIndex.width > 0, '基图索引画布未绘制');
  function stackedCount() {
    const matched = /已叠加项<\/span><b>(\d+) \/ 64/.exec(store.stepParams.innerHTML);
    assert.ok(matched, '缺少“已叠加项”读数');
    return Number(matched[1]);
  }
  /* 点左上角第一格（u = 0, v = 0）：步进应停在“DC 刚被加入”的那一步 */
  store.rebuildBasisIndex.fire('click', { clientX: 39, clientY: 39 });
  const first = stackedCount();
  assert.ok(first >= 1 && first <= 64, '点选基图后已叠加项数越界：' + first);
  store.rebuildBasisIndex.fire('click', { clientX: 39, clientY: 39 });
  assert.strictEqual(stackedCount(), first, '重复点同一格应停在同一项');
});

test('游程编码页：前 4 个典型符号的解剖卡', function () {
  goTo(rleIndex);
  const html = store.stage.innerHTML;
  assert.ok(html.indexOf('rle-guide') < 0, '三句导语已删除，不应再渲染');
  assert.ok(html.indexOf('rle-anatomy-card') >= 0, '缺少符号解剖卡');
  assert.ok(html.indexOf('run = ') >= 0, '解剖卡未说明 run 的含义');
  assert.ok(html.indexOf('size = ') >= 0, '解剖卡未说明 size 的含义');
  assert.ok(/跳过 [1-9]\d* 个 0/.test(html), '解剖卡缺少“跳过非零个 0”的实例');
  assert.ok(html.indexOf('幅值位') >= 0, '解剖卡未给出幅值位');
  /* 播放一拍：读数应换成「第 N 个符号」的白话解释 */
  const play = store.stepTools.children.find(function (button) {
    return button.getAttribute('data-action') === 'rle';
  });
  assert.ok(play, '缺少播放游程编码按钮');
  play.fire('click');
  pump(3);
  assert.ok(store.rleReadout.textContent.indexOf('个符号') >= 0, '读数未跟随扫描进度');
});

test('Huffman 页合并展示位流与 T.81 标准表，独立的 Huffman 表节点已移除', function () {
  assert.strictEqual(flowEntries.some(function (entry) { return page.STEPS[entry.step].id === 'huffTable'; }), false,
    '教学流不应再有独立的 Huffman 表节点');
  const huffIndex = findFlowIndex(function (entry) { return page.STEPS[entry.step].id === 'huffman'; });
  goTo(huffIndex);
  const html = store.stage.innerHTML;
  assert.ok(html.indexOf('huffBits') >= 0, '合并页缺少位流');
  assert.ok(html.indexOf('t81DcTable') >= 0, '合并页缺少 DC 标准表');
  assert.ok(html.indexOf('t81AcTable') >= 0, '合并页缺少 AC 标准表上半');
  assert.ok(html.indexOf('t81AcTable2') >= 0, '合并页缺少 AC 标准表下半');
  assert.ok(html.indexOf('码字从哪里查') < 0, '表标题已删除，不应再渲染');
  assert.ok(html.indexOf('本块位流 · 一格') < 0, '位流标题已删除，不应再渲染');
  assert.ok(html.indexOf('huff-saving') < 0, '收益读数已删除，不应再渲染');
});

test('默认 4:2:0 下色度局部对比与读数完整', function () {
  goTo(subsampleIndex);
  assert.ok(store.stepParams.innerHTML.indexOf('4:2:0') >= 0);
  assert.ok(store.stage.innerHTML.indexOf('subCropBefore') >= 0, '缺少局部对比画布');
  assert.ok(store.subCropNote.innerHTML.indexOf('色度最大偏差') >= 0, '缺少局部对比读数');
});

test('步骤条可手动切换节点', function () {
  goTo(sourceIndex);
  assert.strictEqual(store.stepTitle.textContent, page.flowStep(sourceIndex).title);
  goTo(zigzagIndex);
  assert.strictEqual(store.stepTitle.textContent, page.flowStep(zigzagIndex).title);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
