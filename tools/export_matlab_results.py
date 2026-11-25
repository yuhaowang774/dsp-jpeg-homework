#!/usr/bin/env python3
"""把 MATLAB 批量实验的结果导出成前端可直接 <script> 引入的数据文件。

数据来源（均由 run_project.m / run_experiments.m 生成，不在前端重算）：
    results/measurements.csv             4 图 × 10 个 Q × 3 种方法 = 120 组灰度实测
    results/matched_rate_comparison.csv  等码率插值比较（16 个插值点）
    results/第一轮实验纪要.md              运行环境、生成时间、耗时

输出：
    web/matlab_results.js  →  window.MATLAB_RESULTS

用法（在仓库根目录）：
    python tools/export_matlab_results.py
"""

import csv
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MEASUREMENTS = os.path.join(ROOT, 'results', 'measurements.csv')
MATCHED_RATE = os.path.join(ROOT, 'results', 'matched_rate_comparison.csv')
DIGEST = os.path.join(ROOT, 'results', '第一轮实验纪要.md')
OUTPUT = os.path.join(ROOT, 'web', 'matlab_results.js')

# 顺序即前端绘图顺序：与 results/figures/02_rate_distortion.png 的四宫格一致
IMAGES = [
    ('peppers_gray', '辣椒（灰度裁剪）', '辣椒'),
    ('synthetic_gradient', '合成：平滑渐变', '渐变'),
    ('synthetic_texture', '合成：密集纹理', '纹理'),
    ('synthetic_text', '合成：文字与直线', '文字'),
]
METHODS = [
    ('custom_jpeg', '自编：频率加权'),
    ('custom_uniform', '自编：等步长'),
    ('matlab_jpeg', 'MATLAB imwrite'),
]


def read_digest():
    """从纪要里取运行环境、生成时间与耗时；缺失时留空，不影响数据本身。"""
    meta = {'environment': '', 'generatedAt': '', 'elapsedSeconds': None}
    if not os.path.exists(DIGEST):
        return meta
    with open(DIGEST, encoding='utf-8') as handle:
        text = handle.read()
    for line in text.splitlines():
        if line.startswith('- 运行环境：'):
            meta['environment'] = line.split('：', 1)[1].strip().rstrip('。')
        elif line.startswith('- 生成时间'):
            meta['generatedAt'] = line.split('：', 1)[1].strip().rstrip('。')
        elif line.startswith('- 本轮耗时'):
            matched = re.search(r'([\d.]+)\s*秒', line)
            if matched:
                meta['elapsedSeconds'] = float(matched.group(1))
    return meta


def round_number(value, digits=4):
    number = round(float(value), digits)
    # 避免导出 -0.0
    return 0.0 if number == 0 else number


def maybe_int(value):
    """MATLAB imwrite 那一路拿不到熵位/零系数，CSV 里是 NaN，这里导出为 null。"""
    text = str(value).strip().lower()
    if text in ('', 'nan', 'na'):
        return None
    return int(value)


def maybe_number(value, digits=6):
    text = str(value).strip().lower()
    if text in ('', 'nan', 'na'):
        return None
    return round_number(value, digits)


def read_measurements():
    image_index = {key: index for index, (key, _full, _short) in enumerate(IMAGES)}
    method_index = {key: index for index, (key, _label) in enumerate(METHODS)}
    rows = []
    with open(MEASUREMENTS, encoding='utf-8-sig', newline='') as handle:
        for record in csv.DictReader(handle):
            image = record['Image'].strip()
            method = record['Method'].strip()
            if image not in image_index or method not in method_index:
                raise SystemExit('未知的 Image/Method：%s / %s' % (image, method))
            rows.append({
                'image': image_index[image],
                'method': method_index[method],
                'quality': int(record['Quality']),
                'fileBytes': int(record['FileBytes']),
                'bpp': round_number(record['BPP'], 6),
                'compressionRatio': round_number(record['CompressionRatio'], 4),
                'psnr': round_number(record['PSNR'], 4),
                'zeroFraction': maybe_number(record['ZeroFraction'], 6),
                'entropyBits': maybe_int(record['EntropyBits']),
            })
    rows.sort(key=lambda row: (row['image'], row['method'], row['quality']))
    return rows


def read_matched_rate():
    image_index = {key: index for index, (key, _full, _short) in enumerate(IMAGES)}
    rows = []
    with open(MATCHED_RATE, encoding='utf-8-sig', newline='') as handle:
        for record in csv.DictReader(handle):
            image = record['Image'].strip()
            if image not in image_index:
                raise SystemExit('等码率表出现未知图像：%s' % image)
            rows.append({
                'image': image_index[image],
                'targetBpp': round_number(record['TargetBPP'], 4),
                'weightedPsnr': round_number(record['WeightedPSNR'], 4),
                'uniformPsnr': round_number(record['UniformPSNR'], 4),
                'deltaPsnr': round_number(record['DeltaPSNR'], 4),
            })
    rows.sort(key=lambda row: (row['image'], row['targetBpp']))
    return rows


def main():
    meta = read_digest()
    rows = read_measurements()
    matched = read_matched_rate()
    if len(rows) != 120:
        raise SystemExit('实测组数应为 120，实际 %d' % len(rows))

    payload = {
        'source': {
            'measurements': 'results/measurements.csv',
            'matchedRate': 'results/matched_rate_comparison.csv',
            'digest': 'results/第一轮实验纪要.md',
        },
        'environment': meta['environment'],
        'generatedAt': meta['generatedAt'],
        'elapsedSeconds': meta['elapsedSeconds'],
        'images': [{'key': key, 'label': full, 'short': short} for key, full, short in IMAGES],
        'methods': [{'key': key, 'label': label} for key, label in METHODS],
        'qualities': sorted({row['quality'] for row in rows}),
        'rows': rows,
        'matchedRate': matched,
    }

    text = ('/* 由 tools/export_matlab_results.py 从 results/*.csv 自动生成，请勿手工修改。 */\n'
            'window.MATLAB_RESULTS = '
            + json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
            + ';\n')
    with open(OUTPUT, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(text)

    qualities = payload['qualities']
    print('wrote %s' % os.path.relpath(OUTPUT, ROOT))
    print('  %d measurements | %d images x %d qualities x %d methods'
          % (len(rows), len(IMAGES), len(qualities), len(METHODS)))
    print('  %d matched-rate points | %s' % (len(matched), meta['generatedAt'] or '无时间戳'))


if __name__ == '__main__':
    sys.exit(main())
