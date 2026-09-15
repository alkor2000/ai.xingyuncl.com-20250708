/**
 * 公文模板服务：文件落盘 / 解析摘要 / 生成 / 预览 / 草稿提取
 *
 * 文件：storage/uploads/doc-templates/<uuid>.docx（uploads 目录在两个站点都持久化；文件名是 uuid，不可猜；
 *      下载走鉴权接口 GET /api/doc-templates/:id/file，不给前端暴露 /uploads 直链）
 * 解析：docxEngine.inspectDocx → blocks（给贴角色界面）+ page/headers/footers（摘要）
 * 生成：docxEngine.fillDocx(样板, roles, content) → .docx；预览用 mammoth 转 HTML（只有正文，没有页眉页脚）
 * 草稿：老师上传自己的 .docx 或粘贴文字 → 拆成 {title, recipient, blocks, attachments, signer, date}
 */
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const mammoth = require('mammoth');
const config = require('../../config');
const logger = require('../../utils/logger');
const { ValidationError } = require('../../utils/errors');
const DocTemplate = require('../../models/DocTemplate');
const engine = require('./docxEngine');

const TEMPLATE_DIR = 'doc-templates';
const MAX_BLOCKS = 800;
const MAX_TEXT = 200000;
const MAX_LINE = 2000;

const uploadsRoot = () => config.storage.paths.uploads;

class DocTemplateService {
  static async ensureDir() {
    await fs.mkdir(path.join(uploadsRoot(), TEMPLATE_DIR), { recursive: true });
  }

  static absolutePath(template) {
    const rel = String(template.file_path || '').replace(/^\/+/, '');
    const abs = path.resolve(uploadsRoot(), rel);
    if (!abs.startsWith(path.resolve(uploadsRoot()) + path.sep)) throw new ValidationError('模板文件路径无效');
    return abs;
  }

  static async readFile(template) {
    try {
      return await fs.readFile(DocTemplateService.absolutePath(template));
    } catch (error) {
      logger.error('读取公文模板文件失败', { id: template.id, error: error.message });
      throw new ValidationError('模板文件不存在，请删除后重新上传');
    }
  }

  /** 校验并解析上传的 .docx（不是 docx 或没有正文时抛 ValidationError） */
  static async inspect(buffer) {
    if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ValidationError('只能上传 .docx 格式的 Word 文件');
    try {
      return await engine.inspectDocx(buffer);
    } catch (error) {
      if (error.message === 'NOT_DOCX') throw new ValidationError('只能上传 .docx 格式的 Word 文件（.doc 请先在 Word 里另存为 .docx）');
      throw error;
    }
  }

  /** 各角色的格式摘要（给界面显示"标题：方正小标宋 二号 居中"） */
  static roleFormats(blocks, roles) {
    const out = {};
    const byIndex = new Map(blocks.map((b) => [b.index, b]));
    (roles || []).forEach(({ index, role }) => {
      if (out[role] || role === 'fixed' || role === 'delete') return;
      const b = byIndex.get(Number(index));
      if (b && b.kind === 'p' && b.format) out[role] = { font: b.format.font, size: b.format.size, sizeName: b.format.sizeName, bold: b.format.bold, align: b.format.align, firstLine: b.format.firstLine, color: b.format.color };
    });
    return out;
  }

  static buildSummary(info, roles) {
    return { page: info.page, headers: info.headers, footers: info.footers, block_count: info.block_count, roleFormats: DocTemplateService.roleFormats(info.blocks, roles) };
  }

  static validateRoles(roles, blockCount) {
    if (!Array.isArray(roles)) throw new ValidationError('roles 必须是数组');
    const seen = new Set();
    const clean = [];
    roles.forEach((r) => {
      const index = Number(r && r.index);
      const role = String(r && r.role);
      if (!Number.isInteger(index) || index < 0 || index >= blockCount) throw new ValidationError(`roles 里的 index 无效: ${r && r.index}`);
      if (!engine.ROLES.includes(role)) throw new ValidationError(`未知角色: ${role}`);
      if (seen.has(index)) return;
      seen.add(index);
      clean.push({ index, role });
    });
    if (!clean.some((r) => r.role === 'body')) throw new ValidationError('至少要把一段标成"正文"');
    return clean.sort((a, b) => a.index - b.index);
  }

  static async createFromUpload({ user, buffer, originalname, name, description, scope }) {
    const info = await DocTemplateService.inspect(buffer);
    if (!info.blocks.some((b) => b.kind === 'p' && !b.empty)) throw new ValidationError('这份文件没有正文段落，不能当模板');
    const roles = engine.guessRoles(info.blocks);
    if (!roles.some((r) => r.role === 'body')) {
      /* 猜不出正文时把最长的非空段落当正文，老师再改 */
      const longest = info.blocks.filter((b) => b.kind === 'p' && !b.empty).sort((a, b) => b.length - a.length)[0];
      if (longest) roles[longest.index].role = 'body';
    }
    await DocTemplateService.ensureDir();
    const uuid = crypto.randomUUID();
    const rel = `${TEMPLATE_DIR}/${uuid}.docx`;
    await fs.writeFile(path.join(uploadsRoot(), rel), buffer);
    const cleanName = String(name || '').trim() || String(originalname || '').replace(/\.docx$/i, '').trim() || '未命名模板';
    const template = await DocTemplate.create({
      uuid, user_id: user.id, group_id: user.group_id || null, name: cleanName.slice(0, 100), description: String(description || '').slice(0, 500),
      file_path: rel, file_size: buffer.length, original_filename: String(originalname || '').slice(0, 255), block_count: info.block_count,
      roles, summary: DocTemplateService.buildSummary(info, roles), scope: scope === 'group' ? 'group' : 'private'
    });
    return { template, blocks: info.blocks };
  }

