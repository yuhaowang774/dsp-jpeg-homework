function dataset = load_color_dataset(dataDirectory)
%LOAD_COLOR_DATASET 载入唯一的彩色实验输入，并刷新 data/manifest.csv。
%   输入固定为 data/demo_photo_1024_page.png：由 tools/export_page_photo.py
%   从 web/photos.js 无损导出，像素与网页演示台完全一致。不接受 JPG 版本，
%   因为另一条解码路径与网页像素平均差 1.54/通道、最大 23。
%   dataset 为标量结构体：name / image / source / width / height。
if ~isfolder(dataDirectory)
    mkdir(dataDirectory);
end
filename = fullfile(dataDirectory,'demo_photo_1024_page.png');
assert(isfile(filename),'jpeg:MissingInput', ...
    '缺少 %s，请先运行 python tools/export_page_photo.py。',filename);
image = imread(filename);
assert(isa(image,'uint8') && size(image,3)==3,'jpeg:Input','输入必须是8位RGB PNG。');
assert(size(image,1)==1024 && size(image,2)==1024,'jpeg:Input', ...
    '本轮实验固定使用1024×1024输入，实际为%d×%d。',size(image,2),size(image,1));
dataset.name = 'demo_photo_1024_page';
dataset.image = image;
dataset.width = size(image,2);
dataset.height = size(image,1);
dataset.source = ['web/photos.js 无损导出的1024×1024风景照片；' ...
    '与网页演示台同一份像素，供MATLAB与前端逐位对照'];
manifest = table({dataset.name},{dataset.source},'VariableNames',{'Name','Source'});
writetable(manifest,fullfile(dataDirectory,'manifest.csv'));
fprintf('输入：%s（%d×%d RGB）\n',filename,dataset.width,dataset.height);
end
