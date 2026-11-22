function scan = jpeg_read_scan(filename)
%JPEG_READ_SCAN 从文件解析单分量8位基线JPEG的表、尺寸与熵码流。
%   支持本项目生成的文件，不声称是通用JPEG解码器：明确拒绝彩色、
%   渐进式、多扫描和重启间隔。APPn/COM允许存在但不参与像素重建。
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
position = 3;
hasFrame = false;
hasScan = false;
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
            % DQT：允许一个段携带多张8位量化表。
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
            assert(~hasFrame && numel(payload)==9 && payload(1)==8 && ...
                payload(6)==1 && payload(8)==17 && payload(9)<=3, ...
                'jpeg:Unsupported','仅支持单分量8位基线JPEG。');
            scan.height = payload(2)*256+payload(3);
            scan.width = payload(4)*256+payload(5);
            assert(scan.height>0 && scan.width>0,'jpeg:BadFile','图像尺寸无效。');
            componentId = payload(7);
            quantId = payload(9)+1;
            hasFrame = true;
        case 196
            % DHT：根据文件携带的表生成解码树，不偷用编码端缓存。
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
            assert(hasFrame && numel(payload)==6 && payload(1)==1 && ...
                payload(2)==componentId && isequal(payload(4:6),[0 63 0]), ...
                'jpeg:Unsupported','仅支持完整基线单扫描。');
            dcId = floor(payload(3)/16)+1;
            acId = mod(payload(3),16)+1;
            assert(dcId<=4 && acId<=4 && ~isempty(quantTables{quantId}) && ...
                ~isempty(dcTables{dcId}) && ~isempty(acTables{acId}), ...
                'jpeg:BadFile','扫描引用了缺失的表。');
            scan.quantization = quantTables{quantId};
            scan.dc = dcTables{dcId};
            scan.ac = acTables{acId};
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

% 去掉FF后的填充00；遇到EOI结束，其余标记明确报错。
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
