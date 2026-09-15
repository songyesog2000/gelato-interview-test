(() => {
  const state = {
    schema: null,
    currentId: null,
    parsed: null, // { records, parseErrors, ... } from GET /api/trajectories/:id
    doc: null,    // { trajectoryId, meta, records } from GET /api/annotations/:id
  };

  const el = (id) => document.getElementById(id);
  const trajectoryListEl = el('trajectory-list');
  const recordListEl = el('record-list');
  const recordTemplate = el('record-template');
  const issueTemplate = el('issue-template');

  async function api(path, options) {
    const res = await fetch(`/api${path}`, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `请求失败: ${res.status}`);
    }
    return res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text();
  }

  function padSeq(n) {
    return `P${String(n).padStart(2, '0')}`;
  }

  function emptyIssue(seq) {
    return { 编号: padSeq(seq), 类型: [], 问题现象: '', 判断理由: '', 影响与恢复: '', 改进建议: '' };
  }

  function emptyRecordAnnotation(index, defaultInput) {
    return { index, 阶段: state.schema.stages[0], 本次输入: defaultInput || '', 核查结论: '', 问题标注: [], 异常与疑点: '' };
  }

  // ---------- loading ----------

  async function loadSchema() {
    state.schema = await api('/schema');
    const toolSelect = el('meta-tool');
    toolSelect.innerHTML = state.schema.tools.map((t) => `<option value="${t}">${t}</option>`).join('');
  }

  async function loadTrajectoryList() {
    const list = await api('/trajectories');
    trajectoryListEl.innerHTML = '';
    if (list.length === 0) {
      trajectoryListEl.innerHTML = '<p class="empty-hint">data/trajectories/ 和 samples/ 下暂无 .jsonl 文件</p>';
      return;
    }

    const groups = new Map();
    for (const traj of list) {
      if (!groups.has(traj.group)) groups.set(traj.group, []);
      groups.get(traj.group).push(traj);
    }

    for (const [group, trajs] of groups) {
      const label = document.createElement('div');
      label.className = 'trajectory-group-label';
      label.textContent = group;
      trajectoryListEl.appendChild(label);

      for (const traj of trajs) {
        trajectoryListEl.appendChild(renderTrajectoryItem(traj));
      }
    }
  }

  function renderTrajectoryItem(traj) {
    const row = document.createElement('div');
    row.className = 'trajectory-item';
    row.dataset.id = traj.id;
    if (traj.id === state.currentId) row.classList.add('active');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.textContent = traj.filename;
    nameSpan.title = traj.id;
    row.appendChild(nameSpan);
    row.addEventListener('click', () => selectTrajectory(traj.id));

    if (traj.writable) {
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'rename-btn';
      renameBtn.textContent = '✎';
      renameBtn.title = '重命名';
      renameBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        startRename(row, nameSpan, traj);
      });
      row.appendChild(renameBtn);
    }

    return row;
  }

  function startRename(row, nameSpan, traj) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = traj.filename;
    row.replaceChild(input, nameSpan);
    input.focus();
    input.select();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const newFilename = input.value.trim();
      if (commit && newFilename && newFilename !== traj.filename) {
        try {
          const result = await api(`/trajectories/${encodeURIComponent(traj.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newFilename }),
          });
          if (state.currentId === traj.id) state.currentId = result.id;
        } catch (err) {
          alert(`重命名失败：${err.message}`);
        }
      }
      loadTrajectoryList();
    };

    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') finish(true);
      if (evt.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  function setupImportForm() {
    const form = el('import-form');
    const fileInput = el('import-file');
    const groupInput = el('import-group');
    const errorEl = el('import-error');

    el('import-btn').addEventListener('click', () => {
      form.hidden = !form.hidden;
      errorEl.hidden = true;
    });
    el('import-cancel-btn').addEventListener('click', () => {
      form.hidden = true;
      fileInput.value = '';
      groupInput.value = '';
    });
    el('import-confirm-btn').addEventListener('click', async () => {
      errorEl.hidden = true;
      const file = fileInput.files[0];
      if (!file) {
        errorEl.textContent = '请先选择一个 .jsonl 文件';
        errorEl.hidden = false;
        return;
      }
      try {
        const content = await file.text();
        const { id } = await api('/trajectories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group: groupInput.value.trim(), filename: file.name, content }),
        });
        form.hidden = true;
        fileInput.value = '';
        groupInput.value = '';
        await loadTrajectoryList();
        selectTrajectory(id);
      } catch (err) {
        errorEl.textContent = `导入失败：${err.message}`;
        errorEl.hidden = false;
      }
    });
  }

  async function selectTrajectory(id) {
    state.currentId = id;
    [...trajectoryListEl.querySelectorAll('.trajectory-item')].forEach((row) => row.classList.toggle('active', row.dataset.id === id));

    const [parsed, doc] = await Promise.all([
      api(`/trajectories/${encodeURIComponent(id)}`),
      api(`/annotations/${encodeURIComponent(id)}`),
    ]);
    state.parsed = parsed;
    state.doc = doc;
    if (!state.doc.meta.原始会话文件名) state.doc.meta.原始会话文件名 = id;

    el('empty-state').hidden = true;
    el('workspace').hidden = false;
    renderMeta();
    renderParseWarnings();
    renderRecords();
  }

  // ---------- rendering ----------

  function renderMeta() {
    el('meta-answerer').value = state.doc.meta.作答人 || '';
    el('meta-tool').value = state.doc.meta.使用工具 || state.schema.tools[0];
    el('meta-model').value = state.doc.meta.模型配置 || '';
    el('meta-repo-link').value = state.doc.meta.最终代码链接 || '';
    el('meta-filename').textContent = state.doc.meta.原始会话文件名 || state.currentId;
  }

  function renderParseWarnings() {
    const box = el('parse-warnings');
    const errs = state.parsed.parseErrors || [];
    if (errs.length === 0) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = `有 ${errs.length} 行无法解析为 JSON，已跳过（不计入记录）：<br>` +
      errs.slice(0, 5).map((e) => `第 ${e.line} 行：${e.message}`).join('<br>');
  }

  function eventLabel(item) {
    switch (item.kind) {
      case 'user_input': return { kind: 'user_input', label: '用户输入', text: item.text };
      case 'assistant_text': return { kind: 'assistant_text', label: 'Agent 回复', text: item.text };
      case 'tool_use': return { kind: 'tool_use', label: `工具调用: ${item.toolName}`, text: JSON.stringify(item.input, null, 2) };
      case 'tool_result': return { kind: 'tool_result', label: item.isError ? '工具返回（失败）' : '工具返回', text: item.text, isError: item.isError };
      case 'system': return { kind: 'system', label: '系统', text: item.text };
      default: return { kind: 'unclassified', label: item.kind, text: item.text };
    }
  }

  function renderEventsList(container, items) {
    container.innerHTML = '';
    for (const item of items) {
      const { kind, label, text, isError } = eventLabel(item);
      const li = document.createElement('li');
      li.className = `kind-${kind}${isError ? ' is-error' : ''}`;
      const safeText = (text || '').slice(0, 4000);
      li.innerHTML = `<span class="event-kind">${label}</span><br>${escapeHtml(safeText)}`;
      container.appendChild(li);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function findAnnotation(index) {
    return state.doc.records.find((r) => r.index === index);
  }

  function upsertAnnotation(record) {
    const i = state.doc.records.findIndex((r) => r.index === record.index);
    if (i === -1) state.doc.records.push(record);
    else state.doc.records[i] = record;
  }

  function renderIssueRow(container, record, issue, issueIndex) {
    const node = issueTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('[data-role="issue-seq"]').textContent = issue.编号;

    const typesBox = node.querySelector('[data-role="issue-types"]');
    typesBox.innerHTML = state.schema.issueTypes.map((t) => `
      <label><input type="checkbox" value="${t.code}" ${issue.类型.includes(t.code) ? 'checked' : ''} />${t.code}｜${t.label}</label>
    `).join('');
    typesBox.addEventListener('change', () => {
      issue.类型 = [...typesBox.querySelectorAll('input:checked')].map((i) => i.value);
      markDirty();
    });

    for (const field of ['问题现象', '判断理由', '影响与恢复', '改进建议']) {
      const textarea = node.querySelector(`textarea[data-field="${field}"]`);
      textarea.value = issue[field] || '';
      textarea.addEventListener('input', () => { issue[field] = textarea.value; markDirty(); });
    }

    node.querySelector('[data-role="remove-issue"]').addEventListener('click', () => {
      record.问题标注.splice(issueIndex, 1);
      record.问题标注.forEach((it, i) => { it.编号 = padSeq(i + 1); });
      renderIssuesList(container, record);
      markDirty();
    });

    container.appendChild(node);
  }

  function renderIssuesList(container, record) {
    container.innerHTML = '';
    record.问题标注.forEach((issue, i) => renderIssueRow(container, record, issue, i));
  }

  function renderRecordCard(parsedRecord) {
    const node = recordTemplate.content.firstElementChild.cloneNode(true);
    const annotation = findAnnotation(parsedRecord.seq) || emptyRecordAnnotation(parsedRecord.seq, parsedRecord.inputText);
    upsertAnnotation(annotation);

    node.querySelector('.record-index').textContent = `#${parsedRecord.seq}`;
    node.querySelector('.record-timestamp').textContent = parsedRecord.timestamp || '';

    const stageSelect = node.querySelector('select[data-field="阶段"]');
    stageSelect.innerHTML = state.schema.stages.map((s) => `<option value="${s}">${s}</option>`).join('');
    stageSelect.value = annotation.阶段;
    stageSelect.addEventListener('change', () => { annotation.阶段 = stageSelect.value; markDirty(); });

    const inputTextarea = node.querySelector('textarea[data-field="本次输入"]');
    inputTextarea.value = annotation.本次输入;
    inputTextarea.addEventListener('input', () => { annotation.本次输入 = inputTextarea.value; markDirty(); });

    node.querySelector('[data-role="event-count"]').textContent = parsedRecord.items.length;
    renderEventsList(node.querySelector('[data-role="events-list"]'), parsedRecord.items);

    const conclusionSelect = node.querySelector('select[data-field="核查结论"]');
    conclusionSelect.innerHTML = '<option value=""></option>' +
      state.schema.conclusions.map((c) => `<option value="${c}">${c}</option>`).join('');
    conclusionSelect.value = annotation.核查结论;
    conclusionSelect.addEventListener('change', () => { annotation.核查结论 = conclusionSelect.value; markDirty(); });

    const issuesList = node.querySelector('[data-role="issues-list"]');
    renderIssuesList(issuesList, annotation);
    node.querySelector('[data-role="add-issue"]').addEventListener('click', () => {
      annotation.问题标注.push(emptyIssue(annotation.问题标注.length + 1));
      renderIssuesList(issuesList, annotation);
      markDirty();
    });

    const anomalyTextarea = node.querySelector('textarea[data-field="异常与疑点"]');
    anomalyTextarea.value = annotation.异常与疑点;
    anomalyTextarea.addEventListener('input', () => { annotation.异常与疑点 = anomalyTextarea.value; markDirty(); });

    return node;
  }

  function renderRecords() {
    recordListEl.innerHTML = '';
    const preamble = state.parsed.records.find((r) => r.seq === 0);
    if (preamble && preamble.items.length > 0) {
      const box = document.createElement('details');
      box.className = 'record-card';
      box.innerHTML = '<summary>会话前置信息（首个真实用户指令之前的事件，不计入标注记录）</summary><ol class="events-list"></ol>';
      renderEventsList(box.querySelector('ol'), preamble.items);
      recordListEl.appendChild(box);
    }
    for (const r of state.parsed.records) {
      if (r.seq === 0) continue;
      recordListEl.appendChild(renderRecordCard(r));
    }
  }

  function markDirty() {
    el('save-status').textContent = '有未保存的修改';
    el('save-status').style.color = '#c0392b';
  }

  // ---------- actions ----------

  async function saveAnnotations() {
    state.doc.meta.作答人 = el('meta-answerer').value;
    state.doc.meta.使用工具 = el('meta-tool').value;
    state.doc.meta.模型配置 = el('meta-model').value;
    state.doc.meta.最终代码链接 = el('meta-repo-link').value;

    try {
      await api(`/annotations/${encodeURIComponent(state.currentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.doc),
      });
      el('save-status').textContent = `已保存 ${new Date().toLocaleTimeString()}`;
      el('save-status').style.color = '#2e7d32';
    } catch (err) {
      el('save-status').textContent = `保存失败：${err.message}`;
      el('save-status').style.color = '#c0392b';
    }
  }

  async function exportCsv() {
    try {
      const res = await fetch(`/api/annotations/${encodeURIComponent(state.currentId)}/export`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `导出失败: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${state.currentId.replace(/\//g, '__')}.annotations.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`导出失败：${err.message}`);
    }
  }

  // ---------- auth ----------

  async function tryResumeSession() {
    try {
      const me = await api('/me');
      el('candidate-name').textContent = me.name;
      el('login-screen').hidden = true;
      el('app-shell').hidden = false;
      return true;
    } catch (err) {
      el('login-screen').hidden = false;
      el('app-shell').hidden = true;
      return false;
    }
  }

  async function doLogin(evt) {
    evt.preventDefault();
    const codeInput = el('login-code');
    const errorEl = el('login-error');
    errorEl.hidden = true;
    const code = codeInput.value.trim();
    if (!code) return;
    try {
      await api('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      codeInput.value = '';
      const ok = await tryResumeSession();
      if (ok) {
        await loadTrajectoryList();
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function doLogout() {
    await api('/logout', { method: 'POST' }).catch(() => {});
    state.currentId = null;
    state.parsed = null;
    state.doc = null;
    el('empty-state').hidden = false;
    el('workspace').hidden = true;
    el('login-screen').hidden = false;
    el('app-shell').hidden = true;
  }

  // ---------- init ----------

  el('refresh-btn').addEventListener('click', loadTrajectoryList);
  el('save-btn').addEventListener('click', saveAnnotations);
  el('export-btn').addEventListener('click', exportCsv);
  el('login-form').addEventListener('submit', doLogin);
  el('logout-btn').addEventListener('click', doLogout);
  setupImportForm();

  (async function init() {
    await loadSchema();
    const authed = await tryResumeSession();
    if (authed) await loadTrajectoryList();
  })();
})();
