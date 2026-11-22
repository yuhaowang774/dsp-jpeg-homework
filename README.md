# JPEG压缩原理与实现——分块DCT、量化及率失真分析

这是DSP大作业的第一轮可运行原型。核心算法自行编写，所有MATLAB文件均有中文函数说明和关键步骤注释；没有直接移植网上编解码项目。

## 一键运行

在本机 **MATLAB R2024b** 中把当前文件夹切换到本目录，然后执行：

```matlab
% 执行自测、数据准备、120组实验、绘图和实验纪要生成。
result = run_project;
```

程序仅使用基础MATLAB。不要求Image Processing Toolbox、Signal Processing Toolbox或Communications Toolbox。已保存的`data/`输入请随程序保留；首次运行用到MATLAB自带`peppers.png`。不需要联网。

单独处理自己的灰度PNG：

```matlab
% 核心输入必须是二维uint8；输出是真正的基线JPEG，而非改后缀的MAT文件。
addpath('src');
image = imread('data/peppers_gray.png');
info = jpeg_encode_gray(image,'my_result.jpg',50,'jpeg');
[reconstructed,details] = jpeg_decode_gray('my_result.jpg');
% 独立检查标准解码器是否能读取，不参与自编解码流程。
independent = imread('my_result.jpg');
```

只运行测试：

```matlab
% 测试非8倍数尺寸、极端亮度、随机纹理、ZRL、FF填充和错误文件等。
addpath('src','tests');
tests = run_tests;
```

## 可视化演示

`web/` 是独立的 JPEG 编解码教学演示，双击 `web/index.html` 即可离线打开，不依赖 MATLAB、网络或第三方库。页面只有一个手动流程：先用 3 个节点讲“亮度与色度”“低频与高频”两条人眼视觉特性，再按编码优先顺序“输入：从 JPG 解码出 RGB → 编码准备：YCbCr、色度采样与分块 → DCT 与量化：真正丢信息的地方 → Zigzag/Huffman 与熵编码输出 → 解码：位流如何变回像素 → 二次压缩结果”展开，共 18 个节点，打开后停在第一节点，不自动播放、不自动跳步。

