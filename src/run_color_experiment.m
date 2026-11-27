function [measurements, reference] = run_color_experiment(imagePath, qualities, outputDirectory)
%RUN_COLOR_EXPERIMENT 1024彩色图上的完整实验：3种量化策略 × 3种色度采样 × 10个质量档。
%   MEASUREMENTS = RUN_COLOR_EXPERIMENT() 使用 data/demo_photo_1024_page.png、
%   QF = [5 10 20 35 50 65 80 90 95 100] 与 results 输出目录。输入必须是
%   tools/export_page_photo.py 从 web/photos.js 导出的无损 PNG，否则与网页对不上：
%   data/demo_photo_1024.jpg 的独立解码结果与页面像素平均差 1.54/通道、最大 23。
%
%   实测矩阵：
%     custom_jpeg    自编 T.81 频率加权表，4:4:4/4:2:2/4:2:0 × 10 = 30 组
%     custom_uniform 自编等步长表（三分量共用标量步长），同上 30 组
%     matlab_jpeg    MATLAB imwrite 基线，10 组；imwrite 不暴露采样因子，
%                    实际采样从生成的 SOF0 段解析后写入 Subsampling，不预设结论。
%
%   输出 results/measurements.csv（全部组）与 results/color_reference.json
%   （只含 custom_jpeg 的 30 组，供 web/color_reference.js 与前端逐位对照）。
if nargin<1 || isempty(imagePath)
    projectRoot = fileparts(fileparts(mfilename('fullpath')));
    imagePath = fullfile(projectRoot,'data','demo_photo_1024_page.png');
end
if nargin<2 || isempty(qualities)
    qualities = [5 10 20 35 50 65 80 90 95 100];
end
if nargin<3 || isempty(outputDirectory)
    outputDirectory = fullfile(fileparts(fileparts(mfilename('fullpath'))),'results');
end
if ~isfolder(outputDirectory)
    mkdir(outputDirectory);
end

rgb = imread(imagePath);
assert(isequal(size(rgb,3),3),'jpeg:Input','需要彩色PNG。');
[imageHeight,imageWidth,~] = size(rgb);
sourceSums = verify_page_pixels(imagePath,rgb);
[~,imageName] = fileparts(imagePath);

encodedDirectory = fullfile(outputDirectory,'encoded_color');
if ~isfolder(encodedDirectory)
    mkdir(encodedDirectory);
end

methods = struct( ...
    'key',{'custom_jpeg','custom_uniform','matlab_jpeg'}, ...
    'mode',{'jpeg','uniform',''}, ...
    'label',{'自编：频率加权','自编：等步长','MATLAB imwrite'});
subsamplings = {'444','422','420'};

records = {};
recordIndex = 0;
referenceCases = {};
referenceIndex = 0;
for methodIndex = 1:numel(methods)
    method = methods(methodIndex);
    if strcmp(method.key,'matlab_jpeg')
        for quality = qualities
            filename = fullfile(encodedDirectory,sprintf('%s_%s_q%03d.jpg', ...
                imageName,method.key,quality));
            encodeClock = tic;
            imwrite(rgb,filename,'jpg','Quality',quality);
            encodeSeconds = toc(encodeClock);
            scan = jpeg_read_scan_color(filename);
            subsampling = detect_subsampling(scan);
            decodeClock = tic;
            reconstructed = imread(filename);
            decodeSeconds = toc(decodeClock);
            listing = dir(filename);
            recordIndex = recordIndex+1;
            records{recordIndex} = record_row(imageName,method.key,subsampling, ...
                'parsed from SOF0',quality,imageWidth,imageHeight,rgb,reconstructed,listing.bytes, ...
                NaN,NaN,NaN,NaN,NaN,NaN,encodeSeconds,decodeSeconds); %#ok<AGROW>
            print_row(method.key,subsampling,quality,records{recordIndex});
        end
        continue;
    end
    for subsamplingIndex = 1:numel(subsamplings)
        subsampling = subsamplings{subsamplingIndex};
        for quality = qualities
            filename = fullfile(encodedDirectory,sprintf('%s_%s_%s_q%03d.jpg', ...
                imageName,method.key,subsampling,quality));
            encodeClock = tic;
            info = jpeg_encode_color(rgb,filename,quality,subsampling,method.mode);
            encodeSeconds = toc(encodeClock);
            decodeClock = tic;
            [reconstructed,decodedInfo] = jpeg_decode_color(filename);
            decodeSeconds = toc(decodeClock);
            exact = double(isequal(info.quantized,decodedInfo.quantized));
            assert(exact==1 && info.entropyBits==decodedInfo.consumedBits, ...
                'jpeg:Roundtrip','量化系数或熵位数不能精确往返。');
            independent = imread(filename);
            maxDecoderDifference = max(abs(double(independent(:))-double(reconstructed(:))));
            listing = dir(filename);
            recordIndex = recordIndex+1;
            records{recordIndex} = record_row(imageName,method.key,subsampling, ...
                'declared',quality,imageWidth,imageHeight,rgb,reconstructed,listing.bytes, ...
                info.zeroFraction,info.entropyBits,info.paddingBits,info.stuffingBytes, ...
                info.headerAndMarkerBytes,maxDecoderDifference,encodeSeconds,decodeSeconds); %#ok<AGROW>
            % 上面已断言量化系数逐个相等，这里把结果写进表格，而不是留 NaN。
            records{recordIndex}.ExactCoefficientRoundtrip = exact; %#ok<AGROW>
            if strcmp(method.key,'custom_jpeg')
                referenceIndex = referenceIndex+1;
                referenceCases{referenceIndex} = reference_case(quality,subsampling, ...
                    info,records{recordIndex}); %#ok<AGROW>
            end
            print_row(method.key,subsampling,quality,records{recordIndex});
        end
    end
