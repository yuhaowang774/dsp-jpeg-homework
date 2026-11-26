function info = jpeg_encode_color(rgb, filename, quality, subsampling, mode)
%JPEG_ENCODE_COLOR 手写三分量8位基线JPEG编码器（4:4:4 / 4:2:2 / 4:2:0）。
%   INFO = JPEG_ENCODE_COLOR(RGB,FILENAME,QUALITY,SUBSAMPLING) 使用 T.81
%   附录K的频率加权表；第五个参数 MODE='uniform' 时改用三分量共用的等步长
%   表（仅用于本项目的量化策略对照实验）。RGB 为
%   H×W×3 uint8；FILENAME 为空字符串时只算码流不落盘。逐条对齐
%   web/jpeg_codec.js：BT.601 取整变换、色度 2×2（或1×2）平均下采样且
%   越界复制边缘、按 MCU 交错（Y 各块 → Cb → Cr）、每分量独立 DC 预测、
%   T.81 附录K 的亮度/色度量化表与 Huffman 示例表、位流末补1、FF 补00。
validateattributes(rgb,{'uint8'},{'3d','nonempty'});
assert(size(rgb,3)==3,'jpeg:Input','需要 H×W×3 的 uint8 彩色图。');
validateattributes(quality,{'numeric'},{'scalar','integer','>=',1,'<=',100});
subsampling = validatestring(subsampling,{'444','422','420'});
if nargin<5 || isempty(mode)
    mode = 'jpeg';
end
mode = validatestring(mode,{'jpeg','uniform'});
tables = jpeg_tables();
quantization = jpeg_quant_table_color(quality,mode);
[height,width,~] = size(rgb);

planes = rgb_to_ycbcr(rgb);
specs = component_specs(subsampling);
maxH = max([specs.h]);
maxV = max([specs.v]);
mcuColumns = ceil(width/(8*maxH));
mcuRows = ceil(height/(8*maxV));

components = struct('name',{},'w',{},'h',{},'data',{},'quant',{}, ...
    'paddedW',{},'paddedH',{},'padded',{});
for specIndex = 1:numel(specs)
    spec = specs(specIndex);
    if spec.name=="Y"
        componentData = planes.y;
        dataWidth = width;
        dataHeight = height;
        componentQuant = quantization.lum;
    else
        if spec.name=="Cb"
            source = planes.cb;
        else
            source = planes.cr;
        end
        [componentData,dataWidth,dataHeight] = downsample_chroma(source,width,height,subsampling);
        componentQuant = quantization.chrom;
    end
    component.paddedW = mcuColumns*spec.h*8;
    component.paddedH = mcuRows*spec.v*8;
    component.padded = pad_plane(componentData,dataWidth,dataHeight, ...
        component.paddedW,component.paddedH);
    components(specIndex).name = spec.name;
    components(specIndex).w = dataWidth;
    components(specIndex).h = dataHeight;
    components(specIndex).data = componentData;
    components(specIndex).quant = componentQuant;
    components(specIndex).paddedW = component.paddedW;
    components(specIndex).paddedH = component.paddedH;
    components(specIndex).padded = component.padded;
end

blockCapacity = sum(arrayfun(@(s) s.h*s.v, specs))*mcuColumns*mcuRows;
quantizedAll = zeros(64,blockCapacity,'int16');
blockComponent = zeros(1,blockCapacity);
blockColumn = zeros(1,blockCapacity);
blockRow = zeros(1,blockCapacity);
blockBits = cell(1,blockCapacity);
bitsPerComponent = zeros(1,numel(specs));
previousDC = zeros(1,numel(specs));
blockIndex = 0;
zeroCount = 0;
coefficientCount = 0;

