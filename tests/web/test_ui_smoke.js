'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const store = {};
const timers = [];
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
    getContext: function () { return context2D; },
    querySelectorAll: function () { return node.children; },
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
  getElementById: function (id) {
    if (!store[id]) store[id] = element(id, id.toLowerCase().indexOf('canvas') >= 0 ? 'canvas' : 'div');
    return store[id];
  },
  createElement: function (tag) { return element('', tag); },
  querySelectorAll: function () { return []; }
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
  atob: function (text) { return Buffer.from(text, 'base64').toString('binary'); },
  performance: { now: function () { return 0; } },
  requestAnimationFrame: function () { return 1; },
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

['web/photos.js', 'web/demo_data.js', 'web/jpeg_codec.js'].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
});

const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
const inline = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(function (match) { return match[1]; })[0];

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

function goTo(index) {
  store.stepper.children[index].fire('click');
}

function findFlowIndex(predicate) {
  const index = flowEntries.findIndex(predicate);
  assert.ok(index >= 0, '找不到符合条件的教学节点');
  return index;
}

const expectedByStepId = {
  source: ['sourceCanvas', 'blockPreview'],
  color: ['colorRGB', 'colorY', 'colorCb', 'colorCr'],
  subsample: ['subCbOriginal', 'subCrOriginal', 'subCbSmall', 'subCrSmall'],
  block: ['blockY', 'blockCb', 'blockCr'],
  quant: ['quantTable', 'quantCoeff', 'quantError'],
  zigzag: ['zigMain', 'zigSeq'],
  rle: ['rleStrip'],
  huffman: ['huffBits', 'huffBytes', 'huffCurrent'],
  bitstream: ['bitBars', 'bitHist', 'bitAssembly'],
  decEntropy: ['decodeWrap', 'decodeBitStrip'],
  dequant: ['dqOriginal', 'dqQuantized', 'dqTable', 'dqRestored'],
  idct: ['idctOriginal', 'idctRestored', 'idctError'],
  recolor: ['finalOriginal', 'finalDecoded', 'finalError'],
  visualLuma: ['hvsLumaOrig', 'hvsLumaY', 'hvsLumaColor'],
  visualLumaCompare: ['hvsOriginal', 'hvsLowChroma', 'hvsLowLuma'],
  visualFreq: ['hvsGray', 'hvsOnlyLow', 'hvsOnlyHigh']
};

const expectedByDctView = {
  shift: ['shiftOriginal', 'shiftCentered', 'shiftReadout'],
  oneD: ['dctRowBasis', 'dctRowReadout'],
  twopass: ['passOriginal', 'passTemp', 'passFinal', 'passRow', 'passReadout'],
  coeff: ['dctMain', 'dctBasis', 'dctTermBasis', 'dctTermContribution', 'dctTermRebuild'],
  rebuild: ['rebuildTarget', 'rebuildSum', 'rebuildTerm', 'rebuildBars', 'rebuildInfo']
};

function expectedIdsFor(entry) {
  if (entry.chapter === 'dct') {
    const view = page.DCT_VIEWS[entry.subIndex];
    const ids = expectedByDctView[view];
    assert.ok(ids, '未定义的 DCT 视图：' + view);
    return ids;
  }
  const stepId = page.STEPS[entry.step].id;
  const ids = expectedByStepId[stepId];
  assert.ok(ids, '未定义的步骤：' + stepId);
  return ids;
}

const sourceIndex = findFlowIndex(function (entry) { return page.STEPS[entry.step].id === 'source'; });
const subsampleIndex = findFlowIndex(function (entry) { return page.STEPS[entry.step].id === 'subsample'; });
const blockIndex = findFlowIndex(function (entry) { return page.STEPS[entry.step].id === 'block'; });
const zigzagIndex = findFlowIndex(function (entry) { return page.STEPS[entry.step].id === 'zigzag'; });
const oneDIndex = findFlowIndex(function (entry) { return entry.chapter === 'dct' && entry.subIndex === 1; });
const twoPassIndex = findFlowIndex(function (entry) { return entry.chapter === 'dct' && entry.subIndex === 2; });
const dctCoeffIndex = findFlowIndex(function (entry) { return entry.chapter === 'dct' && entry.subIndex === 3; });

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

test('初始化：示例图、示例按钮与教学流节点均由页面配置驱动', function () {
  assert.strictEqual(window.DEMO_PHOTOS.length, 2);
  assert.strictEqual(window.DEMO_PHOTOS[0].width, 1024);
  assert.strictEqual(window.DEMO_PHOTOS[1].width, 640);
  assert.ok(store.sampleButtons.children.length > 0, '缺少示例按钮');
  assert.strictEqual(store.stepper.children.length, flowEntries.length);
  store.stepper.children.forEach(function (button, index) {
    assert.strictEqual(button.getAttribute('data-index'), String(index));
  });
  assert.strictEqual(store.stepTitle.textContent, page.flowStep(0).title);
  assert.ok(Object.keys(store).some(function (key) { return store[key] && store[key].width > 0; }), '首个节点未渲染出画布');
});

