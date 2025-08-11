// Minimal diff app leveraging body.html logic

document.addEventListener('DOMContentLoaded', () => {
  const fileInputA = document.getElementById('file-input-a');
  const fileInputB = document.getElementById('file-input-b');
  const progress = document.getElementById('progress-container');
  const results = document.getElementById('results-section');
  const fileANameEl = document.getElementById('file-a-name');
  const fileBNameEl = document.getElementById('file-b-name');
  const tableFilters = document.getElementById('table-filters');
  const tableContainers = document.getElementById('table-containers');

  let diagA = null;
  let diagB = null;

  const readDiag = async (file) => {
    const zipReader = new zip.ZipReader(new zip.BlobReader(file));
    const entries = await zipReader.getEntries();
    const files = {};
    const readText = async (entry) => entry.getData(new zip.TextWriter());

    // Reuse subset of body.html extraction logic
    for (const entry of entries) {
      if (entry.directory) continue;
      try {
        // Only gather files we render in UI tables
        if (/config\/general-settings\.json$/.test(entry.filename) ||
            /config\/license\.json$/.test(entry.filename) ||
            /config\/users\.json$/.test(entry.filename) ||
            /config\/connections\.json$/.test(entry.filename) ||
            /dss-version\.json$/.test(entry.filename) ||
            /diagnostic\/.*projects\/params\.json$/.test(entry.filename) ||
            /config\/plugins\/[^/]+\/settings\.json$/.test(entry.filename) ||
            /code-envs\/desc\/.+?\/desc\.json$/.test(entry.filename) ||
            /run\/backend\.log$/.test(entry.filename) ||
            /(\/|^)diag\.txt$/.test(entry.filename)) {
          files[entry.filename] = await readText(entry);
        }
      } catch (e) {
        console.warn('Skip unreadable', entry.filename, e);
      }
    }
    await zipReader.close();
    return files;
  };

  const parseDiag = (files) => {
    // Very small subset parser copied from body.html parsers
    const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
    const parsed = {
      version: null,
      plugins: [],
      codeEnvs: [],
      connections: {},
      connectionsList: [],
      usersList: [],
      usersMap: {},
      license: null,
      generalSettings: null,
      projects: [],
      memoryInfo: null,
      filesystems: [],
    };
    for (const [path, content] of Object.entries(files)) {
      if (/dss-version\.json$/.test(path)) {
        const j = safeJson(content); parsed.version = j?.version || j?.DSS_VERSION || null;
      } else if (/config\/plugins\/.+\/settings\.json$/.test(path)) {
        const m = path.match(/config\/plugins\/([^/]+)\/settings\.json$/);
        if (m) parsed.plugins.push(m[1]);
      } else if (/code-envs\/desc\/.+?\/desc\.json$/.test(path)) {
        const j = safeJson(content); if (j?.name) parsed.codeEnvs.push({ name: j.name, version: j?.python || j?.pythonVersion });
      } else if (/config\/connections\.json$/.test(path)) {
        const j = safeJson(content); if (j) {
          parsed.connections = j;
          if (typeof j === 'object' && j) parsed.connectionsList = Object.keys(j);
        }
      } else if (/config\/users\.json$/.test(path)) {
        const j = safeJson(content);
        const addUser = (u) => {
          const key = u?.login || u?.username || u?.id || u?.name;
          if (!key) return;
          parsed.usersMap[key] = u;
          parsed.usersList.push(key);
        };
        if (Array.isArray(j)) j.forEach(addUser);
        else if (j?.users && Array.isArray(j.users)) j.users.forEach(addUser);
        else if (j && typeof j === 'object') Object.entries(j).forEach(([k, v]) => { parsed.usersMap[k] = v; parsed.usersList.push(k); });
      } else if (/config\/license\.json$/.test(path)) {
        parsed.license = safeJson(content);
      } else if (/config\/general-settings\.json$/.test(path)) {
        parsed.generalSettings = safeJson(content);
      } else if (/projects\/params\.json$/.test(path)) {
        const j = safeJson(content); if (j?.projectKey) parsed.projects.push({ key: j.projectKey, name: j.projectDisplayName || j.projectKey, owner: j.owner || j.projectOwner });
      }
    }
    parsed.plugins = Array.from(new Set(parsed.plugins)).sort();
    parsed.usersList = Array.from(new Set(parsed.usersList)).sort();
    parsed.connectionsList = Array.from(new Set(parsed.connectionsList)).sort();
    // Parse diag.txt for memory/filesystem
    const diagTxtPath = Object.keys(files).find(k => /(\/|^)diag\.txt$/.test(k));
    if (diagTxtPath) {
      const diagTxt = files[diagTxtPath];
      parsed.memoryInfo = parseMemoryFromDiagTxt(diagTxt);
      parsed.filesystems = parseFilesystemFromDiagTxt(diagTxt);
    }
    return parsed;
  };

  const summarizeConn = (v) => {
    if (!v) return '-';
    if (typeof v === 'string') return v;
    if (v.type) return `type=${v.type}`;
    if (v.kind) return `kind=${v.kind}`;
    const keys = Object.keys(v || {});
    return `${keys.length} fields`;
  };

  const extractSection = (content, cmdRegex) => {
    const re = new RegExp(`>\\s*${cmdRegex}\\n([\\s\\S]+?)(?=\\n>|\\n\\n|$)`);
    const m = content.match(re);
    return m ? m[1].trim() : null;
  };

  const parseMemoryFromDiagTxt = (content) => {
    const sec = extractSection(content, 'free\\s+-m');
    if (!sec) return null;
    const line = (sec.split('\n').find(l => /^Mem:\s+/i.test(l)) || '').trim();
    if (!line) return null;
    const parts = line.replace(/\s+/g, ' ').split(' ');
    if (parts.length < 7) return null;
    const [, total, used, free, shared, buffCache, available] = parts;
    return { totalMB: Number(total), usedMB: Number(used), freeMB: Number(free), sharedMB: Number(shared), buffCacheMB: Number(buffCache), availableMB: Number(available) };
  };

  const parseFilesystemFromDiagTxt = (content) => {
    const sec = extractSection(content, 'df\\s+-h');
    if (!sec) return [];
    const lines = sec.split('\n').map(l => l.trim()).filter(Boolean);
    const headerIdx = lines.findIndex(l => /Filesystem/i.test(l) && /Mounted/i.test(l));
    const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;
    const rows = [];
    dataLines.forEach(l => {
      const cols = l.replace(/\s+/g, ' ').split(' ');
      if (cols.length >= 6) {
        const [filesystem, size, used, avail, usep, ...rest] = cols;
        const mount = rest.join(' ');
        rows.push({ filesystem, size, used, avail, usePercent: usep, mount });
      }
    });
    return rows;
  };

  const diffObjects = (a = {}, b = {}) => {
    const keys = new Set([...(a ? Object.keys(a) : []), ...(b ? Object.keys(b) : [])]);
    const rows = [];
    keys.forEach((k) => {
      const av = a?.[k];
      const bv = b?.[k];
      if (av === undefined && bv !== undefined) rows.push({ item: k, status: 'Added', _class: 'text-added' });
      else if (av !== undefined && bv === undefined) rows.push({ item: k, status: 'Removed', _class: 'text-removed' });
      else if (JSON.stringify(av) !== JSON.stringify(bv)) rows.push({ item: k, status: 'Changed', _class: 'text-changed' });
      else rows.push({ item: k, status: 'Same', _class: 'text-same' });
    });
    return rows.sort((x, y) => x.item.localeCompare(y.item));
  };

  const diffArrays = (a, b, keyFn) => {
    const aMap = new Map(a.map((x) => [keyFn(x), x]));
    const bMap = new Map(b.map((x) => [keyFn(x), x]));
    const keys = new Set([...aMap.keys(), ...bMap.keys()]);
    const added = [], removed = [], common = [];
    keys.forEach((k) => {
      if (aMap.has(k) && !bMap.has(k)) removed.push(aMap.get(k));
      else if (!aMap.has(k) && bMap.has(k)) added.push(bMap.get(k));
      else common.push([aMap.get(k), bMap.get(k)]);
    });
    return { added, removed, common };
  };

  const renderDiffTable = (id, title, rows, opts = {}) => {
    const container = document.createElement('div');
    container.className = 'table-container' + (opts.half ? ' half-width' : '');
    container.id = id;
    const h = document.createElement('h4'); h.className = 'table-title'; h.textContent = title; container.appendChild(h);
    const table = document.createElement('table'); table.className = 'table';
    const thead = document.createElement('thead'); const hr = document.createElement('tr');
    ['Item', 'Status'].forEach(t => { const th = document.createElement('th'); th.textContent = t; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      const c1 = document.createElement('td');
      c1.textContent = r.item; tr.appendChild(c1);
      const c2 = document.createElement('td');
      c2.textContent = r.status;
      if (r._class) c2.className = r._class;
      tr.appendChild(c2);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = document.createElement('div'); wrap.className = 'table-scroll'; wrap.appendChild(table);
    container.appendChild(wrap);
    tableContainers.appendChild(container);

    // filter button
    const btn = document.createElement('button');
    btn.className = 'filter-btn'; btn.textContent = title; btn.dataset.filter = id;
    btn.addEventListener('click', () => applyFilter(id));
    tableFilters.appendChild(btn);
  };

  let onlyChanges = true;
  const applyFilter = (id) => {
    document.querySelectorAll('#table-containers > div.table-container').forEach((div) => {
      div.style.display = (id === 'all' || div.id === id) ? '' : 'none';
      if (onlyChanges) {
        // hide same rows
        div.querySelectorAll('tbody tr').forEach(tr => {
          const statusCell = tr.cells[1];
          if (statusCell && statusCell.classList.contains('text-same')) {
            tr.style.display = 'none';
          }
        });
      } else {
        div.querySelectorAll('tbody tr').forEach(tr => { tr.style.display = ''; });
      }
    });
    document.querySelectorAll('#table-filters .filter-btn').forEach((b) => b.classList.toggle('active', b.dataset.filter === id));
  };

  const buildDiff = (a, b) => {
    tableContainers.innerHTML = '';
    tableFilters.innerHTML = '';
    const allBtn = document.createElement('button'); allBtn.className = 'filter-btn active'; allBtn.textContent = 'All Tables'; allBtn.dataset.filter = 'all'; allBtn.onclick = () => applyFilter('all');
    tableFilters.appendChild(allBtn);

    const onlyBtn = document.createElement('button'); onlyBtn.className = 'filter-btn active'; onlyBtn.textContent = 'Only Changes';
    onlyBtn.onclick = () => { onlyChanges = !onlyChanges; onlyBtn.classList.toggle('active', onlyChanges); applyFilter('all'); };
    tableFilters.appendChild(onlyBtn);

    // Version
    renderDiffTable('version-diff', 'DSS Version', [
      {
        item: 'DSS Version',
        status: a.version === b.version ? `${a.version || '-'}` : `${a.version || '-'} → ${b.version || '-'}`,
        _class: a.version === b.version ? 'text-same' : 'text-changed'
      }
    ], { half: true });

    // Plugins
    const pluginsDiff = diffArrays(a.plugins, b.plugins, (x) => x);
    const pluginRows = [
      ...pluginsDiff.added.map(p => ({ item: p, status: 'Added', _class: 'text-added' })),
      ...pluginsDiff.removed.map(p => ({ item: p, status: 'Removed', _class: 'text-removed' })),
      ...pluginsDiff.common.map(([pa]) => ({ item: pa, status: 'Same', _class: 'text-same' }))
    ];
    renderDiffTable('plugins-diff', `Plugins (${pluginRows.length})`, pluginRows, { half: true });

    // Code Envs (by name)
    const envsDiff = diffArrays(a.codeEnvs, b.codeEnvs, (x) => (x.name || String(x)).toLowerCase());
    const envRows = [
      ...envsDiff.added.map(e => ({ item: e.name, status: 'Added', _class: 'text-added' })),
      ...envsDiff.removed.map(e => ({ item: e.name, status: 'Removed', _class: 'text-removed' })),
      ...envsDiff.common.map(([ea, eb]) => ({ item: ea.name, status: ea.version === eb.version ? 'Same' : `${ea.version || '-'} → ${eb.version || '-'}`, _class: ea.version === eb.version ? 'text-same' : 'text-changed' }))
    ];
    envRows.sort((a,b)=> a.item.localeCompare(b.item));
    renderDiffTable('envs-diff', `Code Environments (${envRows.length})`, envRows, { half: true });

    // Memory Info
    if (a.memoryInfo || b.memoryInfo) {
      const memRows = diffObjects(a.memoryInfo || {}, b.memoryInfo || {});
      renderDiffTable('memory-diff', `Memory (${memRows.length})`, memRows, { half: true });
    }

    // Filesystems
    if ((a.filesystems && a.filesystems.length) || (b.filesystems && b.filesystems.length)) {
      const fsA = a.filesystems || [];
      const fsB = b.filesystems || [];
      const fsDiff = diffArrays(fsA, fsB, (x) => x.mount || `${x.filesystem}:${x.mount}`);
      const fsRows = [];
      fsDiff.added.forEach(r => fsRows.push({ item: `${r.mount} (${r.usePercent || '?'})`, status: 'Added', _class: 'text-added' }));
      fsDiff.removed.forEach(r => fsRows.push({ item: `${r.mount} (${r.usePercent || '?'})`, status: 'Removed', _class: 'text-removed' }));
      fsDiff.common.forEach(([ra, rb]) => {
        if ((ra.usePercent || '') !== (rb.usePercent || '')) {
          fsRows.push({ item: `${ra.mount}`, status: `${ra.usePercent || '-'} → ${rb.usePercent || '-'}`, _class: 'text-changed' });
        } else {
          fsRows.push({ item: `${ra.mount}`, status: 'Same', _class: 'text-same' });
        }
      });
      renderDiffTable('filesystem-diff', `Filesystem (${fsRows.length})`, fsRows, { half: true });
    }

    // Projects
    const projDiff = diffArrays(a.projects, b.projects, (x) => x.key);
    const projRows = [];
    projDiff.added.forEach(p => projRows.push({ item: `${p.name} (${p.key})`, status: 'Added', _class: 'text-added' }));
    projDiff.removed.forEach(p => projRows.push({ item: `${p.name} (${p.key})`, status: 'Removed', _class: 'text-removed' }));
    projDiff.common.forEach(([pa, pb]) => {
      if ((pa?.owner || '') !== (pb?.owner || '')) {
        projRows.push({ item: `${pa.name} (${pa.key})`, status: `Owner ${pa?.owner || '-'} → ${pb?.owner || '-'}`, _class: 'text-changed' });
      } else {
        projRows.push({ item: `${pa.name} (${pa.key})`, status: 'Same', _class: 'text-same' });
      }
    });
    renderDiffTable('projects-diff', `Projects (${projRows.length})`, projRows, { half: true });

    // Users (show old → new summary: admin and group count)
    const usersDiff = diffArrays(a.usersList, b.usersList, (x) => x);
    const userRows = [];
    usersDiff.added.forEach(u => userRows.push({ item: u, status: `- → present`, _class: 'text-added' }));
    usersDiff.removed.forEach(u => userRows.push({ item: u, status: `present → -`, _class: 'text-removed' }));
    usersDiff.common.forEach(([u]) => {
      const ua = a.usersMap?.[u] || {};
      const ub = b.usersMap?.[u] || {};
      const adminA = !!(ua.admin ?? ua.isAdmin ?? ua.administrator);
      const adminB = !!(ub.admin ?? ub.isAdmin ?? ub.administrator);
      const groupsA = Array.isArray(ua.groups) ? ua.groups : (Array.isArray(ua.groupNames) ? ua.groupNames : []);
      const groupsB = Array.isArray(ub.groups) ? ub.groups : (Array.isArray(ub.groupNames) ? ub.groupNames : []);
      const aStr = `admin=${adminA ? '✓' : '✗'}, groups=${groupsA.length}`;
      const bStr = `admin=${adminB ? '✓' : '✗'}, groups=${groupsB.length}`;
      const same = adminA === adminB && groupsA.length === groupsB.length;
      userRows.push({ item: u, status: `${aStr} → ${bStr}`, _class: same ? 'text-same' : 'text-changed' });
    });
    renderDiffTable('users-diff', `Users (${userRows.length})`, userRows, { half: true });

    // Connections (show old → new summary using type/kind or field count)
    const connDiff = diffArrays(a.connectionsList, b.connectionsList, (x) => x);
    const connRows = [];
    connDiff.added.forEach(c => connRows.push({ item: c, status: `- → ${summarizeConn(b.connections?.[c])}`, _class: 'text-added' }));
    connDiff.removed.forEach(c => connRows.push({ item: c, status: `${summarizeConn(a.connections?.[c])} → -`, _class: 'text-removed' }));
    connDiff.common.forEach(([c]) => {
      const av = a.connections?.[c];
      const bv = b.connections?.[c];
      const same = JSON.stringify(av) === JSON.stringify(bv);
      connRows.push({ item: c, status: `${summarizeConn(av)} → ${summarizeConn(bv)}`, _class: same ? 'text-same' : 'text-changed' });
    });
    renderDiffTable('connections-diff', `Connections (${connRows.length})`, connRows, { half: true });

    // License
    if (a.license || b.license) {
      const licenseRows = diffObjects(a.license || {}, b.license || {});
      renderDiffTable('license-diff', `License (${licenseRows.length})`, licenseRows, { half: true });
    }

    // General Settings (top level sections)
    if (a.generalSettings || b.generalSettings) {
      const aGS = a.generalSettings || {};
      const bGS = b.generalSettings || {};
      const sections = new Set([...Object.keys(aGS), ...Object.keys(bGS)]);
      Array.from(sections).sort().forEach((section) => {
        const rows = diffObjects(aGS?.[section] || {}, bGS?.[section] || {});
        renderDiffTable(`gs-${section}-diff`, `General Settings: ${section} (${rows.length})`, rows, { half: true });
      });
    }
  };

  const maybeRun = async () => {
    if (!(fileInputA.files?.[0] && fileInputB.files?.[0])) return;
    progress.style.display = 'block';
    results.style.display = 'none';
    fileANameEl.textContent = fileInputA.files[0].name;
    fileBNameEl.textContent = fileInputB.files[0].name;
    try {
      const [filesA, filesB] = await Promise.all([readDiag(fileInputA.files[0]), readDiag(fileInputB.files[0])]);
      diagA = parseDiag(filesA);
      diagB = parseDiag(filesB);
      buildDiff(diagA, diagB);
      results.style.display = 'block';
    } catch (e) {
      alert('Error processing zips: ' + e.message);
      console.error(e);
    } finally {
      progress.style.display = 'none';
    }
  };

  fileInputA.addEventListener('change', maybeRun);
  fileInputB.addEventListener('change', maybeRun);
});