for mcuRow = 1:mcuRows
    for mcuColumn = 1:mcuColumns
        for specIndex = 1:numel(specs)
            spec = specs(specIndex);
            component = components(specIndex);
            for vertical = 1:spec.v
                for horizontal = 1:spec.h
                    blockColumnInComponent = (mcuColumn-1)*spec.h+horizontal;
                    blockRowInComponent = (mcuRow-1)*spec.v+vertical;
                    rowStart = (blockRowInComponent-1)*8+1;
                    columnStart = (blockColumnInComponent-1)*8+1;
                    spatial = component.padded(rowStart:rowStart+7,columnStart:columnStart+7)-128;
                    coefficients = jpeg_dct_web(spatial,tables.transform);
                    quantizedBlock = round(coefficients./component.quant);
                    scan = quantizedBlock(tables.zigzag);

                    blockIndex = blockIndex+1;
                    quantizedAll(:,blockIndex) = int16(scan(:));
                    blockComponent(blockIndex) = specIndex;
                    blockColumn(blockIndex) = blockColumnInComponent;
                    blockRow(blockIndex) = blockRowInComponent;
                    zeroCount = zeroCount+sum(scan(:)==0);
                    coefficientCount = coefficientCount+64;

                    % DC 差分按分量各自预测，与网页 predictors 一致。
                    difference = scan(1)-previousDC(specIndex);
                    previousDC(specIndex) = scan(1);
                    [category,amplitude] = amplitude_bits(difference);
                    pieces = cell(1,130);
                    pieceCount = 1;
                    pieces{pieceCount} = [tables.dc.codes{category+1},amplitude];
                    zeroRun = 0;
                    for coefficientIndex = 2:64
                        coefficient = scan(coefficientIndex);
                        if coefficient==0
                            zeroRun = zeroRun+1;
                            continue;
                        end
                        while zeroRun>=16
                            pieceCount = pieceCount+1;
                            pieces{pieceCount} = tables.ac.codes{241};
                            zeroRun = zeroRun-16;
                        end
                        [acCategory,acAmplitude] = amplitude_bits(coefficient);
                        symbolValue = 16*zeroRun+acCategory;
                        code = tables.ac.codes{symbolValue+1};
                        assert(~isempty(code),'jpeg:CoefficientRange','AC类别超出基线范围。');
                        pieceCount = pieceCount+1;
                        pieces{pieceCount} = [code,acAmplitude];
                        zeroRun = 0;
                    end
                    if zeroRun>0
                        pieceCount = pieceCount+1;
                        pieces{pieceCount} = tables.ac.codes{1};
                    end
                    blockBits{blockIndex} = [pieces{1:pieceCount}];
                    bitsPerComponent(specIndex) = bitsPerComponent(specIndex)+numel(blockBits{blockIndex});
                end
            end
        end
    end
end

