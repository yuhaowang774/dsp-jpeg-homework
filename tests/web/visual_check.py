import os
import sys
import json
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'results', 'web_screenshots')
URL_BASE = 'http://127.0.0.1:8765/index.html'
URL = URL_BASE
os.makedirs(OUT, exist_ok=True)

expected_titles = [
    'JPEG 压缩：只省人眼看不清的那部分',
    '人眼先看亮度，再看颜色',
    '人眼对高频不敏感，所以敢删',
    '源图像与 8×8 分块',
    'RGB → YCbCr 颜色空间转换',
    '色度下采样',
    '8×8 分块与电平平移',
    'DCT ①：把亮度搬到 0 附近',
    'DCT ②：八种固定的余弦模式',
    'DCT ③：一行像素拆成 8 个余弦波',
    'DCT ④：二维 = 先逐行、再逐列做两次一维',
    'DCT ⑤：64 张基图，64 个权重',
    'DCT ⑥：64 项加权相加 = 原块',
    '量化：系数域中的有损步骤',
    'Zigzag 扫描',
    'DC 差分与 AC 游程',
    'Huffman 表：码字从哪里查',
    '规范 Huffman 编码',
    '熵编码输出',
    '熵解码：从位流恢复符号',
    '反量化',
    'IDCT 重建像素块',
    '色度上采样与逆颜色变换',
    '二次压缩结果'
]

wait_by_step = {
    0: 500, 1: 500, 2: 500, 3: 400, 4: 400,
    5: 400, 6: 400, 7: 400, 8: 400, 9: 400,
    10: 400, 11: 400, 12: 400, 13: 400, 14: 400,
    15: 400, 16: 400, 17: 400, 18: 400, 19: 400,
    20: 400, 21: 400, 22: 400, 23: 400
}

