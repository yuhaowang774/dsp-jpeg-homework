# 连续教学片改造台账

## 核对矩阵

| 信源 | 断言 | 结果 |
|---|---|---|
| `web/index.html` | 默认连续教学片，单一时间轴驱动；六章字幕、章节跳转、暂停、倍速、重播本章、自由探索切换 | 通过 |
| `web/index.html` | 原 14 步实验台在自由探索模式完整保留；`?explore=1` 可直接打开 | 通过 |
| `tests/web/test_ui_smoke.js` | 步骤按钮、播放/进度、全部工具按钮不回归 | 通过：9 passed |
| `tests/web/test_codec.js` | 编解码核心不回归 | 通过：13 passed |
| `tests/web/visual_check.py` | 真实 Chrome 渲染、控制台无错误、16 节点截图 | 通过：29 screenshots，errors=[] |
| `README.md` | 说明编码优先 16 节点流程、QF/q(u,v) 符号 | 通过 |
| `web/index.html` 视觉原理节点 | 位于流程最前，含亮度/色度敏感性与低频/高频敏感性两条 HVS 依据及对应设计后果 | 通过 |
| `web/index.html` 视觉原理可视化 | Y/Cb/Cr 分量 + 量化表热力图，量化表左上低频步长小、右下高频步长大 | 通过 |
| 口径审查 | “唯一有损”、Q 二义、Huffman 自适应误导清零 | 通过 |
| `web/index.html` ANIM 配置 | 13 个流程的触发条件、时长、缓动、过渡方式统一登记且被动画函数使用 | 通过 |
| `tests/web/visual_check.py` 移动端/减少动态效果 | 390×844 与 `prefers-reduced-motion` 截图通过，控制台无错误 | 通过 |
| `README.md` 动画说明 | 统一配置、性能策略、响应式与减少动态效果说明同步 | 通过 |

## 问题台账

1. 原页面默认是无引导的 14 步实验台，缺连续教学主线。已改为默认连续教学片。
2. 原页面多定时器并存，直接自动连播会冲突。已改为独立 `requestAnimationFrame` 时间轴，教学片期间暂停底层实验台播放与快捷键。
3. “量化：唯一的有损步骤”与色度下采样矛盾。已改为“系数域中的有损步骤”，并注明下采样也损失色度分辨率。
4. 质量因子 Q 与量化步长 Q(u,v) 二义。已统一为 QF 与 q(u,v)，同步更新页面、README、视觉回归脚本。
5. Huffman 文案像按当前图片自适应。已改为固定 T.81 附录 K 表，换图不重新生成码表。
6. Zigzag 的 EOB 文案不严谨。已改为“剩余全为零用 EOB，长零串拆成 ZRL”。
7. DCT 步骤提前显示量化后非零。已改为 DCT 系数非零。
8. 块效应只按 Q 绝对判定。已改为“低 QF 通常更明显”等谨慎表述。
9. 视觉回归原脚本会被教学片遮罩挡住。已改用 `?explore=1`，并新增教学片截图。
10. 用户纠正：不要嵌入独立视频画布，需要“视频里面的源界面”。已删除全屏 `guidedOverlay`/`guidedCanvas` 与全部自绘画布函数，改为页面内讲解控制条 + 时间轴直接驱动原 14 步界面与原步骤动画。
11. 用户纠正：设置选项需单独收纳，演示界面需全屏显示。已将示例图、上传、QF、采样、分量移入右侧设置抽屉；顶栏只保留标题、教学片入口和设置按钮；讲解控制条、步骤导航、播放条改为固定浮层，主区域撑满可视窗口。

## 已知限制

- 教学片不包含音频；讲解内容以字幕呈现，便于离线答辩和暂停讲解。
- 教学片主画面就是原实验台界面；时间轴按章节切换质量因子、采样格式和步骤，并触发该步骤原有动画。
- 教学片为科普主线，参数预设为固定序列；自由探索模式保留全部交互。

## 动画系统统一整改

新增矩阵断言：每个流程动画必须登记触发条件、持续时长、缓动曲线和过渡方式；交互反馈、状态切换、页面切换需共享统一节奏；桌面端与移动端均流畅；后台与减少动态效果场景需降耗。

