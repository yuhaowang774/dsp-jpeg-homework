function table = jpeg_huffman(counts,values)
%JPEG_HUFFMAN 由码长计数生成规范码查找表及逐位解码二叉树。
counts = double(counts(:)');
values = double(values(:)');
assert(numel(counts)==16 && sum(counts)==numel(values), ...
    'jpeg:BadHuffman','码长计数与符号数量不符。');
assert(all(values>=0 & values<=255) && numel(unique(values))==numel(values), ...
    'jpeg:BadHuffman','符号无效或重复。');
table.codes = cell(1,256);
table.children = zeros(1+16*numel(values),2);
table.symbol = -ones(1+16*numel(values),1);
codeValue = 0;
valueIndex = 1;
nodeCount = 1;
for codeLength = 1:16
    for entryIndex = 1:counts(codeLength)
        assert(codeValue<2^codeLength,'jpeg:BadHuffman','码表超额分配。');
        bitText = dec2bin(codeValue,codeLength);
        symbolValue = values(valueIndex);
        table.codes{symbolValue+1} = bitText;
        node = 1;
        for bitIndex = 1:codeLength
            branch = double(bitText(bitIndex)=='1')+1;
            assert(table.symbol(node)<0,'jpeg:BadHuffman','前缀冲突。');
            if table.children(node,branch)==0
                nodeCount = nodeCount+1;
                table.children(node,branch) = nodeCount;
            end
            node = table.children(node,branch);
        end
        assert(all(table.children(node,:)==0) && table.symbol(node)<0, ...
            'jpeg:BadHuffman','重复码或前缀冲突。');
        table.symbol(node) = symbolValue;
        codeValue = codeValue+1;
        valueIndex = valueIndex+1;
    end
    codeValue = codeValue*2;
end
table.children = table.children(1:nodeCount,:);
table.symbol = table.symbol(1:nodeCount);
end
