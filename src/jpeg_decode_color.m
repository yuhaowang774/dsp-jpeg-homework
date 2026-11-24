function [image,info] = jpeg_decode_color(filename)
%JPEG_DECODE_COLOR 自行熵解码、反量化、IDCT、色度上采样并恢复RGB。
%   与 web/jpeg_codec.js 的 decode() 对齐：按 MCU 交错读取、每分量独立
%   DC 预测、双线性上采样使用半像素映射 (x+0.5)/2-0.5、逆变换末加 128
%   后四舍五入并截断。INFO.quantized 可用于验证编码解码完全互逆。
scan = jpeg_read_scan_color(filename);
tables = jpeg_tables();
bitText = dec2bin(scan.entropy,8);
bits = reshape(bitText',1,[])=='1';
bitPosition = 1;
height = scan.height;
width = scan.width;
components = scan.components;
componentCount = numel(components);
maxH = max([components.h]);
maxV = max([components.v]);
mcuColumns = ceil(width/(8*maxH));
mcuRows = ceil(height/(8*maxV));

paddedPlanes = cell(1,componentCount);
paddedWidths = zeros(1,componentCount);
paddedHeights = zeros(1,componentCount);
previousDC = zeros(1,componentCount);
blockCount = 0;
for index = 1:componentCount
    paddedWidths(index) = mcuColumns*components(index).h*8;
    paddedHeights(index) = mcuRows*components(index).v*8;
    paddedPlanes{index} = zeros(paddedHeights(index),paddedWidths(index));
    blockCount = blockCount+components(index).h*components(index).v*mcuColumns*mcuRows;
end
quantized = zeros(64,blockCount,'int16');
blockIndex = 0;

for mcuRow = 1:mcuRows
    for mcuColumn = 1:mcuColumns
        for index = 1:componentCount
            component = components(index);
            for vertical = 1:component.v
                for horizontal = 1:component.h
                    coefficients = zeros(1,64);
                    category = read_symbol(component.dc);
                    assert(category<=11,'jpeg:BadFile','DC类别超过基线范围。');
                    previousDC(index) = previousDC(index)+read_amplitude(category);
                    coefficients(1) = previousDC(index);
                    coefficientIndex = 2;
                    while coefficientIndex<=64
                        symbol = read_symbol(component.ac);
                        if symbol==0
                            break;
                        elseif symbol==240
                            coefficientIndex = coefficientIndex+16;
                            assert(coefficientIndex<=65,'jpeg:BadFile','ZRL跨越块边界。');
                            continue;
                        end
                        zeroRun = floor(symbol/16);
                        acCategory = mod(symbol,16);
                        coefficientIndex = coefficientIndex+zeroRun;
                        assert(acCategory>=1 && acCategory<=10 && coefficientIndex<=64, ...
                            'jpeg:BadFile','AC类别或游程无效。');
                        coefficients(coefficientIndex) = read_amplitude(acCategory);
                        coefficientIndex = coefficientIndex+1;
                    end
                    blockIndex = blockIndex+1;
                    quantized(:,blockIndex) = int16(coefficients(:));
                    block = zeros(8);
                    block(tables.zigzag) = coefficients;
                    reconstructed = jpeg_idct_web(block.*component.quantization,tables.transform)+128;
                    rowStart = (mcuRow-1)*component.v*8+(vertical-1)*8+1;
                    columnStart = (mcuColumn-1)*component.h*8+(horizontal-1)*8+1;
                    paddedPlanes{index}(rowStart:rowStart+7,columnStart:columnStart+7) = ...
                        min(255,max(0,round(reconstructed)));
                end
            end
        end
    end
end

remaining = bits(bitPosition:end);
assert(numel(remaining)<=7 && all(remaining),'jpeg:BadFile','尾部填充位无效。');

planes = cell(1,componentCount);
for index = 1:componentCount
    componentWidth = ceil(width*components(index).h/maxH);
    componentHeight = ceil(height*components(index).v/maxV);
    planes{index} = paddedPlanes{index}(1:componentHeight,1:componentWidth);
end
cbFull = upsample_bilinear(planes{2},size(planes{2},2),size(planes{2},1), ...
    width,height,components(2).h<maxH,components(2).v<maxV);
crFull = upsample_bilinear(planes{3},size(planes{3},2),size(planes{3},1), ...
    width,height,components(3).h<maxH,components(3).v<maxV);
yPlane = planes{1}(1:height,1:width);
image = uint8(ycbcr_to_rgb(yPlane,cbFull,crFull));

info.width = width;
info.height = height;
info.quantized = quantized;
info.consumedBits = bitPosition-1;
info.fileBytes = scan.fileBytes;
info.planes = planes;
info.cbFull = cbFull;
info.crFull = crFull;

    function symbol = read_symbol(decoder)
        %每读一位沿树下降，直到找到叶节点；最多16位。
        node = 1;
        for depth = 1:16
            assert(bitPosition<=numel(bits),'jpeg:Truncated','Huffman码被截断。');
            node = decoder.children(node,double(bits(bitPosition))+1);
            bitPosition = bitPosition+1;
            assert(node>0,'jpeg:BadFile','无法识别的Huffman码。');
            if decoder.symbol(node)>=0
                symbol = decoder.symbol(node);
                return;
            end
        end
        error('jpeg:BadFile','Huffman码超过16位。');
    end

    function value = read_amplitude(category)
        %低于 2^(类别-1) 的幅值编码映射回负数。
        if category==0
            value = 0;
            return;
        end
        assert(bitPosition+category-1<=numel(bits),'jpeg:Truncated','幅值位被截断。');
        value = double(bits(bitPosition:bitPosition+category-1))*(2.^(category-1:-1:0))';
        bitPosition = bitPosition+category;
        if value<2^(category-1)
            value = value-(2^category-1);
        end
    end
end

function output = upsample_bilinear(plane,planeWidth,planeHeight,outWidth,outHeight,horizontalHalved,verticalHalved)
%半像素映射与网页 upsampleBilinear() 一致；越界样本按 0 基坐标夹取。
output = zeros(outHeight,outWidth);
horizontal = 2*horizontalHalved;
vertical = 2*verticalHalved;
for y = 1:outHeight
    if vertical==2
        sourceY = (y-0.5)/2-0.5;   % 0 基坐标，与 JS 的 (y+0.5)/2-0.5 等价
    else
        sourceY = y-1;
    end
    y0 = floor(sourceY);
    ty = sourceY-y0;
    safeY0 = min(planeHeight-1,max(0,y0));
    y1 = max(0,min(planeHeight-1,y0+1));
    for x = 1:outWidth
        if horizontal==2
            sourceX = (x-0.5)/2-0.5;
        else
            sourceX = x-1;
        end
        x0 = floor(sourceX);
        tx = sourceX-x0;
        safeX0 = min(planeWidth-1,max(0,x0));
        x1 = max(0,min(planeWidth-1,x0+1));
        top = plane(safeY0+1,safeX0+1)*(1-tx)+plane(safeY0+1,x1+1)*tx;
        bottom = plane(y1+1,safeX0+1)*(1-tx)+plane(y1+1,x1+1)*tx;
        output(y,x) = top*(1-ty)+bottom*ty;
    end
end
end

function rgb = ycbcr_to_rgb(y,cb,cr)
%与网页 ycbcrToRgb() 相同的系数与取整规则，输出截断到 0–255。
cbValue = cb-128;
crValue = cr-128;
rgb = zeros([size(y),3],'uint8');
rgb(:,:,1) = uint8(min(255,max(0,round(y+1.402*crValue))));
rgb(:,:,2) = uint8(min(255,max(0,round(y-0.344136*cbValue-0.714136*crValue))));
rgb(:,:,3) = uint8(min(255,max(0,round(y+1.772*cbValue))));
end