12. 原动画分散在 10 个 `setInterval`、2 条 rAF 和散落 `setTimeout` 中，周期 14–280ms 不一致。已建立 `ANIM` 配置表，统一登记 13 个流程的 trigger/duration/easing/transition，并由 `ANIM.interval/progress/duration` 驱动。
13. 原自动播放延迟散落在 `setStep` 的 8 个分支。已集中为 `AUTO_DELAY`，并纳入统一清理。
14. 原 `stopVisualAnimations()` 不清理 `scheduleAuto`、基函数清理定时器和重建防抖。已统一清理；进入教学片时额外递增 `stepToken` 作废旧回调。
15. 教学字幕每帧重写 `innerHTML`，教学控制条每帧写 DOM。已改为脏检查 + 100ms 限频；场景切换立即刷新。
16. 块巡览每帧重写 `stage.innerHTML`。已改为只重绘源图高亮层。
17. 位流写入、熵解码、MCU 拼接每 tick 重写 DOM/canvas。已改为状态值变化时才更新，并建立最小帧间隔。
18. 页面隐藏时动画继续运行。已增加 `visibilitychange` 暂停教学时间轴和原步骤动画。
19. 移动端与低性能设备按桌面节奏运行。已降低 DPR 上限并按屏幕/CPU 档位缩放动画时长与最小间隔。
20. 系统“减少动态效果”未被尊重。已增加 `prefers-reduced-motion` CSS 降级和 JS 时长压缩。
21. 教学模式下原播放条和设置项可抢占状态。已隐藏原播放条，并使设置项在教学播放期间只读。
22. 移动端步骤条被原播放条遮挡、教学模式底部留白过大。已将移动端步骤条与播放条分层定位，并在教学模式隐藏原播放条让演示区延伸到底部。
23. 回归截图原来只覆盖桌面端。已新增移动端探索、移动端教学、减少动态效果三张截图，真实 Chrome 回归达到 30 张且控制台无错误。
24. 第一章原来只陈述未压缩大小，没有编码结果与对比。已在原第一步界面加入大小对比卡（原始 RGB、熵编码段、少存比例、压缩比），字幕改为“未压缩大小 → 编码结果 → 对比”三段式，数字实时取自当前编码结果。
25. 用户指出顶栏红框中的标题与副标题不需要。已删除 `brand` DOM 与相关 CSS，顶栏只保留教学片入口和设置按钮，并改为右对齐。
26. 原三张内置实拍照片来源不明。已使用用户提供的 `_DSC4402.JPG`（6000×4000，MPO 首帧）居中裁剪并缩放为 256×256，替换 `web/photos.js`；原三张照片全部删除。样例数从 7 降为 5，初始 `state.imageName` 同步更新，UI、编解码与视觉回归断言同步更新。
27. 用户要求试 2000×3000。已用自编 JPEG 引擎离线实测：居中裁剪为 2:3 后缩放，QF=50、4:2:0，原始 RGB 18,000,000 B、熵编码段 464,361 B、压缩比 38.76:1、PSNR 34.37 dB、141000 块；编码 11.7 s、解码 21.4 s、合计 33.0 s，堆内存约 493 MB。位流完整消费。结论：算法可正确运行，但不适合当前需要实时重建的交互网页，未 adopt 到前端默认演示。
28. 用户追问 640×480。离线实测：居中裁剪为 4:3 后缩放，QF=50、4:2:0，原始 RGB 921,600 B、熵编码段 29,746 B、压缩比 30.98:1、PSNR 30.83 dB、7200 块；编码 0.52 s、解码 0.88 s、合计 1.40 s，堆内存约 40 MB。结论：算法正确且单次可接受，但每次 Q/采样切换仍会卡顿；如采用需预计算缓存，不直接用当前实时重建路径。
29. 用户指定新六章顺序并要求编解码讲解权重相同。已重排为输入解码、解码原理、为什么二次编码、编码准备、DCT量化、码流与结果；六章各 35 秒，总时长 210 秒。大小对比卡限定在第三章显示，质量因子/采样预设按新章节映射，视觉回归截图覆盖输入/解码/对比/结果四章。
30. 用户要求前端演示使用 640×480。已将 `photos.js` 换为本人照片 4:3 中心裁剪后的 640×480 RGB 数据；`demo_data.js` 的 256 样例在前端统一放大到 640×480；上传图片改为 4:3 中心裁剪至 640×480；状态尺寸、字幕和文档同步。为避免 640×480 每次约 1.4 s 的重算卡顿，新增按 imageId/QF/采样/分辨率键控、上限 8 条的编码结果缓存。MATLAB 批量实验仍保持 256×256，口径分离。
31. 六章教学片展开为 16 个教学流节点（解码链 4 节点、为什么压缩 1 节点、编码链 11 节点），左侧说明按章节覆盖标题，步骤条与进度条使用流节点索引；test_ui_smoke 与 visual_check 同步为 16 节点，第 6 节点验证“为什么二次编码”对比卡。
32. 用户指出 640×480 图像仍显示为正方形。原因是整图画布沿用 256 时代的正方形尺寸，`drawRGBInto` 将 4:3 图像拉伸到 1:1。已将源图、颜色分量、色度采样、最终原图/重建图/误差图等整图画布改为 4:3；8×8 系数与块画布保持正方形。visual_check 新增 `sourceCanvas` 宽高比断言。
33. 用户指出在编码流程之前应先讲人眼视觉特性（对亮度敏感、对色度不敏感；对低频敏感、对高频不敏感），这是 JPEG 能压缩的根本依据。已新增“视觉原理”节点置于流程最前，章节序号整体后移一位（01–07）；节点展示当前图像 Y/Cb/Cr 分量与量化表热力图，说明色度下采样与高频步长设计的来源。用户原文“对高频敏感，对低频敏感”按 CSF 正确口径写为“对低频敏感、对高频不敏感”。state.step 初始值同步改为 14，test_ui_smoke 与 visual_check 的 16 节点索引、标题、截图数量（29 张）全部同步，三套回归通过。
34. 用户指出视觉原理章“亮度与色度、空间频率体现得不够直接简单易懂”。已把静态的 Y/Cb/Cr 三分量 + 量化表热力图改为两组对比实验：① 原图 / 色度 2×2 平均降到 1/4 / 亮度 2×2 平均降到 1/4，默认 4:2:0 式下采样后双线性插值回全尺寸；② 灰度图按 8×8 DCT + Zigzag 前 10 个系数做低通/高通，高通图加 128 提亮以显示细纹理。六张图下方直接标注“几乎看不出 / 立刻就糊了”“还能认出轮廓 / 只剩纹理认不出”。左栏改为问答式大白话，公式改为结论对照。新增 halfScale/frequencyFiltered/buildVisualData 并按 imageId+尺寸缓存；画布 id 改为 hvsOriginal/hvsLowChroma/hvsLowLuma/hvsGray/hvsOnlyLow/hvsOnlyHigh，测试断言同步，README 同步。三套回归通过。
35. 用户反馈“亮度降到 1/4 立刻就糊了没感受出差距”。根因是两处缩放掩盖了下采样损失：原图 1024×1024 画到 320×240 时浏览器插值先抹平细节；双线性上采样又把 2×2 平均的块效应平滑掉。已改为：① 用 chooseDetailRegion 在 5×5 候选网格上按亮度方差自动挑 160×120 纹理最丰富区域，1:1 裁出后放大 2 倍显示；② halfScale 增加 factor 与 nearest 参数，色度用 4×4 平均 + 平滑插值（砍到 1/16 仍几乎看不出），亮度用 2×2 平均 + 最近邻（故意暴露像素块）；③ 文案从“立刻糊掉”改为“出现明显像素块”，左栏说明两种插值的差异，避免误导。drawRGBRegionInto 增加 originX/originY 参数。三套回归通过。
36. 用户要求把视觉原理拆成两张（第一张亮度色度、第二张低频高频），并撤销“色度砍 1/16、亮度砍 1/4”的不对等手法，允许多放几页。已拆成 3 个视觉节点（终态，与并行改动一致）：14 visualLuma（原图 + Y/Cb/Cr 三分量，说明亮度带轮廓、色度平缓）、15 visualLumaCompare（公平对比：色度与亮度都 2×2 降到 1/4、都最近邻放大，自动挑纹理区，色度几乎看不出、亮度马赛克明显）、16 visualFreq（低通/高通三图）；量化表热力图保留在原有“DCT 与量化”章，不单列视觉页。章节从 7 章变 8 章（01 亮度与色度、02 低频与高频、03–08 原有），流程从 16 节点变 18 节点，state.step 初始仍为 14。buildVisualData 改为色度也用 2×2 + 最近邻，并把 planes 存入缓存供第 14 节点使用。renderVisualStep 拆为三个渲染函数 renderVisualLumaStep/renderVisualLumaCompareStep/renderVisualFreqStep，画布 id 分别为 hvsLumaOrig/hvsLumaY/hvsLumaCb/hvsLumaCr、hvsOriginal/hvsLowChroma/hvsLowLuma、hvsGray/hvsOnlyLow/hvsOnlyHigh。test_ui_smoke 硬编码索引整体 +3、模板数与 expectedIds 同步；visual_check 标题/索引/截图数（31 张）同步；README 同步。三套回归通过。
37. 用户要求按科普视频的讲法改 DCT 章（二维 DCT = 两次一维 DCT），参考两张截图：一行像素→系数柱→8 个余弦波加权求和、8×8 系数矩阵→64 张基图像。已把 DCT 节点拆成三个视图：`oneD`（默认进入时按方差自动挑一行；1040×296 画布画 8 个像素柱+折线→箭头→有符号系数柱；1040×336 画布左为“逐项叠加 vs 原行 + 残差”，右为 2×4 个 `X(k)·C_k` 小图，波形高度按 `|X|^0.5` 压缩、底部细条为真实权重占比）、`coeff` 基图像视图（320×320 系数矩阵 + 700×700 的 64 张基图像画廊，点矩阵或画廊任一格互相高亮，`globalAlpha` 下限 0.32 保证弱系数基图像仍可辨认）、`twopass` 行列两遍（保留原三张矩阵，新增 760×200 桥接条显示当前行/列的像素或中间系数 → 一维 DCT 结果）。`startBasis` 改为驱动一维余弦叠加（`dctRowBasis`），`drawDctMain`/`drawBasisInset` 由 `drawCoefficientMatrix`/`drawBasisGallery` 取代；新增 `dctRow` 状态（-1 表示按方差自动选行）、`oneD` 工具按钮与 `.dct-2d`/`.dct-row-picker` 样式。test_ui_smoke 新增“一维分解视图”断言（11 passed），visual_check 增拍 `17_dct_1d.png`（32 张），README 与快捷键说明同步。真实 Chromium（Playwright 自带，非 `channel=chrome`）全 18 节点 + 全部工具按钮巡检：无 console/pageerror，标题全对。
38. 用户要求第 ③ 步“源图像与 8×8 分块”的默认选区改成方便后续演示的区域。原 `chooseDefaultBlock` 是纯 `variance × (1−|mean−128|/255)`，在风景图上落到前景灌木噪声块（QF=50 量化后基本整片归零，后面几步没内容可讲）。改为结构优先：步长 2 个块、四周留 2 块边距，先算 8×8 luma 块（新增 `blockLumaValues`）和二维 DCT（新增 `blockDct`，复用 `rowDct`），要求交流能量 ≥ 400（否则视为平面）、`u+v ≤ 4` 的低中频能量占比 ≥ 0.55（抑制噪声/纯高频），再按 `√低中频能量 × 相干度^1.5 × 曝光(1−|mean−128|/168) × (1−0.45·中心距离)` 打分，全部不达标时回退到方差最大块。实测：风景 1024 默认块 (64,60)、640 版 (58,42) 落在山脊与天空交界；辣椒 (54,82) 落在椒体与暗背景的强竖直边缘；文字 (62,64) 落在字母竖直边；渐变 (112,42)。同块在 QF=50 下 DCT 非零 20/64、量化置零 44/64（68.8%），量化/反量化/IDCT 三步都有可见变化。第 ③ 步原理与提示、README 默认块说明同步。
39. 用户要求网页里不使用辣椒图像。已把 `peppers_gray` 从 `web/demo_data.js` 的 `images` 中移除（顺带剔除 `metrics`/`reference` 里 image 为 peppers_gray 的行：120 → 90 行、24 → 18 行），`web/index.html` 的 `LABELS` 删除对应标签，样例按钮由 6 个变 5 个（风景 1024、风景 640、渐变、纹理、文字）。MATLAB 交叉验证没有丢：像素挪到 `tests/web/fixtures/peppers_gray.js`，`test_codec.js` 改为 `require` 该夹具后仍对照 36.5665 dB；`test_ui_smoke.js` 样例数与标题改为 5，`visual_check.py` 断言改 5、上传测试文件由 `data/peppers_gray.png` 换成 `data/synthetic_texture.png`。`src/export_demo.m` 的 `names` 去掉 peppers_gray、`metrics` 用 `~strcmp({metrics.image},'peppers_gray')` 过滤，避免重新导出时又把它加回来。`data/peppers_gray.png` 与 MATLAB 实验（`prepare_dataset.m`/`run_experiments.m`/报告）保持不变——只限制网页端。回归：13 + 11 测试通过；真实 Chromium 确认样例为 5 个、页面文本无“辣椒”、无 console/pageerror。
40. 用户要求第 ⑤ 步（RGB→YCbCr，截图里的“颜色空间”）的默认块要“色度差异大，同时对后面 DCT 也好演示”。原选块只按结构，风景图落在山脊/天空交界，Cb 只有 125–135、Cr 124–131，Cb/Cr 面板是一整片纯洋红/纯青。新增 `blockChromaSpread()`（块内 Cb/Cr 联合标准差，BT.601 与编解码器一致），评分乘上色度增益 `0.15 + 0.85·min(1, σ/12)`，曝光项放宽到 /240、中心距离权重改 0.4；再加两道筛选：均值 80–182（减 128 后两侧都有值）、σ ≥ 8（颜色确实在变），不满足时退回纯结构打分（灰度/单色样例走这条路）。离线试算 20 余组权重：该照片的有色区域集中在底部阴影里的暖色草丛（亮度 40–90），强推色度就会掉到很暗、DC 压倒 AC 的块，因此用亮度带把候选限制在 80–182。最终 1024 版落在 (82,86)：Y 19–131、Cb 81–128、Cr 130–158、DC −340；640 版落在 (14,50)：Cb 84–127。QF=50 置零 48/64，DCT·二维 低频 10 项能量 97.9%，颜色与 DCT 两边都有内容。test_codec 13 项全过。注意：期间另一个会话把流程重构成 22 个节点（DCT 拆成 移位/一维/二维/行列/重建），`test_ui_smoke` 仍按 18 节点写，6 项失败属于那次重构尚未同步测试，与本改动无关。
41. 用户给出科普视频 `QQ20261123-212238-HD.mp4`（4 分 01 秒，2550×1446，无字幕轨）要求按它改写“前面三张”（原理 01–03）。用 ffmpeg 每 4 秒抽 59 帧读图理解：① 亮度/颜色感知——同一张狗图分出“亮度感知（灰度）”与“颜色感知”，视网膜视杆细胞（明暗，多）与视锥细胞（颜色，少）分工，人眼对亮度变化非常敏感 → 压缩颜色信息；② 压缩颜色信息——RGB 三通道 → Y/Cb/Cr，色度缩减采样“每 4 小块合并成一大块（取 4 格平均）”，采样后与原图几乎无差别，即 JPEG 第一步；③ 低/高频信号感知——低频=大片平滑区域（天空、岩石表面）、高频=细密棋盘格，人眼不擅长高频 → 删掉一些高频 → 接 DCT（64 张基图）+ 量化（只剩 9 个非 0）+ 熵编码。据此改写三节点：01 改为“人眼先看亮度，再看颜色”（视杆/视锥说明，参数加“视杆 1.2 亿·视锥 600 万”，图注改为彩色原图/只留亮度/Cb/Cr）；02 改为“压缩颜色信息：4 个色度并成 1 个”（4:2:0 口径、放大区域由 160×120 改成 80×60 即 4 倍最近邻放大，方块才看得清）；03 改为“人眼对高频不敏感，所以敢删”，并新增 1040×190 的“中间那一行亮度曲线”（平缓蓝、跳变橙，阈值 18）作为频率直观图。同步更新 `test_ui_smoke` 首节点标题断言与 `visual_check.py` 的 expected_titles 前三项、README 原理段。test_codec 13 项通过；test_ui_smoke 仍是 5 passed / 6 failed（22 节点重构遗留，与本次无关）；真实 Chromium 截图核对三页无 console 错误。
42. 用户追加要求“前三张彻底重构，不要沿用之前的方法，用视频的讲解方法但图片还是用自己的”。放弃了上一轮的文字微调，把三个 renderer 全量重写（保留原 canvas id 让旧断言仍可命中）：① `renderVisualLumaStep` 改为视频式编号分支——`hvsLumaOrig`（你那张风景图）/ `hvsLumaY`（只留亮度=灰度）/ `hvsLumaColor`（Y 填 128、只留 Cb/Cr 的色块），下方 150×110 的 Cb/Cr 小图 + 420×110 的 `hvsEye`（视杆群 vs 红绿蓝视锥，字幕写视频里的 1.25 亿 / 600 万），再加亮度/饱和度滑块（直接改 `hvsLumaOrig.style.filter`）与复位按钮，页尾 hvs-conclusion 收成“压缩颜色信息”。② `renderVisualLumaCompareStep` 保留 80×60 区域 4 倍放大三图，新增 `hvsMerge`（760×190）把 `data.planes.cb/cr` 里那块真实 2×2 的四个值画成“4 格 → 取平均 → 1 格”，Cb 129/130…、Cr 129/130… 都来自用户图；色度格标「有损」，页尾小结「①色彩空间转换 → ②色度缩减采样」。③ `renderVisualFreqStep` 先画 220×220 粗棋盘（cell=44）与细棋盘（cell=4，远看成灰）设问，再放你的照片“删高频 vs 只留高频”正反图、保留中间行亮度曲线，页尾落到量化。三页 lead 全改问句，视杆数字从 1.2 亿修正为 1.25 亿（与视频字幕一致）。新增 CSS `.hvs-subgrid/.hvs-sliders/.hvs-conclusion` 及窄屏折行。test_codec 13 passed；test_ui_smoke 仍 5/11（22 节点重构遗留）；真实 Chromium 三页截图 + 滑块 input/reset 验证通过、无 console 错误。
43. 用户看了 01 页截图后要求把两组图全删：① Cb/Cr 小图 + 视杆/视锥细胞示意图；② “只留亮度 Y / 只留色度 Cb-Cr”两张分支图。已按确认的范围清理 `renderVisualLumaStep`：只留 `hvsLumaOrig`（放大到 520×360）+ 亮度/饱和度滑块 + 复位 + hvs-conclusion；删掉 `hvsLumaY/hvsLumaColor/hvsLumaCb/hvsLumaCr/hvsEye` 的 DOM 与 draw 调用，删掉无用的 `drawEyeCells()` 与 `.hvs-subgrid` CSS（含窄屏规则）。左栏 lead 改成“哪个滑块一动你立刻发现？”，principle 第二句改为引导拖滑块，tips 同步；视杆/视锥数字保留在文字里。`test_ui_smoke` 的 expectedIds[原理01] 从 4 个 canvas 改为 1 个。真实 Chromium 确认 01 页只剩 1 个 canvas、滑块 brightness(0.7) 与复位正常、无 console 错误。用户明确要求保留 1 fps 抽帧（`%TEMP%\dsp_video_1fps\`，237 张）——不要清理该目录。
44. 用户又要求 01 页改回视频里的三图分支（“哪两张看起来区别更大？” → 标「亮度感知/颜色感知」，一张图分两支），但不要 Cb/Cr 小图与视杆视锥示意图。已把 `renderVisualLumaStep` 改成三图布局：左 `hvsLumaOrig`（320×220，你的原图）、中间 `.hvs-branch-arrows` 两行标「→亮度感知（绿）/ →颜色感知（橙）」、`hvs-branch-targets` 上下两张 `hvsLumaY`（320×150 灰度）与 `hvsLumaColor`（320×150，Y 填 128 的色块）；恢复 `neutralY + Codec.ycbcrToRgb` 计算；保留亮度/饱和度滑块与 hvs-conclusion。新增 CSS `.hvs-branch/.hvs-branch-targets/.hvs-branch-arrows`（含窄屏折行）；lead/principle 改回视频式设问与分支说明。`test_ui_smoke` expectedIds 首节点改回 3 个 canvas（Orig/Y/Color，不含已删的 Cb/Cr/Eye）。真实 Chromium 确认三图与标签都在、滑块 brightness(0.75) 与复位正常、无 console 错误。1 fps 抽帧目录仍未动。
45. 用户指出三图分支中的②③两张图“一个是调节亮度、一个是调节饱和度”。已把两个滑块分别绑到各自的图：`hvsBright` → `hvsLumaY.style.filter=brightness(...)`，`hvsSat` → `hvsLumaColor.style.filter=saturate(...)`，原图 `hvsLumaOrig` 不再受滑块影响；复位把两张图都设回 1。图注改为“②只留亮度 Y（调下面调节亮度）/③只留色度 Cb/Cr（调下面调节饱和度）”，提示写成“左滑块调②亮度，右滑块调③饱和度”。真实 Chromium 核对：brightness(0.7) 只落在 Y 图、saturate(0.2) 只落在色度图、复位回 1、无 console 错误。1 fps 抽帧仍未动。
46. 用户要求把②③两张结果图放到原图下面的第二排（原来是“左原图 + 右上下两支”）。已改为两排：第一排 `.hvs-source-row`（flex 居中）放 520×340 的原图，第二排 `.grid-2` 并排 400×260 的②灰度图与③色度图；删掉 `.hvs-branch/.hvs-branch-targets/.hvs-branch-arrows` 三条 CSS 与窄屏规则，新增 `.hvs-source-row`；图注改成“②调节亮度后的结果：只留亮度 Y / ③调节饱和度后的结果：只留色度 Cb/Cr”，lead 改成“上面是原图，下面是调节亮度、调节饱和度后的两张结果”。真实 Chromium 量了坐标：原图 y=75 居中、两张结果同在 y=448；滑块仍只作用于各自图片。1 fps 抽帧仍未动。
47. 用户说明第二排两张图“一个是调节亮度、一个是调节饱和度的结果，这两张照片的亮度和色度都要”——即两张结果图都要同时保留亮度和颜色，不再是“只留 Y 的灰度图 / 只留色度的色块图”。已改：两张 canvas 都画 `data.original`（全彩），靠 CSS filter 区分——② `brightness(70%)` 变暗但保留颜色、③ `saturate(40%)` 掉色但保留明暗；滑块初值改为亮度 70、饱和度 40，渲染时先调一次 `applyFilter()` 让结果与滑块一致；复位回 100/100。删掉不再使用的 `neutralY/colorOnly` 计算，图注改为“②调节亮度的结果：变暗了，颜色还在 / ③调节饱和度的结果：颜色淡了，明暗还在”，principle/tips 同步成“两张都保留亮度和颜色，只改了一个通道”。真实 Chromium 核对坐标与 filter：原图无 filter，②brightness(0.7)、③saturate(0.4)，拖动后为 1.2/1.6，无 console 错误。1 fps 抽帧仍未动。
48. 用户要求把“亮度一动就发现、饱和度几乎没感觉”变成可对照的数值。两个滑块后各加一个 `<output>` 实时显示「当前百分比（相对原图的改动量）」，如 `70%（−30%）`、`40%（−60%）`；新增「两边都 −30%」按钮一键把两个滑块设为同幅改动，便于现场做等幅对比；下方 note 动态拼接成“两边都 −30%：亮度一眼看出，饱和度几乎没感觉”或“亮度 +30%（一眼看出）｜饱和度 −30%（几乎没感觉）”。`hvsReset` 复位到 100/100 并刷新读数。新增 `.hvs-sliders output` 样式（Consolas 11.5px 加粗）。真实 Chromium 核对：初始 70%（−30%）/40%（−60%）、点“两边都 −30%”后两个读数都是 −30%、拖动亮度到 130 读数变 +30% 且 compare 文案切换，无 console 错误。1 fps 抽帧仍未动。
49. 用户反馈“两边都 −1%：亮度一眼看出，饱和度几乎没感觉”这类自动提示不要（小改动时明显不成立）。已删除 `#hvsCompare` 这个 span 与 JS 里对应的 compare 逻辑，滑块旁只保留「70%（−30%）」这类纯数值；「两边都 −30%」与「复位」按钮保留。左栏观察要点把“调节亮度一动就发现…”换成中性的“拖动滑块，记录两个通道各自的改动百分比”。真实 Chromium 确认 `.hvs-sliders .note` 数量为 0、拖动后数值仍实时更新（99%（−1%））、无 console 错误。1 fps 抽帧未动。
50. 用户又要求把 ②③ 两张结果图的图注（“② 调节亮度的结果：变暗了，颜色还在 / ③ 调节饱和度的结果：颜色淡了，明暗还在”及“亮度 + 颜色都有”徽标）也删掉。已把两个 figure 的 caption 置空，只留①原图图注；页面靠滑块文字与位置区分，不再写结论。真实 Chromium 截图确认 figcaption 只剩①、两张结果图无文字、无 console 错误。1 fps 抽帧仍未动。
51. 用户提出“盲盒”玩法：拖动时不显示变化程度，用户自己觉得明显了再点按钮揭示实际改了多少。已把两个滑块改成盲盒测阈值：初始都在中点（100%），`<output>` 显示 `?`（`.hvs-blind` 灰色）；拖动时只更新 `brightness()/saturate()` 滤镜、数值重新变回 `?`、按钮文案回到「我看出变化了」；点按钮才显示 `−12%` 这类差值、按钮变「已记录」；「重新开始」把两个滑块复位到 100、数值变回 `?`。删掉原来的「两边都 −30%」按钮与实时百分比（与盲盒冲突）。左栏 principle 改成“先别管数值，凭感觉拖到明显变了再点按钮”，tips 同步；README 同步。真实 Chromium 走完整流程：初始 `?/?`、拖到 88/55 仍 `?/?`、点按钮显示 `−12%/−45%`、复位回 `?/?` 且滤镜归 1，无 console 错误。
52. 用户说抽帧不需要了，已删除 `%TEMP%\dsp_video_1fps\`（237 张），第 43 条“不要清理该目录”的限制自此作废；视频分析与台账记录仍保留，源视频在 `C:\Users\Administrator\Downloads\QQ20261123-212238-HD.mp4` 未动。

## 2026-11-27 外部复审版回灌

53. 用户要求把外部 AI 复审产物（`…\Documents\xwechat_files\…\2026-11\.playwright-cli`）完整回灌到桌面工程，以复审版为唯一权威源、冲突一律取复审版。已整树镜像：223 文件双向 MD5 校验 0 差异。改动 10 个文件（`web/app.js`、`web/index.html`、`web/color_reference.js`、`web/matlab_results.js`、`README.md`、`run_project.m`、`src/jpeg_encode_color.m`、`src/plot_experiments.m`、`src/run_color_experiment.m`、`src/write_experiment_report.m`），新增 `tests/web/visual_check.js` 与 `.gitignore`，删除 `tests/web/visual_check.py`、`__pycache__`、`web/assets` 两张无引用的 T.81 表图、`results/web_screenshots` 旧命名 55 张（换为新命名 45 张）。前端回归 `test_codec` 14/14、`test_color_reference` 8/8、`test_ui_smoke` 19/19 全通过。
54. 复审版对页面的实质修复（以代码为准）：DCT 子页跳转 `dct:2→dct:3`、`dct:5→dct:6`（原值与 `DCT_VIEWS` 不符）；IDCT 动画进度 `×2→×64`；`qfReturn` 记录顺序挪到 `applyQuantQuality` 之后；切页与缩放补 `stopQfSweep(true)`；巡览块可还原（新增 `tourOrigin`/`restoreTourOrigin`）；`fitStageToViewport` 等 T.81 表图解码完再量；Huffman 首字节灰底覆盖整段而非只盖第一段；`ExactCoefficientRoundtrip` 写回表格（CSV 该列由 `NaN` 变 `1`）；`jpeg_encode_color.m` 增加 DC 类别 ≤11 断言；`plot_experiments.m` 增 `chinese_font()` 跨平台回退并复用已解码 Q50；`run_project.m` 先删旧日志、版本断言降级为 warning。同时清掉了从未被调用的 `drawRowWave`/`entropyOf`/`countZero`/`symbolTable`/`halfScale`/`frequencyFiltered`/`drawCheckerInto`/`drawRowLumaCurve`、`buildVisualData` 里白算的 `onlyLow/onlyHigh`，以及永不生效的 `FLOW_OVERRIDES.result`。
55. 口径变更（答辩前必须声明）：网页压缩比分母改为熵编码字节（含末尾补位，不含表/标记/FF00 填充），MATLAB 实测仍为完整文件字节，README 已写明两种口径。教学流仍是 29 节点（`FLOW_ENTRIES`，`test_ui_smoke` 有断言）；章内编号 07→08→09 的空号已修（原为 07→09→10）。引导模式（guided）在复审版中已不存在：`app.js`/`index.html` 对 `引导|guided|guide` 命中 0 次，其配套 `visual_check.py` 与 `*_guided_*.png` 截图一并退出。
56. 事故与恢复：同步时 `robocopy /MIR /XD` 的排除路径写了正斜杠未匹配成功，`大作业/.git` 与本文件被当成多余项一并清除。已从 GitHub 远程 `https://github.com/yuhaowang774/dsp-jpeg-homework`（`main`，HEAD `59c3940`）重新取回全部 14 条历史，本文件亦从该提交原样恢复，**原文未丢失**；本地临时重建的两个提交（`2229738`、`4ebcbc2`）作废，改为在 `59c3940` 之上提交一次同步记录，保证历史连续且无需强推。
57. R2024b 复现验证：本机 `D:\matlab\bin\matlab.exe`（`24.2.0.2712019`）执行 `matlab -batch run_project`，耗时 609.5 s（随包投递版本为 181.2 s，属机器性能差异）。`measurements.csv` 70 组逐格比对，除 `EncodeSeconds`/`DecodeSeconds` 两列外不一致单元格 0；`web/color_reference.js` 字段级仅 `generatedAt` 变化；`第一轮实验纪要.md` 仅“生成时间/本轮耗时”两行变化。复核完成后已还原为投递版本，本机重跑产物不入库。

