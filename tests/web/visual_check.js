/* 真实浏览器验证：用 Playwright（Node 版）打开离线页面 web/index.html，
 * 逐节点截图并检查控制台错误、NaN/undefined、一屏装下、QF 拉杆、动画工具按钮、
 * Huffman 首字节灰底、IDCT 动画进度、快捷键、移动端与减少动态效果。
 *
 * 用法（在仓库根目录）：node tests/web/visual_check.js
 * 依赖：npm 安装的 playwright 与其自带 Chromium（npx playwright install chromium）。
 * 截图输出：results/web_screenshots/（每次运行先清空旧图，保证与当前页面一致）。
 * 页面是 file:// 直接打开的，不需要本地 HTTP 服务。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'results', 'web_screenshots');
const URL = pathToFileURL(path.join(ROOT, 'web', 'index.html')).href;
/* 常见投影/笔记本分辨率（1536×864 = 1920×1080 屏 125% 缩放）：29 个节点的演示舞台都应无需滚动 */
const FIT_VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 }
];
const SHOT_VIEWPORT = { width: 1920, height: 1080 };
const EXPECTED_NODES = 29;
/* 这些按钮只切块或跳页，不是动画 */
const NON_ANIMATION_ACTIONS = new Set(['goto', 'prevBlock', 'nextBlock']);

const errors = [];
const checks = [];
let shotCount = 0;

function fail(message) { errors.push(message); }
function check(name, value) { checks.push([name, value]); }

function prepareOutput() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).forEach(function (name) {
    if (name.toLowerCase().endsWith('.png')) fs.unlinkSync(path.join(OUT, name));
  });
}

async function shot(page, name) {
  shotCount += 1;
  await page.screenshot({ path: path.join(OUT, name + '.png') });
}

