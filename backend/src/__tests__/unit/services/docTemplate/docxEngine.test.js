/**
 * 公文模板引擎单测：解析摘要、猜角色、按角色套内容、草稿提取
 */
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const engine = require('../../../../services/docTemplate/docxEngine');
const { buildSampleDocx, p } = require('../../../helpers/docxFixture');

const paragraphTexts = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  return xml.split('</w:p>').map((part) => (part.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((m) => m.replace(/<[^>]+>/g, '')).join('')).filter(Boolean);
};
const documentXml = async (buffer) => (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');

describe('docxEngine.inspectDocx', () => {
  it('列出顶层块并解析格式、页面、页眉页脚', async () => {
    const info = await engine.inspectDocx(await buildSampleDocx());
    expect(info.block_count).toBe(20);
    expect(info.blocks[0]).toMatchObject({ kind: 'p', format: { align: 'center', font: '方正小标宋简体', size: 30, color: 'FF0000' } });
    expect(info.blocks[4].format).toMatchObject({ font: '方正小标宋简体', size: 22, sizeName: '二号', align: 'center' });
    expect(info.blocks[7].format).toMatchObject({ font: '仿宋_GB2312', size: 16, sizeName: '三号', align: 'both', firstLine: 2 });
    expect(info.blocks[19]).toMatchObject({ kind: 'tbl', rows: 2 });
    expect(info.page).toMatchObject({ width_cm: 21, height_cm: 29.7, margins_cm: { top: 3.7, left: 2.8 } });
    expect(info.headers[0]).toMatchObject({ type: 'default', text: '北京市某某中学 内部文件', hasImage: false });
    expect(info.footers).toHaveLength(1);
  });

  it('不是 docx 时报 NOT_DOCX', async () => {
    const zip = new JSZip(); zip.file('hello.txt', 'x');
    await expect(engine.inspectDocx(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('NOT_DOCX');
  });
});

describe('docxEngine.guessRoles', () => {
  it('按公文结构猜出各角色', async () => {
    const info = await engine.inspectDocx(await buildSampleDocx());
    const roles = engine.guessRoles(info.blocks).map((r) => r.role);
    expect(roles.slice(0, 4)).toEqual(['fixed', 'fixed', 'fixed', 'fixed']);
    expect(roles[4]).toBe('title');
    expect(roles[6]).toBe('recipient');
    expect(roles.slice(7, 15)).toEqual(['body', 'h1', 'body', 'h2', 'body', 'h1', 'body', 'attachment']);
    expect(roles[16]).toBe('signer');
    expect(roles[17]).toBe('date');
    expect(roles[19]).toBe('fixed');
  });

  it('没有首行缩进的普通文档也能找到正文（按长度）', async () => {
    const body = [p('会议纪要', { align: 'center', bold: true, size: 36 }), p('参加人员：张三、李四、王五，会议由张三主持，主要讨论了下学期的工作安排。'), p('一、关于课程安排的讨论意见如下，各位老师基本同意。'), p('二〇二六年一月八日', { align: 'right' })];
    const info = await engine.inspectDocx(await buildSampleDocx({ body }));
    const roles = engine.guessRoles(info.blocks).map((r) => r.role);
    expect(roles).toEqual(['title', 'body', 'h1', 'date']);
  });
});

describe('docxEngine.fillDocx', () => {
  const content = {
    title: '关于举办冬季读书月的通知',
    recipient: '各年级组、图书馆：',
    blocks: [
      { type: 'paragraph', runs: [{ text: '为营造书香校园，' }, { text: '决定', bold: true, italic: true }, { text: '举办读书月活动。' }] },
      { type: 'heading', level: 1, runs: [{ text: '一、活动安排' }] },
      { type: 'heading', level: 3, runs: [{ text: '1. 三级标题没有原型' }] },
      { type: 'list', ordered: false, items: [{ runs: [{ text: '每班推荐三本' }] }, { runs: [{ text: '图书馆汇总' }] }] },
      { type: 'table', rows: [[{ text: '日期' }, { text: '活动' }], [{ text: '12月1日' }, { text: '启动' }]] },
      { type: 'paragraph', runs: [{ text: '第一行\n第二行' }] }
    ],
    attachments: ['附件：1. 安排表', '2. 推荐表'],
    signer: ['北京市某某中学', '教务处'],
    date: '二〇二六年十一月二十日'
  };

  it('固定块原样保留，角色块换成新内容，示例段与 delete 段消失', async () => {
    const sample = await buildSampleDocx();
    const info = await engine.inspectDocx(sample);
    const roles = engine.guessRoles(info.blocks);
    roles[13].role = 'delete';
    const out = await engine.fillDocx(sample, roles, content);
    const texts = await paragraphTexts(out);
    expect(texts[0]).toBe('北京市某某中学文件');
    expect(texts[1]).toBe('某中〔2026〕12 号');
    expect(texts).toContain('关于举办冬季读书月的通知');
    expect(texts).toContain('各年级组、图书馆：');
    expect(texts).toContain('为营造书香校园，决定举办读书月活动。');
    expect(texts).toContain('一、活动安排');
    expect(texts).toContain('1. 三级标题没有原型');
    expect(texts).toContain('• 每班推荐三本');
    expect(texts).toContain('12月1日');
    expect(texts).toContain('第一行第二行');
    expect(texts).toContain('附件：1. 安排表');
    expect(texts).toContain('2. 推荐表');
    expect(texts).toContain('教务处');
    expect(texts).toContain('二〇二六年十一月二十日');
    expect(texts.join('|')).not.toContain('为丰富校园');
    expect(texts.join('|')).not.toContain('各年级组请于');
    expect(texts[texts.length - 1]).toContain('印发');
  });

  it('新段落沿用原型的 pPr 与 rPr；加粗按 rPr 顺序插入；标题原型缺失时用正文加粗', async () => {
    const sample = await buildSampleDocx();
    const info = await engine.inspectDocx(sample);
    const roles = engine.guessRoles(info.blocks);
    const xml = await documentXml(await engine.fillDocx(sample, roles, content));
    const titleP = xml.split('</w:p>').find((s) => s.includes('关于举办冬季读书月的通知'));
    expect(titleP).toContain('w:eastAsia="方正小标宋简体"');
    expect(titleP).toContain('<w:sz w:val="44"/>');
    expect(titleP).toContain('<w:jc w:val="center"/>');
    const boldRun = xml.split('</w:r>').find((s) => s.includes('>决定<'));
    expect(boldRun).toMatch(/<w:rFonts[^>]*\/><w:b\/><w:bCs\/><w:i\/><w:iCs\/><w:sz/);
    const h3 = xml.split('</w:p>').find((s) => s.includes('三级标题没有原型'));
    expect(h3).toContain('<w:b/>');
    expect(h3).toContain('w:eastAsia="仿宋_GB2312"');
    expect(h3).toContain('w:firstLineChars="200"');
    const tableCell = xml.split('</w:tc>').find((s) => s.includes('12月1日'));
    expect(tableCell).not.toContain('firstLineChars');
    expect(tableCell).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:br/>');
    expect(xml).toContain('headerReference');
    let errors = 0;
    new DOMParser({ onError: () => { errors += 1; } }).parseFromString(xml, 'application/xml');
    expect(errors).toBe(0);
  });

  it('样板里没有主送/落款原型时，内容挂在正文前后并用正文格式', async () => {
    const body = [p('通知', { align: 'center', size: 44 }), p('正文第一段，这一段够长可以被当成正文来用了吧应该可以。', { firstLineChars: 2 }), p('二〇二六年一月八日', { align: 'right' })];
    const sample = await buildSampleDocx({ body });
    const info = await engine.inspectDocx(sample);
    const roles = engine.guessRoles(info.blocks);
    const texts = await paragraphTexts(await engine.fillDocx(sample, roles, { title: 'T', recipient: '各位：', blocks: [{ type: 'paragraph', text: '新正文' }], signer: '某单位', date: '二〇二六年二月一日' }));
    expect(texts).toEqual(['T', '各位：', '新正文', '某单位', '二〇二六年二月一日']);
  });

  it('没有正文原型时报错', async () => {
    const sample = await buildSampleDocx();
    await expect(engine.fillDocx(sample, [{ index: 0, role: 'fixed' }], { blocks: [{ type: 'paragraph', text: 'x' }] })).rejects.toThrow('NO_BODY_PROTOTYPE');
  });
});

describe('docxEngine.extractDraft / contentFromText', () => {
  it('完整公文当草稿：红头与版记不带进内容，字段与正文分开', async () => {
    const c = await engine.extractDraft(await buildSampleDocx());
    expect(c.title).toBe('关于开展 2026 年秋季校园科技节的通知');
    expect(c.recipient).toBe('各年级组、各处室：');
    expect(c.date).toBe('二〇二六年九月十五日');
    expect(c.signer).toEqual(['北京市某某中学']);
    expect(c.attachments).toEqual(['附件：1. 科技节活动安排表']);
    expect(c.blocks.map((b) => b.type)).toEqual(['paragraph', 'heading', 'paragraph', 'heading', 'paragraph', 'heading', 'paragraph']);
    expect(c.blocks.map((b) => b.runs[0].text).join('|')).not.toContain('文件');
  });

  it('普通草稿（居中标题 + 段落 + 日期）', async () => {
    const body = [p('关于放假的通知', { align: 'center', bold: true }), p('各位同学：'), p('明天放假，请大家注意安全，按时返校，家长知悉。'), p('教务处', { align: 'right' }), p('2026年1月8日', { align: 'right' })];
    const c = await engine.extractDraft(await buildSampleDocx({ body }));
    expect(c.title).toBe('关于放假的通知');
    expect(c.recipient).toBe('各位同学：');
    expect(c.signer).toEqual(['教务处']);
    expect(c.date).toBe('2026年1月8日');
    expect(c.blocks).toHaveLength(1);
  });

  it('粘贴文字：每行一段，# 当标题', () => {
    const c = engine.contentFromText('# 通知\n正文一\n\n## 二级');
    expect(c.blocks).toEqual([{ type: 'heading', level: 1, runs: [{ text: '通知' }] }, { type: 'paragraph', runs: [{ text: '正文一' }] }, { type: 'heading', level: 2, runs: [{ text: '二级' }] }]);
  });
});
