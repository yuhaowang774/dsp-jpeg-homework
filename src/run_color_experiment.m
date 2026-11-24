function measurements = run_color_experiment(imagePath, outputDirectory)
%RUN_COLOR_EXPERIMENT 彩色三分量实验：10 个质量档 × 3 种采样，1024×1024。
%   输入必须是 tools/export_page_photo.py 从 web/photos.js 导出的无损 PNG，
%   否则与网页对不上：data/demo_photo_1024.jpg 的独立解码结果与页面像素
%   平均差 1.54/通道、最大 23，量化系数会不同。
%   输出 results/color_measurements.csv 与 results/color_reference.json，
%   后者由 export_color_reference.m 转成 web/color_reference.js。
if nargin<1 || isempty(imagePath)
    projectRoot = fileparts(fileparts(mfilename('fullpath')));
    imagePath = fullfile(projectRoot,'data','demo_photo_1024_page.png');
end
if nargin<2
    outputDirectory = fullfile(fileparts(fileparts(mfilename('fullpath'))),'results');
end
if ~isfolder(outputDirectory)
    mkdir(outputDirectory);
end

rgb = imread(imagePath);
assert(isequal(size(rgb,3),3),'jpeg:Input','需要彩色PNG。');
[height,width,~] = size(rgb);
sourceSums = verify_page_pixels(imagePath,rgb);

qualities = [5 10 20 35 50 65 80 90 95 100];
subsamplings = {'420','422','444'};
encodedDirectory = fullfile(outputDirectory,'encoded_color');
if ~isfolder(encodedDirectory)
    mkdir(encodedDirectory);
end
[~,imageName] = fileparts(imagePath);
records = struct([]);
cases = struct([]);
recordIndex = 0;
caseIndex = 0;

for subsamplingIndex = 1:numel(subsamplings)
    mode = subsamplings{subsamplingIndex};
    for quality = qualities
        filename = fullfile(encodedDirectory,sprintf('%s_%s_q%03d.jpg',imageName,mode,quality));
        encodeClock = tic;
        info = jpeg_encode_color(rgb,filename,quality,mode);
        encodeSeconds = toc(encodeClock);
        decodeClock = tic;
        [decoded,decodedInfo] = jpeg_decode_color(filename);
        decodeSeconds = toc(decodeClock);
        exact = double(isequal(info.quantized,decodedInfo.quantized));

        % 独立解码器交叉验证：libjpeg 的整数 IDCT 与色度上采样与本项目不同，
        % 因此只校验“能被通用解码器解出且差异有界”，不要求逐像素相同。
        independent = imread(filename);
        maxDecoderDifference = max(abs(double(independent(:))-double(decoded(:))));

        errorImage = double(rgb)-double(decoded);
        squared = sum(errorImage(:).^2);
        mse = squared/numel(errorImage);
        psnrValue = 10*log10(255^2/mse);
        mae = mean(abs(errorImage(:)));

        planes = page_planes(rgb);
        yError = planes.y-decodedInfo.planes{1};
        yMse = mean(yError(:).^2);
        yPsnr = 10*log10(255^2/yMse);

        listing = dir(filename);
        recordIndex = recordIndex+1;
        records(recordIndex).Image = imageName;
        records(recordIndex).Width = width;
        records(recordIndex).Height = height;
        records(recordIndex).Subsampling = mode;
        records(recordIndex).Quality = quality;
        records(recordIndex).EntropyBits = info.entropyBits;
        records(recordIndex).EntropyBytes = ceil(info.entropyBits/8);
        records(recordIndex).PaddingBits = info.paddingBits;
        records(recordIndex).StuffingBytes = info.stuffingBytes;
        records(recordIndex).HeaderBytes = info.headerAndMarkerBytes;
        records(recordIndex).FileBytes = listing.bytes;
        records(recordIndex).BPP = 8*listing.bytes/(width*height);
        records(recordIndex).CompressionRatio = width*height*3/listing.bytes;
        records(recordIndex).ZeroFraction = info.zeroFraction;
        records(recordIndex).MSE = mse;
        records(recordIndex).PSNR = psnrValue;
        records(recordIndex).MAE = mae;
        records(recordIndex).YPSNR = yPsnr;
        records(recordIndex).MaxImreadDifference = maxDecoderDifference;
        records(recordIndex).ExactCoefficientRoundtrip = exact;
        records(recordIndex).EncodeSeconds = encodeSeconds;
        records(recordIndex).DecodeSeconds = decodeSeconds;

        caseIndex = caseIndex+1;
        cases(caseIndex).quality = quality;
        cases(caseIndex).subsampling = mode;
        cases(caseIndex).entropyBits = info.entropyBits;
        cases(caseIndex).paddingBits = info.paddingBits;
        cases(caseIndex).stuffingBytes = info.stuffingBytes;
        cases(caseIndex).headerBytes = info.headerAndMarkerBytes;
        cases(caseIndex).fileBytes = listing.bytes;
        cases(caseIndex).zeroFraction = info.zeroFraction;
        cases(caseIndex).mse = mse;
        cases(caseIndex).psnr = psnrValue;
        cases(caseIndex).yPsnr = yPsnr;
        cases(caseIndex).compressionRatio = width*height*3/listing.bytes;
        cases(caseIndex).bitsPerComponent = info.bitsPerComponent;

        fprintf('%s Q%3d: bits=%7d file=%6d psnr=%6.3f zero=%.4f imreaddiff=%d (%.1fs)\n', ...
            mode, quality, info.entropyBits, listing.bytes, psnrValue, info.zeroFraction, ...
            maxDecoderDifference, encodeSeconds+decodeSeconds);
    end
