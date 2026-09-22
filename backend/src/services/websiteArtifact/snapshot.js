'use strict';

// Reads the student's own project/pages and turns them into the two things P09 needs:
//   * source facts (does an effective save exist, when, is a preview renderable) — never guessed from
//     "the editor was opened" or "a default project exists";
//   * an immutable bundle for a fixed review revision (entry page + every page + a listed set of
//     dependencies that are NOT frozen), so later renames, deletions or edits cannot change a version
//     a teacher already reviewed.
// Ownership is checked on every object against the authenticated owner; nothing is resolved by name.
const { createHash } = require('node:crypto');
const { fail } = require('./errors');

// Candidate parameters (engineering choices recorded in the delivery doc, not user-decided policy).
const MIN_EFFECTIVE_BYTES = 64;      // below this a page is an empty shell, not an effective save
// The editor creates a blank starter page from its own template as soon as a project without pages is
// opened. That page is not work: an effective save also requires a later save of the page, which the
// starter page never gets until the student actually writes something.
const MIN_SAVE_GAP_MS = 1000;
const MAX_PAGES = 50;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const NUL = '\u0000';
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
// A page path is derived from the page slug only, and is re-derived (never taken from input).
function pagePath(slug, id) {
  const safe = String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return `pages/${safe || 'page'}-${id}.html`;
}
// URLs that a frozen bundle cannot guarantee: platform uploads and anything off-instance. Counted by
// kind for the event payload; the concrete URLs stay inside the revision manifest (authorized reads only).
const DEPENDENCY_PATTERNS = [
  { kind: 'platform_upload', re: /(?:src|href)\s*=\s*["'](\/uploads\/[^"']{1,300})["']/gi },
  { kind: 'external_url', re: /(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']{1,300})["']/gi },
  { kind: 'external_fetch', re: /\b(?:fetch|XMLHttpRequest|importScripts)\s*\(\s*["']((?:https?:)?\/\/[^"']{1,300})["']/gi }
];

function createSourceReader({ HtmlProject, HtmlPage, sourceInstance }) {
  if (!HtmlProject || !HtmlPage || typeof sourceInstance !== 'string') fail('invalid_request');

  // The owner's project with its pages. `ownerUserId` is the authenticated session user — a mismatch is
  // project_unavailable (the caller learns nothing about someone else's project).
  async function load(ownerUserId, projectId) {
    if (!/^[1-9][0-9]{0,18}$/.test(String(projectId))) fail('project_unavailable', 404);
    const project = await HtmlProject.findById(projectId);
    if (!project || String(project.user_id) !== String(ownerUserId)) fail('project_unavailable', 404);
    const listed = await HtmlPage.getUserPages(ownerUserId, projectId, { page: 1, limit: MAX_PAGES + 1 });
    const pages = (listed?.data || []).filter(page => String(page.project_id) === String(projectId) &&
      String(page.user_id) === String(ownerUserId));
    if (pages.length > MAX_PAGES) fail('revision_too_large', 413);
    return { project, pages };
  }

  const bytesOf = page => Buffer.byteLength(`${page.html_content || ''}${page.css_content || ''}${page.js_content || ''}`.trim());
  const savedAt = page => new Date(page.updated_at || page.created_at || 0).getTime() || 0;
  const createdAt = page => new Date(page.created_at || page.updated_at || 0).getTime() || 0;
  // "明确创建或有效保存" in source terms: enough content to be a page, and a save that happened after
  // the page came into existence.
  const effectiveSave = page => bytesOf(page) >= MIN_EFFECTIVE_BYTES && savedAt(page) - createdAt(page) >= MIN_SAVE_GAP_MS;

  // Source facts for one linked project. An automatically created, still empty project reports
  // has_effective_save=false, so edu keeps showing 未开始 rather than 制作中.
  function facts({ pages }) {
    const effective = pages.filter(effectiveSave);
    const digest = page => sha256(Buffer.from([page.title || '', page.html_content || '', page.css_content || '',
      page.js_content || ''].join(NUL), 'utf8'));
    return {
      page_count: pages.length,
      effective_page_count: effective.length,
      has_effective_save: effective.length > 0,
      saved_at: effective.length ? Math.max(...effective.map(savedAt)) : null,
      content_digest: sha256(Buffer.from(pages.map(page => `${page.id}:${digest(page)}`).sort().join('\n'), 'utf8'))
    };
  }

  // Renders one page exactly as the editor's own compiler does, so the private preview and the frozen
  // revision show the page the student sees — not a second rendering path that could disagree.
  function render(page) {
    const html = HtmlPage.compileContent(page.html_content || '', page.css_content || '', page.js_content || '');
    const buffer = Buffer.from(html, 'utf8');
    if (buffer.length > MAX_PAGE_BYTES) fail('revision_too_large', 413);
    return buffer;
  }

  function dependencies(buffers) {
    const found = new Map();
    for (const buffer of buffers) {
      const text = buffer.toString('utf8');
      for (const { kind, re } of DEPENDENCY_PATTERNS) {
        for (const match of text.matchAll(new RegExp(re.source, re.flags))) {
          const url = match[1].slice(0, 300);
          const key = `${kind}${NUL}${url}`;
          found.set(key, { kind, url, count: (found.get(key)?.count || 0) + 1 });
        }
      }
    }
    return [...found.values()].sort((a, b) => (a.kind + a.url).localeCompare(b.kind + b.url)).slice(0, 200);
  }

  // The immutable bundle. Files are addressed by path; the entry page is always index.html so a reviewer
  // opens the student's declared entry, whatever the page was called at the time.
  function bundle({ project, pages }, entryPageId, refs) {
    const entry = pages.find(page => String(page.id) === String(entryPageId));
    if (!entry) fail('entry_page_invalid');
    const files = [];
    const add = (path, buffer, meta) => {
      files.push({ path, media_type: 'text/html; charset=utf-8', byte_length: buffer.length, sha256: sha256(buffer), content: buffer, ...meta });
    };
    add('index.html', render(entry), { page_ref: refs.page(entry.id), page_id: entry.id, title: String(entry.title || '').slice(0, 200), entry: true });
    for (const page of pages) {
      if (String(page.id) === String(entry.id)) continue;
      add(pagePath(page.slug, page.id), render(page), { page_ref: refs.page(page.id), page_id: page.id, title: String(page.title || '').slice(0, 200), entry: false });
    }
    const total = files.reduce((sum, file) => sum + file.byte_length, 0);
    if (total > MAX_BUNDLE_BYTES) fail('revision_too_large', 413);
    const external = dependencies(files.map(file => file.content));
    const manifest = {
      schema_version: 1,
      source_instance: sourceInstance,
      project_ref: refs.project, entry_ref: refs.page(entry.id), entry: 'index.html',
      project_name: String(project.name || '').slice(0, 200),
      pages: files.map(({ path, page_ref, title, byte_length, sha256: digest, entry: isEntry }) =>
        ({ path, page_ref, title, byte_length, sha256: digest, entry: isEntry })),
      // Explicitly NOT frozen: the bundle carries the student's own page bytes only.
      frozen_scope: 'pages_only',
      external_dependencies: external.map(({ kind, url, count }) => ({ kind, url, reference_count: count })),
      byte_length: total
    };
    const contentSha = sha256(Buffer.from(files.map(file => `${file.path}${NUL}${file.sha256}`).sort().join('\n'), 'utf8'));
    return { manifest: { ...manifest, content_sha256: contentSha }, files, content_sha256: contentSha, byte_length: total };
  }

  return { load, facts, render, bundle, effectiveSave, MIN_EFFECTIVE_BYTES, MAX_BUNDLE_BYTES };
}
module.exports = { createSourceReader, pagePath, sha256, MIN_EFFECTIVE_BYTES, MIN_SAVE_GAP_MS, MAX_PAGES, MAX_BUNDLE_BYTES };
