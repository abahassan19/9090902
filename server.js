const express = require('express');
const { v4: uuidv4 } = require('uuid');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory storage
const clients = new Map(); // clientId -> { lastCommandId: 0, lastOutput: '' }
let latestCommand = { id: 0, cmd: '' };

// Serve a simple web UI
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Remote Command</title></head>
    <body>
      <h1>Remote Command</h1>
      <form action="/command" method="POST">
        <input type="text" name="cmd" placeholder="Enter command" style="width:60%;" />
        <button type="submit">Send</button>
      </form>
      <h3>Client Outputs</h3>
      <div id="outputs"></div>
      <script>
        async function fetchOutputs() {
          const res = await fetch('/outputs');
          const data = await res.json();
          const container = document.getElementById('outputs');
          container.innerHTML = '';
          for (const [id, info] of Object.entries(data)) {
            const div = document.createElement('div');
            div.textContent = id + ': ' + info.lastOutput;
            container.appendChild(div);
          }
        }
        setInterval(fetchOutputs, 1000);
        fetchOutputs();
      </script>
    </body>
    </html>
  `);
});

// Register a new client
app.post('/register', (req, res) => {
  const clientId = uuidv4();
  clients.set(clientId, { lastCommandId: 0, lastOutput: '' });
  res.json({ clientId });
});

// Get the latest command (only if new)
app.get('/command', (req, res) => {
  const clientId = req.query.clientId;
  if (!clientId || !clients.has(clientId)) {
    return res.status(400).json({ error: 'Invalid client' });
  }
  const client = clients.get(clientId);
  if (latestCommand.id > client.lastCommandId) {
    res.json({ command: latestCommand.cmd, id: latestCommand.id });
  } else {
    res.json({ command: '', id: client.lastCommandId });
  }
});

// Acknowledge command execution (update lastCommandId)
app.post('/ack', (req, res) => {
  const { clientId, commandId } = req.body;
  if (!clientId || !clients.has(clientId)) {
    return res.status(400).json({ error: 'Invalid client' });
  }
  const client = clients.get(clientId);
  if (commandId > client.lastCommandId) {
    client.lastCommandId = commandId;
  }
  res.json({ ok: true });
});

// Submit command output
app.post('/output', (req, res) => {
  const { clientId, output } = req.body;
  if (!clientId || !clients.has(clientId)) {
    return res.status(400).json({ error: 'Invalid client' });
  }
  const client = clients.get(clientId);
  client.lastOutput = output;
  res.json({ ok: true });
});

// Get all outputs (for UI)
app.get('/outputs', (req, res) => {
  const outputs = {};
  for (const [id, info] of clients) {
    outputs[id] = { lastOutput: info.lastOutput };
  }
  res.json(outputs);
});

// Submit new command (from UI)
app.post('/command', (req, res) => {
  const cmd = req.body.cmd;
  if (!cmd) {
    return res.redirect('/');
  }
  latestCommand.id++;
  latestCommand.cmd = cmd;
  res.redirect('/');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP Server running on port ${PORT}`);
});
