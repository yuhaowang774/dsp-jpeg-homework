function results = run_tests(outputDirectory)
%RUN_TESTS 验证数学基础、边界、真实文件格式及独立解码一致性。
%   测试使用固定种子；imread仅作为外部解码器核验，未用于核心实现。
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
assert(isequal(jpeg_quant_table(50,'jpeg'),tables.luminance));
assert(isequal(jpeg_quant_table(100,'jpeg'),ones(8)));
rng(20261113,'twister');
block = randn(8);
restored = tables.transform'*(tables.transform*block*tables.transform')*tables.transform;
assert(max(abs(block(:)-restored(:)))<1e-12);
expect_error(@() jpeg_quant_table(0,'jpeg'));
expect_error(@() jpeg_quant_table(101,'jpeg'));

% 专门构造非零高频项，覆盖长零游程ZRL及负幅值分支。
coefficients = zeros(8);
coefficients(tables.zigzag(38)) = -300;
sparseBlock = uint8(round(tables.transform'*coefficients*tables.transform+128));
cases = {uint8(128),zeros(8,'uint8'),255*ones(17,19,'uint8'), ...
    uint8(randi([0 255],31,47)),uint8(repmat(0:63,32,1)*4), ...
    uint8(255*mod((1:32)'+(1:40),2)),sparseBlock};
names = ["single_pixel","black","white_odd","random_odd", ...
    "gradient","checkerboard","long_zero_run"];
qualities = [1 50 100];
records = struct([]);
recordIndex = 0;
for caseIndex = 1:numel(cases)
    for quality = qualities
        image = cases{caseIndex};
        filename = fullfile(outputDirectory,sprintf('%s_q%03d.jpg',names(caseIndex),quality));
        encoded = jpeg_encode_gray(image,filename,quality,'jpeg');
        [decoded,details] = jpeg_decode_gray(filename);
        independent = imread(filename);
        assert(isequal(encoded.quantized,details.quantized),'量化系数不能精确往返。');
        assert(isequal(encoded.quantization,details.quantization),'量化表不一致。');
        assert(encoded.entropyBits==details.consumedBits,'熵位数不一致。');
        assert(isequal(size(image),size(decoded)) && isequal(size(image),size(independent)));
        delta = max(abs(double(decoded(:))-double(independent(:))));
        assert(delta<=2,'自编解码与MATLAB解码误差超过2个灰度级。');
        listing = dir(filename);
        assert(listing.bytes==encoded.fileBytes);
        assert(encoded.fileBytes==encoded.headerAndMarkerBytes+ ...
            (encoded.entropyBits+encoded.paddingBits)/8+encoded.stuffingBytes);
        recordIndex = recordIndex+1;
        records(recordIndex).Case = names(caseIndex);
        records(recordIndex).Quality = quality;
        records(recordIndex).FileBytes = encoded.fileBytes;
        records(recordIndex).StuffingBytes = encoded.stuffingBytes;
        records(recordIndex).MaxDecoderDifference = delta;
        records(recordIndex).Passed = true;
    end
end
assert(any([records.StuffingBytes]>0),'测试数据未覆盖FF字节填充。');
% 等步长表也必须能被标准解码器读取，而不是只有默认模式可用。
filename = fullfile(outputDirectory,'uniform.jpg');
encoded = jpeg_encode_gray(cases{4},filename,65,'uniform');
[decoded,details] = jpeg_decode_gray(filename);
assert(isequal(encoded.quantized,details.quantized));
independent = imread(filename);
assert(max(abs(double(decoded(:))-double(independent(:))))<=2);

% 故意截断文件，确认解码器会报错，而不是输出貌似正常的图像。
fileId = fopen(filename,'rb');
bytes = fread(fileId,Inf,'*uint8');
fclose(fileId);
truncatedPath = fullfile(outputDirectory,'truncated.bin');
fileId = fopen(truncatedPath,'wb');
fwrite(fileId,bytes(1:end-2),'uint8');
fclose(fileId);
expect_error(@() jpeg_decode_gray(truncatedPath));
results = struct2table(records);
writetable(results,fullfile(outputDirectory,'test_results.csv'));
fprintf('TESTS PASSED: %d round trips + uniform + malformed input + mathematical checks.\n',height(results));
fprintf('Maximum independent decoder difference: %d gray levels.\n',max(results.MaxDecoderDifference));
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
