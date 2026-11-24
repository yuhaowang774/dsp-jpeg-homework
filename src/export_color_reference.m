function export_color_reference(referenceFile,outputFile)
%EXPORT_COLOR_REFERENCE 把彩色实测结果转成网页可直接加载的 web/color_reference.js。
%   数据来自 run_color_experiment.m 写出的 results/color_reference.json；
%   页面用 window.COLOR_REFERENCE 渲染对照表，并由
%   tests/web/test_color_reference.js 断言网页复算结果与之一致。
if nargin<1 || isempty(referenceFile)
    projectRoot = fileparts(fileparts(mfilename('fullpath')));
    referenceFile = fullfile(projectRoot,'results','color_reference.json');
end
if nargin<2 || isempty(outputFile)
    projectRoot = fileparts(fileparts(mfilename('fullpath')));
    outputFile = fullfile(projectRoot,'web','color_reference.js');
end
assert(isfile(referenceFile),'jpeg:MissingReference','缺少 %s，请先运行 run_color_experiment.m。',referenceFile);
reference = jsondecode(fileread(referenceFile));
json = jsonencode(reference);
fileId = fopen(outputFile,'w','n','UTF-8');
assert(fileId>=0,'jpeg:FileOpen','无法写入：%s',outputFile);
fprintf(fileId,'window.COLOR_REFERENCE = %s;\n',json);
fclose(fileId);
fprintf('已写出 %s（%d 个档位，%.1f KB）\n',outputFile,numel(reference.cases),dir(outputFile).bytes/1024);
end