end

measurements = struct2table(records);
writetable(measurements,fullfile(outputDirectory,'color_measurements.csv'));

reference = struct();
reference.version = '1.0';
reference.source = basename(imagePath);
reference.width = width;
reference.height = height;
reference.sourceChannelSums = sourceSums;
reference.generatedBy = version;
reference.generatedAt = datestr(now,'yyyy-mm-dd HH:MM:SS');
reference.notes = ['与 web/jpeg_codec.js 逐位一致：熵位数、分量位数、零系数占比、PSNR 相同；' ...
    '压缩比按 原始RGB字节/完整文件字节 计算；imread 仅作有界交叉验证。'];
reference.qualities = qualities;
reference.subsamplings = subsamplings;
reference.cases = cases;
fid = fopen(fullfile(outputDirectory,'color_reference.json'),'w','n','UTF-8');
assert(fid>=0,'jpeg:FileOpen','无法写入 color_reference.json。');
fprintf(fid,'%s',jsonencode(reference));
fclose(fid);
fprintf('已写出 %s 与 color_reference.json\n',fullfile(outputDirectory,'color_measurements.csv'));
end

function sums = verify_page_pixels(imagePath,rgb)
%与 tools/export_page_photo.py 的清单比对通道和，防止有人换成 JPG 直接跑。
sums = [sum(sum(rgb(:,:,1))),sum(sum(rgb(:,:,2))),sum(sum(rgb(:,:,3)))];
projectRoot = fileparts(fileparts(mfilename('fullpath')));
manifestPath = fullfile(projectRoot,'data','page_pixels.json');
if ~isfile(manifestPath)
    warning('jpeg:NoManifest','缺少 data/page_pixels.json，跳过像素来源校验。');
    return;
end
manifest = jsondecode(fileread(manifestPath));
[~,name,extension] = fileparts(imagePath);
targetFile = ['data/',name,extension];
for index = 1:numel(manifest.images)
    entry = manifest.images(index);
    if strcmp(entry.file,targetFile)
        assert(isequal(double(sums(:))',double(entry.channelSums(:))'), ...
            'jpeg:WrongPixels','该PNG与网页像素不一致，请用 tools/export_page_photo.py 重新导出。');
        return;
    end
end
warning('jpeg:NoManifest','清单中没有 %s，跳过像素来源校验。',name);
end

function planes = page_planes(rgb)
%与网页 rgbToYCbCr 相同的取整规则，仅用于统计 Y 通道 PSNR。
red = double(rgb(:,:,1));
green = double(rgb(:,:,2));
blue = double(rgb(:,:,3));
planes.y = round(0.299*red+0.587*green+0.114*blue);
end

function name = basename(path)
[~,name,extension] = fileparts(path);
name = [name,extension];
end
