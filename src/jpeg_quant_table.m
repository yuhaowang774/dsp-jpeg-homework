function quantization = jpeg_quant_table(quality,mode)
%JPEG_QUANT_TABLE 使用常见IJG质量映射构造量化表；不是标准强制映射。
%   quality为1~100整数；100仍不保证无损。uniform为等步长对照。
validateattributes(quality,{'numeric'},{'scalar','integer','>=',1,'<=',100});
mode = validatestring(mode,{'jpeg','uniform'});
tables = jpeg_tables();
base = tables.luminance;
if strcmp(mode,'uniform')
    base = mean(base(:))*ones(8);
end
if quality<50
    scale = floor(5000/double(quality));
else
    scale = 200-2*double(quality);
end
quantization = min(255,max(1,floor((base*scale+50)/100)));
end