async function openPage(browser, viewport, options) {
  const context = await browser.newContext(Object.assign({ viewport: viewport, deviceScaleFactor: 1 }, options || {}));
  const page = await context.newPage();
  page.on('console', function (message) {
    if (message.type() === 'error') fail('console.error @' + viewport.width + ': ' + message.text());
  });
  page.on('pageerror', function (error) { fail('pageerror @' + viewport.width + ': ' + error.message); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(function () {
    const title = document.querySelector('#stepTitle');
    return title && title.textContent.trim().length > 0;
  });
  await page.waitForTimeout(500);
  return { context: context, page: page };
}

async function gotoNode(page, index, wait) {
  await page.locator('#stepper button[data-index="' + index + '"]').click();
  await page.waitForTimeout(wait || 450);
}

async function nodeLabel(page) {
  const kicker = (await page.locator('#stepKicker').innerText()).trim();
  const title = (await page.locator('#stepTitle').innerText()).trim();
  return { kicker: kicker, title: title };
}

async function findNode(page, predicate) {
  const count = await page.locator('#stepper button').count();
  for (let index = 0; index < count; index++) {
    const text = (await page.locator('#stepper button[data-index="' + index + '"]').innerText()).trim();
    if (predicate(text)) return index;
  }
  return -1;
}

async function scanBodyText(page, where) {
  const body = await page.locator('body').innerText();
  ['NaN', 'undefined', '编码失败', 'Infinity'].forEach(function (bad) {
    if (body.indexOf(bad) >= 0) fail(where + ' 页面文字里出现 ' + JSON.stringify(bad));
  });
}

/* 布局：.main 里先是演示舞台（一屏高），说明面板排在舞台下面、下滚才看见。
 * 所以「一屏装下」只看舞台：舞台卡片不超出可视区、卡片内容也不溢出卡片。
 * 量化页（.quant-grid）是刻意分屏的，四宫格占满首屏、算式与统计卡在首屏之外，不算溢出。 */
async function overflowOf(page) {
  return page.evaluate(function () {
    const main = document.getElementById('mainScroll');
    const stage = document.getElementById('stage');
    if (!main || !stage) return 0;
    if (stage.querySelector('.quant-grid')) return 0;
    main.scrollTop = 0;
    const viewportBottom = main.getBoundingClientRect().top + main.clientHeight;
    const card = stage.getBoundingClientRect();
    const beyondViewport = Math.round(card.bottom - viewportBottom);
    const beyondCard = stage.scrollHeight - stage.clientHeight;
    return Math.max(beyondViewport, beyondCard);
  });
}

async function run() {
  prepareOutput();
  const browser = await chromium.launch();
  try {
    /* 1. 逐节点：截图 + 文字检查 */
    let session = await openPage(browser, SHOT_VIEWPORT);
    let page = session.page;
    const nodeCount = await page.locator('#stepper button').count();
    check('nodes', nodeCount);
    if (nodeCount !== EXPECTED_NODES) fail('节点数 ' + nodeCount + '，README 写的是 ' + EXPECTED_NODES);
    const labels = [];
    for (let index = 0; index < nodeCount; index++) {
      await gotoNode(page, index, 600);
      const label = await nodeLabel(page);
      labels.push(label);
      if (!label.title) fail('节点 ' + index + ' 标题为空');
      await scanBodyText(page, '节点 ' + index + '（' + label.title + '）');
      await shot(page, String(index + 1).padStart(2, '0') + '_node');
    }
    check('first_title', labels[0] && labels[0].title);

    /* 2. 每个节点上的动画工具按钮都点一遍：不抛错、不出 NaN */
    let animationClicks = 0;
    for (let index = 0; index < nodeCount; index++) {
      await gotoNode(page, index, 350);
      const actions = await page.locator('#stepTools button[data-action]').evaluateAll(function (buttons) {
        return buttons.map(function (button) { return button.getAttribute('data-action'); });
      });
      for (const action of actions) {
        if (NON_ANIMATION_ACTIONS.has(action)) continue;
        const button = page.locator('#stepTools button[data-action="' + action + '"]').first();
        if (!(await button.isVisible()) || !(await button.isEnabled())) continue;
        await button.click();
        await page.waitForTimeout(900);
        animationClicks += 1;
        await scanBodyText(page, '节点 ' + index + ' 动画 ' + action);
        await shot(page, 'anim_' + String(index + 1).padStart(2, '0') + '_' + action);
        /* 再点一次停掉（多数按钮是播放/暂停切换），避免拖到下一节点 */
        if (await button.isVisible()) await button.click().catch(function () {});
        await page.waitForTimeout(150);
      }
    }
    check('animation_buttons_clicked', animationClicks);
    if (animationClicks < 10) fail('只点到 ' + animationClicks + ' 个动画按钮，可能选择器失效');

    /* 3. IDCT 动画中途应逐项叠加，而不是停在 2/64 再跳到 64 */
    const idctNode = await findNode(page, function (text) { return /IDCT/.test(text); });
    if (idctNode >= 0) {
      await gotoNode(page, idctNode, 400);
      const idctButton = page.locator('#stepTools button[data-action="idct"]');
      if (await idctButton.count()) {
        await idctButton.click();
        await page.waitForTimeout(500);
        const mid = await page.locator('#idctReadout').innerText();
        const match = mid.match(/已叠加 (\d+)\/64/);
        check('idct_mid_readout', mid.trim());
        if (!match || Number(match[1]) <= 2) fail('IDCT 动画中途读数异常：' + mid);
        await page.waitForTimeout(1500);
        const end = await page.locator('#idctReadout').innerText();
        if (end.indexOf('64/64') < 0) fail('IDCT 动画结束读数异常：' + end);
      } else {
        fail('IDCT 节点没有 idct 按钮');
      }
    } else {
      fail('没找到 IDCT 节点');
    }

    /* 4. QF 拉杆：拖到 20 松手后整幅重编码，读数跟着变 */
    const quantNode = await findNode(page, function (text) { return text.indexOf('量化') >= 0 && text.indexOf('反量化') < 0; });
    if (quantNode >= 0) {
      await gotoNode(page, quantNode, 400);
      await page.evaluate(function () {
        const range = document.getElementById('quantQfRange');
        range.value = '20';
        range.dispatchEvent(new Event('input', { bubbles: true }));
        range.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(1500);
      const params = await page.locator('#stepParams').innerText();
      check('qf_params_after_slider', params.replace(/\s+/g, ' ').slice(0, 80));
      if (!/20/.test(params)) fail('QF 拉杆未生效：' + params);
      await shot(page, 'qf_20');
      /* 键盘 ↑ 把 QF 调高（步长见 app.js keydown 处理） */
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(1200);
      const value = Number(await page.locator('#quantQfRange').inputValue());
      check('qf_after_arrow_up', value);
      if (!(value > 20)) fail('↑ 键未把 QF 调高：' + value);
    } else {
      fail('没找到量化节点');
    }

    /* 5. Huffman 页：首字节灰底的位数 = 图例写的位数 */
    const huffNode = await findNode(page, function (text) { return text.indexOf('Huffman') >= 0; });
    if (huffNode >= 0) {
      await gotoNode(page, huffNode, 500);
      const result = await page.evaluate(function () {
        const partial = document.querySelector('.huff-bitline > .partial');
        const legend = document.querySelector('.huff-legend .lg-note');
        return {
          partialBits: partial ? partial.textContent.replace(/[^01]/g, '').length : 0,
          partialCount: document.querySelectorAll('.huff-bitline .partial').length,
          legend: legend ? legend.textContent : ''
        };
      });
      check('huffman_first_byte', result);
      const legendBits = (result.legend.match(/只有 (\d+) 位/) || [])[1];
      if (legendBits ? Number(legendBits) !== result.partialBits : result.partialBits !== 0) {
        fail('Huffman 首字节灰底 ' + result.partialBits + ' 位，图例写 ' + result.legend);
      }
      if (result.partialCount > 1) fail('Huffman 首字节灰底被拆成 ' + result.partialCount + ' 段');
    }

    /* 5b. 分块巡览中途换页：分析块要还原成巡览前那块，后续各节才用的是讲解块 */
    const sourceNode = await findNode(page, function (text) { return /^\s*03\.2/.test(text); });
    if (sourceNode >= 0) {
      await gotoNode(page, sourceNode, 500);
      const before = (await page.locator('#blockPreviewHead').innerText()).trim();
      const tour = page.locator('#stepTools button[data-action="tour"]');
      if (await tour.count()) {
        await tour.click();
        await page.waitForTimeout(700);
        const during = (await page.locator('#blockPreviewHead').innerText()).trim();
        await gotoNode(page, sourceNode + 1, 400);
        await gotoNode(page, sourceNode, 500);
        const after = (await page.locator('#blockPreviewHead').innerText()).trim();
        check('tour_block', before + ' | 巡览中 ' + during + ' | 回来后 ' + after);
        if (after !== before) fail('分块巡览后分析块没有还原：' + before + ' → ' + after);
      } else {
        fail('源图分块节点没有巡览按钮');
      }
    }

    /* 6. 快捷键：→ 切到下一节点；在 DCT 首页按 B 跳到一维分解页 */
    await gotoNode(page, 0, 300);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    if ((await nodeLabel(page)).title !== labels[1].title) fail('→ 键没有切到第 2 个节点');
    const dctNode = await findNode(page, function (text) { return /^\s*05\.1/.test(text); });
    if (dctNode >= 0) {
      await gotoNode(page, dctNode, 400);
      await page.keyboard.press('b');
      await page.waitForTimeout(800);
      const title = (await nodeLabel(page)).title;
      check('key_B_title', title);
      if (title.indexOf('一行像素拆成 8 个余弦波') < 0) fail('B 键没有跳到一维分解页：' + title);
    }
    await session.context.close();

    /* 7. 一屏装下：三档常见投影分辨率，每个节点都不需要滚动 */
    for (const viewport of FIT_VIEWPORTS) {
      session = await openPage(browser, viewport);
      page = session.page;
      const overflowing = [];
      for (let index = 0; index < nodeCount; index++) {
        await gotoNode(page, index, 450);
        const overflow = await overflowOf(page);
        if (overflow > 2) overflowing.push(index + '(' + labels[index].kicker.replace(/\s+/g, ' ') + ' +' + overflow + 'px)');
      }
      check('fit_' + viewport.width + 'x' + viewport.height, overflowing.length ? overflowing : 'all fit');
      if (overflowing.length) fail(viewport.width + '×' + viewport.height + ' 下需要滚动的节点：' + overflowing.join('，'));
      await session.context.close();
    }

    /* 8. 移动端与减少动态效果 */
    session = await openPage(browser, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
    await shot(session.page, 'mobile_opening');
    await gotoNode(session.page, Math.max(0, quantNode), 500);
    await scanBodyText(session.page, '移动端量化页');
    await shot(session.page, 'mobile_quant');
    await session.context.close();

    session = await openPage(browser, SHOT_VIEWPORT, { reducedMotion: 'reduce' });
    await gotoNode(session.page, Math.max(0, quantNode), 400);
    const sweep = session.page.locator('#stepTools button[data-action="qfsweep"]');
    if (await sweep.count()) {
      const before = await session.page.locator('#quantQfRange').inputValue();
      await sweep.click();
      await session.page.waitForTimeout(1200);
      const coarse = await session.page.locator('#quantQfRange').inputValue();
      await sweep.click();
      await session.page.waitForTimeout(1200);
      const after = await session.page.locator('#quantQfRange').inputValue();
      check('reduced_motion_qf_toggle', before + ' → ' + coarse + ' → ' + after);
      if (coarse !== '5' || after !== before) fail('减少动态效果下 QF 切换没有回到原值：' + before + ' → ' + coarse + ' → ' + after);
    }
    await shot(session.page, 'reduced_motion_quant');
    await session.context.close();
  } finally {
    await browser.close();
  }

  const summary = { url: URL, screenshots: shotCount, outputDir: OUT, checks: checks, errors: errors };
  console.log(JSON.stringify(summary, null, 2));
  if (errors.length) process.exitCode = 1;
}

run().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
