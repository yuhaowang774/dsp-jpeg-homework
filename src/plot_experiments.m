function plot_experiments(dataset, measurements, outputDirectory)
%PLOT_EXPERIMENTS 生成彩色实验的5组图（PNG + PDF），全部只用基础绘图函数。
%   图1：输入与两种采样在QF=50的重建、以及4:2:0的误差放大。
%   图2：三种采样各一块的率失真曲线，三种量化策略同图对照。
%   图3：同一张图在QF=10/50/90的整图、64×64局部与绝对误差。
%   图4：单块走完DCT→量化→反量化→IDCT，解释“变换无损、量化有损”。
%   图5：零系数比例与完整文件压缩比，说明两者不能互相替代。
figureDirectory = fullfile(outputDirectory,'figures');
if ~isfolder(figureDirectory)
    mkdir(figureDirectory);
end
image = dataset.image;
imageName = dataset.name;
% 从CSV读回时 444/422/420 会被解析成数值，统一转成字符串再比较。
measurements.Subsampling = string(measurements.Subsampling);
measurements.Method = string(measurements.Method);
methodKeys = ["custom_jpeg","custom_uniform","matlab_jpeg"];
methodLabels = {'自编：频率加权','自编：等步长','MATLAB imwrite'};
methodStyles = {'-o','--s',':^'};
methodColors = [0.11 0.31 0.85; 0.76 0.25 0.05; 0.06 0.46 0.43];
subsamplings = ["444","422","420"];
subsamplingLabels = {'4:4:4','4:2:2','4:2:0'};

% 图1：输入、三种采样的重建，以及两种采样相对原图的误差（放大10倍）。
figureHandle = new_figure([1600 1000]);
layout = tiledlayout(figureHandle,2,3,'Padding','compact','TileSpacing','compact');
axesHandle = nexttile(layout);
show_rgb(axesHandle,image);
title(axesHandle,sprintf('原图 | %d×%d | %d B',size(image,2),size(image,1),numel(image)),'FontSize',11);
decodedQ50 = struct();
for subsampling = {'444','422','420'}
    reconstructed = decode_case(outputDirectory,imageName,'custom_jpeg',subsampling{1},50);
    decodedQ50.(['s' subsampling{1}]) = reconstructed;
    row = measurements(measurements.Method=="custom_jpeg" & ...
        measurements.Subsampling==subsampling{1} & measurements.Quality==50,:);
    axesHandle = nexttile(layout);
    show_rgb(axesHandle,reconstructed);
    title(axesHandle,sprintf('%s QF=50 | %.2f:1 | %.2f dB',subsampling{1}, ...
        row.CompressionRatio,row.PSNR),'FontSize',11);
end
for subsampling = {'444','420'}
    % 上面已解码过同一文件，直接复用，避免整幅1024²再解一遍。
    reconstructed = decodedQ50.(['s' subsampling{1}]);
    axesHandle = nexttile(layout);
    difference = mean(abs(double(image)-double(reconstructed)),3)*10;
    imagesc(axesHandle,difference,[0 120]);
    axis(axesHandle,'image');
    axis(axesHandle,'off');
    colormap(axesHandle,parula(256));
    colorbar(axesHandle);
    title(axesHandle,sprintf('%s 误差 ×10（0–120 饱和）',subsampling{1}),'FontSize',11);
end
title(layout,'输入与色度采样重建：亮度不降采样，误差集中在彩色细节','FontName',chinese_font(),'FontSize',17);
save_figure(figureHandle,figureDirectory,'01_dataset');

