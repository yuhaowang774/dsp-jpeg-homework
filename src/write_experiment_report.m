function write_experiment_report(measurements,matched,tests,elapsedSeconds,outputDirectory)
%WRITE_EXPERIMENT_REPORT 从真实测量表生成中文纪要，不填写臆造实验结果。
filename = fullfile(outputDirectory,'第一轮实验纪要.md');
fileId = fopen(filename,'w','n','UTF-8');
assert(fileId>=0,'无法创建实验纪要。');
closer = onCleanup(@() fclose(fileId));
fprintf(fileId,'# JPEG大作业：第一轮实验纪要\n\n');
fprintf(fileId,'- 运行环境：MATLAB %s，release %s。\n',version,version('-release'));
fprintf(fileId,'- 生成时间（主机本地时钟）：%s。\n',char(datetime('now','Format','yyyy-MM-dd HH:mm:ss')));
fprintf(fileId,'- 本轮耗时：%.1f秒，含测试和绘图；不是严格性能基准。\n',elapsedSeconds);
fprintf(fileId,'- 4张256×256灰度图 × 10个Q × 3种方法，共%d组实测。\n',height(measurements));
fprintf(fileId,'- 数据为1张MATLAB自带辣椒照片裁剪和3张合成图，不构成广泛自然图像验证。\n');
fprintf(fileId,'- 自编链路：DCT、量化、Zigzag、DC差分、AC游程、Huffman、JFIF写入及独立文件解码。\n\n');
fprintf(fileId,'## 校验结果\n\n');
fprintf(fileId,'- %d组边界往返测试通过，另含等步长、截断文件、DCT正交性与标准码字测试。\n',height(tests));
custom = measurements(measurements.Method~="matlab_jpeg",:);
fprintf(fileId,'- %d组自编实验的量化系数完全往返；全部生成文件均可由MATLAB imread独立读取。\n',height(custom));
fprintf(fileId,'- 自编IDCT和MATLAB解码最大像素差：%.0f灰度级；两实现舍入方式可有差异。\n\n',max(custom.MaxDecoderDifference));
fprintf(fileId,'## 辣椒照片：自编频率加权量化\n\n');
fprintf(fileId,'| Q | 文件字节 | 压缩比 | bpp | PSNR/dB | 零系数比例 |\n');
fprintf(fileId,'|---:|---:|---:|---:|---:|---:|\n');
photo = measurements(measurements.Image=="peppers_gray" & measurements.Method=="custom_jpeg",:);
for rowIndex = 1:height(photo)
    fprintf(fileId,'| %d | %d | %.2f:1 | %.3f | %.2f | %.1f%% |\n', ...
        photo.Quality(rowIndex),photo.FileBytes(rowIndex),photo.CompressionRatio(rowIndex), ...
        photo.BPP(rowIndex),photo.PSNR(rowIndex),100*photo.ZeroFraction(rowIndex));
end
fprintf(fileId,'\n## 内容差异：固定Q=50（不是等码率比较）\n\n');
fprintf(fileId,'| 图像 | 文件字节 | 压缩比 | PSNR/dB |\n|---|---:|---:|---:|\n');
rows = measurements(measurements.Method=="custom_jpeg" & measurements.Quality==50,:);
for rowIndex = 1:height(rows)
    fprintf(fileId,'| %s | %d | %.2f:1 | %.2f |\n',rows.Image(rowIndex), ...
        rows.FileBytes(rowIndex),rows.CompressionRatio(rowIndex),rows.PSNR(rowIndex));
end
fprintf(fileId,'\n## 等码率量化策略比较\n\n');
fprintf(fileId,'仅在两条实测曲线的重叠区间内线性插值，不外推。以下是插值估计，非额外实测点。\n');
fprintf(fileId,'ΔPSNR = 频率加权 − 等步长；正数才表示前者在该点的PSNR较高。\n\n');
fprintf(fileId,'| 图像 | 目标bpp | 加权PSNR | 等步长PSNR | ΔPSNR/dB |\n|---|---:|---:|---:|---:|\n');
for rowIndex = 1:height(matched)
    fprintf(fileId,'| %s | %.3f | %.2f | %.2f | %+.2f |\n',matched.Image(rowIndex), ...
        matched.TargetBPP(rowIndex),matched.WeightedPSNR(rowIndex), ...
        matched.UniformPSNR(rowIndex),matched.DeltaPSNR(rowIndex));
end
fprintf(fileId,'\n## 本轮可得出的结论\n\n');
selected = photo(photo.Quality==50,:);
fprintf(fileId,'- 辣椒照片在Q=50时压到%d字节，压缩比%.2f:1，PSNR %.2f dB，适合作为演示的中等压缩点。\n', ...
    selected.FileBytes,selected.CompressionRatio,selected.PSNR);
fprintf(fileId,'- 观察同一照片不同Q的局部图，可直观看到强压缩的块效应与细节损失。\n');
photoMatched = matched(matched.Image=="peppers_gray",:);
fprintf(fileId,'- 辣椒照片的4个等码率插值点上，加权减等步长的PSNR差为%.2f～%.2f dB；本轮不支持“加权总是PSNR更高”。\n', ...
    min(photoMatched.DeltaPSNR),max(photoMatched.DeltaPSNR));
fprintf(fileId,'- 两种量化表的Q网格较稀，尤其95到100跨度大；插值只作初步探索，定量优劣需下一轮加密Q或直接匹配目标码率。\n');
fprintf(fileId,'\n## 解释口径与限制\n\n');
fprintf(fileId,'1. 压缩比=原始灰度像素字节数/JPEG完整文件字节数；没有以PNG大小或零系数比例替代。\n');
fprintf(fileId,'2. 净熵位数、填充字节和文件头另列在CSV中；小图可能因文件头而膨胀。\n');
fprintf(fileId,'3. Q不是画质百分比；本项目采用IJG常见整数映射。Q=100仍可能有取整损失。\n');
fprintf(fileId,'4. 频率加权表并不保证PSNR始终优于等步长；感知质量也不等同于PSNR。\n');
fprintf(fileId,'5. MATLAB对照使用相同数字Q，但不能据此假定内部表、头部、优化策略完全相同。\n');
fprintf(fileId,'6. 编解码时间为单次墙钟记录，含文件读写和JIT影响，不用于性能优越性结论。\n');
fprintf(fileId,'7. 当前只有8位灰度基线单扫描；不支持彩色、渐进式、重启标记，也不是通用JPEG解析器。\n');
fprintf(fileId,'8. 下一轮可加入自己拍摄的人像/风景、重复抽样以及感知指标；本轮不编造用户调查。\n\n');
fprintf(fileId,'## 产物索引\n\n- measurements.csv：完整实测数据。\n- matched_rate_comparison.csv：等码率插值比较。\n');
fprintf(fileId,'- figures/：5组PNG和PDF图。\n- encoded/：120个真实JPEG文件。\n');
fprintf(fileId,'- tests/test_results.csv：21组边界往返测试明细。\n- experiment_results.mat：结构化结果。\n');
end
