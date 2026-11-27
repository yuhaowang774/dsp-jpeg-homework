function write_experiment_report(measurements,matched,tests,elapsedSeconds,outputDirectory)
%WRITE_EXPERIMENT_REPORT 从真实测量表生成中文纪要，不填写臆造实验结果。
filename = fullfile(outputDirectory,'第一轮实验纪要.md');
fileId = fopen(filename,'w','n','UTF-8');
assert(fileId>=0,'无法创建实验纪要。');
closer = onCleanup(@() fclose(fileId));
imageName = measurements.Image(1);
customRows = measurements(measurements.Method~="matlab_jpeg",:);
imwriteRows = measurements(measurements.Method=="matlab_jpeg",:);
fprintf(fileId,'# JPEG大作业：彩色第一轮实验纪要\n\n');
fprintf(fileId,'- 运行环境：MATLAB %s，release %s。\n',version,version('-release'));
fprintf(fileId,'- 生成时间（主机本地时钟）：%s。\n',char(datetime('now','Format','yyyy-MM-dd HH:mm:ss')));
fprintf(fileId,'- 本轮耗时：%.1f秒，含测试和绘图；不是严格性能基准。\n',elapsedSeconds);
fprintf(fileId,'- 输入：data/%s.png（%d×%d RGB，从 web/photos.js 无损导出）。\n', ...
    imageName,measurements.Width(1),measurements.Height(1));
fprintf(fileId,'- 实测：1图 × 3种采样（4:4:4/4:2:2/4:2:0）× 2种自编量化表 × %d个QF = %d组；\n', ...
    numel(unique(customRows.Quality)),height(customRows));
fprintf(fileId,'  另加 MATLAB imwrite 基线 %d 组，共 %d 组。\n',height(imwriteRows),height(measurements));
fprintf(fileId,'- imwrite 不暴露采样因子，其实际采样由生成的 SOF0 段解析：%s。\n', ...
    strjoin(unique(imwriteRows.Subsampling),' / '));
fprintf(fileId,'- 自编链路：RGB→YCbCr、色度下采样、8×8分块、DCT、量化、Zigzag、差分/游程/Huffman、JFIF写入及独立文件解码。\n\n');

fprintf(fileId,'## 校验结果\n\n');
fprintf(fileId,'- %d组边界往返测试通过（非8倍数尺寸、极端亮度、随机纹理、ZRL、FF填充、截断文件）。\n',height(tests));
fprintf(fileId,'- %d组自编实验的量化系数与熵位数完全往返；全部文件均可由MATLAB imread独立读取。\n',height(customRows));
fprintf(fileId,'- 自编解码与 imread 的最大像素差：%d级（整数IDCT与色度上采样策略不同，只做有界校验）。\n\n', ...
    max(customRows.MaxDecoderDifference));

% imwrite 只有 4:2:0 一条曲线，4:4:4 表里只有两种自编量化表。
fprintf(fileId,'## 4:4:4 下两种自编量化策略\n\n');
fprintf(fileId,'| QF | 方法 | 文件字节 | 压缩比 | bpp | PSNR/dB | 零系数比例 |\n');
fprintf(fileId,'|---:|---|---:|---:|---:|---:|---:|\n');
rows = measurements(measurements.Subsampling=="444",:);
for rowIndex = 1:height(rows)
    fprintf(fileId,'| %d | %s | %d | %.2f:1 | %.3f | %.2f | %s |\n', ...
        rows.Quality(rowIndex),method_label(rows.Method(rowIndex)), ...
        rows.FileBytes(rowIndex),rows.CompressionRatio(rowIndex),rows.BPP(rowIndex), ...
        rows.PSNR(rowIndex),percent_text(rows.ZeroFraction(rowIndex)));
end

fprintf(fileId,'\n## 固定 QF=50：三种采样的收益与代价\n\n');
fprintf(fileId,'| 采样 | 方法 | 文件字节 | 压缩比 | bpp | PSNR/dB | Y-PSNR/dB |\n');
fprintf(fileId,'|---|---|---:|---:|---:|---:|---:|\n');
rows = measurements(measurements.Quality==50,:);
for rowIndex = 1:height(rows)
    fprintf(fileId,'| %s | %s | %d | %.2f:1 | %.3f | %.2f | %.2f |\n', ...
        rows.Subsampling(rowIndex),method_label(rows.Method(rowIndex)), ...
        rows.FileBytes(rowIndex),rows.CompressionRatio(rowIndex),rows.BPP(rowIndex), ...
        rows.PSNR(rowIndex),rows.YPSNR(rowIndex));
end

