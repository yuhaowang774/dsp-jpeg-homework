function plot_experiments(dataset,measurements,outputDirectory)
%PLOT_EXPERIMENTS 生成可直接用于答辩的中文图，PNG与矢量PDF同时保存。
%   统一图例/尺度；误差图使用固定范围，不通过自动拉伸夸大低误差。
figureDirectory = fullfile(outputDirectory,'figures');
if ~isfolder(figureDirectory)
    mkdir(figureDirectory);
end
labels = ["示例照片：辣椒","合成：平滑渐变","合成：密集纹理","合成：文字与直线"];
colors = [0 114 178;213 94 0;0 158 115]/255;
methods = ["custom_jpeg","custom_uniform","matlab_jpeg"];
methodLabels = ["自编：频率加权","自编：等步长","MATLAB参考"];
styles = {'-o','--s',':^'};

% 图1：如实展示数据来源，避免把合成样本伪装为真实照片。
figureHandle = new_figure([1150 760]);
layout = tiledlayout(figureHandle,2,2,'Padding','compact','TileSpacing','compact');
for imageIndex = 1:numel(dataset)
    axesHandle = nexttile(layout);
    show_gray(axesHandle,dataset(imageIndex).image);
    title(axesHandle,labels(imageIndex));
end
title(layout,'实验输入：4张256×256、8位灰度图','FontName','Microsoft YaHei','FontSize',17);
save_figure(figureHandle,figureDirectory,'01_dataset');

% 图2：完整文件码率与PSNR关系；同码率比较比相同Q比较更公平。
figureHandle = new_figure([1200 820]);
layout = tiledlayout(figureHandle,2,2,'Padding','compact','TileSpacing','compact');
for imageIndex = 1:numel(dataset)
    axesHandle = nexttile(layout);
    hold(axesHandle,'on');
    for methodIndex = 1:numel(methods)
        rows = measurements(measurements.Image==dataset(imageIndex).name & ...
            measurements.Method==methods(methodIndex),:);
        rows = sortrows(rows,'BPP');
        finiteRows = isfinite(rows.PSNR);
        plot(axesHandle,rows.BPP(finiteRows),rows.PSNR(finiteRows),styles{methodIndex}, ...
            'Color',colors(methodIndex,:),'LineWidth',1.5,'MarkerSize',5);
    end
    title(axesHandle,labels(imageIndex));
    xlabel(axesHandle,'完整文件码率 / bit·pixel^{-1}');
    ylabel(axesHandle,'PSNR / dB');
    style_axes(axesHandle);
    legend(axesHandle,methodLabels,'Location','southeast','FontSize',9,'Box','off');
end
title(layout,'率失真曲线：标记为实测点，连线仅辅助阅读', ...
    'FontName','Microsoft YaHei','FontSize',17);
save_figure(figureHandle,figureDirectory,'02_rate_distortion');

% 图3：同一照片的全图、同位置局部和固定量程的绝对误差。
original = dataset(1).image;
qualities = [10 50 90];
images = {original};
headers = {sprintf('原图 | %d B',numel(original))};
for quality = qualities
    filename = fullfile(outputDirectory,'encoded',sprintf('peppers_gray_custom_jpeg_q%03d.jpg',quality));
    images{end+1} = jpeg_decode_gray(filename); %#ok<AGROW>
    row = measurements(measurements.Image=="peppers_gray" & ...
        measurements.Method=="custom_jpeg" & measurements.Quality==quality,:);
    headers{end+1} = sprintf('Q=%d | %.2f:1 | %.2f dB',quality,row.CompressionRatio,row.PSNR); %#ok<AGROW>
end
figureHandle = new_figure([1400 930]);
layout = tiledlayout(figureHandle,3,4,'Padding','compact','TileSpacing','compact');
cropRows = 97:160;
cropColumns = 97:160;
for columnIndex = 1:4
    axesHandle = nexttile(layout,columnIndex);
    show_gray(axesHandle,images{columnIndex});
    title(axesHandle,headers{columnIndex},'FontSize',11);
    rectangle(axesHandle,'Position',[96.5 96.5 64 64],'EdgeColor',[0.9 0.4 0],'LineWidth',1.3);
    axesHandle = nexttile(layout,columnIndex+4);
    show_gray(axesHandle,images{columnIndex}(cropRows,cropColumns));
    title(axesHandle,'相同区域64×64局部');
    axesHandle = nexttile(layout,columnIndex+8);
    errorImage = abs(double(original)-double(images{columnIndex}));
    imagesc(axesHandle,errorImage,[0 40]);
    axis(axesHandle,'image');
    axis(axesHandle,'off');
    colormap(axesHandle,parula(256));
    title(axesHandle,'绝对误差：固定0～40，超出饱和');
    colorbar(axesHandle);
