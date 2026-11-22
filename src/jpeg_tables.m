function tables = jpeg_tables()
%JPEG_TABLES 构造DCT矩阵、Zigzag顺序与T.81附录K的亮度示例表。
%   不依赖工具箱；这些示例表不是JPEG唯一允许使用的表。
sample = 0:7;
frequency = (0:7)';
tables.transform = sqrt(2/8)*cos(pi/16*frequency*(2*sample+1));
tables.transform(1,:) = tables.transform(1,:)/sqrt(2);
tables.luminance = [16 11 10 16 24 40 51 61;
    12 12 14 19 26 58 60 55;14 13 16 24 40 57 69 56;
    14 17 22 29 51 87 80 62;18 22 37 56 68 109 103 77;
    24 35 55 64 81 104 113 92;49 64 78 87 103 121 120 101;
    72 92 95 98 112 100 103 99];
% 沿反对角线交替扫描，转换为MATLAB按列存储的线性下标。
tables.zigzag = zeros(1,64);
position = 1;
for diagonal = 0:14
    rowList = max(0,diagonal-7):min(7,diagonal);
    if mod(diagonal,2)==0
        rowList = fliplr(rowList);
    end
    for rowIndex = rowList
        columnIndex = diagonal-rowIndex;
        tables.zigzag(position) = sub2ind([8,8],rowIndex+1,columnIndex+1);
        position = position+1;
    end
end
% 每个码长的符号数，以及规范Huffman码顺序中的符号值。
tables.dcBits = [0 1 5 1 1 1 1 1 1 0 0 0 0 0 0 0];
tables.dcValues = 0:11;
tables.acBits = [0 2 1 3 3 2 4 3 5 5 4 4 0 0 1 125];
acHex = ['01 02 03 00 04 11 05 12 21 31 41 06 13 51 61 07 ' ...
    '22 71 14 32 81 91 A1 08 23 42 B1 C1 15 52 D1 F0 ' ...
    '24 33 62 72 82 09 0A 16 17 18 19 1A 25 26 27 28 ' ...
    '29 2A 34 35 36 37 38 39 3A 43 44 45 46 47 48 49 ' ...
    '4A 53 54 55 56 57 58 59 5A 63 64 65 66 67 68 69 ' ...
    '6A 73 74 75 76 77 78 79 7A 83 84 85 86 87 88 89 ' ...
    '8A 92 93 94 95 96 97 98 99 9A A2 A3 A4 A5 A6 A7 ' ...
    'A8 A9 AA B2 B3 B4 B5 B6 B7 B8 B9 BA C2 C3 C4 C5 ' ...
    'C6 C7 C8 C9 CA D2 D3 D4 D5 D6 D7 D8 D9 DA E1 E2 ' ...
    'E3 E4 E5 E6 E7 E8 E9 EA F1 F2 F3 F4 F5 F6 F7 F8 ' ...
    'F9 FA'];
tables.acValues = hex2dec(split(string(acHex)))';
tables.dc = jpeg_huffman(tables.dcBits,tables.dcValues);
tables.ac = jpeg_huffman(tables.acBits,tables.acValues);
end