58. 用户要求在 05.6「DCT 二维」页的系数矩阵**左边**补上原块图。已在 `renderDctBasisView()` 的 `.dct-2d-top` 里加一列 `figure('dctBlockOriginal', '原块 f(x,y)（已 −128）')`，新增 `drawDctBlockOriginal()`（画法与 05.5 行列分解页的 `passOriginal` 一致：`drawCells` + `grayColor(v+128)` + 像素读数，上限与矩阵共用 `dctMatrixCap()`，两块方形图同尺寸）；样式 `.dct-2d-top` 由 `repeat(2,auto)` 改 `repeat(2,minmax(0,1fr))` + `gap:12px`，`@media(max-width:900px)` 下改单列堆叠（否则 820px 时每块被压到约 170px、格内数字看不清）；`test_ui_smoke.js` 的 `expectedByDctView.coeff` 补上 `dctBlockOriginal`。验证：1600×900 真实 Chromium 下原块（340px）在左、矩阵在右，两块与下方贡献图、右侧 64 基图仍一屏装下、无滚动；820×900 下改为原块在上、矩阵在下；控制台 0 error 0 warning；`test_ui_smoke` 19/19、`test_codec` 14/14、`test_color_reference` 8/8 全过。

59. 用户要求 PPT `JPEG编解码流程实验台_演示_定型版.pptx` 第 39 页跟着改。该页只有 3 个形状：两层圆角矩形 + 一张 3780×1968 的整页截图（`#stage` 卡片区域）。复现方式：在本机 Chrome 里以 1920×1080 视口、`deviceScaleFactor=2` 打开 `web/index.html`，点步骤条「05.6」后暂停巡览、点选矩阵格 (row 1, col 0)，再对 `#stage` 元素截图 —— 得到与旧图**完全同尺寸同比例**（3780×1968，1.9207）的新图，读数同为「第 9 / 64 项：F(1,0) = 84」。用 python-pptx 原位替换第 39 页那张图片的 blob（不改几何：0.98,1.39cm，31.91×16.27cm），未删形状、未动版式；包内 433 个零件前后完全一致（无丢失，解压总量 59.33→59.37 MB，文件体积变小只是重新压缩所致）。复核：PowerPoint COM 导出第 39 页 PNG，新图正确嵌在圆角卡片内、无拉伸错位；幻灯片总数仍 117。

