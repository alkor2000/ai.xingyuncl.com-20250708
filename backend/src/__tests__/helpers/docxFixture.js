/**
 * 测试用最小 .docx（手写 OOXML + JSZip），模仿一份公文样板：
 * 页眉（内部文件）、页脚（页码）、红头（小标宋 60 半磅 红色 居中）、发文字号、红线段、标题（小标宋 44 居中）、
 * 主送机关、正文（仿宋 32，首行缩进 2 字）、黑体一级标题、楷体二级标题、附件说明、落款、日期（右对齐）、版记表。
 * 供 docTemplate 单测与冒烟脚本共用。
 */
const JSZip = require('jszip');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rPr = ({ font = '仿宋_GB2312', size = 32, bold = false, color } = {}) => `<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="${font}" w:hAnsi="Times New Roman"/>${bold ? '<w:b/><w:bCs/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
/**
 * @param {string} text
 * @param {{align?:string, font?:string, size?:number, bold?:boolean, color?:string, firstLineChars?:number, redLine?:boolean}} o
 */
const p = (text, o = {}) => {
  const pPr = [
    o.redLine ? '<w:pBdr><w:bottom w:val="single" w:sz="18" w:space="1" w:color="FF0000"/></w:pBdr>' : '',
    '<w:spacing w:line="560" w:lineRule="exact"/>',
    o.firstLineChars ? `<w:ind w:firstLineChars="${o.firstLineChars * 100}"/>` : '',
    o.align ? `<w:jc w:val="${o.align}"/>` : ''
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r>${rPr(o)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
};
const tbl = (rowsText) => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="8800"/></w:tblGrid>${rowsText.map((t) => `<w:tr><w:tc><w:tcPr><w:tcW w:w="8800" w:type="dxa"/></w:tcPr>${p(t, { size: 28 })}</w:tc></w:tr>`).join('')}</w:tbl>`;

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const DEFAULT_BODY = [
  p('北京市某某中学文件', { align: 'center', font: '方正小标宋简体', size: 60, color: 'FF0000' }),
  p('某中〔2026〕12 号', { align: 'center' }),
  p('', { redLine: true }),
  p(''),
  p('关于开展 2026 年秋季校园科技节的通知', { align: 'center', font: '方正小标宋简体', size: 44 }),
  p(''),
  p('各年级组、各处室：', { align: 'left' }),
  p('为丰富校园科技文化生活，培养学生创新精神与实践能力，经研究，决定于 2026 年 10 月举办秋季校园科技节。现将有关事项通知如下。', { align: 'both', firstLineChars: 2 }),
  p('一、活动主题', { align: 'both', firstLineChars: 2, font: '黑体' }),
  p('本届科技节以"人工智能与生活"为主题，围绕真实数据、真实训练、真实测试展开。', { align: 'both', firstLineChars: 2 }),
  p('（一）时间安排', { align: 'both', firstLineChars: 2, font: '楷体_GB2312' }),
  p('10 月 8 日至 10 月 22 日为作品征集期，10 月 29 日举办展示与评比活动。', { align: 'both', firstLineChars: 2 }),
  p('二、工作要求', { align: 'both', firstLineChars: 2, font: '黑体' }),
  p('各年级组请于 9 月 30 日前将报名表报送教务处，逾期不再受理。', { align: 'both', firstLineChars: 2 }),
  p('附件：1. 科技节活动安排表', { align: 'both', firstLineChars: 2 }),
  p(''),
  p('北京市某某中学', { align: 'right' }),
  p('二〇二六年九月十五日', { align: 'right' }),
  p(''),
  tbl(['抄送：区教委基教科。', '北京市某某中学办公室            2026 年 9 月 15 日印发'])
];

/**
 * @param {{body?:string[], header?:string}} [options]
 * @returns {Promise<Buffer>}
 */
async function buildSampleDocx(options = {}) {
  const body = (options.body || DEFAULT_BODY).join('');
  const header = options.header === undefined ? '北京市某某中学 内部文件' : options.header;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>样板</dc:title><dc:creator>test</dc:creator></cp:coreProperties>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="仿宋_GB2312" w:hAnsi="Times New Roman"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`);
  zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W}>${p(header, { align: 'right', size: 21 })}</w:hdr>`);
  zip.file('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${rPr({ size: 28 })}<w:t xml:space="preserve">— </w:t></w:r><w:r>${rPr({ size: 28 })}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPr({ size: 28 })}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r>${rPr({ size: 28 })}<w:fldChar w:fldCharType="end"/></w:r><w:r>${rPr({ size: 28 })}<w:t xml:space="preserve"> —</w:t></w:r></w:p></w:ftr>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2098" w:right="1474" w:bottom="1984" w:left="1587" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildSampleDocx, p, tbl, DEFAULT_BODY };
