function result = run_project()
%RUN_PROJECT JPEG大作业第一轮实验一键入口，目标环境MATLAB R2024b。
%   在本文件所在目录输入 run_project。无需Image Processing Toolbox。
%   本轮依次执行自测、准备数据、运行实验、画图、生成中文实验纪要。
%   运行会覆盖本项目results中的同名产物，不修改用户提供的作业要求。
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
dataset = prepare_dataset(fullfile(root,'data'));
% Q是控制量化表的参数，不是百分比画质；实验覆盖低、中、高码率。
qualities = [5 10 20 35 50 65 80 90 95 100];
measurements = run_experiments(dataset,qualities,outputDirectory);
matched = compare_matched_rates(measurements);
writetable(matched,fullfile(outputDirectory,'matched_rate_comparison.csv'));
plot_experiments(dataset,measurements,outputDirectory);
elapsedSeconds = toc(started);
write_experiment_report(measurements,matched,testResults,elapsedSeconds,outputDirectory);
result.measurements = measurements;
result.matchedRates = matched;
result.tests = testResults;
result.release = version('-release');
result.elapsedSeconds = elapsedSeconds;
save(fullfile(outputDirectory,'experiment_results.mat'),'result');
fprintf('DONE: %d measurements, elapsed %.1f s.\n',height(measurements),elapsedSeconds);
fprintf('Results: %s\n',outputDirectory);
end