60. 用户报 PPT 第 112 页（解码 03 · IDCT）「后两张图重叠」。查明该页只有一张整页截图（`ppt/media/image175.png`，3276×1876，仅本页引用），重叠是图里烘焙进去的双重曝光：中、右两张画布各叠了一帧偏移约一格、放大 4% 的旧帧。复现路径：在 1920×1080 / `deviceScaleFactor=2` 下打开 IDCT 页并点「播放 IDCT 合成」，发现 `refreshIdct()` 重画误差热力图时**没传 `text` 回调**（与静态页 `renderIdctStep` 不一致），动画跑完第三张图的数字会全部消失——旧截图正是这种残状态叠两层。已修：`refreshIdct()` 补上 `text: value===0 ? '' : formatValue(value)`，与静态页同一套绘制参数。重出图：1920×1080（dpr 2）播放到「已叠加 64/64 个基函数，IDCT 完成。」后截 `#stage`（3780×1968），按原内容 bbox（x 43–3232、y 295–1581）等比缩放合成 3276×1876 白底图。回写走 zip 层：只替换 `ppt/media/image175.png`，并把 `slide112.xml` 里 `a:off` 的 `y` 由 -185630 改成 0，其余零件字节不变；复核 PowerPoint COM 导出第 112 页，三图为方形、无重叠、数字与图注完整，幻灯片总数仍 117。回归：`test_codec` 14/14、`test_color_reference` 8/8、`test_ui_smoke` 19/19。
