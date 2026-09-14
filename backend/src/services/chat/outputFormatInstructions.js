/**
 * 对话"输出格式"指令 —— 让模型把回复组织成平台能预览、能下载的文件
 *
 * 背景：
 *   平台接入的模型全部走 OpenAI 兼容的 chat completions，只会返回文本，
 *   不会直接产出 .pptx / .docx / .pdf 二进制。前端画布（HtmlCanvasPanel）
 *   的做法是"模型输出带语言标识的围栏代码块 → 前端解析、渲染、转换成文件"。
 *   本文件负责其中"告诉模型该怎么写"的一半；解析的一半在
 *   frontend/src/utils/htmlBlockParser.js，两边的代码块语言标识必须一致：
 *
 *     html → 完整 HTML 文档（iframe 预览，下载 .html / 打印为 PDF）
 *     pdf  → 面向 A4 打印排版的完整 HTML 文档（iframe 预览，打印为 PDF）
 *     pptx → Marp 风格 Markdown，`---` 分页（幻灯片预览，pptxgenjs 生成 .pptx）
 *     docx → Markdown 全文（纸张预览，docx 库生成 .docx）
 *
 * 用法：
 *   前端在发送消息时带 output_format 字段，控制器用 normalizeOutputFormat
 *   做白名单归一化，MessageService.buildAIContext 把 buildOutputFormatInstruction
 *   的结果追加到系统提示词末尾。指令不落库，也不进入消息内容。
 *
 * 写指令时的几条经验：
 *   - "重新输出完整代码块"必须写死：画布按整块渲染，只给增量改动没法用。
 *   - 内部代码块要求用 ~~~ 围栏：外层 ``` 是 CommonMark 围栏，内部再出现
 *     行首 ``` 会提前闭合。前端解析器虽然按围栏长度配对，但模型不会主动用
 *     四个反引号，所以直接约定内部用 ~~~ 最稳。
 *   - 不主动用图片：模型产不出图，随手编的 URL 只会让导出失败。
 */

/** 允许的输出格式（也是前端画布识别的 kind） */
const OUTPUT_FORMATS = Object.freeze(['html', 'pptx', 'docx', 'pdf']);

/**
 * 把请求里的 output_format 归一化成白名单值
 * @param {*} value - 请求原始值
 * @returns {string|null} 合法格式，空/非法返回 null（表示普通对话）
 */
function normalizeOutputFormat(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return OUTPUT_FORMATS.includes(key) ? key : null;
}

const COMMON_TAIL = [
  '内容语言与用户提问的语言保持一致。',
  '用户要求修改或补充时，重新输出完整的代码块（包含全部内容），不要只输出改动的部分。'
];

