function measurements = run_experiments(dataset,qualities,outputDirectory)
%RUN_EXPERIMENTS 比较频率加权量化、等步长量化和MATLAB内置JPEG。
%   所有主指标使用完整文件大小，灰度输入基准为每像素1字节。
%   imwrite只出现在明确标注的基线分支，不用于自编JPEG生成。
encodedDirectory = fullfile(outputDirectory,'encoded');
if ~isfolder(encodedDirectory)
    mkdir(encodedDirectory);
end
methods = ["custom_jpeg","custom_uniform","matlab_jpeg"];
records = struct([]);
recordIndex = 0;
for imageIndex = 1:numel(dataset)
    original = dataset(imageIndex).image;
    imageName = dataset(imageIndex).name;
    for method = methods
        for quality = qualities
            filename = fullfile(encodedDirectory,sprintf('%s_%s_q%03d.jpg',imageName,method,quality));
            encodeClock = tic;
            if method=="matlab_jpeg"
                % 内置基线用于独立参考，不把其内部实现说成自己的算法。
                imwrite(original,filename,'jpg','Quality',quality);
                encodeSeconds = toc(encodeClock);
                decodeClock = tic;
                reconstructed = imread(filename);
                decodeSeconds = toc(decodeClock);
                encoded.zeroFraction = NaN;
                encoded.entropyBits = NaN;
                encoded.headerAndMarkerBytes = NaN;
                encoded.stuffingBytes = NaN;
                decoderDifference = NaN;
                exactCoefficients = NaN;
            else
                if method=="custom_jpeg"
                    mode = 'jpeg';
                else
                    mode = 'uniform';
                end
                encoded = jpeg_encode_gray(original,filename,quality,mode);
                encodeSeconds = toc(encodeClock);
                decodeClock = tic;
                [reconstructed,decoded] = jpeg_decode_gray(filename);
                decodeSeconds = toc(decodeClock);
                exactCoefficients = double(isequal(encoded.quantized,decoded.quantized));
                assert(exactCoefficients==1 && encoded.entropyBits==decoded.consumedBits);
                independent = imread(filename);
                decoderDifference = max(abs(double(independent(:))-double(reconstructed(:))));
                assert(decoderDifference<=2,'自编与独立解码不一致。');
            end
            listing = dir(filename);
            metrics = image_metrics(original,reconstructed);
            recordIndex = recordIndex+1;
            records(recordIndex).Image = imageName;
            records(recordIndex).Method = method;
            records(recordIndex).Quality = quality;
            records(recordIndex).Width = size(original,2);
            records(recordIndex).Height = size(original,1);
            records(recordIndex).RawBytes = numel(original);
            records(recordIndex).FileBytes = listing.bytes;
            records(recordIndex).BPP = listing.bytes*8/numel(original);
            records(recordIndex).CompressionRatio = numel(original)/listing.bytes;
            records(recordIndex).MSE = metrics.mse;
            records(recordIndex).PSNR = metrics.psnr;
            records(recordIndex).MAE = metrics.mae;
            records(recordIndex).ZeroFraction = encoded.zeroFraction;
            records(recordIndex).EntropyBits = encoded.entropyBits;
            records(recordIndex).HeaderAndMarkerBytes = encoded.headerAndMarkerBytes;
            records(recordIndex).StuffingBytes = encoded.stuffingBytes;
            records(recordIndex).ExactCoefficientRoundtrip = exactCoefficients;
            records(recordIndex).MaxDecoderDifference = decoderDifference;
            records(recordIndex).EncodeSeconds = encodeSeconds;
            records(recordIndex).DecodeSeconds = decodeSeconds;
        end
        fprintf('Finished %-20s %-15s (%d quality levels).\n',imageName,method,numel(qualities));
        % 分阶段落盘，长实验中断时已有结果仍可审计。
        measurements = struct2table(records);
        writetable(measurements,fullfile(outputDirectory,'measurements.csv'));
    end
end
end
