function results = run_tests(outputDirectory)
%RUN_TESTS 验证彩色编解码的数学基础、边界尺寸、文件格式与独立解码一致性。
%   测试使用固定种子；imread仅作为外部解码器核验，未用于核心实现。
%   覆盖：非8倍数尺寸、极端亮度、随机纹理、长零游程(ZRL)、FF填充、
%   三种采样格式、等步长表，以及截断文件必须报错。
root = fileparts(fileparts(mfilename('fullpath')));
addpath(fullfile(root,'src'));
if nargin<1
    outputDirectory = fullfile(root,'results','tests');
end
if ~isfolder(outputDirectory)
    mkdir(outputDirectory);
end
tables = jpeg_tables();
assert(norm(tables.transform*tables.transform'-eye(8),'fro')<1e-12);
assert(isequal(sort(tables.zigzag),1:64));
assert(isequal(tables.zigzag(1:10),[1 9 2 3 10 17 25 18 11 4]));
assert(strcmp(tables.dc.codes{1},'00'));
assert(strcmp(tables.ac.codes{1},'1010'));
assert(isequal(jpeg_quant_table_color(50,'jpeg').lum,tables.luminance));
assert(isequal(jpeg_quant_table_color(100,'jpeg').lum,ones(8)));
uniform = jpeg_quant_table_color(50,'uniform');
assert(max(uniform.lum(:))-min(uniform.lum(:))==0,'等步长表必须频率方向一致。');
assert(isequal(uniform.lum,uniform.chrom),'三分量必须共用同一个标量步长。');
rng(20261113,'twister');
block = randn(8);
restored = tables.transform'*(tables.transform*block*tables.transform')*tables.transform;
assert(max(abs(block(:)-restored(:)))<1e-12);
expect_error(@() jpeg_quant_table_color(0,'jpeg'));
expect_error(@() jpeg_quant_table_color(101,'jpeg'));
expect_error(@() jpeg_quant_table_color(50,'unknown'));

% 专门构造非零高频项，覆盖长零游程ZRL及负幅值分支。
coefficients = zeros(8);
coefficients(tables.zigzag(38)) = -300;
sparseBlock = uint8(round(tables.transform'*coefficients*tables.transform+128));
graySparse = repmat(sparseBlock,1,1,3);
cases = {uint8(cat(3,255,0,0)),128*ones(8,8,3,'uint8'), ...
    uint8(randi([0 255],17,19,3)),uint8(randi([0 255],31,47,3)), ...
    repmat(uint8(255*mod((1:32)'+(1:40),2)),1,1,3),uint8(255*ones(33,17,3)), ...
    repmat(uint8(round(255*(0.65*repmat(linspace(0,1,24),24,1)+ ...
    0.35*repmat(linspace(0,1,24)',1,24)))),1,1,3),graySparse};
names = ["single_pixel","flat_gray","random_odd","random_wide", ...
    "checkerboard","white_odd","smooth_gradient","long_zero_run"];
qualities = [1 50 100];
records = {};
recordIndex = 0;
for caseIndex = 1:numel(cases)
    for quality = qualities
        record = roundtrip_case(cases{caseIndex},names(caseIndex),quality,'420', ...
            'jpeg',outputDirectory);
        recordIndex = recordIndex+1;
        records{recordIndex} = record; %#ok<AGROW>
    end
end

% 4:4:4 / 4:2:2 与等步长表也必须能逐位往返，而不是只有默认组合可用。
extras = {{cases{4},'random_wide',65,'444','jpeg'}, ...
    {cases{5},'checkerboard',65,'422','jpeg'}, ...
    {cases{7},'smooth_gradient',65,'444','uniform'}, ...
    {cases{8},'long_zero_run',65,'444','uniform'}};
for extraIndex = 1:numel(extras)
    extra = extras{extraIndex};
    record = roundtrip_case(extra{1},extra{2},extra{3},extra{4},extra{5},outputDirectory);
    recordIndex = recordIndex+1;
    records{recordIndex} = record; %#ok<AGROW>
end
results = struct2table([records{:}]);
assert(any(results.StuffingBytes>0),'测试数据未覆盖FF字节填充。');
assert(any(results.Subsampling=="444") && any(results.Subsampling=="422"), ...
    '采样格式覆盖不全。');

% 故意截断文件，确认解码器会报错，而不是输出貌似正常的图像。
filename = fullfile(outputDirectory,'truncated_source.jpg');
jpeg_encode_color(cases{4},filename,65,'420');
fileId = fopen(filename,'rb');
bytes = fread(fileId,Inf,'*uint8');
fclose(fileId);
truncatedPath = fullfile(outputDirectory,'truncated.bin');
fileId = fopen(truncatedPath,'wb');
fwrite(fileId,bytes(1:end-2),'uint8');
fclose(fileId);
expect_error(@() jpeg_decode_color(truncatedPath));

writetable(results,fullfile(outputDirectory,'test_results.csv'));
fprintf('TESTS PASSED: %d colour round trips + uniform + malformed input + mathematical checks.\n', ...
    height(results));
fprintf('Maximum independent decoder difference: %d levels.\n',max(results.MaxDecoderDifference));
end

function record = roundtrip_case(image,name,quality,subsampling,mode,outputDirectory)
%ROUNDTRIP_CASE 编码→自编解码→imread 独立解码，逐项核对后返回一行记录。
filename = fullfile(outputDirectory,sprintf('%s_%s_q%03d_%s.jpg', ...
    name,mode,quality,subsampling));
encoded = jpeg_encode_color(image,filename,quality,subsampling,mode);
[decoded,details] = jpeg_decode_color(filename);
scan = jpeg_read_scan_color(filename);
assert(isequal(encoded.quantized,details.quantized),'量化系数不能精确往返。');
assert(encoded.entropyBits==details.consumedBits,'熵位数不一致。');
assert(isequal(size(image),size(decoded)),'解码尺寸与原图不一致。');
% 量化表必须真的写进文件并被重新解析出来，而不是只在内存里相等。
assert(isequal(scan.components(1).quantization,encoded.quantization.lum),'亮度量化表未正确写入。');
assert(isequal(scan.components(2).quantization,encoded.quantization.chrom),'色度量化表未正确写入。');
independent = imread(filename);
assert(isequal(size(image),size(independent)),'imread 读回的尺寸不一致。');
delta = max(abs(double(decoded(:))-double(independent(:))));
% libjpeg 的整数IDCT与色度上采样策略与本项目不同，只做有界校验；
% 本轮28组实测最大为3级，留出余量后统一要求不超过8级。
assert(delta<=8,'与独立解码器差异过大：%d。',delta);
listing = dir(filename);
assert(listing.bytes==encoded.fileBytes,'落盘字节数与编码器估算不符。');
assert(encoded.fileBytes==encoded.headerAndMarkerBytes+ ...
    (encoded.entropyBits+encoded.paddingBits)/8+encoded.stuffingBytes, ...
    '文件字节数与头部、熵位、填充之和不一致。');
record.Case = name;
record.Quality = quality;
record.Subsampling = subsampling;
record.Mode = mode;
record.FileBytes = encoded.fileBytes;
record.StuffingBytes = encoded.stuffingBytes;
record.MaxDecoderDifference = delta;
record.Passed = true;
end

function expect_error(action)
% 负面测试必须确实抛出异常，避免误把无执行当成功。
failed = false;
try
    action();
catch
    failed = true;
end
assert(failed,'预期错误未发生。');
end