% 图2：每种采样一块面板，三种量化策略按实测点连线。
figureHandle = new_figure([1500 520]);
layout = tiledlayout(figureHandle,1,3,'Padding','compact','TileSpacing','compact');
for panelIndex = 1:numel(subsamplings)
    subsampling = subsamplings(panelIndex);
    axesHandle = nexttile(layout);
    hold(axesHandle,'on');
    legendHandles = gobjects(0);
    legendLabels = {};
    lowest = Inf;
    highest = -Inf;
    for methodIndex = 1:numel(methodKeys)
        rows = measurements(measurements.Method==methodKeys(methodIndex) & ...
            measurements.Subsampling==subsampling & isfinite(measurements.PSNR),:);
        if isempty(rows)
            continue;
        end
        [bpp,order] = sort(rows.BPP);
        psnrValues = rows.PSNR(order);
        lineHandle = plot(axesHandle,bpp,psnrValues,methodStyles{methodIndex}, ...
            'Color',methodColors(methodIndex,:),'LineWidth',1.4,'MarkerSize',5);
        legendHandles(end+1) = lineHandle; %#ok<AGROW>
        legendLabels{end+1} = methodLabels{methodIndex}; %#ok<AGROW>
        lowest = min(lowest,min(psnrValues));
        highest = max(highest,max(psnrValues));
    end
    if isfinite(lowest)
        padding = max(1,0.06*(highest-lowest));
        ylim(axesHandle,[lowest-padding highest+padding]);
    end
    xlabel(axesHandle,'完整文件码率 / bit·pixel^{-1}');
    ylabel(axesHandle,'PSNR / dB');
    title(axesHandle,sprintf('%s',subsamplingLabels{panelIndex}),'FontSize',12);
    legend(axesHandle,legendHandles,legendLabels,'Location','southeast','FontSize',8,'Box','off');
    style_axes(axesHandle);
end
title(layout,'率失真曲线：同一采样下比量化策略，同一采样率下比采样格式', ...
    'FontName',chinese_font(),'FontSize',17);
save_figure(figureHandle,figureDirectory,'02_rate_distortion');

% 图3：固定4:2:0，同一张图的整图、64×64局部与固定量程绝对误差。
qualities = [10 50 90];
columns = {image};
headers = {sprintf('原图 | %d B',numel(image))};
for quality = qualities
    columns{end+1} = decode_case(outputDirectory,imageName,'custom_jpeg','420',quality); %#ok<AGROW>
    row = measurements(measurements.Method=="custom_jpeg" & ...
        measurements.Subsampling=="420" & measurements.Quality==quality,:);
    headers{end+1} = sprintf('QF=%d | %.2f:1 | %.2f dB',quality, ...
        row.CompressionRatio,row.PSNR); %#ok<AGROW>
end
figureHandle = new_figure([1500 1000]);
layout = tiledlayout(figureHandle,3,4,'Padding','compact','TileSpacing','compact');
% 局部图自动挑全图方差最大的64×64区块，避免恰好切到天空导致整行看不出差别。
[cropRows,cropColumns] = choose_detail_crop( ...
    round(0.299*double(image(:,:,1))+0.587*double(image(:,:,2))+0.114*double(image(:,:,3))),64);
for columnIndex = 1:4
    axesHandle = nexttile(layout,columnIndex);
    show_rgb(axesHandle,columns{columnIndex});
    title(axesHandle,headers{columnIndex},'FontSize',11);
    rectangle(axesHandle,'Position', ...
        [cropColumns(1)-0.5 cropRows(1)-0.5 64 64],'EdgeColor',[0.9 0.4 0],'LineWidth',1.3);
    axesHandle = nexttile(layout,columnIndex+4);
    show_rgb(axesHandle,columns{columnIndex}(cropRows,cropColumns));
    title(axesHandle,'相同区域64×64局部','FontSize',11);
    axesHandle = nexttile(layout,columnIndex+8);
    errorImage = mean(abs(double(image)-double(columns{columnIndex})),3);
    imagesc(axesHandle,errorImage,[0 40]);
    axis(axesHandle,'image');
    axis(axesHandle,'off');
    colormap(axesHandle,parula(256));
    title(axesHandle,'绝对误差：固定0～40，超出饱和','FontSize',11);
    colorbar(axesHandle);
end
title(layout,'4:2:0 下三个质量档：块效应随量化步长放大','FontName',chinese_font(),'FontSize',17);
save_figure(figureHandle,figureDirectory,'03_visual_comparison');

