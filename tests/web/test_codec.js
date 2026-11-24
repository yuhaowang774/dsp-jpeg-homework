'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const sandbox = {
  window: {},
  console: console,
  atob: function (text) { return Buffer.from(text, 'base64').toString('binary'); }
};
vm.createContext(sandbox);

['web/photos.js', 'web/demo_data.js', 'web/jpeg_codec.js'].forEach(function (file) {
  const fullPath = path.join(root, file);
  vm.runInContext(fs.readFileSync(fullPath, 'utf8'), sandbox, { filename: fullPath });
});

const Codec = sandbox.window.JpegCodec;
const Photos = sandbox.window.DEMO_PHOTOS;
const Demo = sandbox.window.DEMO_DATA;
// 网页样例已移除这张灰度图，仅测试用它对照 MATLAB 的 Y 通道结果。
const peppers = require('./fixtures/peppers_gray.js');

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

function rgbaFromRgbBase64(base64) {
  const raw = Buffer.from(base64, 'base64');
  const output = new Uint8ClampedArray(raw.length / 3 * 4);
  for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
    output[j] = raw[i];
    output[j + 1] = raw[i + 1];
    output[j + 2] = raw[i + 2];
    output[j + 3] = 255;
  }
  return output;
}

function photoImages() {
  return Photos.map(function (photo) {
    return {
      name: photo.name,
      rgb: rgbaFromRgbBase64(photo.pixels),
      width: photo.width || 256,
      height: photo.height || 256
    };
  });
}

function smoothImage(width, height) {
  const rgb = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      rgb[index] = Math.round(255 * x / width);
      rgb[index + 1] = Math.round(255 * y / height);
      rgb[index + 2] = Math.round(128 + 80 * Math.sin(x / 12));
      rgb[index + 3] = 255;
    }
  }
  return rgb;
}

test('DCT/IDCT 对随机块可逆（最大误差 < 1e-9）', function () {
  const block = new Float64Array(64);
  for (let i = 0; i < 64; i++) block[i] = Math.sin(i * 1.7) * 60;
  const restored = Codec.idct2(Codec.dct2(block));
  let maximum = 0;
  for (let i = 0; i < 64; i++) maximum = Math.max(maximum, Math.abs(restored[i] - block[i]));
  assert.ok(maximum < 1e-9, '最大误差 ' + maximum);
});

test('常数块的 DCT 只有 DC 分量', function () {
  const block = new Float64Array(64).fill(3);
  const coefficients = Codec.dct2(block);
  assert.ok(Math.abs(coefficients[0] - 24) < 1e-9, 'DC=' + coefficients[0]);
  for (let i = 1; i < 64; i++) assert.ok(Math.abs(coefficients[i]) < 1e-9, 'AC ' + i);
});

test('二维 DCT 可分解为两次一维 DCT', function () {
  const block = new Float64Array(64);
  for (let i = 0; i < 64; i++) block[i] = Math.sin(i * 0.37) * 80 + Math.cos(i * 1.13) * 30;
  const temporary = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) sum += Codec.T[u][x] * block[y * 8 + x];
      temporary[y * 8 + u] = sum;
    }
  }
  const direct = Codec.dct2(block);
  let maximum = 0;
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) sum += Codec.T[u][y] * temporary[y * 8 + v];
      maximum = Math.max(maximum, Math.abs(sum - direct[u * 8 + v]));
    }
  }
  assert.ok(maximum < 1e-9, '两阶段与直接 DCT 最大差 ' + maximum);
});

test('幅值位映射符合 JPEG 规则', function () {
  const cases = [[0, 0, ''], [1, 1, '1'], [-1, 1, '0'], [3, 2, '11'], [-3, 2, '00'], [5, 3, '101'], [-5, 3, '010']];
  cases.forEach(function (item) {
    const result = Codec.amplitudeBits(item[0]);
    assert.strictEqual(result.category, item[1], '类别 ' + item[0]);
    assert.strictEqual(result.bits, item[2], '幅值位 ' + item[0]);
  });
});

test('规范 Huffman 码表与 T.81 附录 K 一致', function () {
  assert.strictEqual(Codec.DC_TABLE.encode.get(0).code, '00');
  assert.strictEqual(Codec.DC_TABLE.encode.get(1).code, '010');
  assert.strictEqual(Codec.DC_TABLE.encode.get(5).code, '110');
  assert.strictEqual(Codec.AC_TABLE.encode.get(0x00).code, '1010');
  assert.strictEqual(Codec.AC_TABLE.encode.get(0xF0).length, 11);
});

test('质量映射在 Q=50 时等于基准表，Q=100 时全为 1', function () {
  const table50 = Codec.qualityTable(Codec.QL_BASE, 50);
  assert.strictEqual(table50[0], 16);
  assert.strictEqual(table50[1], 11);
  const table100 = Codec.qualityTable(Codec.QL_BASE, 100);
  for (let i = 0; i < 64; i++) assert.strictEqual(table100[i], 1);
});

test('三种色度采样的尺寸正确', function () {
  const rgb = smoothImage(64, 64);
  const expected = { '444': [64, 64], '422': [32, 64], '420': [32, 32] };
  Object.keys(expected).forEach(function (mode) {
    const encoded = Codec.encode(rgb, 64, 64, { quality: 50, subsampling: mode });
    const cb = encoded.components.Cb;
    assert.strictEqual(cb.w, expected[mode][0], mode + ' 宽');
    assert.strictEqual(cb.h, expected[mode][1], mode + ' 高');
  });
});