end

measurements = struct2table([records{:}]);
writetable(measurements,fullfile(outputDirectory,'measurements.csv'));

reference = struct();
reference.version = '1.0';
reference.source = [imageName '.png'];
reference.width = imageWidth;
reference.height = imageHeight;
reference.sourceChannelSums = sourceSums;
reference.generatedBy = version;
reference.generatedAt = char(datetime('now','Format','yyyy-MM-dd HH:mm:ss'));
reference.notes = ['只收自编频率加权表的 30 组：与 web/jpeg_codec.js 逐位一致（熵位数、' ...
    '分量位数、零系数占比、PSNR 相同）；压缩比按 原始RGB字节/完整文件字节 计算；' ...
    'imread 仅作有界交叉验证。等步长与 imwrite 组见 measurements.csv。'];
reference.qualities = qualities;
reference.subsamplings = subsamplings;
reference.cases = [referenceCases{:}];
fileId = fopen(fullfile(outputDirectory,'color_reference.json'),'w','n','UTF-8');
assert(fileId>=0,'jpeg:FileOpen','无法写入 color_reference.json。');
fprintf(fileId,'%s',jsonencode(reference));
fclose(fileId);
fprintf('已写出 measurements.csv（%d 组）与 color_reference.json（%d 组）\n', ...
    size(measurements,1),numel(referenceCases));
end

function record = record_row(imageName,method,subsampling,source,quality, ...
    width,height,original,reconstructed,fileBytes,zeroFraction,entropyBits, ...
    paddingBits,stuffingBytes,headerBytes,maxDecoderDifference,encodeSeconds,decodeSeconds)
%RECORD_ROW 统一口径：压缩比分子为原始RGB字节，分母为完整文件字节。
errorImage = double(original)-double(reconstructed);
squared = sum(errorImage(:).^2);
mse = squared/numel(errorImage);
mae = mean(abs(errorImage(:)));
if mse==0
    psnrValue = Inf;
else
    psnrValue = 10*log10(255^2/mse);
end
planes = page_planes(original);
decodedPlanes = page_planes(reconstructed);
yError = planes.y-decodedPlanes.y;
yMse = mean(yError(:).^2);
if yMse==0
    yPsnr = Inf;
else
    yPsnr = 10*log10(255^2/yMse);
end
record.Image = string(imageName);
record.Method = string(method);
record.Subsampling = string(subsampling);
record.SubsamplingSource = string(source);
record.Quality = quality;
record.Width = width;
record.Height = height;
record.RawBytes = width*height*3;
record.FileBytes = fileBytes;
record.BPP = 8*fileBytes/(width*height);
record.CompressionRatio = width*height*3/fileBytes;
record.MSE = mse;
record.PSNR = psnrValue;
record.MAE = mae;
record.YPSNR = yPsnr;
record.ZeroFraction = zeroFraction;
record.EntropyBits = entropyBits;
record.PaddingBits = paddingBits;
record.StuffingBytes = stuffingBytes;
record.HeaderAndMarkerBytes = headerBytes;
record.ExactCoefficientRoundtrip = NaN;
record.MaxDecoderDifference = maxDecoderDifference;
record.EncodeSeconds = encodeSeconds;
record.DecodeSeconds = decodeSeconds;
end

function entry = reference_case(quality,subsampling,info,record)
%REFERENCE_CASE 与旧版 color_reference.json 字段保持一致，供前端逐位断言。
entry.quality = quality;
entry.subsampling = subsampling;
entry.entropyBits = info.entropyBits;
entry.paddingBits = info.paddingBits;
entry.stuffingBytes = info.stuffingBytes;
entry.headerBytes = info.headerAndMarkerBytes;
entry.fileBytes = record.FileBytes;
entry.zeroFraction = info.zeroFraction;
entry.mse = record.MSE;
entry.psnr = record.PSNR;
entry.yPsnr = record.YPSNR;
entry.compressionRatio = record.CompressionRatio;
entry.bitsPerComponent = info.bitsPerComponent;
end

function name = detect_subsampling(scan)
%从SOF0段读实际采样因子，避免把imwrite的结果当成“声称”的4:2:0。
h = scan.components(1).h;
v = scan.components(1).v;
if h==1 && v==1
    name = '444';
elseif h==2 && v==1
    name = '422';
elseif h==2 && v==2
    name = '420';
else
    error('jpeg:Unsupported','未知的采样因子 %dx%d。',h,v);
end
end

function print_row(method,subsampling,quality,record)
fprintf('%-14s %-3s Q%3d: file=%7.0f psnr=%6.3f zero=%.3f\n', ...
    method,subsampling,quality,record.FileBytes,record.PSNR,record.ZeroFraction);
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
if size(rgb,3)==1
    planes.y = double(rgb);
    return;
end
red = double(rgb(:,:,1));
green = double(rgb(:,:,2));
blue = double(rgb(:,:,3));
planes.y = round(0.299*red+0.587*green+0.114*blue);
end
