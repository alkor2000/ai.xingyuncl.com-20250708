'use strict';

// Reads the student's own project/pages and produces the two things P09 needs:
//   * source observations — how many pages there are, what the bytes digest to, when the source rows
//     were last touched. Whether a *student* ever saved is deliberately NOT decided here: a timestamp
//     cannot tell a real save from the blank starter page the editor writes by itself, so that fact
//     comes from observed save events in the ledger (service.js).
//   * an immutable bundle for a fixed review revision: every page of the project plus the local assets
//     the student provably owns, with intra-project links and asset references rewritten so the frozen
//     copy re-opens completely and navigates on its own after the original is edited or deleted.
// Ownership is checked against the authenticated owner on every object; nothing resolves by name.
const { createHash } = require('node:crypto');
const { fail } = require('./errors');

const MAX_PAGES = 50;
const MAX_BUNDLE_BYTES = 12 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const NUL = '\u0000';
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

// Flat bundle layout: the entry page is index.html and every other page is a sibling of it, so a link
// from any page to any other page is a plain file name and `assets/…` means the same thing everywhere.
function pagePath(slug, id) {
  const safe = String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return `p-${safe || 'page'}-${id}.html`;
}
const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Replace a reference only where it is a reference: inside quotes or inside url(), never in body text.
function replaceReference(text, from, to) {
  return text.replace(new RegExp(`(["'(])${escapeRe(from)}(?=["')#?])`, 'g'), `$1${to}`);
}

