(function (global) {
  'use strict';

  const QL_BASE = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99
  ];
  const QC_BASE = [
    17, 18, 24, 47, 99, 99, 99, 99,
    18, 21, 26, 66, 99, 99, 99, 99,
    24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99
  ];
  const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
  const AC_VALUES = [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
    0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5,
    0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
    0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
    0xF9, 0xFA
  ];

  const ZIG = [];
  for (let diagonal = 0; diagonal <= 14; diagonal++) {
    const rows = [];
    for (let row = Math.max(0, diagonal - 7); row <= Math.min(7, diagonal); row++) rows.push(row);
    if (diagonal % 2 === 0) rows.reverse();
    for (let i = 0; i < rows.length; i++) ZIG.push([rows[i], diagonal - rows[i]]);
  }

  const T = [];
  for (let u = 0; u < 8; u++) {
    const row = [];
    for (let x = 0; x < 8; x++) row.push(Math.sqrt(2 / 8) * Math.cos(Math.PI / 16 * u * (2 * x + 1)));
    if (u === 0) for (let x = 0; x < 8; x++) row[x] /= Math.SQRT2;
    T.push(row);
  }

  function matlabRound(value) {
    return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
  }

  function buildHuffman(counts, values) {
    const encode = new Map();
    const decode = new Map();
    let code = 0;
    let index = 0;
    for (let length = 1; length <= 16; length++) {
      for (let i = 0; i < counts[length - 1]; i++) {
        const text = code.toString(2).padStart(length, '0');
        const symbol = values[index];
        encode.set(symbol, { code: text, length: length });
        decode.set(text, symbol);
        code += 1;
        index += 1;
      }
      code <<= 1;
    }
    return { encode: encode, decode: decode };
  }

  const DC_TABLE = buildHuffman(DC_BITS, DC_VALUES);
  const AC_TABLE = buildHuffman(AC_BITS, AC_VALUES);

  function qualityTable(base, quality) {
    const scale = quality < 50 ? Math.floor(5000 / quality) : 200 - 2 * quality;
    const table = new Float64Array(64);
    for (let i = 0; i < 64; i++) {
      table[i] = Math.min(255, Math.max(1, Math.floor((base[i] * scale + 50) / 100)));
    }
    return table;
  }

  function dct2(block) {
    const temporary = new Float64Array(64);
    const output = new Float64Array(64);
    for (let y = 0; y < 8; y++) {
      for (let u = 0; u < 8; u++) {
        let sum = 0;
        for (let x = 0; x < 8; x++) sum += T[u][x] * block[y * 8 + x];
        temporary[y * 8 + u] = sum;
      }
    }
    for (let u = 0; u < 8; u++) {
      for (let v = 0; v < 8; v++) {
        let sum = 0;
        for (let y = 0; y < 8; y++) sum += temporary[y * 8 + v] * T[u][y];
        output[u * 8 + v] = sum;
      }
    }
    return output;
  }

  function idct2(coefficients) {
    const temporary = new Float64Array(64);
    const output = new Float64Array(64);
    for (let x = 0; x < 8; x++) {
      for (let v = 0; v < 8; v++) {
        let sum = 0;
        for (let u = 0; u < 8; u++) sum += T[u][x] * coefficients[u * 8 + v];
        temporary[x * 8 + v] = sum;
      }
    }
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        let sum = 0;
        for (let v = 0; v < 8; v++) sum += temporary[x * 8 + v] * T[v][y];
        output[x * 8 + y] = sum;
      }
    }
    return output;
  }

  function amplitudeBits(value) {
    if (value === 0) return { category: 0, bits: '' };
    const category = Math.floor(Math.log2(Math.abs(value))) + 1;
    const mapped = value < 0 ? value + Math.pow(2, category) - 1 : value;
    return { category: category, bits: mapped.toString(2).padStart(category, '0') };
  }

  function rgbToYCbCr(rgb, width, height) {
    const size = width * height;
    const y = new Float32Array(size);
    const cb = new Float32Array(size);
    const cr = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const r = rgb[i * 4];
      const g = rgb[i * 4 + 1];
      const b = rgb[i * 4 + 2];
      y[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      cb[i] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
      cr[i] = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
    }
    return { y: y, cb: cb, cr: cr };
  }

  function ycbcrToRgb(y, cb, cr, width, height) {
    const output = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const yy = y[i];
      const cbValue = cb[i] - 128;
      const crValue = cr[i] - 128;
      output[i * 4] = Math.round(yy + 1.402 * crValue);
      output[i * 4 + 1] = Math.round(yy - 0.344136 * cbValue - 0.714136 * crValue);
      output[i * 4 + 2] = Math.round(yy + 1.772 * cbValue);
      output[i * 4 + 3] = 255;
    }
    return output;
  }

  function downsample(plane, width, height, mode) {
    if (mode === '444') return { data: Float32Array.from(plane), w: width, h: height };
    const outWidth = Math.ceil(width / 2);
    const outHeight = mode === '420' ? Math.ceil(height / 2) : height;
    const output = new Float32Array(outWidth * outHeight);
    for (let y = 0; y < outHeight; y++) {
      for (let x = 0; x < outWidth; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = 0; dy < (mode === '420' ? 2 : 1); dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sourceX = Math.min(width - 1, x * 2 + dx);
            const sourceY = mode === '420' ? Math.min(height - 1, y * 2 + dy) : y;
            sum += plane[sourceY * width + sourceX];
            count += 1;
          }
        }
        output[y * outWidth + x] = sum / count;
      }
    }
    return { data: output, w: outWidth, h: outHeight };
  }

  function upsampleBilinear(plane, width, height, outWidth, outHeight, mode) {
    const output = new Float32Array(outWidth * outHeight);
    const horizontal = mode === '444' ? 1 : 2;
    const vertical = mode === '420' ? 2 : 1;
    for (let y = 0; y < outHeight; y++) {
      const sourceY = vertical === 2 ? (y + 0.5) / 2 - 0.5 : y;
      const y0 = Math.floor(sourceY);
      const y1 = Math.min(height - 1, y0 + 1);
      const ty = sourceY - y0;
      for (let x = 0; x < outWidth; x++) {
        const sourceX = horizontal === 2 ? (x + 0.5) / 2 - 0.5 : x;
        const x0 = Math.floor(sourceX);
        const x1 = Math.min(width - 1, x0 + 1);
        const tx = sourceX - x0;
        const safeX0 = Math.max(0, Math.min(width - 1, x0));
        const safeY0 = Math.max(0, Math.min(height - 1, y0));
        const top = plane[safeY0 * width + safeX0] * (1 - tx) + plane[safeY0 * width + x1] * tx;
        const bottom = plane[y1 * width + safeX0] * (1 - tx) + plane[y1 * width + x1] * tx;
        output[y * outWidth + x] = top * (1 - ty) + bottom * ty;
      }
    }
    return output;
  }

  function padPlane(plane, width, height, paddedWidth, paddedHeight) {
    const output = new Float32Array(paddedWidth * paddedHeight);
    for (let y = 0; y < paddedHeight; y++) {
      const sourceY = Math.min(height - 1, y);
      for (let x = 0; x < paddedWidth; x++) {
        const sourceX = Math.min(width - 1, x);
        output[y * paddedWidth + x] = plane[sourceY * width + sourceX];
      }
    }
    return output;
  }

  function componentSpecs(subsampling) {
    if (subsampling === '420') {
      return [
        { name: 'Y', h: 2, v: 2, quant: 'lum' },
        { name: 'Cb', h: 1, v: 1, quant: 'chr' },
        { name: 'Cr', h: 1, v: 1, quant: 'chr' }
      ];
    }
    if (subsampling === '422') {
      return [
        { name: 'Y', h: 2, v: 1, quant: 'lum' },
        { name: 'Cb', h: 1, v: 1, quant: 'chr' },
        { name: 'Cr', h: 1, v: 1, quant: 'chr' }
      ];
    }
    return [
      { name: 'Y', h: 1, v: 1, quant: 'lum' },
      { name: 'Cb', h: 1, v: 1, quant: 'chr' },
      { name: 'Cr', h: 1, v: 1, quant: 'chr' }
    ];
  }

  function encodeSymbols(scan, previousDC) {
    const symbols = [];
    const difference = scan[0] - previousDC;
    const dcAmplitude = amplitudeBits(difference);
    const dcCode = DC_TABLE.encode.get(dcAmplitude.category);
    let bits = dcCode.code + dcAmplitude.bits;
    symbols.push({
      kind: 'DC', value: difference, run: 0, size: dcAmplitude.category,
      code: dcCode.code, amplitude: dcAmplitude.bits
    });
    let zeroRun = 0;
    for (let index = 1; index < 64; index++) {
      const value = scan[index];
      if (value === 0) { zeroRun += 1; continue; }
      while (zeroRun >= 16) {
        const zrl = AC_TABLE.encode.get(0xF0);
        bits += zrl.code;
        symbols.push({ kind: 'ZRL', value: 0, run: 16, size: 0, code: zrl.code, amplitude: '' });
        zeroRun -= 16;
      }
      const acAmplitude = amplitudeBits(value);
      const symbolValue = zeroRun * 16 + acAmplitude.category;
      const acCode = AC_TABLE.encode.get(symbolValue);
      bits += acCode.code + acAmplitude.bits;
      symbols.push({
        kind: 'AC', value: value, run: zeroRun, size: acAmplitude.category,
        code: acCode.code, amplitude: acAmplitude.bits
      });
      zeroRun = 0;
    }
    if (zeroRun > 0) {
      const endOfBlock = AC_TABLE.encode.get(0x00);
      bits += endOfBlock.code;
      symbols.push({ kind: 'EOB', value: 0, run: 0, size: 0, code: endOfBlock.code, amplitude: '' });
    }
    return { symbols: symbols, bits: bits, previousDC: scan[0], previousDCBefore: previousDC, difference: difference };
  }

  function encode(rgb, width, height, options) {
    const quality = options.quality;
    const subsampling = options.subsampling;
    const quantLuminance = qualityTable(QL_BASE, quality);
    const quantChrominance = qualityTable(QC_BASE, quality);
    const full = rgbToYCbCr(rgb, width, height);
    const specs = componentSpecs(subsampling);
    let maxH = 1;
    let maxV = 1;
    specs.forEach(function (spec) { maxH = Math.max(maxH, spec.h); maxV = Math.max(maxV, spec.v); });
    const mcuColumns = Math.ceil(width / (8 * maxH));
    const mcuRows = Math.ceil(height / (8 * maxV));

    const components = {};
    specs.forEach(function (spec) {
      if (spec.name === 'Y') {
        components.Y = { name: 'Y', w: width, h: height, data: full.y, quant: quantLuminance };
      } else {
        const source = spec.name === 'Cb' ? full.cb : full.cr;
        const sub = downsample(source, width, height, subsampling);
        components[spec.name] = {
          name: spec.name, w: sub.w, h: sub.h, data: sub.data,
          quant: quantChrominance
        };
      }
    });

    specs.forEach(function (spec) {
      const component = components[spec.name];
      component.paddedW = mcuColumns * spec.h * 8;
      component.paddedH = mcuRows * spec.v * 8;
      component.cols = mcuColumns * spec.h;
      component.rows = mcuRows * spec.v;
      component.padded = padPlane(component.data, component.w, component.h, component.paddedW, component.paddedH);
    });

    const blocks = new Map();
    const mcus = [];
    const predictors = { Y: 0, Cb: 0, Cr: 0 };
    const bitsPerComponent = { Y: 0, Cb: 0, Cr: 0 };
    let bitstream = '';
    let bitOffset = 0;
    let zeroCount = 0;
    let coefficientCount = 0;

    for (let mcuY = 0; mcuY < mcuRows; mcuY++) {
      for (let mcuX = 0; mcuX < mcuColumns; mcuX++) {
        const mcu = { mx: mcuX, my: mcuY, blocks: [] };
        specs.forEach(function (spec) {
          const component = components[spec.name];
          for (let v = 0; v < spec.v; v++) {
            for (let h = 0; h < spec.h; h++) {
              const blockX = mcuX * spec.h + h;
              const blockY = mcuY * spec.v + v;
              const block = new Float64Array(64);
              for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                  block[y * 8 + x] = component.padded[(blockY * 8 + y) * component.paddedW + blockX * 8 + x] - 128;
                }
              }
              const coefficients = dct2(block);
              const quantized = new Int16Array(64);
              for (let i = 0; i < 64; i++) {
                quantized[i] = matlabRound(coefficients[i] / component.quant[i]);
                if (quantized[i] === 0) zeroCount += 1;
                coefficientCount += 1;
              }
              const scan = new Int16Array(64);
              for (let i = 0; i < 64; i++) scan[i] = quantized[ZIG[i][0] * 8 + ZIG[i][1]];
              const encodedSymbols = encodeSymbols(scan, predictors[spec.name]);
              predictors[spec.name] = encodedSymbols.previousDC;
              const bits = encodedSymbols.bits;
              const record = {
                component: spec.name,
                blockX: blockX,
                blockY: blockY,
                mcuX: mcuX,
                mcuY: mcuY,
                pixels: block,
                coefficients: coefficients,
                quantized: quantized,
                scan: scan,
                symbols: encodedSymbols.symbols,
                bits: bits,
                bitStart: bitOffset,
                bitEnd: bitOffset + bits.length,
                difference: encodedSymbols.difference,
                previousDC: encodedSymbols.previousDCBefore,
                quant: component.quant
              };
              blocks.set(spec.name + ':' + blockX + ':' + blockY, record);
              mcu.blocks.push(record);
              bitsPerComponent[spec.name] += bits.length;
              bitstream += bits;
              bitOffset += bits.length;
            }
          }
        });
        mcus.push(mcu);
      }
    }

    const padding = (8 - bitstream.length % 8) % 8;
    const paddedBits = bitstream + '1'.repeat(padding);
    let stuffing = 0;
    for (let i = 0; i < paddedBits.length; i += 8) {
      if (parseInt(paddedBits.slice(i, i + 8), 2) === 255) stuffing += 1;
    }

    return {
      width: width,
      height: height,
      quality: quality,
      subsampling: subsampling,
      specs: specs,
      mcuColumns: mcuColumns,
      mcuRows: mcuRows,
      components: components,
      full: full,
      blocks: blocks,
      mcus: mcus,
      bitstream: bitstream,
      quant: { lum: quantLuminance, chr: quantChrominance },
      stats: {
        totalBits: bitstream.length,
        paddingBits: padding,
        entropyBytes: Math.ceil(bitstream.length / 8),
        stuffingBytes: stuffing,
        bitsPerComponent: bitsPerComponent,
        zeroCount: zeroCount,
        coefficientCount: coefficientCount,
        blockCount: blocks.size
      }
    };
  }

  function BitReader(bits) {
    this.bits = bits;
    this.position = 0;
  }
  BitReader.prototype.read = function () {
    if (this.position >= this.bits.length) throw new Error('位流提前结束');
    const value = this.bits[this.position] === '1' ? 1 : 0;
    this.position += 1;
    return value;
  };

  function readSymbol(table, reader) {
    let code = '';
    for (let length = 1; length <= 16; length++) {
      code += reader.read() ? '1' : '0';
      const symbol = table.decode.get(code);
      if (symbol !== undefined) return { symbol: symbol, code: code };
    }
    throw new Error('无法识别的 Huffman 码');
  }

  function readAmplitude(reader, size) {
    if (size === 0) return { value: 0, bits: '' };
    let value = 0;
    let bits = '';
    for (let i = 0; i < size; i++) {
      const bit = reader.read();
      value = (value << 1) | bit;
      bits += bit ? '1' : '0';
    }
    if (value < Math.pow(2, size - 1)) value -= Math.pow(2, size) - 1;
    return { value: value, bits: bits };
  }

  function decode(encoded) {
    const reader = new BitReader(encoded.bitstream);
    const specs = encoded.specs;
    const predictors = { Y: 0, Cb: 0, Cr: 0 };
    const decodedPlanes = {};
    specs.forEach(function (spec) {
      const component = encoded.components[spec.name];
      decodedPlanes[spec.name] = new Float32Array(component.paddedW * component.paddedH);
    });
    const decodedBlocks = new Map();

    for (let m = 0; m < encoded.mcus.length; m++) {
      const mcu = encoded.mcus[m];
      for (let b = 0; b < mcu.blocks.length; b++) {
        const reference = mcu.blocks[b];
        const component = encoded.components[reference.component];
        const quantized = new Int16Array(64);
        const symbols = [];
        const dcInfo = readSymbol(DC_TABLE, reader);
        const dcAmplitude = readAmplitude(reader, dcInfo.symbol);
        predictors[reference.component] += dcAmplitude.value;
        quantized[0] = predictors[reference.component];
        symbols.push({
          kind: 'DC', value: dcAmplitude.value, run: 0, size: dcInfo.symbol,
          code: dcInfo.code, amplitude: dcAmplitude.bits
        });
        let index = 1;
        while (index < 64) {
          const acInfo = readSymbol(AC_TABLE, reader);
          if (acInfo.symbol === 0) {
            symbols.push({ kind: 'EOB', value: 0, run: 0, size: 0, code: acInfo.code, amplitude: '' });
            break;
          }
          if (acInfo.symbol === 0xF0) {
            symbols.push({ kind: 'ZRL', value: 0, run: 16, size: 0, code: acInfo.code, amplitude: '' });
            index += 16;
            continue;
          }
          const run = acInfo.symbol >> 4;
          const size = acInfo.symbol & 15;
          const acAmplitude = readAmplitude(reader, size);
          index += run;
          if (index >= 64) break;
          quantized[index] = acAmplitude.value;
          symbols.push({
            kind: 'AC', value: acAmplitude.value, run: run, size: size,
            code: acInfo.code, amplitude: acAmplitude.bits
          });
          index += 1;
        }
        const scan = new Int16Array(64);
        for (let i = 0; i < 64; i++) scan[i] = quantized[i];
        for (let i = 0; i < 64; i++) quantized[ZIG[i][0] * 8 + ZIG[i][1]] = scan[i];
        const dequantized = new Float64Array(64);
        for (let i = 0; i < 64; i++) dequantized[i] = quantized[i] * component.quant[i];
        const pixels = idct2(dequantized);
        const blockX = reference.blockX;
        const blockY = reference.blockY;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const value = Math.min(255, Math.max(0, matlabRound(pixels[y * 8 + x] + 128)));
            decodedPlanes[reference.component][(blockY * 8 + y) * component.paddedW + blockX * 8 + x] = value;
          }
        }
        decodedBlocks.set(reference.component + ':' + blockX + ':' + blockY, {
          component: reference.component,
          blockX: blockX,
          blockY: blockY,
          quantized: quantized,
          dequantized: dequantized,
          scan: scan,
          symbols: symbols,
          pixels: pixels
        });
      }
    }

    const components = {};
    specs.forEach(function (spec) {
      const source = encoded.components[spec.name];
      const cropped = new Float32Array(source.w * source.h);
      for (let y = 0; y < source.h; y++) {
        for (let x = 0; x < source.w; x++) {
          cropped[y * source.w + x] = decodedPlanes[spec.name][y * source.paddedW + x];
        }
      }
      components[spec.name] = { name: spec.name, w: source.w, h: source.h, data: cropped };
    });

    const cbFull = upsampleBilinear(components.Cb.data, components.Cb.w, components.Cb.h,
      encoded.width, encoded.height, encoded.subsampling);
    const crFull = upsampleBilinear(components.Cr.data, components.Cr.w, components.Cr.h,
      encoded.width, encoded.height, encoded.subsampling);
    const rgb = ycbcrToRgb(components.Y.data, cbFull, crFull, encoded.width, encoded.height);

    return {
      components: components,
      cbFull: cbFull,
      crFull: crFull,
      rgb: rgb,
      blocks: decodedBlocks,
      bitPosition: reader.position,
      bitLength: encoded.bitstream.length
    };
  }

  function psnr(original, reconstructed) {
    let squaredError = 0;
    let sampleCount = 0;
    const length = Math.min(original.length, reconstructed.length);
    for (let i = 0; i + 2 < length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        const difference = original[i + channel] - reconstructed[i + channel];
        squaredError += difference * difference;
        sampleCount += 1;
      }
    }
    const mse = squaredError / Math.max(1, sampleCount);
    return mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse);
  }

  global.JpegCodec = {
    encode: encode,
    decode: decode,
    rgbToYCbCr: rgbToYCbCr,
    ycbcrToRgb: ycbcrToRgb,
    psnr: psnr,
    dct2: dct2,
    idct2: idct2,
    amplitudeBits: amplitudeBits,
    T: T,
    ZIG: ZIG,
    DC_TABLE: DC_TABLE,
    AC_TABLE: AC_TABLE,
    QL_BASE: QL_BASE,
    QC_BASE: QC_BASE,
    qualityTable: qualityTable
  };
})(typeof window !== 'undefined' ? window : globalThis);