bits = [blockBits{:}];
entropyBitCount = numel(bits);
paddingBits = mod(-entropyBitCount,8);
paddedBits = [bits,repmat('1',1,paddingBits)];
byteMatrix = reshape(double(paddedBits-'0'),8,[])';
entropyBytes = uint8(byteMatrix*(2.^(7:-1:0))');
entropyBytes = entropyBytes(:)';

header = build_header(height,width,specs,quantization,tables);
stuffed = stuff_bytes(entropyBytes);
fileBytes = numel(header)+numel(stuffed)+2;

info.height = height;
info.width = width;
info.quality = quality;
info.subsampling = subsampling;
info.mcuColumns = mcuColumns;
info.mcuRows = mcuRows;
info.entropyBits = entropyBitCount;
info.paddingBits = paddingBits;
info.bitsPerComponent = bitsPerComponent;
info.scanBytes = numel(stuffed);
info.stuffingBytes = sum(entropyBytes==255);
info.headerAndMarkerBytes = numel(header)+2;
info.fileBytes = fileBytes;
info.bpp = 8*fileBytes/(height*width);
info.rawBytes = height*width*3;
info.compressionRatio = info.rawBytes/fileBytes;
info.zeroFraction = zeroCount/coefficientCount;
info.quantization = quantization;
info.quantizationMode = mode;
info.quantized = quantizedAll;
info.blockComponent = blockComponent;
info.blockColumn = blockColumn;
info.blockRow = blockRow;
info.blockBitCounts = cellfun(@numel,blockBits);
info.components = rmfield(components,{'padded'});

if ~isempty(filename)
    fileId = fopen(filename,'wb');
    assert(fileId>=0,'jpeg:FileOpen','无法写入文件：%s',filename);
    closer = onCleanup(@() fclose(fileId));
    written = fwrite(fileId,[header,stuffed,uint8([255 217])],'uint8');
    assert(written==fileBytes,'jpeg:FileWrite','写入JPEG不完整。');
    clear closer;
    listing = dir(filename);
    assert(listing.bytes==fileBytes,'jpeg:FileWrite','落盘字节数与估算不符。');
end
end

function planes = rgb_to_ycbcr(rgb)
%Bt.601 取整规则与网页 Math.round 一致（值域非负，四舍五入相同）。
red = double(rgb(:,:,1));
green = double(rgb(:,:,2));
blue = double(rgb(:,:,3));
planes.y = round(0.299*red+0.587*green+0.114*blue);
planes.cb = round(128-0.168736*red-0.331264*green+0.5*blue);
planes.cr = round(128+0.5*red-0.418688*green-0.081312*blue);
end

function specs = component_specs(subsampling)
%采样因子决定 MCU 网格；网页 componentSpecs() 的同构表。
switch subsampling
    case '420'
        specs = struct('name',{'Y','Cb','Cr'},'h',{2,1,1},'v',{2,1,1});
    case '422'
        specs = struct('name',{'Y','Cb','Cr'},'h',{2,1,1},'v',{1,1,1});
    otherwise
        specs = struct('name',{'Y','Cb','Cr'},'h',{1,1,1},'v',{1,1,1});
end
end

function [output,outputWidth,outputHeight] = downsample_chroma(plane,width,height,mode)
%2×2（4:2:0）或 1×2（4:2:2）取平均；越界时复制边缘样本，不做额外取整。
if strcmp(mode,'444')
    output = plane;
    outputWidth = width;
    outputHeight = height;
    return;
end
vertical = strcmp(mode,'420');
outputWidth = ceil(width/2);
if vertical
    outputHeight = ceil(height/2);
else
    outputHeight = height;
end
output = zeros(outputHeight,outputWidth);
for y = 1:outputHeight
    if vertical
        rowIndex = min(height,(y-1)*2+(1:2));
    else
        rowIndex = min(height,y);
    end
    for x = 1:outputWidth
        columnIndex = min(width,(x-1)*2+(1:2));
        patch = plane(rowIndex,columnIndex);
        output(y,x) = mean(patch(:));
    end
end
end

function padded = pad_plane(plane,width,height,paddedWidth,paddedHeight)
%边缘复制补齐到 MCU 整数倍，与网页 padPlane() 一致。
padded = plane(min(height,1:paddedHeight),min(width,1:paddedWidth));
end

function bytes = build_header(height,width,specs,quantization,tables)
%JFIF 头：APP0 + DQT(两张表) + SOF0(三分量) + DHT(四张表) + SOS。
jfif = uint8([74 70 73 70 0 1 1 0 0 1 0 1 0 0]);
quantPayload = uint8([0,quantization.lum(tables.zigzag), ...
    1,quantization.chrom(tables.zigzag)]);
framePayload = uint8([8,big_endian(height),big_endian(width),numel(specs)]);
for specIndex = 1:numel(specs)
    if specs(specIndex).name=="Y"
        quantId = 0;
    else
        quantId = 1;
    end
    framePayload = [framePayload,uint8([specIndex,16*specs(specIndex).h+specs(specIndex).v,quantId])];
end
huffmanPayload = uint8([0,tables.dcBits,tables.dcValues, ...
    16,tables.acBits,tables.acValues, ...
    1,tables.dcBits,tables.dcValues, ...
    17,tables.acBits,tables.acValues]);
scanPayload = uint8([numel(specs)]);
for specIndex = 1:numel(specs)
    if specs(specIndex).name=="Y"
        tableId = 0;
    else
        tableId = 1;
    end
    scanPayload = [scanPayload,uint8([specIndex,16*tableId+tableId])];
end
scanPayload = [scanPayload,uint8([0 63 0])];
bytes = [uint8([255 216]),segment(224,jfif),segment(219,quantPayload), ...
    segment(192,framePayload),segment(196,huffmanPayload),segment(218,scanPayload)];
end

function bytes = stuff_bytes(entropyBytes)
%熵编码中的 FF 补 00，避免被解码器误认为标记。
stuffed = zeros(1,numel(entropyBytes)+sum(entropyBytes==255),'uint8');
destinations = (1:numel(entropyBytes))+[0,cumsum(entropyBytes(1:end-1)==255)];
stuffed(destinations) = entropyBytes;
bytes = stuffed;
end

function [category,bits] = amplitude_bits(value)
%负数使用 JPEG 幅值映射（不是普通二进制补码）。
if value==0
    category = 0;
    bits = '';
    return;
end
category = floor(log2(abs(value)))+1;
if value<0
    value = value+2^category-1;
end
bits = dec2bin(value,category);
end

function bytes = big_endian(value)
bytes = [floor(double(value)/256),mod(double(value),256)];
end

function bytes = segment(marker,payload)
bytes = [uint8([255,marker,big_endian(numel(payload)+2)]),uint8(payload)];
end