errors = []
checks = []
screenshots = []

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--force-device-scale-factor=1'])
    page = browser.new_page(viewport={'width': 1680, 'height': 1050}, device_scale_factor=1)
    page.set_default_timeout(90000)
    page.on('console', lambda message: errors.append('console.' + message.type + ': ' + message.text)
            if message.type == 'error' else None)
    page.on('pageerror', lambda exception: errors.append('pageerror: ' + str(exception)))

    page.goto(URL, wait_until='load')
    page.wait_for_function("document.querySelector('#stepTitle').textContent.trim().length > 0")
    page.wait_for_timeout(700)

    checks.append(('initial_samples', page.locator('#sampleButtons button').count()))
    assert page.locator('#sampleButtons button').count() == 5, 'expected 5 samples'
    checks.append(('initial_stepper', page.locator('#stepper button').count()))
    source_w = int(page.locator('#hvsLumaOrig').get_attribute('width'))
    source_h = int(page.locator('#hvsLumaOrig').get_attribute('height'))
    checks.append(('visual_canvas_aspect', round(source_w / source_h, 4)))

    for index, title in enumerate(expected_titles):
        page.locator('#stepper button[data-index="%d"]' % index).click()
        page.wait_for_timeout(wait_by_step[index])
        actual = page.locator('#stepTitle').inner_text().strip()
        if actual != title:
            errors.append('step %d title mismatch: %r != %r' % (index, actual, title))
        body = page.locator('body').inner_text()
        for bad in ['NaN', 'undefined', '编码失败']:
            if bad in body:
                errors.append('step %d contains %r' % (index, bad))
        path = os.path.join(OUT, '%02d_step%02d.png' % (index + 1, index + 1))
        page.screenshot(path=path)
        screenshots.append(path)

    page.locator('#stepper button[data-index="7"]').click()
    page.wait_for_timeout(400)
    page.locator('#stepTools button[data-action="twopass"]').click()
    page.wait_for_timeout(1500)
    path = os.path.join(OUT, '17_dct_twopass.png')
    page.screenshot(path=path)
    screenshots.append(path)
    if 'passTemp' not in page.content():
        errors.append('DCT two-pass view not rendered')
    page.locator('#passBack').click()
    page.wait_for_timeout(300)

    page.locator('#stepTools button[data-action="oneD"]').click()
    page.wait_for_timeout(400)
    path = os.path.join(OUT, '17_dct_1d.png')
    page.screenshot(path=path)
    screenshots.append(path)
    if 'dctRowWave' not in page.content():
        errors.append('DCT one-dimensional view not rendered')

    page.locator('#stepper button[data-index="5"]').click()
    page.wait_for_timeout(300)
    page.evaluate("document.getElementById('settingsPanel').classList.add('open'); document.getElementById('settingsBackdrop').classList.add('open');")
    page.locator('#subButtons button[data-sub="444"]').click()
    page.wait_for_timeout(700)
    page.locator('#settingsCloseBtn').click()
    path = os.path.join(OUT, '18_subsample_444.png')
    page.screenshot(path=path)
    screenshots.append(path)
    page.evaluate("document.getElementById('settingsPanel').classList.add('open'); document.getElementById('settingsBackdrop').classList.add('open');")
    page.locator('#subButtons button[data-sub="420"]').click()
    page.locator('#settingsCloseBtn').click()
    page.wait_for_timeout(700)

    page.locator('#stepper button[data-index="17"]').click()
    page.wait_for_timeout(500)
    page.evaluate("""() => {
        const slider = document.querySelector('#qSlider');
        slider.value = '20';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    }""")
    page.wait_for_timeout(1200)
    path = os.path.join(OUT, '19_quality_20.png')
    page.screenshot(path=path)
    screenshots.append(path)
    q_value = page.locator('#qValue').inner_text().strip()
    if q_value != '20':
        errors.append('QF slider did not apply: ' + q_value)

    page.locator('#stepper button[data-index="3"]').click()
    page.wait_for_timeout(300)
    page.set_input_files('#fileInput', os.path.join(ROOT, 'data', 'synthetic_texture.png'))
    page.wait_for_timeout(1500)
    path = os.path.join(OUT, '20_upload.png')
    page.screenshot(path=path)
    screenshots.append(path)
    upload_text = page.locator('#stepParams').inner_text()
    if '上传' not in upload_text:
        errors.append('upload did not apply: ' + upload_text)

    page.locator('#stepper button[data-index="0"]').click()
    page.wait_for_timeout(400)
    page.screenshot(path=os.path.join(OUT, '00_fullpage.png'), full_page=True)
    screenshots.append(os.path.join(OUT, '00_fullpage.png'))

    page.goto(URL, wait_until='load')
    page.wait_for_function("document.querySelector('#stepTitle').textContent.trim().length > 0")
    page.wait_for_timeout(500)
    animation_cases = [
        (7, 'basis', 1500, '21_anim_dct_basis.png', None),
        (8, 'quant', 1300, '22_anim_quant.png', '/64'),
        (10, 'rle', 1200, '23_anim_rle.png', '个符号'),
        (12, 'assembly', 1400, '24_anim_assembly.png', '已拼接'),
        (13, 'decode', 1400, '25_anim_decode.png', '已解码'),
        (15, 'idct', 1300, '26_anim_idct.png', '已叠加')
    ]
    for index, action, wait, filename, marker in animation_cases:
        page.locator('#stepper button[data-index="%d"]' % index).click()
        page.wait_for_timeout(300)
        page.locator('#stepTools button[data-action="%s"]' % action).click()
        page.wait_for_timeout(wait)
        if marker:
            body = page.locator('body').inner_text()
            if marker not in body:
                errors.append('animation step %d missing marker %r' % (index, marker))
        path = os.path.join(OUT, filename)
        page.screenshot(path=path)
        screenshots.append(path)

    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(URL, wait_until='load')
    page.wait_for_function("document.querySelector('#stepTitle').textContent.trim().length > 0")
    page.wait_for_timeout(500)
    path = os.path.join(OUT, '27_mobile.png')
    page.screenshot(path=path)
    screenshots.append(path)

    page.set_viewport_size({'width': 1680, 'height': 1050})
    page.emulate_media(reduced_motion='reduce')
    page.goto(URL, wait_until='load')
    page.wait_for_function("document.querySelector('#stepTitle').textContent.trim().length > 0")
    page.wait_for_timeout(300)
    path = os.path.join(OUT, '28_reduced_motion.png')
    page.screenshot(path=path)
    screenshots.append(path)
    page.emulate_media(reduced_motion='no-preference')

    browser.close()

summary = {
    'url': URL,
    'screenshots': len(screenshots),
    'output_dir': OUT,
    'checks': checks,
    'qf_value': q_value,
    'upload_text': upload_text,
    'errors': errors
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
if errors:
    sys.exit(1)