- 页面采用全屏演示布局：顶部不再显示页面标题和“设置”按钮；示例图、上传、质量因子 QF、色度采样和分析分量仍集中在右侧设置面板，但页面已不提供打开入口，演示时保持默认参数，主演示区占满窗口。
- 编码优先流程直接驱动原 14 个步骤画布，并在最前面增加 3 个视觉原理节点（亮度与色度两页、低频与高频一页）：点击底部步骤条切换节点，画布保持静态，动画由节点内的工具按钮手动触发；页面不设时间轴、字幕浮层或自动连播。
- 流程按顺序展开为 18 个节点：⓪–② 视觉原理（亮度与色度：分量展示 + 同倍率砍到 1/4 的公平对比；低频与高频：低通/高通对比）→ ③ 输入：源图分块 → ④–⑥ 编码准备：RGB/YCbCr 转换、色度下采样、分块与电平平移 → ⑦–⑧ DCT 与量化 → ⑨–⑫ Zigzag、DC 差分与 AC 游程、Huffman、熵编码位流 → ⑬–⑯ 解码：熵解码、反量化、IDCT、上采样与逆颜色变换 → ⑰ 二次压缩结果。最后节点复用重建画布，用于最终压缩结果对照。
- 亮度与色度主题：第 1 页看原图与 Y/Cb/Cr 三分量，说明亮度带轮廓细节、色度是平缓色块；第 2 页公平对比——亮度和色度都用 2×2 平均降到 1/4、都用最近邻放大，自动挑纹理最丰富的一块显示，结果色度几乎看不出、亮度出现明显马赛克。
- 低频与高频主题：看原图灰度 / 只留 Zigzag 前 10 个低频系数（还能认出轮廓）/ 只留后 54 个高频系数（提亮后只剩细纹理）。
- 每张图下方直接写结论，左栏用问答式文字解释，不要求观众记 CSF 等术语。对比数据按图像缓存，切换节点不重算。
- 支持 4:4:4 / 4:2:2 / 4:2:0 色度采样、质量因子 QF=1–100、Y/Cb/Cr 分量切换、点击任意 8×8 块联动所有步骤。QF 控制量化表缩放，量化步长记为 `q(u,v)`。
- 页面左侧为原理、公式、当前参数与观察要点；右侧为对应阶段的可视化结果。第一步采用两列布局：主图在左列尽量放大，右侧为 8×8 块放大预览；鼠标悬浮时预览实时跟随光标所在块，点击主图后才确认选区，后续各步骤使用的分块数据与确认选区同步。
- 前端默认 1024×1024：内置同一张风景示例的 1024×1024 与 640×640 两个原生版本（均由 6000×4000 原图按 1:1 居中裁剪后缩放），以及四张灰度/合成样例；选择 640 版本时后续编码和分块按 640×640 处理。上传图片按 1:1 居中裁剪到 1024×1024。原三张来源不明的演示照片已删除。MATLAB 批量实验仍保持 256×256，二者口径不同。
- 动画覆盖：分块巡览（行优先、逐行从左到右扫描）、DCT 基函数合成、DCT 行列两阶段分解、逐系数量化、Zigzag 扫描、RLE 游程条带、Huffman 逐符号写入与字节分组、熵编码按 MCU 拼接、熵解码位游标、IDCT 基函数累加，以及步骤切换淡入。
- 所有动画由页面内 `ANIM` 配置统一定义触发条件、持续时长和缓动曲线；离散流程使用 `steps` 节奏，连续流程使用标准三次或正弦缓动。步骤切换和设置抽屉共享统一过渡变量。
- 性能与适配：移动端降低设备像素比上限、动画节拍按屏幕与性能档位缩放；块巡览只重绘高亮层，位流写入/解码/拼接按状态变化更新；系统开启“减少动态效果”时自动压缩所有动画时长。
- 底部只保留步骤条；所有动画都需要点击对应步骤内的工具按钮才会播放。
- 页面中的熵解码直接读取编码产生的位流，逐块验证编码/解码符号一致；PSNR 在重建步骤的参数区显示。
- 快捷键：`←/→` 切换步骤，`↑/↓` 调整 QF，`Z` Zigzag 扫描，`B` 基函数合成。

### 前端测试

```bash
node tests/web/test_codec.js      # 编解码正确性、标准表、位流闭环
node tests/web/test_ui_smoke.js   # 18 节点渲染、控件与全部动画路径
python tests/web/visual_check.py  # Playwright + Chrome 截图验证（需本地 8765 服务）
```

`test_codec.js` 覆盖 DCT/IDCT 可逆性、二维 DCT 行列分解、幅值位映射、规范 Huffman 码、质量映射、三种采样尺寸、示例图全组合闭环、与 MATLAB 的灰度 Y 路径对比、奇数尺寸与颜色转换往返。`test_ui_smoke.js` 使用轻量 DOM 桩件遍历 18 个教学流节点与所有工具按钮，验证手动触发的动画不抛错且产生读数。`visual_check.py` 在真实 Chrome 中逐步骤截图，并检查控制台错误、Q 滑杆与上传。

验证截图输出到 `results/web_screenshots/`：18 个静态节点、DCT 行列分解、4:4:4 对比、QF=20、上传图片、6 个手动动画中间态、1 张移动端画面与 1 张减少动态效果画面，共 31 张。

`web/jpeg_codec.js` 是前端编解码核心，按基线顺序 DCT、标准量化表与 T.81 附录 K Huffman 表实现；`web/demo_data.js` 提供灰度/合成样例数据，`web/photos.js` 提供 1024×1024 与 640×640 两个原生版本的风景示例像素数据，页面不再对内置照片做上采样。前端对相同图像、分辨率、质量因子 QF 与采样格式的编码结果做有限缓存，避免重复重算。MATLAB 程序仍是提交的算法主体，前端用于讲解与演示。

## 已实现范围