test('真实照片在全部采样与关键质量下可逆且位流完全消费', function () {
  const images = photoImages();
  const qualities = [1, 10, 50, 90, 100];
  const modes = ['444', '422', '420'];
  let cases = 0;
  images.forEach(function (image) {
    modes.forEach(function (mode) {
      qualities.forEach(function (quality) {
        const encoded = Codec.encode(image.rgb, image.width, image.height, { quality: quality, subsampling: mode });
        const decoded = Codec.decode(encoded);
        assert.strictEqual(decoded.bitPosition, decoded.bitLength,
          image.name + ' ' + mode + ' Q' + quality + ' 位流未完全消费');
        let mismatch = 0;
        encoded.blocks.forEach(function (block, key) {
          const other = decoded.blocks.get(key);
          for (let i = 0; i < 64; i++) {
            if (block.quantized[i] !== other.quantized[i]) mismatch += 1;
          }
        });
        assert.strictEqual(mismatch, 0, image.name + ' ' + mode + ' Q' + quality + ' 系数不一致');
        assert.ok(Number.isFinite(Codec.psnr(image.rgb, decoded.rgb)), 'PSNR 非有限值');
        cases += 1;
      });
    });
  });
  assert.strictEqual(cases, images.length * modes.length * qualities.length);
});

test('取整规则与 MATLAB round 一致（含 0.5 前一格的双精度值）', function () {
  const round = Codec.matlabRound;
  assert.strictEqual(round(0.5), 1);
  assert.strictEqual(round(-0.5), -1);
  assert.strictEqual(round(2.5), 3);
  assert.strictEqual(round(-2.5), -3);
  assert.strictEqual(round(0.49999999999999994), 0, '0.5 前一格不能进位');
  assert.strictEqual(round(-0.49999999999999994), 0, '-0.5 后一格不能舍入到 -1');
  assert.strictEqual(round(0), 0);
  assert.strictEqual(round(-0.0000000000000001), 0);
});

test('灰度 Y 路径与 MATLAB 参考一致（Q=50, 4:4:4）', function () {
  const image = peppers;
  const raw = Buffer.from(image.pixels, 'base64');
  const rgb = new Uint8ClampedArray(raw.length * 4);
  for (let i = 0; i < raw.length; i++) {
    rgb[i * 4] = raw[i];
    rgb[i * 4 + 1] = raw[i];
    rgb[i * 4 + 2] = raw[i];
    rgb[i * 4 + 3] = 255;
  }
  const encoded = Codec.encode(rgb, image.width || 256, image.height || 256, { quality: 50, subsampling: '444' });
  const decoded = Codec.decode(encoded);
  let squared = 0;
  for (let i = 0; i < raw.length; i++) {
    const difference = raw[i] - decoded.components.Y.data[i];
    squared += difference * difference;
  }
  const mse = squared / raw.length;
  const psnr = 10 * Math.log10(255 * 255 / mse);
  assert.ok(Math.abs(psnr - 36.5665) < 0.05, 'Y-PSNR=' + psnr.toFixed(4));
});

test('奇数尺寸 101×77 在三种采样下位流完整消费', function () {
  const rgb = smoothImage(101, 77);
  ['444', '422', '420'].forEach(function (mode) {
    const encoded = Codec.encode(rgb, 101, 77, { quality: 80, subsampling: mode });
    const decoded = Codec.decode(encoded);
    assert.strictEqual(decoded.bitPosition, decoded.bitLength, mode + ' 位流长度');
    const psnr = Codec.psnr(rgb, decoded.rgb);
    assert.ok(psnr > 40, mode + ' PSNR=' + psnr.toFixed(2));
  });
});

test('RGB→YCbCr→RGB 往返误差不超过 1', function () {
  const rgb = smoothImage(32, 32);
  const ycbcr = Codec.rgbToYCbCr(rgb, 32, 32);
  const restored = Codec.ycbcrToRgb(ycbcr.y, ycbcr.cb, ycbcr.cr, 32, 32);
  let maximum = 0;
  for (let i = 0; i < rgb.length; i++) {
    if (i % 4 === 3) continue;
    maximum = Math.max(maximum, Math.abs(rgb[i] - restored[i]));
  }
  assert.ok(maximum <= 1, '最大误差 ' + maximum);
});

test('每块位流长度与符号位长之和一致', function () {
  const image = photoImages()[0];
  const encoded = Codec.encode(image.rgb, image.width, image.height, { quality: 50, subsampling: '420' });
  encoded.blocks.forEach(function (block) {
    let bits = 0;
    block.symbols.forEach(function (symbol) {
      bits += symbol.code.length + symbol.amplitude.length;
    });
    assert.strictEqual(bits, block.bits.length, '块 ' + block.blockX + ',' + block.blockY);
  });
});

test('演示数据中的灰度样例仍可被彩色编码器处理', function () {
  Demo.images.forEach(function (image) {
    const raw = Buffer.from(image.pixels, 'base64');
    const rgb = new Uint8ClampedArray(raw.length * 4);
    for (let i = 0; i < raw.length; i++) {
      rgb[i * 4] = raw[i];
      rgb[i * 4 + 1] = raw[i];
      rgb[i * 4 + 2] = raw[i];
      rgb[i * 4 + 3] = 255;
    }
    const encoded = Codec.encode(rgb, image.width || 256, image.height || 256, { quality: 50, subsampling: '420' });
    const decoded = Codec.decode(encoded);
    assert.strictEqual(decoded.bitPosition, decoded.bitLength);
  });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
