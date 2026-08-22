import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'https://fan2d.top';
const DLSITE_PROXY_PORT = 7897;
const PORT = 3456;

async function fetchPage(url, cookie) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8',
    };
    if (cookie) headers['Cookie'] = cookie;
    const resp = await fetch(url, { signal: controller.signal, headers });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.text();
  } finally { clearTimeout(timer); }
}

async function proxyImage(imgUrl, cookie) {
  try {
    const fullUrl = imgUrl.startsWith('http') ? imgUrl : (imgUrl.startsWith('//') ? 'https:' + imgUrl : BASE_URL + imgUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://fan2d.top/',
      'Accept': 'image/*,*/*;q=0.8',
    };
    if (cookie) headers['Cookie'] = cookie;
    const resp = await fetch(fullUrl, { signal: controller.signal, headers });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const ct = resp.headers.get('content-type') || 'image/png';
    return { base64: buf.toString('base64'), mime: ct.split(';')[0].trim() };
  } catch { return null; }
}async function search2dfan(keyword, cookie) {
  const url = BASE_URL + '/subjects/search?keyword=' + encodeURIComponent(keyword);
  console.error('[2DFan] search: ' + keyword);
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  const resp = await fetch(url, { headers });
  const data = await resp.json();
  const html = data.subjects || '';
  const results = [];
  const items = html.split('<li class="media"');
  for (const item of items) {
    if (!item.includes('href=')) continue;
    const titleMatch = item.match(/href="\/subjects\/(\d+)"[^>]*>([^<]+)<\/a><\/h4>/);
    if (!titleMatch) continue;
    const subjectId = titleMatch[1];
    const title = titleMatch[2].trim();
    const thumbMatch = item.match(/data-normal="([^"]+)"/);
    const thumbnail = thumbMatch ? thumbMatch[1] : '';
    const brandMatch = item.match(/品牌：[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
    const brand = brandMatch ? brandMatch[1].trim() : '';
    const dateMatch = item.match(/发售日期：([^<\n]+)/);
    const releaseDate = dateMatch ? dateMatch[1].trim() : '';
    const hasIntro = item.includes('介绍：') && item.includes('href="/topics/');
    const introTopicMatch = item.match(/href="\/topics\/(\d+)"/);
    const introUrl = hasIntro && introTopicMatch ? '/topics/' + introTopicMatch[1] : '';
    const hasDownloads = item.includes('下载：') && item.includes('badge-info');
    results.push({ subjectId, title, brand, releaseDate, thumbnail, topicUrl: introUrl, hasIntro, hasDownloads });
  }
  console.error('[2DFan] found ' + results.length);
  return results;
}

async function searchGalpic(keyword) {
  const url = 'https://www.galpic.xyz/spreview.so?name=' + encodeURIComponent(keyword);
  console.error('[galpic] search: ' + keyword);
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await resp.text();
  const results = [];
  const rows = html.split('<tr>');
  for (const row of rows) {
    const titleMatch = row.match(/href="\/show\/([^"]+)"[^>]*>([\s\S]*?)<\/a><\/b>/);
    if (!titleMatch) continue;
    const gid = titleMatch[1];
    const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
    const resMatch = row.match(/glyphicon-download-alt/);
    let resourceCount = 0, resourceUrl = '';
    if (resMatch) {
      const resBtnMatch = row.match(/<a[^>]*href="([^"]*)"[^>]*><b>(\d+)<\/b>[\s\S]*?glyphicon-download-alt/);
      if (resBtnMatch) { resourceUrl = resBtnMatch[1]; resourceCount = parseInt(resBtnMatch[2]); }
    }
    if (resourceUrl && !resourceUrl.startsWith('http')) resourceUrl = 'https:' + resourceUrl;
    const imgCountMatch = row.match(/glyphicon-picture/);
    let imageCount = 0;
    if (imgCountMatch) {
      const imgBtnMatch = row.match(/<a[^>]*href="\/show\/([^"]*)"[^>]*><b>(\d+)<\/b>[\s\S]*?glyphicon-picture/);
      if (imgBtnMatch) imageCount = parseInt(imgBtnMatch[2]);
    }
    results.push({ gid, title, resourceCount, resourceUrl, imageCount });
  }
  console.error('[galpic] found ' + results.length);
  return results;
}async function fetchDlsite(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: DLSITE_PROXY_PORT, method: 'CONNECT', path: 'www.dlsite.com:443' });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { reject(new Error('Proxy CONNECT failed')); return; }
      const agent = new https.Agent({ socket, servername: 'www.dlsite.com', rejectUnauthorized: false });
      https.get({ host: 'www.dlsite.com', path, agent, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja,en;q=0.9' } }, (resp) => {
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => resolve(data));
      }).on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function translateText(text, from, to) {
  return new Promise((resolve, reject) => {
    const qs = 'client=gtx&sl=' + (from || 'auto') + '&tl=' + (to || 'zh-CN') + '&dt=t&q=' + encodeURIComponent(text);
    const req = http.request({ hostname: '127.0.0.1', port: DLSITE_PROXY_PORT, method: 'CONNECT', path: 'translate.googleapis.com:443' });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { reject(new Error('Proxy CONNECT failed')); return; }
      const agent = new https.Agent({ socket, servername: 'translate.googleapis.com', rejectUnauthorized: false });
      https.get({ host: 'translate.googleapis.com', path: '/translate_a/single?' + qs, agent, headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => {
          try { const j = JSON.parse(data); resolve(j[0] ? j[0].map(s => s[0]).join('') : text); }
          catch (e) { resolve(text); }
        });
      }).on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function searchDlsite(keyword) {
  const searchPath = '/pro/fsr/=/keyword/' + encodeURIComponent(keyword) + '/ana_flg/all';
  console.error('[DLSite] search: ' + keyword);
  const html = await fetchDlsite(searchPath);
  const results = [];
  const seen = new Set();
  const linkPattern = /href="[^"]*product_id\/([A-Z0-9]+)\.html"[^>]*>([^<]{3,})<\/a>/g;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const pid = match[1];
    const title = match[2].trim();
    if (seen.has(pid) || title.length < 3) continue;
    seen.add(pid);
    results.push({ productId: pid, title, thumbnail: '', url: 'https://www.dlsite.com/pro/work/=/product_id/' + pid + '.html' });
  }
  console.error('[DLSite] found ' + results.length);
  return results;
}async function scrapeDlsite(productId) {
  const workPath = '/pro/work/=/product_id/' + productId + '.html';
  console.error('[DLSite] scrape: ' + productId);
  const html = await fetchDlsite(workPath);
  const titleMatch = html.match(/work_name">([^<]+)<\/h1>/) || html.match(/data-product-name="([^"]+)"/) || html.match(/<title>([^<|]+)/);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const outlineMatch = html.match(/work_outline">([\s\S]*?)<\/table>/);
  const details = {};
  if (outlineMatch) {
    const rows = [...outlineMatch[1].matchAll(/<th>([^<]+)<\/th>\s*<td>([\s\S]*?)<\/td>/g)];
    for (const row of rows) { details[row[1].trim()] = row[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
  }
  const descMatch = html.match(/class="work_parts type_text">\s*<div class="work_parts_area">\s*<p>([\s\S]*?)<\/p>/);
  let description = descMatch ? descMatch[1].replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').trim() : '';
  const coverMatch = html.match(/(\/\/img\.dlsite\.jp\/[^"]*_img_main\.jpg)/);
  const coverImage = coverMatch ? 'https:' + coverMatch[1] : '';
  const sampleImages = [];
  const samplePattern = /\/\/img\.dlsite\.jp\/[^"]*_img_smp[a-z]+\d+\.jpg/g;
  let sm;
  while ((sm = samplePattern.exec(html)) !== null) { const url = 'https:' + sm[0]; if (!sampleImages.includes(url)) sampleImages.push(url); }
  const trialMatch = html.match(/href="(\/\/trial\.dlsite\.com[^"]*trial\.zip)"/);
  const trialUrl = trialMatch ? 'https:' + trialMatch[1] : '';
  const trialSizeMatch = html.match(/trial_file[\s\S]*?<span>\(([^)]+)\)/);
  const trialSize = trialSizeMatch ? trialSizeMatch[1] : '';
  const movieMatch = html.match(/href="(\/\/trial\.dlsite\.com[^"]*trial_mov\.zip)"/);
  const movieUrl = movieMatch ? 'https:' + movieMatch[1] : '';
  const movieSizeMatch = html.match(/demo_file[\s\S]*?<span>\(([^)]+)\)/);
  const movieSize = movieSizeMatch ? movieSizeMatch[1] : '';
  let translatedDesc = description;
  if (description) {
    try {
      const dlines = description.split('\n').filter(l => l.trim());
      const translatedLines = [];
      for (const line of dlines) {
        if (line.trim()) { try { translatedLines.push(await translateText(line.trim(), 'ja', 'zh-CN')); } catch (e) { translatedLines.push(line.trim()); } await new Promise(r => setTimeout(r, 300)); }
        else { translatedLines.push(''); }
      }
      translatedDesc = translatedLines.join('\n');
    } catch (e) { console.error('[DLSite] translate error:', e.message); }
  }
  let out = '<a href="https://www.dlsite.com/pro/work/=/product_id/' + productId + '.html">' + title + '</a><br>\n';
  for (const [key, val] of Object.entries(details)) { out += '<b>' + key + '</b>：' + val + '<br>\n'; }
  out += '<br>\n';
  if (translatedDesc) { for (const l of translatedDesc.split('\n')) out += l + '<br>\n'; out += '<br>\n'; }
  if (coverImage) out += '<img src="' + coverImage + '"><br>\n<br>\n';
  for (const img of sampleImages) out += '<img src="' + img + '"><br>\n';
  if (trialUrl) out += '<br>\n<a href="' + trialUrl + '" target="_blank">📥 体验版下载 (' + trialSize + ')</a><br>\n';
  if (movieUrl) out += '<a href="' + movieUrl + '" target="_blank">📥 宣传视频下载 (' + movieSize + ')</a><br>\n';
  return { title, productId, details, description: translatedDesc, coverImage, sampleImages, trialUrl, trialSize, movieUrl, movieSize, html: out };
}function extractTopicContent(html) {
  const marker = 'id="topic-content"';
  const start = html.indexOf(marker);
  if (start === -1) return '';
  let i = html.indexOf('<', start);
  let depth = 0, end = i;
  while (i < html.length) {
    const s4 = html.substring(i, i + 4);
    const s6 = html.substring(i, i + 6);
    if (s4 === '<div') { depth++; i += 4; }
    else if (s6 === '</div>') {
      if (depth === 0) { end = i; break; }
      depth--; i += 6;
    } else { i++; }
  }
  return html.substring(start + marker.length, end).trim();
}

function extractSidebar(html) {
  const s = {};
  const idx = html.indexOf('id="show_sidebar"');
  if (idx === -1) return s;
  const b = html.substring(idx, idx + 5000);
  const m = (re) => { const x = b.match(re); return x ? x[1].trim() : ''; };
  s.title = m(/<div class="caption">\s*<a[^>]*>([^<]+)<\/a>/);
  const sl = b.match(/href="(\/subjects\/\d+)"/);
  s.subjectUrl = sl ? sl[1] : '';
  return s;
}

function getPageCount(html) {
  const lp = html.match(/href="[^"]*\/page\/(\d+)">尾页/);
  if (lp) return parseInt(lp[1]);
  const ms = [...html.matchAll(/\/topics\/\d+\/page\/(\d+)/g)];
  return ms.length ? Math.max(...ms.map(m => parseInt(m[1]))) : 1;
}

function formatHtml(raw) {
  if (!raw) return '';
  let c = raw.replace(/\r/g, '');
  c = c.replace(/<div class="pagination">[\s\S]*?<\/div>\s*<\/div>/g, '');
  c = c.replace(/<div class="video-player">[\s\S]*?<\/div>/g, '');
  c = c.replace(/ style="[^"]*"/g, '');
  c = c.replace(/^[\s>]+/, '');
  c = c.replace(/<\/p>\s*\n?\s*<p>/g, '<br>\n<br>\n');
  c = c.replace(/<p>/g, '');
  c = c.replace(/<\/p>/g, '<br>');
  c = c.replace(/<h4>/g, '\n<h4>');
  c = c.replace(/<\/h4>/g, '</h4>\n');
  c = c.replace(/\n{3,}/g, '\n\n');
  c = c.replace(/\s+<br>/g, '<br>');
  c = c.replace(/^\s+/, '');
  c = c.replace(/\s+$/, '');
  return c;
}

async function scrape2dfan(url, cookie) {
  console.error('[2DFan] scrape: ' + url);
  const firstHtml = await fetchPage(url, cookie);
  const pageCount = getPageCount(firstHtml);
  console.error('[2DFan] pages: ' + pageCount);
  const sidebar = extractSidebar(firstHtml);
  console.error('[2DFan] game: ' + (sidebar.title || 'unknown'));
  let allContent = '';
  for (let page = 1; page <= pageCount; page++) {
    const pageUrl = page === 1 ? url : url + '/page/' + page;
    console.error('[2DFan] page ' + page + '/' + pageCount);
    const html = page === 1 ? firstHtml : await fetchPage(pageUrl, cookie);
    const content = extractTopicContent(html);
    if (content) allContent += '\n' + content;
    if (page < pageCount) await new Promise(r => setTimeout(r, 300));
  }
  let contentHtml = formatHtml(allContent);
  let result = '';
  if (sidebar.title) { result += '<a href="' + url + '">' + sidebar.title + '</a><br>\n<br>\n'; }
  result += contentHtml;
  return result;
}function parseGalpicUrl(url) {
  const m = url.match(/(?:galpic|ggbase)\.xyz\/show\/(gc\d+|RJ\d+|VJ\d+)(?:\/(\d+))?/i);
  if (!m) return null;
  return { gid: m[1], page: m[2] ? parseInt(m[2]) : 0 };
}

function getGalpicImageUrl(gid, p) {
  if (gid.startsWith('RJ') || gid.startsWith('VJ')) {
    let did = gid.substring(2);
    let pre0 = null, dpre0 = null, npre = null;
    if (did.indexOf('0') === 0) npre = '0';
    try { did = parseInt(did); } catch(e) {}
    let rid = Math.ceil(did / 1000) * 1000;
    if (did < 10) pre0 = '00000';
    else if (did < 100) pre0 = '0000';
    else if (did < 1000) pre0 = '000';
    else if (did < 10000) pre0 = '00';
    else if (did < 100000) pre0 = '0';
    if (rid < 10000) dpre0 = '00';
    else if (rid < 100000) dpre0 = '0';
    if (pre0) did = pre0 + did;
    if (dpre0) rid = dpre0 + rid;
    if (npre && gid.length === 10) { did = npre + did; rid = npre + rid; }
    const prefix = gid.startsWith('VJ') ? 'VJ' : 'RJ';
    if (p === 0) return 'https://file.galpic.xyz/_300_cover/dlsite/' + prefix + rid + '/' + gid + '_img_main.jpg';
    return 'https://file.galpic.xyz/_400_cover/dlsite/' + prefix + rid + '/' + gid + '_' + p + '.jpg';
  }
  if (p === 0) return 'https://file.galpic.xyz/_300_cover/getchu/' + gid + '.jpg';
  const num = gid.replace('gc', '');
  return 'https://file.galpic.xyz/_400_cover/getchu/' + num + '/' + num + '_' + p + '.jpg';
}

async function scrapeGalpic(url) {
  console.error('[galpic] scrape: ' + url);
  const parsed = parseGalpicUrl(url);
  if (!parsed) throw new Error('Cannot parse galpic/ggbase URL');
  const { gid } = parsed;
  const html = await fetchPage(url);
  const pnumMatch = html.match(/var\s+pnum\s*=\s*(\d+)/);
  if (!pnumMatch) throw new Error('Cannot get image count');
  const pnum = parseInt(pnumMatch[1]);
  const imageUrls = [];
  for (let i = 0; i <= pnum; i++) {
    const imgUrl = getGalpicImageUrl(gid, i);
    if (imgUrl) imageUrls.push(imgUrl);
  }
  let result = '\n<!-- ' + gid + ' (' + imageUrls.length + ' images) -->\n';
  for (const imgUrl of imageUrls) { result += '<img src="' + imgUrl + '"><br>\n'; }
  return result;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Error loading index.html');
    }
    return;
  }

  if (req.url === '/proxy-image') {
    let imgUrl = '';
    let cookie = '';
    if (req.method === 'GET') {
      const u = new URL(req.url, 'http://localhost');
      imgUrl = u.searchParams.get('url') || '';
    } else if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        imgUrl = body.url || '';
        cookie = body.cookie || '';
      } catch(e) {}
    }
    if (!imgUrl) { res.writeHead(400); return res.end('Missing url'); }
    try {
      const data = await proxyImage(imgUrl, cookie);
      if (!data) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': data.mime, 'Access-Control-Allow-Origin': '*' });
      res.end(Buffer.from(data.base64, 'base64'));
    } catch (e) { res.writeHead(500); res.end(e.message); }
    return;
  }

  if (req.method === 'POST' && req.url === '/proxy-image-json') {
    try {
      const body = JSON.parse(await readBody(req));
      const data = await proxyImage(body.url, body.cookie || '');
      if (!data) return jsonResponse(res, { ok: false });
      jsonResponse(res, { ok: true, base64: data.base64, mime: data.mime });
    } catch (e) { jsonResponse(res, { ok: false, error: e.message }, 500); }
    return;
  }

  if (req.method === 'POST' && req.url === '/upload-imgbed') {
    try {
      const body = JSON.parse(await readBody(req));
      const imgBuffer = Buffer.from(body.base64, 'base64');
      const ext = (body.mime || 'image/png').includes('png') ? '.png' : '.jpg';
      const blob = new Blob([imgBuffer], { type: body.mime || 'image/png' });
      const formData = new FormData();
      formData.append('file', blob, 'upload' + ext);
      const resp = await fetch('https://17324728.my-imgbed-bs8.pages.dev/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer imgbed_f4415a36e06fd880ea32174be9d583311c6703b871b0be9bc232ab124fca5b54',
        },
        body: formData,
      });
      const result = await resp.json();
      const url = (result[0] && result[0].src) ? 'https://17324728.my-imgbed-bs8.pages.dev' + result[0].src : '';
      jsonResponse(res, { url });
    } catch (e) {
      jsonResponse(res, { error: e.message }, 500);
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));

      if (req.url === '/search') {
        const results = await search2dfan(body.keyword, body.cookie);
        return jsonResponse(res, { results });
      }

      if (req.url === '/scrape') {
        const html = await scrape2dfan(body.url, body.cookie);
        return jsonResponse(res, { html });
      }

      if (req.url === '/search-galpic') {
        const results = await searchGalpic(body.keyword);
        return jsonResponse(res, { results });
      }

      if (req.url === '/scrape-galpic') {
        if (!body.url || (!body.url.includes('galpic.xyz') && !body.url.includes('ggbase.xyz'))) {
          return jsonResponse(res, { error: '请输入有效的 galpic 链接' }, 400);
        }
        const html = await scrapeGalpic(body.url);
        return jsonResponse(res, { html });
      }

      if (req.url === '/search-dlsite') {
        const results = await searchDlsite(body.keyword);
        return jsonResponse(res, { results });
      }

      if (req.url === '/scrape-dlsite') {
        const data = await scrapeDlsite(body.url);
        return jsonResponse(res, data);
      }

      jsonResponse(res, { error: 'Unknown route' }, 404);
    } catch (e) {
      jsonResponse(res, { error: e.message }, 500);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
});
