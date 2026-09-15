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
      trajectoryListEl.innerHTML = '<li style="cursor:default;color:#999;">data/trajectories/ 下暂无 .jsonl 文件</li>';
      return;
    }
    for (const traj of list) {
      const li = document.createElement('li');
      li.textContent = traj.id;
      li.dataset.id = traj.id;
      if (traj.id === state.currentId) li.classList.add('active');
      li.addEventListener('click', () => selectTrajectory(traj.id));
      trajectoryListEl.appendChild(li);
    }
  }

  async function selectTrajectory(id) {
    state.currentId = id;
    [...trajectoryListEl.children].forEach((li) => li.classList.toggle('active', li.dataset.id === id));

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

  function exportCsv() {
    window.location.href = `/api/annotations/${encodeURIComponent(state.currentId)}/export`;
  }

  // ---------- init ----------

  el('refresh-btn').addEventListener('click', loadTrajectoryList);
  el('save-btn').addEventListener('click', saveAnnotations);
  el('export-btn').addEventListener('click', exportCsv);

  (async function init() {
    await loadSchema();
    await loadTrajectoryList();
  })();
})();
