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
 *   的结果追加到系统提示词末尾，并把 buildOutputFormatReminder 的一行提醒
 *   追加到当前用户消息末尾。两者都只进模型上下文，不落库。
 *
 * 写指令时的几条经验：
 *   - 先讲平台会把代码块直接变成文件，再把回答结构写死（一句话 + 一个代码块，
 *     闭合即停）：不少模型的惯性是"Markdown 一份 + Python 生成脚本一份"，
 *     那份脚本占了大半输出 token；系统提示词 + 用户轮提醒 + 后端
 *     artifactStreamGuard 硬截断三层一起压制。
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

/**
 * 每种格式共用的"回答骨架"：先说清平台会把代码块直接变成文件，再把回答
 * 结构写死并要求代码块闭合后立即结束。不少模型的训练惯性是"Markdown 一份 +
 * Python 生成脚本一份"，那份脚本对用户毫无用处却占了大半输出 token；
 * 这段话配合 buildOutputFormatReminder（用户轮提醒）与 artifactStreamGuard
 * （后端硬截断）三层一起压制。
 * @param {string} lang - 围栏语言标识
 * @param {string} noun - 产物名称（幻灯片/文档/网页）
 * @param {string} deliver - 平台怎么交付（生成 .pptx 文件供用户下载 / 让用户另存为 PDF）
 * @param {string} inside - 代码块里放什么
 */
function answerSkeleton(lang, noun, deliver, inside) {
  return [
    `平台会把你回复里的 \`\`\`${lang} 代码块直接渲染成${noun}并${deliver}，用户不需要也不会使用任何其他工具。`,
    '回答固定为两部分，写完即结束：',
    '① 一句话说明（不超过 30 字）；',
    `② 一个以 \`\`\`${lang} 开头、以 \`\`\` 结尾的代码块（语言标识必须是 ${lang}），${inside}。`,
    '代码块闭合后立即停止回答。不要再提供"方式二"、Python 或其他语言的生成脚本、安装步骤、别的格式版本或任何其他代码块——平台不需要它们，只会浪费用户的等待时间。'
  ];
}

const INSTRUCTIONS = {
  pptx: [
    '【输出格式要求：演示文稿（PPT）】',
    ...answerSkeleton('pptx', '幻灯片', '生成 .pptx 文件供用户下载', '整份演示文稿都在里面'),
    '代码块内的写法：',
    '1. 用 Markdown 写幻灯片，用单独一行 --- 分隔每一页。第一页是封面：一行 # 主标题，下面可选一行副标题。',
    '2. 之后每页：一行 # 页标题，然后是以 - 开头的要点（每页 3–6 条，每条尽量不超过 30 个字；用两个空格缩进表示子要点）。也可以写简短段落或 GFM 表格。演讲备注写在该页末尾的 HTML 注释里：<!-- 这里是备注 -->。',
    '3. 代码块内部绝对不要再出现 ```（哪怕不带语言标识），否则整份 PPT 会从那里断开——需要展示代码时用 ~~~ 围栏；"暗处理 → 遮光 → 观察"这类箭头流程直接写成一行普通文字（会自动画成流程条）。',
    '4. 不要使用图片，除非用户给出了图片 URL。公式和化学方程式不要用 LaTeX（$$…$$），直接写成普通文字并用 Unicode 上下标，如：6CO₂ + 6H₂O →（光能、叶绿体）C₆H₁₂O₆ + 6O₂、E = mc²。',
    '5. 页数按内容需要决定，一般 6–15 页；第二页放目录，最后一页放"谢谢"结束页。版式会按内容自动排，一份课件里穿插使用 3–4 种：同一页写 2–3 个 ## 小标题各带要点＝左右分栏；一个 3–6 步的有序列表、每步一句短语＝流程图；3–6 条"- **名称**：一句说明"＝卡片网格；3–6 条"- 1771年：事件"＝时间线；2–4 条"- 90%：说明"＝数据亮点；3–8 条以 emoji 开头的要点＝图标列表；整页只放一段 > 引文＝大字引言；以"结论：""要点：""注意：""提示："开头的段落＝高亮提示框。',
    ...COMMON_TAIL
  ],
  docx: [
    '【输出格式要求：Word 文档】',
    ...answerSkeleton('docx', '文档', '生成 .docx 文件供用户下载', '整份文档都在里面'),
    '代码块内的写法：',
    '1. 用 Markdown 撰写完整文档：第一行用 # 写文档标题，正文用 ## / ### 分节；可以使用段落、有序/无序列表、GFM 表格、引用、加粗、斜体和超链接。',
    '2. 文档内需要展示代码时用 ~~~ 作为围栏，不要用 ```（哪怕不带语言标识，否则文档会从那里断开）。不要使用图片，除非用户给出了图片 URL。',
    '3. 内容要完整、可直接使用，不要写"此处省略"之类的占位。公式不要用 LaTeX（$$…$$），直接写成普通文字并用 Unicode 上下标（如 H₂O、x²）。',
    '4. 如果用户要的是通知、函、请示、报告等公文：第一行用 # 写公文标题；下一段单独写主送机关并以中文冒号结尾（如"各年级组、各处室："）；正文分段，层级标题按"一、""（一）""1."的公文习惯写在段首；如有附件，用单独一段以"附件："开头列出；结尾另起两段分别写发文单位和成文日期（如"二〇二六年九月十五日"）。平台会据此把内容套进学校自己的公文模板。',
    ...COMMON_TAIL
  ],
  pdf: [
    '【输出格式要求：PDF 文档】',
    ...answerSkeleton('pdf', '可打印的页面', '让用户直接另存为 PDF', '内容是完整的 HTML 文档：包含 <!DOCTYPE html>、<html>、<head>、<body>'),
    '代码块内的写法：',
    '1. 面向 A4 纸张排版：在 <style> 中写 @page { size: A4; margin: 20mm }，设置 body 的字体与行距；用 page-break-before: always 控制分页；样式全部内联在文档里，不要引用外部 CSS、JS 或字体文件。',
    '2. 不要使用图片，除非用户给出了图片 URL；文档内如需展示代码，用 ~~~ 围栏，不要出现 ```。',
    ...COMMON_TAIL
  ],
  html: [
    '【输出格式要求：网页（HTML）】',
    ...answerSkeleton('html', '网页', '生成 .html 文件供用户下载', '内容是完整的 HTML 文档：包含 <!DOCTYPE html>、<html>、<head>、<body>，样式和脚本全部内联，不依赖外部资源'),
    '文档内如需展示代码，用 ~~~ 围栏，不要出现 ```。',
    ...COMMON_TAIL
  ]
};

/**
 * 追加在当前用户消息末尾的一行提醒（只进模型上下文，不落库）。
 * 系统提示词在长对话里容易被模型"忘掉"，用户轮的提醒对"写完产物又附赠脚本"
 * 这种惯性最管用。
 * @param {string|null} format - normalizeOutputFormat 的返回值
 * @returns {string} 提醒文本；format 非法时返回空串
 */
function buildOutputFormatReminder(format) {
  if (!INSTRUCTIONS[format]) return '';
  return `【格式提醒】这条回复只输出一句话说明和一个 \`\`\`${format} 代码块，代码块闭合后就结束；不要附加 Python 脚本、安装步骤或第二种交付方式。`;
}

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
  buildOutputFormatInstruction,
  buildOutputFormatReminder
};