  static async getWithBlocks(template) {
    const buffer = await DocTemplateService.readFile(template);
    const info = await DocTemplateService.inspect(buffer);
    return { template, blocks: info.blocks };
  }

  static async updateRoles(template, roles) {
    const clean = DocTemplateService.validateRoles(roles, template.block_count);
    const buffer = await DocTemplateService.readFile(template);
    const info = await DocTemplateService.inspect(buffer);
    return DocTemplate.update(template.id, { roles: clean, summary: DocTemplateService.buildSummary(info, clean) });
  }

  static async remove(template) {
    await DocTemplate.remove(template.id);
    try { await fs.unlink(DocTemplateService.absolutePath(template)); } catch (e) { /* 文件可能已不在 */ }
  }

  /** 生成内容的形状校验与截断（前端 Markdown → blocks，或草稿提取的结果） */
  static normalizeContent(raw) {
    if (!raw || typeof raw !== 'object') throw new ValidationError('content 必须是对象');
    const str = (v, max = MAX_LINE) => (v === undefined || v === null ? '' : String(v)).slice(0, max);
    const runs = (v) => {
      const list = Array.isArray(v) ? v : [{ text: v }];
      return list.slice(0, 200).map((r) => (r && typeof r === 'object' ? { text: str(r.text), bold: !!r.bold, italic: !!r.italic, underline: !!r.underline, strike: !!r.strike } : { text: str(r) }));
    };
    const blocks = Array.isArray(raw.blocks) ? raw.blocks.slice(0, MAX_BLOCKS) : [];
    let total = 0;
    const clean = blocks.map((b) => {
      if (!b || typeof b !== 'object') return null;
      const type = ['paragraph', 'heading', 'list', 'table'].includes(b.type) ? b.type : 'paragraph';
      if (type === 'heading') return { type, level: Math.min(3, Math.max(1, Number(b.level) || 1)), runs: runs(b.runs ?? b.text) };
      if (type === 'list') return { type, ordered: !!b.ordered, items: (Array.isArray(b.items) ? b.items : []).slice(0, 200).map((it) => ({ runs: runs(it && typeof it === 'object' && 'runs' in it ? it.runs : (it && it.text) ?? it) })) };
      if (type === 'table') return { type, rows: (Array.isArray(b.rows) ? b.rows : []).slice(0, 200).map((row) => (Array.isArray(row) ? row : []).slice(0, 20).map((cell) => ({ runs: runs(cell && typeof cell === 'object' && 'runs' in cell ? cell.runs : (cell && cell.text) ?? cell) }))) };
      return { type, runs: runs(b.runs ?? b.text) };
    }).filter(Boolean);
    clean.forEach((b) => { const count = (rs) => rs.reduce((a, r) => a + r.text.length, 0); if (b.runs) total += count(b.runs); if (b.items) b.items.forEach((i) => { total += count(i.runs); }); if (b.rows) b.rows.forEach((r) => r.forEach((c) => { total += count(c.runs); })); });
    if (total > MAX_TEXT) throw new ValidationError('内容太长（超过 20 万字）');
    const lines = (v) => (Array.isArray(v) ? v.map((x) => str(x)) : str(v, 5000)).toString();
    return {
      title: str(raw.title, 300),
      recipient: str(raw.recipient, 1000),
      blocks: clean,
      attachments: Array.isArray(raw.attachments) ? raw.attachments.slice(0, 50).map((a) => str(a)) : str(raw.attachments, 5000).split(/\r?\n/).filter(Boolean),
      signer: Array.isArray(raw.signer) ? raw.signer.slice(0, 10).map((s) => str(s)) : lines(raw.signer),
      date: str(raw.date, 100)
    };
  }

  static async render(template, rawContent) {
    const content = DocTemplateService.normalizeContent(rawContent);
    if (!content.blocks.length && !content.title) throw new ValidationError('没有可生成的内容');
    const buffer = await DocTemplateService.readFile(template);
    try {
      const out = await engine.fillDocx(buffer, template.roles, content);
      DocTemplate.touchUsed(template.id);
      return { buffer: out, content };
    } catch (error) {
      if (error.message === 'NO_BODY_PROTOTYPE') throw new ValidationError('模板还没有标出"正文"段落，请先在模板里贴角色');
      throw error;
    }
  }

  static async previewHtml(buffer) {
    const result = await mammoth.convertToHtml({ buffer }, { styleMap: ['p[style-name="Title"] => h1:fresh'] });
    return result.value;
  }

  static async extractDraft(buffer) {
    await DocTemplateService.inspect(buffer);
    return engine.extractDraft(buffer);
  }

  static contentFromText(text) {
    return engine.contentFromText(String(text || '').slice(0, MAX_TEXT));
  }
}

DocTemplateService.ROLES = engine.ROLES;
module.exports = DocTemplateService;
