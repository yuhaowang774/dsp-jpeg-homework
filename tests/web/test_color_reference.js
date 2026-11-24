/* 校验网页彩色编码与 MATLAB 实测（web/color_reference.js）逐位一致。
 * 数据由 src/run_color_experiment.m → src/export_color_reference.m 生成；
 * 断言口径：熵位数、各分量位数、文件字节、填充字节、零系数占比必须完全相等，
 * PSNR 允许 1e-6 dB 的求和次序差异。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const sandbox = {
  window: {},
  atob: function (text) { return Buffer.from(text, 'base64').toString('binary'); },
  document: {}
};
vm.createContext(sandbox);
['web/photos.js', 'web/color_reference.js', 'web/jpeg_codec.js'].forEach(function (file) {
  const fullPath = path.join(root, file);
  vm.runInContext(fs.readFileSync(fullPath, 'utf8'), sandbox, { filename: fullPath });
});

const Codec = sandbox.window.JpegCodec;
const Photos = sandbox.window.DEMO_PHOTOS;
const Reference = sandbox.window.COLOR_REFERENCE;

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
function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(label + '：' + actual + ' != ' + expected);
}

test('参考数据存在且对应 1024×1024 风景示例', function () {
  if (!Reference) throw new Error('缺少 window.COLOR_REFERENCE');
  assertEqual(Reference.width, 1024, 'width');
  assertEqual(Reference.height, 1024, 'height');
  assertEqual(Reference.cases.length, 30, '档位数量');
  assertEqual(Photos[0].width, Reference.width, '页面样例宽度');
});

if (Reference) {
  const photo = Photos[0];
  const raw = Buffer.from(photo.pixels, 'base64');
  const rgb = new Uint8ClampedArray(photo.width * photo.height * 4);
  for (let i = 0; i < photo.width * photo.height; i++) {
    rgb[i * 4] = raw[i * 3];
    rgb[i * 4 + 1] = raw[i * 3 + 1];
    rgb[i * 4 + 2] = raw[i * 3 + 2];
    rgb[i * 4 + 3] = 255;
  }

  test('页面像素与 MATLAB 实验输入是同一份（通道和一致）', function () {
    if (!Reference.sourceChannelSums) throw new Error('参考数据缺少 sourceChannelSums');
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let i = 0; i < raw.length; i += 3) {
      red += raw[i];
      green += raw[i + 1];
      blue += raw[i + 2];
    }
    assertEqual(red, Reference.sourceChannelSums[0], 'R 通道和');
    assertEqual(green, Reference.sourceChannelSums[1], 'G 通道和');
    assertEqual(blue, Reference.sourceChannelSums[2], 'B 通道和');
  });

  [['420', 50], ['422', 50], ['444', 50], ['420', 5], ['420', 20], ['422', 20]].forEach(function (pair) {
    const subsampling = pair[0];
    const quality = pair[1];
    test('QF=' + quality + ' ' + subsampling + ' 与 MATLAB 逐位一致', function () {
      const expected = Reference.cases.filter(function (item) {
        return item.subsampling === subsampling && item.quality === quality;
      })[0];
      if (!expected) throw new Error('参考数据缺少该档位');
      const encoded = Codec.encode(rgb, photo.width, photo.height, { quality: quality, subsampling: subsampling });
      const decoded = Codec.decode(encoded);
      const stats = encoded.stats;
      assertEqual(stats.totalBits, expected.entropyBits, '熵位数');
      assertEqual(stats.bitsPerComponent.Y, expected.bitsPerComponent[0], 'Y 分量位数');
      assertEqual(stats.bitsPerComponent.Cb, expected.bitsPerComponent[1], 'Cb 分量位数');
      assertEqual(stats.bitsPerComponent.Cr, expected.bitsPerComponent[2], 'Cr 分量位数');
      assertEqual(stats.fileBytes, expected.fileBytes, '文件字节');
      assertEqual(stats.stuffingBytes, expected.stuffingBytes, '填充字节');
      assertEqual(stats.headerBytes, expected.headerBytes, '头字节');
      assertEqual(stats.zeroCount / stats.coefficientCount, expected.zeroFraction, '零系数占比');
      const psnr = Codec.psnr(rgb, decoded.rgb);
      if (Math.abs(psnr - expected.psnr) > 1e-6) {
        throw new Error('PSNR：' + psnr.toFixed(6) + ' != ' + expected.psnr.toFixed(6));
      }
    });
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;
