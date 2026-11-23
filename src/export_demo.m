function export_demo(outputFile)
%EXPORT_DEMO 导出前端可视化所需的数据与MATLAB参考结果。
%   EXPORT_DEMO() 默认写入 web/demo_data.js；数据包含图像像素、量化表、
%   Zigzag顺序、Huffman表、实测指标，以及用于交叉验证的编码结果。
if nargin<1
    outputFile = '';
end
projectRoot = fileparts(fileparts(mfilename('fullpath')));
if isempty(outputFile)
    outputFile = fullfile(projectRoot,'web','demo_data.js');
end
outputDirectory = fileparts(outputFile);
if ~isfolder(outputDirectory)
    mkdir(outputDirectory);
end
addpath(fullfile(projectRoot,'src'));

tables = jpeg_tables();
demo = struct();
demo.version = '1.0';

% 图像像素按行优先展平后Base64编码，前端可直接还原为Uint8Array。
% 网页样例不含 MATLAB 自带的辣椒照片：该图只留在 MATLAB 实验与测试参考里。
names = ["synthetic_gradient","synthetic_texture","synthetic_text"];
images = struct('name',{},'width',{},'height',{},'pixels',{});
for imageIndex = 1:numel(names)
    image = imread(fullfile(projectRoot,'data',names(imageIndex)+".png"));
    if size(image,3)>1
        image = uint8(round(0.299*double(image(:,:,1))+ ...
            0.587*double(image(:,:,2))+0.114*double(image(:,:,3))));
    end
    rowMajor = uint8(image');
    images(imageIndex).name = char(names(imageIndex));
    images(imageIndex).width = size(image,2);
    images(imageIndex).height = size(image,1);
    images(imageIndex).pixels = char(matlab.net.base64encode(rowMajor(:)));
end
demo.images = images;

% 量化表按行优先展平，前端按Q索引直接取用。
quantJpeg = zeros(100,64);
quantUniform = zeros(100,64);
for quality = 1:100
    table = jpeg_quant_table(quality,'jpeg');
    quantJpeg(quality,:) = reshape(table',1,64);
    table = jpeg_quant_table(quality,'uniform');
    quantUniform(quality,:) = reshape(table',1,64);
end
demo.quantJpeg = quantJpeg;
demo.quantUniform = quantUniform;
demo.qualityLevels = [5 10 20 35 50 65 80 90 95 100];

[rowIndex,columnIndex] = ind2sub([8,8],tables.zigzag);
demo.zigzagRC = [rowIndex(:)-1,columnIndex(:)-1];
demo.dcBits = tables.dcBits;
demo.dcValues = tables.dcValues;
demo.acBits = tables.acBits;
demo.acValues = tables.acValues;

% 实测指标直接来自第一轮实验，保证前端曲线与报告一致。
measurements = readtable(fullfile(projectRoot,'results','measurements.csv'), ...
    'TextType','string');
metrics = struct('image',{},'method',{},'quality',{},'bpp',{},'psnr',{}, ...
    'cr',{},'mse',{},'mae',{},'fileBytes',{},'zeroFraction',{});
for row = 1:height(measurements)
    metrics(row).image = char(measurements.Image(row));
    metrics(row).method = char(measurements.Method(row));
    metrics(row).quality = double(measurements.Quality(row));
    metrics(row).bpp = double(measurements.BPP(row));
    metrics(row).psnr = finite_or_large(measurements.PSNR(row));
    metrics(row).cr = double(measurements.CompressionRatio(row));
    metrics(row).mse = double(measurements.MSE(row));
    metrics(row).mae = double(measurements.MAE(row));
    metrics(row).fileBytes = double(measurements.FileBytes(row));
    metrics(row).zeroFraction = double(measurements.ZeroFraction(row));
end
% 指标表也去掉辣椒照片的行，保持网页数据与网页样例一致。
keepRow = ~strcmp({metrics.image},'peppers_gray');
demo.metrics = metrics(keepRow);

% 参考结果供前端自检：整图熵位数、PSNR与逐块位数应完全一致。
cases = struct('image',{},'quality',{},'mode',{},'entropyBits',{}, ...
    'fileBytes',{},'zeroFraction',{},'psnr',{},'mse',{},'mae',{}, ...
    'blockBitCounts',{});
caseIndex = 0;
for imageIndex = 1:numel(names)
    image = imread(fullfile(projectRoot,'data',names(imageIndex)+".png"));
    if size(image,3)>1
        image = uint8(round(0.299*double(image(:,:,1))+ ...
            0.587*double(image(:,:,2))+0.114*double(image(:,:,3))));
    end
    for quality = [5 50 90]
        for modeIndex = 1:2
            if modeIndex==1
                mode = 'jpeg';
            else
                mode = 'uniform';
            end
            temporary = [tempname,'.jpg'];
            info = jpeg_encode_gray(image,temporary,quality,mode);
            [reconstructed,~] = jpeg_decode_gray(temporary);
            delete(temporary);
            qualityMetrics = image_metrics(image,reconstructed);
            caseIndex = caseIndex+1;
            cases(caseIndex).image = char(names(imageIndex));
            cases(caseIndex).quality = quality;
            cases(caseIndex).mode = mode;
            cases(caseIndex).entropyBits = info.entropyBits;
            cases(caseIndex).fileBytes = info.fileBytes;
            cases(caseIndex).zeroFraction = info.zeroFraction;
            cases(caseIndex).psnr = finite_or_large(qualityMetrics.psnr);
            cases(caseIndex).mse = qualityMetrics.mse;
            cases(caseIndex).mae = qualityMetrics.mae;
            if imageIndex==1 && quality==50 && modeIndex==1
                cases(caseIndex).blockBitCounts = info.blockBitCounts;
            else
                cases(caseIndex).blockBitCounts = [];
            end
        end
    end
end
demo.reference = cases;

jsonText = jsonencode(demo);
fileId = fopen(outputFile,'w','n','UTF-8');
assert(fileId>=0,'demo:FileOpen','无法写入：%s',outputFile);
fprintf(fileId,'window.DEMO_DATA=%s;\n',jsonText);
fclose(fileId);
fprintf('已导出 %s（%.2f MB）\n',outputFile,dir(outputFile).bytes/1024/1024);
end

function value = finite_or_large(value)
%JSON不支持Inf，用一个大数代替，前端只在完全无损时遇到。
if ~isfinite(value)
    value = 999;
end
value = double(value);
end
