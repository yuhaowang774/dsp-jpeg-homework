function info = jpeg_encode_gray(image,filename,quality,mode)
%JPEG_ENCODE_GRAY 手写8位灰度基线JPEG编码器，输出真实JFIF文件。
%   INFO=JPEG_ENCODE_GRAY(IMAGE,FILENAME,QUALITY,MODE)。IMAGE是二维uint8；
%   MODE为jpeg或uniform。核心不调用imwrite；边缘复制补齐，保留原尺寸。
if nargin<4
    mode = 'jpeg';
end
validateattributes(image,{'uint8'},{'2d','nonempty'});
[height,width] = size(image);
assert(height<=65535 && width<=65535,'jpeg:ImageSize','尺寸超过JPEG字段范围。');
tables = jpeg_tables();
quantization = jpeg_quant_table(quality,mode);
blockRows = ceil(height/8);
blockColumns = ceil(width/8);
padded = double(image(min(1:blockRows*8,height),min(1:blockColumns*8,width)))-128;
blockCount = blockRows*blockColumns;
quantized = zeros(64,blockCount,'int16');
blockBits = cell(1,blockCount);
previousDC = 0;
blockIndex = 0;
for rowStart = 1:8:size(padded,1)
    for columnStart = 1:8:size(padded,2)
        blockIndex = blockIndex+1;
        spatial = padded(rowStart:rowStart+7,columnStart:columnStart+7);
        coefficients = tables.transform*spatial*tables.transform';
        quantizedBlock = round(coefficients./quantization);
        scan = quantizedBlock(tables.zigzag);
        quantized(:,blockIndex) = int16(scan(:));

        % DC差分利用块间平均亮度相关性；随后发送类别和幅值位。
        difference = scan(1)-previousDC;
        previousDC = scan(1);
        [category,amplitude] = amplitude_bits(difference);
        pieces = cell(1,130);
        pieceCount = 1;
        pieces{pieceCount} = [tables.dc.codes{category+1},amplitude];

        % AC游程：F0代表16个零；00代表块内剩余系数全部为零。
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
            [category,amplitude] = amplitude_bits(coefficient);
            symbolValue = 16*zeroRun+category;
            code = tables.ac.codes{symbolValue+1};
            assert(~isempty(code),'jpeg:CoefficientRange','AC类别超出基线范围。');
            pieceCount = pieceCount+1;
            pieces{pieceCount} = [code,amplitude];
            zeroRun = 0;
        end
        if zeroRun>0
            pieceCount = pieceCount+1;
            pieces{pieceCount} = tables.ac.codes{1};
        end
        blockBits{blockIndex} = [pieces{1:pieceCount}];
    end
end

% 比特串有利于教学直观性，但不是内存最优的流式编码实现。
bits = [blockBits{:}];
entropyBitCount = numel(bits);
paddingBits = mod(-entropyBitCount,8);
bits = [bits,repmat('1',1,paddingBits)];
byteMatrix = reshape(double(bits-'0'),8,[])';
entropyBytes = uint8(byteMatrix*(2.^(7:-1:0))');
entropyBytes = entropyBytes(:)';

% 熵编码中的FF补00，避免被解码器误认为标记。
stuffed = zeros(1,numel(entropyBytes)+sum(entropyBytes==255),'uint8');
destinations = (1:numel(entropyBytes))+[0,cumsum(entropyBytes(1:end-1)==255)];
stuffed(destinations) = entropyBytes;
jfif = uint8([74 70 73 70 0 1 1 0 0 1 0 1 0 0]);
quantPayload = uint8([0,quantization(tables.zigzag)]);
framePayload = uint8([8,big_endian(height),big_endian(width),1,1,17,0]);
huffmanPayload = uint8([0,tables.dcBits,tables.dcValues, ...
    16,tables.acBits,tables.acValues]);
scanPayload = uint8([1 1 0 0 63 0]);
header = [uint8([255 216]),segment(224,jfif),segment(219,quantPayload), ...
    segment(192,framePayload),segment(196,huffmanPayload),segment(218,scanPayload)];
fileBytes = [header,stuffed,uint8([255 217])];
fileId = fopen(filename,'wb');
assert(fileId>=0,'jpeg:FileOpen','无法写入文件：%s',filename);
closer = onCleanup(@() fclose(fileId));
written = fwrite(fileId,fileBytes,'uint8');
assert(written==numel(fileBytes),'jpeg:FileWrite','写入JPEG不完整。');
clear closer;

% 压缩率以完整文件字节为准；净熵位数单列，不能冒充文件大小。
info.fileBytes = numel(fileBytes);
info.headerAndMarkerBytes = numel(header)+2;
info.entropyBits = entropyBitCount;
info.paddingBits = paddingBits;
info.stuffingBytes = sum(entropyBytes==255);
info.scanBytes = numel(stuffed);
info.bitsPerPixel = 8*info.fileBytes/numel(image);
info.compressionRatio = numel(image)/info.fileBytes;
info.zeroFraction = mean(quantized(:)==0);
info.blockBitCounts = cellfun(@numel,blockBits);
info.quantization = quantization;
info.quantized = quantized;
info.quality = quality;
info.mode = mode;
info.height = height;
info.width = width;
end

function [category,bits] = amplitude_bits(value)
% 负数使用JPEG的幅值映射，不是普通有符号二进制表示。
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
% 多字节整数使用大端序，与主机字节序无关。
bytes = [floor(double(value)/256),mod(double(value),256)];
end

function bytes = segment(marker,payload)
% 段长包含两字节长度字段，不包含FF和标记号。
bytes = [uint8([255,marker,big_endian(numel(payload)+2)]),uint8(payload)];
end
