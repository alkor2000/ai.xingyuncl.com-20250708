# 幻灯片模板背景图

把图片放进本目录，**按文件名自动挂到对应模板**（改完要重新构建/发布）：

| 文件名 | 用途 |
|---|---|
| `<主题key>-cover.jpg` | 封面背景（16:9，建议 1920×1080，JPG 质量 80 左右，≤ 400KB） |
| `<主题key>-content.jpg` | 内容页背景（可选；要很淡，正文区会再盖一层 90% 不透明的底色保证可读） |

主题 key：`classic` 经典蓝 · `business` 商务藏青 · `tech` 科技渐变 · `minimal` 极简 · `academic` 学术宋体 ·
`education` 教育活泼 · `ink` 墨蓝夜色 · `split` 分割橙 · `dark` 深色 · `warm` 暖橙 · `nature` 自然绿

没有图的模板用程序生成的抽象背景（`utils/canvas/slideArt.js`），不会报错。
封面文字在图片**中央偏左**，请让画面主体靠右、中央区域干净；图片里不要带任何文字。

## 生图提示词（可直接用平台"图像生成"模块，尺寸选 16:9）

通用后缀（每条都加）：`16:9, no text, no letters, no watermark, clean center area for title, high quality, 4k`

- **classic 经典蓝**：`abstract corporate background, deep navy blue with soft diagonal light bands, subtle geometric lines, minimalist, calm`
- **business 商务藏青**：`elegant dark navy background with thin gold circular arcs and fine lines, premium business presentation, subtle depth`
- **tech 科技渐变**：`abstract technology background, purple to cyan gradient, glowing soft bokeh orbs, flowing light curves, futuristic`
- **minimal 极简**：`minimal white background with a single thin black line and soft gray paper texture, lots of negative space, japanese design`
- **academic 学术宋体**：`cream paper background with faint classical ornament border, ivory and burgundy, scholarly, vintage book texture`
- **education 教育活泼**：`playful teal and yellow background, rounded shapes, soft dots pattern, friendly classroom feel, flat illustration style`
- **ink 墨蓝夜色**：`dark blue night sky abstract, glowing cyan and violet nebula, subtle stars, cinematic`
- **split 分割橙**：`warm orange to amber gradient with bold flat geometric blocks on the left side, right side plain white`
- **dark 深色**：`dark charcoal abstract background with faint light blue rings, subtle grain`
- **warm 暖橙**：`warm orange sunset gradient with soft diagonal light rays, cozy`
- **nature 自然绿**：`soft green abstract background, blurred leaves and light spots, fresh, spring`

内容页背景（`-content.jpg`）建议只要"很淡的纹理/光斑"：`very subtle light texture, almost white, faint <主题色> glow in one corner, extremely low contrast`。

## 版权说明

- 程序生成的背景不涉及版权。
- 自己用平台生图得到的图片可直接使用；从网上取图请只用 CC0 / Unsplash / Pexels 许可的图片，并在本文件下面记录来源。

## 来源记录

（文件名 — 来源 / 许可）