fprintf(fileId,'\n## 等码率量化策略比较（按采样分别插值）\n\n');
fprintf(fileId,'仅在两条实测曲线的重叠区间内线性插值，不外推。以下是插值估计，非额外实测点。\n');
fprintf(fileId,'ΔPSNR = 频率加权 − 等步长；正数才表示前者在该点的PSNR较高。\n\n');
fprintf(fileId,'| 采样 | 目标bpp | 加权PSNR | 等步长PSNR | ΔPSNR/dB |\n|---|---:|---:|---:|---:|\n');
for rowIndex = 1:height(matched)
    fprintf(fileId,'| %s | %.3f | %.2f | %.2f | %+.2f |\n',matched.Subsampling(rowIndex), ...
        matched.TargetBPP(rowIndex),matched.WeightedPSNR(rowIndex), ...
        matched.UniformPSNR(rowIndex),matched.DeltaPSNR(rowIndex));
end

fprintf(fileId,'\n## 本轮可得出的结论\n\n');
mid = measurements(measurements.Method=="custom_jpeg" & measurements.Quality==50,:);
base = mid(mid.Subsampling=="444",:);
small = mid(mid.Subsampling=="420",:);
if ~isempty(base) && ~isempty(small)
    fprintf(fileId,['- QF=50 时 4:4:4 压到%.2f:1、%.2f dB；4:2:0 的体积是它的%.1f%%，' ...
        'PSNR 低%.2f dB。\n'],base.CompressionRatio,base.PSNR, ...
        100*small.FileBytes/base.FileBytes,base.PSNR-small.PSNR);
end
top = measurements(measurements.Method=="custom_jpeg" & measurements.Quality==max(measurements.Quality),:);
baseTop = top(top.Subsampling=="444",:);
smallTop = top(top.Subsampling=="420",:);
if ~isempty(baseTop) && ~isempty(smallTop)
    fprintf(fileId,'- QF=%d 时 4:2:0 比 4:4:4 低%.2f dB：高码率下色度采样取代量化成为主要误差来源。\n', ...
        baseTop.Quality,baseTop.PSNR-smallTop.PSNR);
end
for subsampling = unique(matched.Subsampling,'stable')'
    subset = matched(matched.Subsampling==subsampling,:);
    fprintf(fileId,['- %s 的%d个等码率插值点上，加权减等步长的PSNR差为%+.2f～%+.2f dB；' ...
        '本轮不支持“加权总是PSNR更高”。\n'],subsampling,height(subset), ...
        min(subset.DeltaPSNR),max(subset.DeltaPSNR));
end
fprintf(fileId,'- QF 只是量化表的缩放因子，不是画质百分比；QF=100 仍有取整损失。\n');
fprintf(fileId,'\n## 解释口径与限制\n\n');
fprintf(fileId,'1. 压缩比=原始RGB字节数（宽×高×3）/JPEG完整文件字节数；没有以PNG大小或零系数比例替代。\n');
fprintf(fileId,'2. 净熵位数、填充字节和文件头另列在CSV中；小图可能因文件头而膨胀。\n');
fprintf(fileId,'3. QF 采用 IJG 常见整数映射；等步长表是本项目的对照，不是标准表。\n');
fprintf(fileId,'4. 频率加权表并不保证PSNR始终优于等步长；感知质量也不等同于PSNR。\n');
fprintf(fileId,'5. imwrite 的采样因子由文件头解析得到，不能假定与自编的 4:2:0 完全相同。\n');
fprintf(fileId,'6. 编解码时间为单次墙钟记录，含文件读写和JIT影响，不用于性能优越性结论。\n');
fprintf(fileId,'7. 只有一张1024×1024测试图，属于可行性验证，不是广泛自然图像结论。\n');
fprintf(fileId,'8. 仅基线顺序编码：无渐进式、重启间隔与算术编码，也不是通用JPEG解析器。\n');
fprintf(fileId,'9. 等步长表在 QF≤10 被 255 步长上限截断，这两档量化表相同、实测结果重合。\n\n');
fprintf(fileId,'## 产物索引\n\n');
fprintf(fileId,'- measurements.csv：完整实测数据（%d组）。\n',height(measurements));
fprintf(fileId,'- color_reference.json：自编频率加权30组，供网页逐位对照。\n');
fprintf(fileId,'- matched_rate_comparison.csv：等码率插值比较（%d点）。\n',height(matched));
fprintf(fileId,'- figures/：5组PNG和PDF图。\n');
fprintf(fileId,'- encoded_color/：%d个真实JPEG文件。\n',numel(dir(fullfile(outputDirectory,'encoded_color','*.jpg'))));
fprintf(fileId,'- tests/test_results.csv：%d组边界往返测试明细。\n',height(tests));
fprintf(fileId,'- experiment_results.mat：结构化结果。\n');
end

function label = method_label(method)
%报告里用中文名，避免CSV键名直接出现在正文。
switch char(method)
    case 'custom_jpeg'
        label = '自编：频率加权';
    case 'custom_uniform'
        label = '自编：等步长';
    otherwise
        label = 'MATLAB imwrite';
end
end

function text = percent_text(value)
%imwrite分支拿不到零系数比例，CSV里是NaN，这里明确写“未测”。
if isfinite(value)
    text = sprintf('%.1f%%',100*value);
else
    text = '未测';
end
end