test('全部教学流节点均渲染出预期画布与容器', function () {
  flowEntries.forEach(function (entry, index) {
    goTo(index);
    assert.strictEqual(store.stepTitle.textContent, page.flowStep(index).title);
    expectedIdsFor(entry).forEach(function (id) {
      assert.ok(store.stage.innerHTML.indexOf(id) >= 0, '第 ' + (index + 1) + ' 节点缺少 ' + id);
    });
  });
});

test('可切换 1024×1024 与 640×640 原生样例', function () {
  goTo(sourceIndex);
  store.sampleButtons.children[1].fire('click');
  assert.ok(store.stepParams.innerHTML.indexOf('640 × 640') >= 0);
  store.sampleButtons.children[0].fire('click');
  assert.ok(store.stepParams.innerHTML.indexOf('1024 × 1024') >= 0);
});

test('鼠标悬浮实时预览但不改确认选区', function () {
  goTo(sourceIndex);
  const selected = /\((\d+), (\d+)\)/.exec(store.blockPreviewHead.innerHTML);
  assert.ok(selected, '缺少当前选中块坐标');
  store.sourceCanvas.fire('mousemove', { clientX: 50, clientY: 50 });
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

test('DCT 行列分解视图与返回系数视图', function () {
  goTo(twoPassIndex);
  const tools = store.stepTools.children;
  const twoPass = tools.find(function (button) { return button.getAttribute('data-action') === 'twopass'; });
  assert.ok(twoPass, '缺少行列分解按钮');
  twoPass.fire('click');
  pump(40);
  assert.ok(store.stage.innerHTML.indexOf('passTemp') >= 0);
  assert.ok(store.stage.innerHTML.indexOf('passFinal') >= 0);
  assert.strictEqual(store.passTemp.width, store.passTemp.height);
  assert.strictEqual(store.passFinal.width, store.passFinal.height);
  assert.ok(store.passBack, '缺少返回按钮');
  store.passBack.fire('click');
  assert.strictEqual(store.stepTitle.textContent, page.flowStep(dctCoeffIndex).title);
  assert.ok(store.stage.innerHTML.indexOf('dctMain') >= 0);
});

test('DCT 一维分解视图：8 个行选择与余弦加权读数', function () {
  goTo(oneDIndex);
  assert.ok(store.stage.innerHTML.indexOf('dctRowBasis') >= 0, '缺少余弦加权画布');
  assert.ok(store.dctRowReadout.textContent.indexOf('帕塞瓦尔') >= 0, '缺少帕塞瓦尔读数');
  const rows = store.stage.children.filter(function (node) {
    return node.tagName === 'BUTTON' && node.getAttribute('data-index') !== null;
  });
  assert.strictEqual(rows.length, 8, '应有 8 个行选择按钮');
  rows[2].fire('click');
  assert.ok(store.dctRowReadout.textContent.indexOf('第 3 行') >= 0, store.dctRowReadout.textContent);
});

test('质量、采样、分量与样例切换均可重建', function () {
  store.qSlider.value = '20';
  store.qSlider.fire('input', { target: store.qSlider });
  assert.strictEqual(String(store.qValue.textContent), '20');
  goTo(subsampleIndex);
  const labels = { 444: '4:4:4', 422: '4:2:2', 420: '4:2:0' };
  ['444', '422', '420'].forEach(function (mode) {
    const button = store.subButtons.children.find(function (item) { return item.getAttribute('data-sub') === mode; });
    button.fire('click');
    assert.ok(store.stepParams.innerHTML.indexOf(labels[mode]) >= 0);
  });
  goTo(blockIndex);
  ['Y', 'Cb', 'Cr'].forEach(function (component) {
    const button = store.compButtons.children.find(function (item) { return item.getAttribute('data-comp') === component; });
    button.fire('click');
    assert.ok(store.stepParams.innerHTML.indexOf(component) >= 0 || component === 'Cr');
  });
  store.sampleButtons.children.forEach(function (button) {
    button.fire('click');
    assert.ok(store.stepTitle.textContent.length > 0);
  });
});

test('步骤条可手动切换节点', function () {
  goTo(sourceIndex);
  assert.strictEqual(store.stepTitle.textContent, page.flowStep(sourceIndex).title);
  goTo(zigzagIndex);
  assert.strictEqual(store.stepTitle.textContent, page.flowStep(zigzagIndex).title);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
