function [image,info] = jpeg_decode_gray(filename)
%JPEG_DECODE_GRAY 自行熵解码、反量化和IDCT，不调用imread重建。
%   输入是实际JPEG文件；INFO.quantized可用于验证编码解码完全互逆。
scan = jpeg_read_scan(filename);
tables = jpeg_tables();
bitText = dec2bin(scan.entropy,8);
bits = reshape(bitText',1,[])=='1';
bitPosition = 1;
blockRows = ceil(scan.height/8);
blockColumns = ceil(scan.width/8);
reconstructed = zeros(blockRows*8,blockColumns*8);
quantized = zeros(64,blockRows*blockColumns,'int16');
previousDC = 0;
blockIndex = 0;
for rowStart = 1:8:blockRows*8
    for columnStart = 1:8:blockColumns*8
        blockIndex = blockIndex+1;
        coefficients = zeros(1,64);
        category = read_symbol(scan.dc);
        assert(category<=11,'jpeg:BadFile','DC类别超过基线范围。');
        previousDC = previousDC+read_amplitude(category);
        coefficients(1) = previousDC;
        coefficientIndex = 2;
        while coefficientIndex<=64
            symbol = read_symbol(scan.ac);
            if symbol==0
                break;
            elseif symbol==240
                coefficientIndex = coefficientIndex+16;
                assert(coefficientIndex<=65,'jpeg:BadFile','ZRL跨越块边界。');
                continue;
            end
            zeroRun = floor(symbol/16);
            category = mod(symbol,16);
            coefficientIndex = coefficientIndex+zeroRun;
            assert(category>=1 && category<=10 && coefficientIndex<=64, ...
                'jpeg:BadFile','AC类别或游程无效。');
            coefficients(coefficientIndex) = read_amplitude(category);
            coefficientIndex = coefficientIndex+1;
        end
        quantized(:,blockIndex) = int16(coefficients(:));
        block = zeros(8);
        block(tables.zigzag) = coefficients;
        reconstructed(rowStart:rowStart+7,columnStart:columnStart+7) = ...
            tables.transform'*(block.*scan.quantization)*tables.transform+128;
    end
end
% 基线熵编码在字节边界前用1补齐；防止悄悄接受多余负载。
remaining = bits(bitPosition:end);
assert(numel(remaining)<=7 && all(remaining),'jpeg:BadFile','尾部填充位无效。');
image = uint8(min(255,max(0,round(reconstructed(1:scan.height,1:scan.width)))));
info.quantized = quantized;
info.quantization = scan.quantization;
info.consumedBits = bitPosition-1;
info.fileBytes = scan.fileBytes;

    function symbol = read_symbol(decoder)
        % 每读一位沿树下降，直到找到叶节点；最多16位。
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
        % 读取幅值位，低于2^(类别-1)的编码映射回负数。
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
