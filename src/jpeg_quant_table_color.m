function tables = jpeg_quant_table_color(quality,mode)
%JPEG_QUANT_TABLE_COLOR 生成亮度/色度两张量化表（T.81 附录K.1、K.2 + IJG映射）。
%   TABLES = JPEG_QUANT_TABLE_COLOR(QUALITY) 为默认的“频率加权”表，与网页
%   web/jpeg_codec.js 的 QL_BASE/QC_BASE、qualityTable() 完全同源：
%   scale = quality<50 ? floor(5000/quality) : 200-2*quality
%   q = min(255,max(1,floor((base*scale+50)/100)))
%   TABLES.LUM 供 Y 使用，TABLES.CHROM 供 Cb/Cr 使用。
%
%   TABLES = JPEG_QUANT_TABLE_COLOR(QUALITY,'uniform') 为等步长对照：
%   三分量共用同一个标量步长（取亮度基表均值），频率方向不再加权。
%   该模式只用于本项目实验比较，网页不做对应编码，因此只做记录不下发。
if nargin<2 || isempty(mode)
    mode = 'jpeg';
end
validateattributes(quality,{'numeric'},{'scalar','integer','>=',1,'<=',100});
mode = validatestring(mode,{'jpeg','uniform'});
luminance = [16 11 10 16 24 40 51 61;
    12 12 14 19 26 58 60 55;14 13 16 24 40 57 69 56;
    14 17 22 29 51 87 80 62;18 22 37 56 68 109 103 77;
    24 35 55 64 81 104 113 92;49 64 78 87 103 121 120 101;
    72 92 95 98 112 100 103 99];
chrominance = [17 18 24 47 99 99 99 99;
    18 21 26 66 99 99 99 99;24 26 56 99 99 99 99 99;
    47 66 99 99 99 99 99 99;99 99 99 99 99 99 99 99;
    99 99 99 99 99 99 99 99;99 99 99 99 99 99 99 99;
    99 99 99 99 99 99 99 99];
switch mode
    case 'jpeg'
        luminanceBase = luminance;
        chrominanceBase = chrominance;
    case 'uniform'
        step = mean(luminance(:));
        luminanceBase = step*ones(8);
        chrominanceBase = step*ones(8);
end
if quality<50
    scale = floor(5000/double(quality));
else
    scale = 200-2*double(quality);
end
tables.lum = min(255,max(1,floor((luminanceBase*scale+50)/100)));
tables.chrom = min(255,max(1,floor((chrominanceBase*scale+50)/100)));
tables.quality = quality;
tables.mode = mode;
end
