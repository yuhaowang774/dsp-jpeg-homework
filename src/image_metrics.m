function metrics = image_metrics(original,reconstructed)
%IMAGE_METRICS 手写MSE、PSNR、MAE，不依赖图像处理工具箱。
%   PSNR以8位峰值255计算；完全相同时返回Inf，不能用任意有限数替代。
assert(isequal(size(original),size(reconstructed)),'评价图像尺寸必须相同。');
errorImage = double(original)-double(reconstructed);
metrics.mse = mean(errorImage(:).^2);
metrics.mae = mean(abs(errorImage(:)));
if metrics.mse==0
    metrics.psnr = Inf;
else
    metrics.psnr = 10*log10(255^2/metrics.mse);
end
end
