function scan = jpeg_read_scan_color(filename)
%JPEG_READ_SCAN_COLOR 解析本项目生成的三分量8位基线JPEG（单扫描、无重启）。
%   返回各分量的采样因子、量化表与 Huffman 表，以及去填充后的熵码流。
%   不声称是通用JPEG解码器：遇到渐进式、多扫描、重启间隔或其他标记直接报错。
fileId = fopen(filename,'rb');
assert(fileId>=0,'jpeg:FileOpen','无法读取：%s',filename);
closer = onCleanup(@() fclose(fileId));
bytes = fread(fileId,Inf,'*uint8')';
clear closer;
assert(numel(bytes)>=4 && isequal(bytes(1:2),uint8([255 216])), ...
    'jpeg:BadFile','缺少JPEG起始标记。');
tables = jpeg_tables();
quantTables = cell(1,4);
dcTables = cell(1,4);
acTables = cell(1,4);
components = struct('id',{},'h',{},'v',{},'quantId',{},'dcId',{},'acId',{});
position = 3;
hasFrame = false;
hasScan = false;
scanPayload = [];
while position<=numel(bytes)
    assert(bytes(position)==255,'jpeg:BadFile','标记前缀错误。');
    while position<=numel(bytes) && bytes(position)==255
        position = position+1;
    end
    assert(position<=numel(bytes),'jpeg:Truncated','标记被截断。');
    marker = double(bytes(position));
    position = position+1;
    assert(position+1<=numel(bytes),'jpeg:Truncated','缺少段长。');
    lengthValue = 256*double(bytes(position))+double(bytes(position+1));
    assert(lengthValue>=2 && position+lengthValue-1<=numel(bytes), ...
        'jpeg:Truncated','段内容不完整。');
    payload = double(bytes(position+2:position+lengthValue-1));
    position = position+lengthValue;
    switch marker
        case 219
            % DQT：一个段可携带多张8位量化表。
            cursor = 1;
            while cursor<=numel(payload)
                tableId = mod(payload(cursor),16);
                assert(payload(cursor)<16 && tableId<=3 && cursor+64<=numel(payload), ...
                    'jpeg:Unsupported','仅支持8位量化表，或DQT不完整。');
                quantization = zeros(8);
                quantization(tables.zigzag) = payload(cursor+1:cursor+64);
                assert(all(quantization(:)>0),'jpeg:BadFile','量化步长不能为零。');
                quantTables{tableId+1} = quantization;
                cursor = cursor+65;
            end
        case 192
            % SOF0：精度、尺寸、分量采样因子与量化表选择。
            assert(~hasFrame && numel(payload)>=6 && payload(1)==8, ...
                'jpeg:Unsupported','仅支持8位基线JPEG帧头。');
            scan.height = payload(2)*256+payload(3);
            scan.width = payload(4)*256+payload(5);
            componentCount = payload(6);
            assert(scan.height>0 && scan.width>0,'jpeg:BadFile','图像尺寸无效。');
            assert(componentCount==3 && numel(payload)==6+3*componentCount, ...
                'jpeg:Unsupported','仅支持三分量4:4:4/4:2:2/4:2:0。');
            for index = 1:componentCount
                base = 6+3*(index-1);
                components(index).id = payload(base+1);
                components(index).h = floor(payload(base+2)/16);
                components(index).v = mod(payload(base+2),16);
                components(index).quantId = payload(base+3);
                assert(components(index).h>=1 && components(index).v>=1 && ...
                    components(index).quantId<=3,'jpeg:BadFile','分量采样因子或量化表编号无效。');
            end
            hasFrame = true;
        case 196
            % DHT：用文件携带的表重建解码树。
            cursor = 1;
            while cursor<=numel(payload)
                assert(cursor+16<=numel(payload),'jpeg:Truncated','DHT缺少码长表。');
                tableClass = floor(payload(cursor)/16);
                tableId = mod(payload(cursor),16);
                counts = payload(cursor+1:cursor+16);
                symbolCount = sum(counts);
                assert(tableClass<=1 && tableId<=3 && cursor+16+symbolCount<=numel(payload), ...
                    'jpeg:BadFile','DHT表类别、编号或长度错误。');
                values = payload(cursor+17:cursor+16+symbolCount);
                decoder = jpeg_huffman(counts,values);
                if tableClass==0
                    dcTables{tableId+1} = decoder;
                else
                    acTables{tableId+1} = decoder;
                end
                cursor = cursor+17+symbolCount;
            end
        case 218
            assert(hasFrame && numel(payload)>=4,'jpeg:Unsupported','扫描头不完整。');
            scanPayload = payload;
            hasScan = true;
        otherwise
            assert((marker>=224 && marker<=239) || marker==254, ...
                'jpeg:Unsupported','暂不支持标记0x%02X。',marker);
    end
    if hasScan
        break;
    end
end
assert(hasScan,'jpeg:BadFile','未找到图像扫描。');

scanComponentCount = scanPayload(1);
assert(scanComponentCount==numel(components),'jpeg:Unsupported','扫描分量数与帧头不一致。');
assert(isequal(scanPayload(end-2:end),[0 63 0]),'jpeg:Unsupported','仅支持完整基线单扫描。');
for index = 1:scanComponentCount
    base = 1+2*(index-1);
    selector = scanPayload(base+1);
    tablePair = scanPayload(base+2);
    match = find([components.id]==selector,1);
    assert(~isempty(match),'jpeg:BadFile','扫描引用了未定义的分量。');
    components(match).dcId = floor(tablePair/16);
    components(match).acId = mod(tablePair,16);
    dcId = components(match).dcId+1;
    acId = components(match).acId+1;
    quantId = components(match).quantId+1;
    assert(~isempty(quantTables{quantId}) && ~isempty(dcTables{dcId}) && ...
        ~isempty(acTables{acId}),'jpeg:BadFile','扫描引用了缺失的表。');
end
for index = 1:numel(components)
    components(index).quantization = quantTables{components(index).quantId+1};
    components(index).dc = dcTables{components(index).dcId+1};
    components(index).ac = acTables{components(index).acId+1};
end
scan.components = components;

% 去掉 FF 后的填充 00；遇到 EOI 结束，其余标记明确报错。
entropy = zeros(1,numel(bytes)-position+1,'uint8');
count = 0;
foundEnd = false;
while position<=numel(bytes)
    value = bytes(position);
    position = position+1;
    if value==255
        assert(position<=numel(bytes),'jpeg:Truncated','FF字节后文件截断。');
        following = bytes(position);
        position = position+1;
        if following==217
            foundEnd = true;
            break;
        end
        assert(following==0,'jpeg:Unsupported','不支持扫描内重启或其他标记。');
    end
    count = count+1;
    entropy(count) = value;
end
assert(foundEnd,'jpeg:Truncated','缺少EOI结束标记。');
scan.entropy = entropy(1:count);
scan.fileBytes = numel(bytes);
end
