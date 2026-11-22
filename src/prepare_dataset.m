function dataset = prepare_dataset(dataDirectory)
%PREPARE_DATASET 准备一张MATLAB示例照片与三类明确标注的合成图。
%   PNG是无损实验输入；不把合成图称作真实照片或自然图像数据集。
if ~isfolder(dataDirectory)
    mkdir(dataDirectory);
end
rng(20261113,'twister');
sizeValue = 256;
[horizontal,vertical] = meshgrid(linspace(0,1,sizeValue));
gradient = uint8(round(255*(0.65*horizontal+0.35*vertical)));
texture = 128+45*sin(2*pi*horizontal*19).*cos(2*pi*vertical*13)+ ...
    28*sin(2*pi*(horizontal+vertical)*37)+12*randn(sizeValue);
texture = uint8(round(min(255,max(0,texture))));
% 用可移植的5x7位图字形生成文字，避免依赖屏幕截图与字体渲染。
glyphs = {[1 1 1 1 0;1 0 0 0 1;1 0 0 0 1;1 0 0 0 1;1 0 0 0 1;1 0 0 0 1;1 1 1 1 0], ...
    [0 1 1 1 1;1 0 0 0 0;1 0 0 0 0;0 1 1 1 0;0 0 0 0 1;0 0 0 0 1;1 1 1 1 0], ...
    [1 1 1 1 0;1 0 0 0 1;1 0 0 0 1;1 1 1 1 0;1 0 0 0 0;1 0 0 0 0;1 0 0 0 0]};
word = [glyphs{1},zeros(7,1),glyphs{2},zeros(7,1),glyphs{3}];
textImage = uint8(245*ones(sizeValue));
large = uint8(245-220*kron(word,ones(8)));
textImage(30:85,30:165) = large;
small = uint8(245-220*kron(word,ones(3)));
for rowStart = [115 155 195]
    for columnStart = [17 87 157]
        textImage(rowStart:rowStart+20,columnStart:columnStart+50) = small;
    end
end
textImage(235:237,15:240) = 20;
images = {gradient,texture,textImage};
names = ["synthetic_gradient","synthetic_texture","synthetic_text"];
sources = ["Generated smooth ramp; seed not required", ...
    "Generated sinusoids plus noise; rng=20261113", ...
    "Generated 5x7 bitmap DSP letters and straight line"];

% 复用已保存输入保证后续可复现；只在首次运行读取本机示例照片。
photoPath = fullfile(dataDirectory,'peppers_gray.png');
if isfile(photoPath)
    photo = imread(photoPath);
    photoSource = "MATLAB bundled peppers.png; grayscale crop; cached locally";
else
    originalPath = which('peppers.png');
    assert(~isempty(originalPath),'jpeg:MissingImage', ...
        '未找到peppers.png，请保留data/peppers_gray.png或安装MATLAB示例图像。');
    color = imread(originalPath);
    gray = uint8(round(0.299*double(color(:,:,1))+0.587*double(color(:,:,2))+0.114*double(color(:,:,3))));
    assert(all(size(gray)>=[256 256]),'示例照片小于256x256。');
    firstRow = floor((size(gray,1)-256)/2)+1;
    firstColumn = floor((size(gray,2)-256)/2)+1;
    photo = gray(firstRow:firstRow+255,firstColumn:firstColumn+255);
    imwrite(photo,photoPath);
    photoSource = "MATLAB bundled peppers.png; BT.601 coefficients; centered 256x256 crop";
end
images = [{photo},images];
names = ["peppers_gray",names];
sources = [photoSource,sources];
dataset = struct([]);
for imageIndex = 1:numel(images)
    path = fullfile(dataDirectory,names(imageIndex)+".png");
    imwrite(images{imageIndex},path);
    dataset(imageIndex).name = names(imageIndex);
    dataset(imageIndex).image = images{imageIndex};
    dataset(imageIndex).source = sources(imageIndex);
end
manifest = table(names',sources','VariableNames',{'Name','Source'});
writetable(manifest,fullfile(dataDirectory,'manifest.csv'));
end
