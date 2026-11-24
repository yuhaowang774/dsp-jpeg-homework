function coefficients = jpeg_dct_web(block, transform)
%JPEG_DCT_WEB 与网页 web/jpeg_codec.js 的 dct2() 完全相同的双重累加实现。
%   先逐行做一维 DCT（y 固定、u 外层、x 内层累加），再逐列做一次；
%   目的不是提速，而是让浮点累加顺序与前端逐标量实现一致，
%   从而量化取整在 .5 边界上不会因为求和次序不同而翻转。
temporary = zeros(8);
coefficientsOut = zeros(8);
for y = 1:8
    for u = 1:8
        accumulator = 0;
        for x = 1:8
            accumulator = accumulator+transform(u,x)*block(y,x);
        end
        temporary(y,u) = accumulator;
    end
end
for u = 1:8
    for v = 1:8
        accumulator = 0;
        for y = 1:8
            accumulator = accumulator+temporary(y,v)*transform(u,y);
        end
        coefficientsOut(u,v) = accumulator;
    end
end
coefficients = coefficientsOut;
end
