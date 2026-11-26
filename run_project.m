function result = run_project()
%RUN_PROJECT JPEG大作业一键入口，目标环境MATLAB R2024b。
%   在项目根目录执行 run_project。全程只用基础MATLAB，不要求任何工具箱。
%   本轮流程：边界测试 → 载入1024彩色输入 → 3种量化策略×3种采样×10个QF
%   实测 → 等码率插值 → 5组图 → 网页参考数据 → 中文纪要。
root = fileparts(mfilename('fullpath'));
oldPath = path;
pathGuard = onCleanup(@() path(oldPath));
addpath(fullfile(root,'src'),fullfile(root,'tests'));
outputDirectory = fullfile(root,'results');
if ~isfolder(outputDirectory)
    mkdir(outputDirectory);
end
% 日志保留MATLAB真实版本和控制台进度，不伪造运行环境。
diary(fullfile(outputDirectory,'matlab_run.log'));
diaryGuard = onCleanup(@() diary('off'));
fprintf('JPEG experiment | MATLAB %s | release %s\n',version,version('-release'));
assert(strcmp(version('-release'),'2024b'),'本轮指定用MATLAB R2024b运行。');
started = tic;
testResults = run_tests(fullfile(outputDirectory,'tests'));
dataset = load_color_dataset(fullfile(root,'data'));
% QF是量化表的缩放因子，不是百分比画质；覆盖低、中、高码率。
qualities = [5 10 20 35 50 65 80 90 95 100];
[measurements,reference] = run_color_experiment( ...
    fullfile(root,'data','demo_photo_1024_page.png'),qualities,outputDirectory);
matched = compare_matched_rates(measurements);
writetable(matched,fullfile(outputDirectory,'matched_rate_comparison.csv'));
plot_experiments(dataset,measurements,outputDirectory);
% 自编频率加权30组回写网页，供10.1页与逐位断言使用。
export_color_reference(fullfile(outputDirectory,'color_reference.json'), ...
    fullfile(root,'web','color_reference.js'));
elapsedSeconds = toc(started);
write_experiment_report(measurements,matched,testResults,elapsedSeconds,outputDirectory);
result.measurements = measurements;
result.matchedRates = matched;
result.reference = reference;
result.tests = testResults;
result.release = version('-release');
result.elapsedSeconds = elapsedSeconds;
save(fullfile(outputDirectory,'experiment_results.mat'),'result');
fprintf('DONE: %d measurements (%d jpg), elapsed %.1f s.\n', ...
    height(measurements),numel(dir(fullfile(outputDirectory,'encoded_color','*.jpg'))),elapsedSeconds);
fprintf('Results: %s\n',outputDirectory);
end