end
title(layout,'照片压缩效果：所有灰度图统一显示范围0～255', ...
    'FontName','Microsoft YaHei','FontSize',17);
save_figure(figureHandle,figureDirectory,'03_visual_comparison');

% 图4：从一个确定位置的块解释“变换不丢失，量化才有损”。
tables = jpeg_tables();
spatial = double(original(97:104,97:104));
coefficients = tables.transform*(spatial-128)*tables.transform';
quantization = jpeg_quant_table(35,'jpeg');
quantized = round(coefficients./quantization);
reconstruction = min(255,max(0,round(tables.transform'*(quantized.*quantization)*tables.transform+128)));
figureHandle = new_figure([1250 780]);
layout = tiledlayout(figureHandle,2,3,'Padding','compact','TileSpacing','compact');
panels = {spatial,log10(1+abs(coefficients)),quantization,quantized,reconstruction,abs(spatial-reconstruction)};
panelTitles = ["原始8×8像素块","log10(1+|DCT|)：低频在左上", ...
    "Q=35：频率加权量化表","量化后系数：大量变为零","反量化+IDCT重建块","绝对重建误差"];
for panelIndex = 1:6
    axesHandle = nexttile(layout);
    imagesc(axesHandle,panels{panelIndex});
    axis(axesHandle,'image');
    set(axesHandle,'XTick',1:8,'YTick',1:8);
    colormap(axesHandle,parula(256));
    if panelIndex==1 || panelIndex==5
        clim(axesHandle,[0 255]);
        colormap(axesHandle,gray(256));
    end
    if panelIndex==4
        magnitude = max(1,max(abs(quantized(:))));
        clim(axesHandle,[-magnitude,magnitude]);
    end
    colorbar(axesHandle);
    title(axesHandle,panelTitles(panelIndex),'FontSize',11);
end
title(layout,'单块解释：DCT → 量化 → 反量化 → IDCT', ...
    'FontName','Microsoft YaHei','FontSize',17);
save_figure(figureHandle,figureDirectory,'04_block_pipeline');

% 图5：零系数比例并不等于压缩率，分别绘制两者以防混淆。
figureHandle = new_figure([1250 480]);
layout = tiledlayout(figureHandle,1,2,'Padding','compact','TileSpacing','compact');
palette = [colors;0.8 0.47 0.65];
for panelIndex = 1:2
    axesHandle = nexttile(layout);
    hold(axesHandle,'on');
    for imageIndex = 1:numel(dataset)
        rows = measurements(measurements.Image==dataset(imageIndex).name & ...
            measurements.Method=="custom_jpeg",:);
        if panelIndex==1
            values = 100*rows.ZeroFraction;
        else
            values = rows.CompressionRatio;
        end
        plot(axesHandle,rows.Quality,values,'-o','Color',palette(imageIndex,:), ...
            'LineWidth',1.5,'MarkerSize',5);
    end
    xlabel(axesHandle,'质量参数 Q（不是画质百分比）');
    if panelIndex==1
        ylabel(axesHandle,'量化后零系数 / %');
        ylim(axesHandle,[0 100]);
    else
        ylabel(axesHandle,'原始像素字节 / JPEG完整文件字节');
    end
    style_axes(axesHandle);
    legend(axesHandle,labels,'Location','best','FontSize',9,'Box','off');
end
title(layout,'可压缩性取决于内容，零系数比例不能代替实际压缩率', ...
    'FontName','Microsoft YaHei','FontSize',16);
save_figure(figureHandle,figureDirectory,'05_sparsity_and_size');
end

function figureHandle = new_figure(dimensions)
% 独立设置字体与窗口属性，不污染用户MATLAB的全局绘图默认值。
figureHandle = figure('Visible','off','Color','w', ...
    'Position',[80 80 dimensions],'DefaultAxesFontName','Microsoft YaHei', ...
    'DefaultTextFontName','Microsoft YaHei','DefaultAxesFontSize',11);
end

function show_gray(axesHandle,image)
% 图像展示始终使用0~255，避免各图自动对比度拉伸。
imagesc(axesHandle,image,[0 255]);
axis(axesHandle,'image');
axis(axesHandle,'off');
colormap(axesHandle,gray(256));
end

function style_axes(axesHandle)
% 使用弱网格、颜色加线型共同区分曲线，黑白阅读仍可辨认。
grid(axesHandle,'on');
set(axesHandle,'Box','off','GridAlpha',0.13,'LineWidth',0.8);
end

function save_figure(figureHandle,outputDirectory,stem)
% 图表用PNG避免JPEG伪影，同时保存PDF供后续PPT/报告排版。
exportgraphics(figureHandle,fullfile(outputDirectory,[stem '.png']),'Resolution',300);
exportgraphics(figureHandle,fullfile(outputDirectory,[stem '.pdf']),'ContentType','vector');
close(figureHandle);
end
