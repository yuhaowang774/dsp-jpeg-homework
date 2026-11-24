"""把 web/photos.js 里的页面像素原样导出为无损 PNG，供 MATLAB 实验使用。

网页显示的风景图是 photos.js 中的 RGB 字节流，与 data/demo_photo_*.jpg 的
独立解码结果并不相同（实测每通道平均差 1.54、最大 23）。因此 MATLAB 实验
必须读取本脚本导出的 PNG，才能与网页逐位一致。

用法：python tools/export_page_photo.py
输出：data/<slug>_page.png 与 data/page_pixels.json（尺寸、字节数与校验和）
"""

import base64
import hashlib
import json
import os
import re

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PHOTOS_JS = os.path.join(ROOT, 'web', 'photos.js')
DATA = os.path.join(ROOT, 'data')

ENTRY = re.compile(
    r'\{name:"(?P<name>[^"]*)",width:(?P<width>\d+),height:(?P<height>\d+),'
    r'pixels:"(?P<pixels>[A-Za-z0-9+/=]+)"\}'
)


def main():
    with open(PHOTOS_JS, 'r', encoding='utf-8') as handle:
        source = handle.read()
    entries = list(ENTRY.finditer(source))
    if not entries:
        raise SystemExit('photos.js 中未找到图像条目')

    manifest = []
    for entry in entries:
        width = int(entry.group('width'))
        height = int(entry.group('height'))
        raw = base64.b64decode(entry.group('pixels'))
        expected = width * height * 3
        if len(raw) != expected:
            raise SystemExit('像素字节数不符：%d != %d' % (len(raw), expected))

        image = Image.frombytes('RGB', (width, height), raw)
        slug = 'demo_photo_%d' % width
        path = os.path.join(DATA, slug + '_page.png')
        image.save(path, optimize=True)

        # 读回校验：PNG 必须与 photos.js 字节完全一致（无损）
        with Image.open(path) as check:
            roundtrip = check.convert('RGB').tobytes()
        if roundtrip != raw:
            raise SystemExit('%s 读回与 photos.js 不一致' % path)

        manifest.append({
            'slug': slug,
            'name': entry.group('name'),
            'width': width,
            'height': height,
            'bytes': len(raw),
            'file': os.path.relpath(path, ROOT).replace('\\', '/'),
            'sha256': hashlib.sha256(raw).hexdigest(),
            'channelSums': [sum(raw[0::3]), sum(raw[1::3]), sum(raw[2::3])],
            'samples': {
                '0,0': list(raw[0:3]),
                '512,512': list(raw[(512 * width + 512) * 3:(512 * width + 512) * 3 + 3])
                if width > 512 and height > 512 else None,
            },
        })
        print('写出 %s（%d×%d，%d 字节，sha256=%s…）' %
              (os.path.relpath(path, ROOT), width, height, len(raw), manifest[-1]['sha256'][:12]))

    target = os.path.join(DATA, 'page_pixels.json')
    with open(target, 'w', encoding='utf-8') as handle:
        json.dump({'source': 'web/photos.js', 'images': manifest}, handle, ensure_ascii=False, indent=2)
    print('写出 %s' % os.path.relpath(target, ROOT))


if __name__ == '__main__':
    main()
