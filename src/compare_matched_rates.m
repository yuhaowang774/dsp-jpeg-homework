function matched = compare_matched_rates(measurements)
%COMPARE_MATCHED_RATES 在重叠码率区间内线性插值，不按相同Q直接评优。
%   结果是已测曲线之间的插值估计，不是额外实测点；禁止外推。
%   删除Inf点防止无损点导致插值失真，不预设频率加权一定优于等步长。
records = struct([]);
recordIndex = 0;
for imageName = unique(measurements.Image,'stable')'
    weighted = measurements(measurements.Image==imageName & measurements.Method=="custom_jpeg",:);
    uniform = measurements(measurements.Image==imageName & measurements.Method=="custom_uniform",:);
    [weightedBpp,weightedPsnr] = clean_curve(weighted);
    [uniformBpp,uniformPsnr] = clean_curve(uniform);
    low = max(min(weightedBpp),min(uniformBpp));
    high = min(max(weightedBpp),max(uniformBpp));
    if high<=low || numel(weightedBpp)<2 || numel(uniformBpp)<2
        continue;
    end
    targets = low+(high-low)*[0.2 0.4 0.6 0.8];
    for target = targets
        recordIndex = recordIndex+1;
        records(recordIndex).Image = imageName;
        records(recordIndex).TargetBPP = target;
        records(recordIndex).WeightedPSNR = interp1(weightedBpp,weightedPsnr,target,'linear');
        records(recordIndex).UniformPSNR = interp1(uniformBpp,uniformPsnr,target,'linear');
        records(recordIndex).DeltaPSNR = records(recordIndex).WeightedPSNR-records(recordIndex).UniformPSNR;
        records(recordIndex).Evaluation = "Linear interpolation; no extrapolation";
    end
end
matched = struct2table(records);
end

function [bpp,psnrValue] = clean_curve(rows)
% 同一文件码率可能对应重复量化表；保留对应点的较高PSNR。
valid = isfinite(rows.PSNR);
[bpp,~,groups] = unique(rows.BPP(valid));
psnrValue = accumarray(groups,rows.PSNR(valid),[],@max);
end