function createSourceReader({ HtmlProject, HtmlPage, sourceInstance, assets = null }) {
  if (!HtmlProject || !HtmlPage || typeof sourceInstance !== 'string') fail('invalid_request');

  // The owner's project with its pages. A mismatch is project_unavailable: the caller learns nothing
  // about someone else's project.
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
  const touchedAt = page => new Date(page.updated_at || page.created_at || 0).getTime() || 0;
  const createdAt = page => new Date(page.created_at || page.updated_at || 0).getTime() || 0;
  // A row the editor has written to at least once since it was created. `version` is incremented by
  // HtmlPage.update on every update, so version > 1 is a durable server-side fact that an update
  // happened — it does not say what kind of update, which is exactly why it only ever yields "unknown".
  const everUpdated = page => (Number(page.version) > 1) || touchedAt(page) - createdAt(page) >= 1000;

  // Observations only. `content_digest` changes exactly when the student's bytes change, which is what
  // an event may be derived from; everything else is reported as found.
  function facts({ pages }) {
    const digest = page => sha256(Buffer.from([page.title || '', page.html_content || '', page.css_content || '',
      page.js_content || ''].join(NUL), 'utf8'));
    return {
      page_count: pages.length,
      non_empty_page_count: pages.filter(page => bytesOf(page) > 0).length,
      // "Some row of this project has been updated since it was created" — used only to decide between
      // "provably never touched" and "history predates observation", never to claim a save happened.
      source_ever_updated: pages.some(everUpdated),
      source_touched_at: pages.length ? Math.max(...pages.map(touchedAt)) : null,
      content_digest: sha256(Buffer.from(pages.map(page => `${page.id}:${digest(page)}`).sort().join('\n'), 'utf8'))
    };
  }

  // Rendered by the editor's own compiler, so the private preview and the frozen revision show the page
  // the student sees rather than a second rendering that could disagree.
  function render(page) {
    const html = HtmlPage.compileContent(page.html_content || '', page.css_content || '', page.js_content || '');
    const buffer = Buffer.from(html, 'utf8');
    if (buffer.length > MAX_PAGE_BYTES) fail('revision_too_large', 413);
    return buffer;
  }

  // Page links are rewritten for both the frozen bundle and the live private preview: the editor's own
  // published URL shape (/pages/<user>/<slug>) and the bare slug forms become sibling file names.
  function rewritePageLinks(text, pages, entryId, ownerUserId) {
    let output = text;
    for (const page of pages) {
      const slug = String(page.slug || '');
      if (!slug) continue;
      const file = String(page.id) === String(entryId) ? 'index.html' : pagePath(slug, page.id);
      for (const shape of [`/pages/${ownerUserId}/${slug}`, `./${slug}.html`, `${slug}.html`, `./${slug}`]) {
        output = replaceReference(output, shape, file);
      }
    }
    return output;
  }

  // Live private preview of the current work. Uploads keep pointing at the owner's own files, but as a
  // path relative to the preview session, so the isolated origin can serve them under the same
  // ownership check instead of the page reaching back to the application origin.
  function renderForPreview(page, { pages, entryPageId, ownerUserId }) {
    let text = render(page).toString('utf8');
    text = rewritePageLinks(text, pages, entryPageId, ownerUserId);
    text = text.replace(/(["'(])\/uploads\//g, '$1uploads/');
    return Buffer.from(text, 'utf8');
  }

  // The immutable bundle. Assets are resolved once per reference and refusals are named, never silent.
  async function bundle({ project, pages }, entryPageId, refs, { ownerUserId = null } = {}) {
    const entry = pages.find(page => String(page.id) === String(entryPageId));
    if (!entry) fail('entry_page_invalid');
    const owner = ownerUserId ?? project.user_id;
    const rendered = new Map();
    for (const page of pages) rendered.set(String(page.id), render(page));

    // 1. Everything the pages refer to, counted once per distinct reference.
    const references = new Map();
    for (const buffer of rendered.values()) {
      for (const item of (assets ? assets.collect(buffer.toString('utf8')) : [])) {
        const key = `${item.kind}${NUL}${item.raw || item.url}`;
        const seen = references.get(key);
        references.set(key, seen ? { ...seen, count: seen.count + item.count } : item);
      }
    }
    // 2. Freeze the owned local ones; name every refusal with its reason.
    const assetFiles = [];
    const assetMap = new Map();
    const frozen = [];
    const refused = [];
    const external = [];
    let assetBytes = 0;
    for (const reference of [...references.values()].sort((a, b) => String(a.raw || a.url).localeCompare(String(b.raw || b.url)))) {
      if (reference.kind === 'external') {
        external.push({ kind: 'external_url', url: String(reference.url).slice(0, 300), reference_count: reference.count });
        continue;
      }
      if (reference.kind !== 'upload') continue;                        // page links are handled below
      if (!assets) { refused.push({ reference: reference.pathname, reason: 'asset_freezing_unavailable', reference_count: reference.count }); continue; }
      if (frozen.length >= assets.maxAssets) {
        refused.push({ reference: reference.pathname, reason: 'asset_limit_reached', reference_count: reference.count });
        continue;
      }
      const resolved = await assets.resolve({ ownerUserId: owner, projectId: project.id, reference });
      if (resolved.refused) {
        refused.push({ reference: reference.pathname, reason: resolved.refused, reference_count: reference.count });
        continue;
      }
      assetMap.set(reference.raw, resolved.path);
      if (!assetFiles.some(file => file.path === resolved.path)) {
        assetFiles.push(resolved);
        assetBytes += resolved.byte_length;
      }
      frozen.push({ path: resolved.path, reference: reference.pathname, byte_length: resolved.byte_length,
        media_type: resolved.media_type, sha256: resolved.sha256, owned_by: resolved.owned_by, reference_count: reference.count });
    }
    // 3. Rewrite every page with both maps, then address the files.
    const files = [];
    for (const page of pages) {
      let text = rendered.get(String(page.id)).toString('utf8');
      for (const [reference, target] of assetMap) text = replaceReference(text, reference, target);
      text = rewritePageLinks(text, pages, entry.id, owner);
      const body = Buffer.from(text, 'utf8');
      const isEntry = String(page.id) === String(entry.id);
      files.push({ path: isEntry ? 'index.html' : pagePath(page.slug, page.id), media_type: 'text/html; charset=utf-8',
        byte_length: body.length, sha256: sha256(body), content: body, page_ref: refs.page(page.id), page_id: page.id,
        title: String(page.title || '').slice(0, 200), entry: isEntry });
    }
    for (const asset of assetFiles) {
      files.push({ path: asset.path, media_type: asset.media_type, byte_length: asset.byte_length,
        sha256: asset.sha256, content: asset.content, asset: true });
    }
    const total = files.reduce((sum, file) => sum + file.byte_length, 0);
    if (total > MAX_BUNDLE_BYTES) fail('revision_too_large', 413);

    const manifest = {
      schema_version: 2,
      source_instance: sourceInstance,
      project_ref: refs.project, entry_ref: refs.page(entry.id), entry: 'index.html',
      project_name: String(project.name || '').slice(0, 200),
      pages: files.filter(file => !file.asset).map(({ path, page_ref, title, byte_length, sha256: digest, entry: isEntry }) =>
        ({ path, page_ref, title, byte_length, sha256: digest, entry: isEntry })),
      assets: frozen,
      // Named refusals stay in the manifest: a reviewer sees exactly what is not part of the frozen work
      // and why, instead of a missing image with no explanation.
      refused_assets: refused,
      external_dependencies: external.slice(0, 200),
      // Frozen: the student's pages and the local files whose ownership a real model row proves. NOT
      // frozen: external services, fonts and APIs, and anything ownership cannot be proven for.
      frozen_scope: 'pages_and_owned_local_assets',
      byte_length: total, asset_byte_length: assetBytes
    };
    const contentSha = sha256(Buffer.from(files.map(file => `${file.path}${NUL}${file.sha256}`).sort().join('\n'), 'utf8'));
    return { manifest: { ...manifest, content_sha256: contentSha }, files, content_sha256: contentSha, byte_length: total };
  }

  return { load, facts, render, renderForPreview, bundle, pageFileFor: pagePath, everUpdated, MAX_BUNDLE_BYTES };
}
module.exports = { createSourceReader, pagePath, sha256, MAX_PAGES, MAX_BUNDLE_BYTES };