1. 8×8正交DCT/IDCT矩阵、边缘复制补齐、电平平移。
2. T.81附录K亮度示例表和等步长对照表；常见IJG整数Q映射。
3. Zigzag、DC差分、AC零游程、EOB/ZRL、幅值映射、规范Huffman编码。
4. SOI/APP0(JFIF)/DQT/SOF0/DHT/SOS/EOI、字节填充和实际`.jpg`文件写入。
5. 从文件重新解析表并自编熵解码、反量化、IDCT；不复用编码端量化系数重建。
6. 独立使用`imread`检查自编文件可读性、尺寸和像素差。

当前范围仅为8位灰度、单分量、基线单扫描。彩色、渐进式、重启间隔和通用文件容错尚未实现；自编解码器遇到不支持的格式会报错。

## 实验设计

- 输入：MATLAB辣椒照片的灰度中心裁剪，以及明确标注为合成的渐变、纹理、文字图；均256×256。
- Q：5、10、20、35、50、65、80、90、95、100。
- 方法：自编频率加权、自编等步长、MATLAB `imwrite`基线；共120个文件。
- 实测：完整字节数、bpp、压缩比、MSE、PSNR、MAE、稀疏度、熵位数、读写耗时等。
- 等码率：在加权与等步长曲线共同覆盖范围内线性插值，明确标记为估计，不外推、不冒充实测。
- 不默认“加权一定更好”，不把同Q比较当成等码率比较。

## 文件导航

| 位置 | 内容 |
|---|---|
| `run_project.m` | 一键运行 |
| `src/jpeg_encode_gray.m` | 自编编码器 |
| `src/jpeg_read_scan.m`、`src/jpeg_decode_gray.m` | 文件解析及自编解码 |
| `src/jpeg_tables.m`、`src/jpeg_huffman.m` | 标准常量、DCT、扫描和规范码 |
| `src/jpeg_quant_table.m` | 可编辑的量化策略 |
| `src/run_experiments.m` | 批量实验及MATLAB基线 |
| `src/export_demo.m` | 导出前端可视化数据 |
| `web/` | 离线 HTML 可视化演示 |
| `tests/web/` | 前端编解码与 UI 冒烟测试 |
| `tests/run_tests.m` | 自动验证 |
| `results/第一轮实验纪要.md` | 从实测数据生成的中文报告 |
| `results/figures/` | 答辩用PNG/PDF图 |
| `results/encoded/` | 实际JPEG文件 |
| `data/manifest.csv` | 输入来源 |

## 答辩时必须说清楚

- DCT本身不丢信息，量化才是主要有损步骤，熵编码无损。
- 压缩比基准为原始灰度像素字节数，不是输入PNG文件大小。
- 实际文件大小包含表、标记、填充；极小图可能不压反涨。
- Q不是“画质百分比”；Q=100不保证逐像素无损。
- 图像内容影响压缩表现；PSNR不等价于人类观感。
- 本轮是一张自然照片加三张合成图的可行性验证，不可夸大为普遍结论。
- 组员分工、姓名及成绩权重待你们实际协商后填写，程序不虚构这些信息。

## 参考依据与来源

1. ITU-T Recommendation T.81 (1992), *Digital compression and coding of continuous-tone still images — Requirements and guidelines*，重点为基线编码和附录K示例表：<https://www.w3.org/Graphics/JPEG/itu-t81.pdf>。
2. G. K. Wallace, *The JPEG Still Picture Compression Standard*, Communications of the ACM, 34(4), 1991, pp.30–44，DOI: 10.1145/103085.103089。
3. MathWorks, *Discrete Cosine Transform*，教学背景：<https://www.mathworks.com/help/images/discrete-cosine-transform.html>。本项目不依赖该页工具箱函数。
4. libjpeg-turbo, `src/jcparam.c`，核对常见IJG质量映射（整数除法）；只参考参数约定，不复制其实现：<https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/src/jcparam.c>。

`peppers.png`为本机MATLAB附带示例素材，并非本项目原创图像。衍生灰度裁剪仅用于本机教学实验；对外公开或提交前请核对素材许可，或替换为自己的照片。其余三张测试图由代码生成。JPEG常量是公开标准表，不应宣称为原创算法。
