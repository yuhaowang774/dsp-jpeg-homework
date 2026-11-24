function block = jpeg_idct_web(coefficients, transform)
%JPEG_IDCT_WEB 与网页 web/jpeg_codec.js 的 idct2() 完全相同的双重累加实现。
%   先按 u 求和得到行列中间量，再按 v 求和；累加次序与前端一致，
%   保证 MATLAB 与网页解码出的像素逐位相同。
temporary = zeros(8);
spatial = zeros(8);
for x = 1:8
    for v = 1:8
        accumulator = 0;
        for u = 1:8
            accumulator = accumulator+transform(u,x)*coefficients(u,v);
        end
        temporary(x,v) = accumulator;
    end
end
for x = 1:8
    for y = 1:8
        accumulator = 0;
        for v = 1:8
            accumulator = accumulator+temporary(x,v)*transform(v,y);
        end
        spatial(x,y) = accumulator;
    end
end
block = spatial;
end