% 图4：从确定位置的Y块解释“变换不丢失，量化才有损”。
tables = jpeg_tables();
luma = round(0.299*double(image(:,:,1))+0.587*double(image(:,:,2))+0.114*double(image(:,:,3)));
spatial = luma(97:104,97:104);
coefficients = tables.transform*(spatial-128)*tables.transform';
quantization = jpeg_quant_table_color(35);
quantized = round(coefficients./quantization.lum);
reconstruction = min(255,max(0,round(tables.transform'*(quantized.*quantization.lum)*tables.transform+128)));
figureHandle = new_figure([1250 780]);
layout = tiledlayout(figureHandle,2,3,'Padding','compact','TileSpacing','compact');
panels = {spatial,log10(1+abs(coefficients)),quantization.lum,quantized,reconstruction,abs(spatial-reconstruction)};
panelTitles = ["原始8×8亮度块","log10(1+|DCT|)：低频在左上", ...
    "QF=35：频率加权亮度表","量化后系数：大量变为零","反量化+IDCT重建块","绝对重建误差"];
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
        colormap(axesHandle,diverging_map());
    end
    colorbar(axesHandle);
    title(axesHandle,panelTitles(panelIndex),'FontSize',11);
end
title(layout,'单块解释：DCT → 量化 → 反量化 → IDCT','FontName',chinese_font(),'FontSize',17);
save_figure(figureHandle,figureDirectory,'04_block_pipeline');

% 图5：零系数比例并不等于压缩率，三种采样各一条线。
figureHandle = new_figure([1250 500]);
layout = tiledlayout(figureHandle,1,2,'Padding','compact','TileSpacing','compact');
for panelIndex = 1:2
    axesHandle = nexttile(layout);
    hold(axesHandle,'on');
    legendHandles = gobjects(0);
    legendLabels = {};
    for subsamplingIndex = 1:numel(subsamplings)
        rows = measurements(measurements.Method=="custom_jpeg" & ...
            measurements.Subsampling==subsamplings(subsamplingIndex),:);
        [qualityValues,order] = sort(rows.Quality);
        if panelIndex==1
            values = 100*rows.ZeroFraction(order);
        else
            values = rows.CompressionRatio(order);
        end
        lineHandle = plot(axesHandle,qualityValues,values,methodStyles{subsamplingIndex}, ...
            'Color',methodColors(subsamplingIndex,:),'LineWidth',1.5,'MarkerSize',5);
        legendHandles(end+1) = lineHandle; %#ok<AGROW>
        legendLabels{end+1} = subsamplingLabels{subsamplingIndex}; %#ok<AGROW>
    end
    xlabel(axesHandle,'质量因子 QF（不是画质百分比）');
    if panelIndex==1
        ylabel(axesHandle,'量化后零系数 / %');
        ylim(axesHandle,[0 100]);
    else
        ylabel(axesHandle,'原始RGB字节 / JPEG完整文件字节');
    end
    legend(axesHandle,legendHandles,legendLabels,'Location','best','FontSize',9,'Box','off');
    style_axes(axesHandle);
end
title(layout,'零系数比例不能代替实际压缩率：两者走势不同','FontName',chinese_font(),'FontSize',16);
save_figure(figureHandle,figureDirectory,'05_sparsity_and_size');
end

function reconstructed = decode_case(outputDirectory,imageName,method,subsampling,quality)
%DECODE_CASE 按实验文件名读回自编jpg，保证画图用的就是落盘文件。
filename = fullfile(outputDirectory,'encoded_color', ...
    sprintf('%s_%s_%s_q%03d.jpg',imageName,method,subsampling,quality));
assert(isfile(filename),'jpeg:MissingFile','缺少实验图像：%s',filename);
reconstructed = jpeg_decode_color(filename);
end

function [rowsOut,columnsOut] = choose_detail_crop(luma,side)
%CHOOSE_DETAIL_CROP 用积分图找局部方差最大的 side×side 区块。
%   不依赖图像处理工具箱，只对候选窗口做一次扫描；目的是让“局部放大”
%   落在有纹理的区域，而不是一整片天空。
[imageHeight,imageWidth] = size(luma);
sums = zeros(imageHeight+1,imageWidth+1);
sums(2:end,2:end) = cumsum(cumsum(double(luma),1),2);
squares = zeros(imageHeight+1,imageWidth+1);
squares(2:end,2:end) = cumsum(cumsum(double(luma).^2,1),2);
count = side*side;
bestScore = -Inf;
bestRow = 1;
bestColumn = 1;
stride = 8;
for rowStart = 1:stride:(imageHeight-side+1)
    for columnStart = 1:stride:(imageWidth-side+1)
        total = window_sum(sums,rowStart,columnStart,side);
        totalSquares = window_sum(squares,rowStart,columnStart,side);
        score = totalSquares/count-(total/count)^2;
        if score>bestScore
            bestScore = score;
            bestRow = rowStart;
            bestColumn = columnStart;
        end
    end
end
rowsOut = bestRow:(bestRow+side-1);
columnsOut = bestColumn:(bestColumn+side-1);
end

function total = window_sum(integral,rowStart,columnStart,side)
% 积分图四点求和；索引整体偏移1以容纳第0行/列。
total = integral(rowStart+side,columnStart+side) ...
    -integral(rowStart,columnStart+side) ...
    -integral(rowStart+side,columnStart) ...
    +integral(rowStart,columnStart);
end

function figureHandle = new_figure(dimensions)
% 独立设置字体与窗口属性，不污染用户MATLAB的全局绘图默认值。
figureHandle = figure('Visible','off','Color','w', ...
    'Position',[80 80 dimensions],'DefaultAxesFontName',chinese_font(), ...
    'DefaultTextFontName',chinese_font(),'DefaultAxesFontSize',11);
end

function show_rgb(axesHandle,rgb)
% 用基础函数image显示彩色图，不依赖Image Processing Toolbox的imshow。
% image不接受“坐标轴句柄”作为第一个位置参数，所以用Parent名值对指定。
image('CData',rgb,'Parent',axesHandle);
axis(axesHandle,'image');
axis(axesHandle,'off');
end

function style_axes(axesHandle)
% 使用弱网格、颜色加线型共同区分曲线，黑白阅读仍可辨认。
grid(axesHandle,'on');
set(axesHandle,'Box','off','GridAlpha',0.13,'LineWidth',0.8);
end

function map = diverging_map()
% 蓝色负、白色零、红色正的发散色图，避免默认parula掩盖符号。
half = 128;
lower = [linspace(0.13,1,half)',linspace(0.30,1,half)',linspace(0.67,1,half)'];
upper = [linspace(1,0.70,half)',linspace(1,0.16,half)',linspace(1,0.12,half)'];
map = [lower;upper];
end

function save_figure(figureHandle,outputDirectory,stem)
% 图表用PNG避免JPEG伪影，同时保存PDF供后续PPT/报告排版。
exportgraphics(figureHandle,fullfile(outputDirectory,[stem '.png']),'Resolution',300);
exportgraphics(figureHandle,fullfile(outputDirectory,[stem '.pdf']),'ContentType','vector');
close(figureHandle);
end

function name = chinese_font()
% 图中有中文：依次尝试 Windows / macOS / Linux 常见中文字体，
% 都没有时退回 MATLAB 默认字体，避免在别的电脑上显示成方块或报错。
persistent cached
if isempty(cached)
    % 中文版 Windows 的 listfonts 往往只列出 'Microsoft YaHei UI'，不列 'Microsoft YaHei'。
    candidates = {'Microsoft YaHei','Microsoft YaHei UI','SimHei','PingFang SC','Heiti SC', ...
        'Hiragino Sans GB','Noto Sans SC','Noto Sans CJK SC','Source Han Sans SC','WenQuanYi Micro Hei'};
    available = listfonts;
    cached = get(groot,'defaultAxesFontName');
    for index = 1:numel(candidates)
        if any(strcmpi(available,candidates{index}))
            cached = candidates{index};
            break;
        end
    end
end
name = cached;
end
