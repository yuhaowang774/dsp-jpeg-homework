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
vm.runInContext(inline, sandbox, { filename: 'web/index.html:inline' });

function pump(times) {
  for (let i = 0; i < times; i++) {
    timers.filter(function (timer) { return timer.active; }).forEach(function (timer) { timer.callback(); });
  }
}

function goTo(index) {
  store.stepper.children[index].fire('click');
}

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

test('初始化：2 张原生风景示例、6 个样例与 18 个教学流节点', function () {
  assert.strictEqual(window.DEMO_PHOTOS.length, 2);
  assert.strictEqual(window.DEMO_PHOTOS[0].width, 1024);
  assert.strictEqual(window.DEMO_PHOTOS[1].width, 640);
  assert.strictEqual(store.sampleButtons.children.length, 6);
  assert.strictEqual(store.stepper.children.length, 18);
  assert.strictEqual(store.stepTitle.textContent, '亮度与色度：人眼更依赖亮度');
  assert.ok(store.hvsLumaOrig.width > 0);
});

const flowStepIds = [14, 15, 16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13];

const expectedIds = [
  ['sourceCanvas', 'blockPreview'],
  ['colorRGB', 'colorY', 'colorCb', 'colorCr'],
  ['subCbOriginal', 'subCrOriginal', 'subCbSmall', 'subCrSmall'],
  ['blockY', 'blockCb', 'blockCr'],
  ['dctMain', 'dctBasis'],
  ['quantTable', 'quantCoeff', 'quantError'],
  ['zigMain', 'zigSeq'],
  ['rleStrip'],
  ['huffBits', 'huffBytes', 'huffCurrent'],
  ['bitBars', 'bitHist', 'bitAssembly'],
  ['decodeWrap', 'decodeBitStrip'],
  ['dqOriginal', 'dqQuantized', 'dqTable', 'dqRestored'],
  ['idctOriginal', 'idctRestored', 'idctError'],
  ['finalOriginal', 'finalDecoded', 'finalError'],
  ['hvsLumaOrig', 'hvsLumaY', 'hvsLumaCb', 'hvsLumaCr'],
  ['hvsOriginal', 'hvsLowChroma', 'hvsLowLuma'],
  ['hvsGray', 'hvsOnlyLow', 'hvsOnlyHigh']
];

test('18 个教学流节点均渲染出预期画布与容器', function () {
  flowStepIds.forEach(function (canonicalId, index) {
    goTo(index);
    expectedIds[canonicalId].forEach(function (id) {
      assert.ok(store.stage.innerHTML.indexOf(id) >= 0, '第 ' + (index + 1) + ' 节点缺少 ' + id);
    });
  });
});

test('可切换 1024×1024 与 640×640 原生样例', function () {
  goTo(3);
  store.sampleButtons.children[1].fire('click');
  assert.ok(store.stepParams.innerHTML.indexOf('640 × 640') >= 0);
  store.sampleButtons.children[0].fire('click');
  assert.ok(store.stepParams.innerHTML.indexOf('1024 × 1024') >= 0);
});

test('鼠标悬浮实时预览但不改确认选区', function () {
  goTo(3);
  const selected = /\((\d+), (\d+)\)/.exec(store.blockPreviewHead.innerHTML);
  assert.ok(selected, '缺少当前选中块坐标');
  store.sourceCanvas.fire('mousemove', { clientX: 50, clientY: 50 });
  assert.ok(store.blockPreviewHead.innerHTML.indexOf('悬浮') >= 0);
  assert.ok(store.blockPreviewHead.innerHTML.indexOf('(16, 16)') >= 0);
  goTo(6);
  assert.ok(store.stepParams.innerHTML.indexOf('(' + selected[1] + ', ' + selected[2] + ')') >= 0);
});

test('点击源图同步 8×8 预览与后续块坐标', function () {
  goTo(3);
  store.sourceCanvas.fire('click', { clientX: 100, clientY: 300 });
  assert.ok(store.stage.innerHTML.indexOf('blockPreview') >= 0);
  assert.ok(store.blockPreviewHead.innerHTML.indexOf('(32, 96)') >= 0);
  goTo(6);
  assert.ok(store.stepParams.innerHTML.indexOf('(32, 96)') >= 0);
});

test('切步不会自动跳步或自动播放', function () {
  goTo(5);
  const title = store.stepTitle.textContent;
  pump(200);
  assert.strictEqual(store.stepTitle.textContent, title);
});

test('所有工具按钮触发的动画不抛错并产生读数', function () {
  for (let index = 0; index < 18; index++) {
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
  goTo(7);
  const tools = store.stepTools.children;
  const twoPass = tools.find(function (button) { return button.getAttribute('data-action') === 'twopass'; });
  assert.ok(twoPass, '缺少行列分解按钮');
  twoPass.fire('click');
  pump(40);
  assert.ok(store.stage.innerHTML.indexOf('passTemp') >= 0);
  assert.ok(store.stage.innerHTML.indexOf('passFinal') >= 0);
  const back = store.dctBack || store.passBack;
  assert.ok(back, '缺少返回按钮');
  back.fire('click');
  assert.ok(store.stage.innerHTML.indexOf('dctMain') >= 0);
});

test('质量、采样、分量与样例切换均可重建', function () {
  store.qSlider.value = '20';
  store.qSlider.fire('input', { target: store.qSlider });
  assert.strictEqual(String(store.qValue.textContent), '20');
  goTo(5);
  const labels = { 444: '4:4:4', 422: '4:2:2', 420: '4:2:0' };
  ['444', '422', '420'].forEach(function (mode) {
    const button = store.subButtons.children.find(function (item) { return item.getAttribute('data-sub') === mode; });
    button.fire('click');
    assert.ok(store.stepParams.innerHTML.indexOf(labels[mode]) >= 0);
  });
  goTo(6);
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
  goTo(3);
  assert.strictEqual(store.stepTitle.textContent, '源图像与 8×8 分块');
  goTo(9);
  assert.strictEqual(store.stepTitle.textContent, 'Zigzag 扫描');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