const INSTRUCTIONS = {
  pptx: [
    '【输出格式要求：演示文稿（PPT）】',
    '用户希望得到一份可以直接下载的 PPT。请严格按下面的约定输出，平台会把它渲染成幻灯片并生成 .pptx 文件：',
    '1. 把整份演示文稿放在一个以 ```pptx 开头、以 ``` 结尾的代码块里（语言标识必须是 pptx）；代码块之外只写一两句简短说明。',
    '2. 代码块内用 Markdown 写幻灯片，用单独一行 --- 分隔每一页。',
    '3. 第一页是封面：一行 # 主标题，下面可选一行副标题文字。',
    '4. 之后每页：一行 # 页标题，然后是以 - 开头的要点（每页 3–6 条，每条尽量不超过 30 个字；用两个空格缩进表示子要点）。也可以写简短段落，或 GFM 表格（| 列 | 列 |）。',
    '5. 需要演讲备注时，在该页末尾用 HTML 注释写出：<!-- 这里是备注 -->。',
    '6. 不要使用图片，除非用户给出了图片 URL；代码块内部绝对不要再出现 ```（哪怕不带语言标识），否则整份 PPT 会从那里断开——需要展示代码时用 ~~~ 围栏，"暗处理 → 遮光 → 观察"这类箭头流程直接写成一行普通文字（会自动画成流程条），不要放进代码块。',
    '7. 页数按内容需要决定，一般 6–15 页。',
    '8. 版式会按内容自动排，请善用：同一页写 2–3 个 ## 小标题各带要点＝左右分栏（适合对比、优缺点）；一个 3–6 步的有序列表、每步一句短语＝流程图；3–6 条"- **名称**：一句说明"＝卡片网格（适合要素、概念）；3–6 条"- 1771年：事件"或"- 第一阶段：内容"＝时间线；2–4 条"- 90%：说明"这样以数字开头的条目＝数据亮点大数字；3–8 条以 emoji 开头的要点（如"- 🌱 目标一"）＝图标列表；整页只放一段 > 引文＝大字引言；标题为"目录"的列表页会排成编号目录。段落以"结论：""要点：""注意：""提示："开头会变成高亮提示框。一份课件里穿插使用 3–4 种版式，第二页放目录，最后一页放"谢谢"结束页，不要每页都是要点列表。',
    ...COMMON_TAIL
  ],
  docx: [
    '【输出格式要求：Word 文档】',
    '用户希望得到一份可以直接下载的 Word 文档。请严格按下面的约定输出，平台会把它渲染成文档并生成 .docx 文件：',
    '1. 把整份文档放在一个以 ```docx 开头、以 ``` 结尾的代码块里（语言标识必须是 docx）；代码块之外只写一两句简短说明。',
    '2. 代码块内用 Markdown 撰写完整文档：第一行用 # 写文档标题，正文用 ## / ### 分节；可以使用段落、有序/无序列表、GFM 表格、引用、加粗、斜体和超链接。',
    '3. 文档内需要展示代码时用 ~~~ 作为围栏，不要用 ```（哪怕不带语言标识，否则文档会从那里断开）。不要使用图片，除非用户给出了图片 URL。',
    '4. 内容要完整、可直接使用，不要写"此处省略"之类的占位。',
    ...COMMON_TAIL
  ],
  pdf: [
    '【输出格式要求：PDF 文档】',
    '用户希望得到一份可以打印或另存为 PDF 的文档。请严格按下面的约定输出，平台会在页面中渲染并提供"另存为 PDF"：',
    '1. 把完整的 HTML 文档放在一个以 ```pdf 开头、以 ``` 结尾的代码块里（语言标识必须是 pdf，内容是完整 HTML：包含 <!DOCTYPE html>、<html>、<head>、<body>）；代码块之外只写一两句简短说明。',
    '2. 面向 A4 纸张排版：在 <style> 中写 @page { size: A4; margin: 20mm }，设置 body 的字体与行距；用 page-break-before: always 控制分页；样式全部内联在文档里，不要引用外部 CSS、JS 或字体文件。',
    '3. 不要使用图片，除非用户给出了图片 URL；文档内如需展示代码，用 ~~~ 围栏，不要出现 ```。',
    ...COMMON_TAIL
  ],
  html: [
    '【输出格式要求：网页（HTML）】',
    '用户希望得到一个可以直接预览和下载的网页。请把完整的 HTML 文档（含 <!DOCTYPE html>、<html>、<head>、<body>，样式和脚本全部内联，不依赖外部资源）放在一个以 ```html 开头、以 ``` 结尾的代码块里；代码块之外只写一两句简短说明。',
    '文档内如需展示代码，用 ~~~ 围栏，不要出现 ```。',
    ...COMMON_TAIL
  ]
};

/**
 * 生成追加到系统提示词末尾的格式指令
 * @param {string|null} format - normalizeOutputFormat 的返回值
 * @returns {string} 指令文本；format 非法时返回空串
 */
function buildOutputFormatInstruction(format) {
  const lines = INSTRUCTIONS[format];
  return lines ? lines.join('\n') : '';
}

module.exports = {
  OUTPUT_FORMATS,
  normalizeOutputFormat,
  buildOutputFormatInstruction
};
