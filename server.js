const express = require('express');
const path = require('path');
const fs = require('fs');
const ftp = require('basic-ftp');
const SftpClient = require('ssh2-sftp-client');
const multer = require('multer');
const WebSocket = require('ws');
const { randomUUID } = require('crypto');
const os = require('os');

const app = express();
const PORT = 3000;
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active connections
const connections = {};
const SITES_FILE = path.join(__dirname, 'sites.json');
const transferQueue = {};

const uploadDir = isVercel
  ? path.join(os.tmpdir(), 'filezillapl-uploads')
  : path.join(__dirname, 'temp_uploads');

fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

function loadSites() {
  try {
    if (fs.existsSync(SITES_FILE)) {
      return JSON.parse(fs.readFileSync(SITES_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveSites(sites) {
  fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2));
}

function getDriveLetters() {
  if (process.platform !== 'win32') return null;
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const drive = String.fromCharCode(i) + ':\\';
    try {
      fs.accessSync(drive);
      drives.push(drive);
    } catch (e) {}
  }
  return drives;
}

// ==================== LOCAL FILE SYSTEM ROUTES ====================

app.get('/api/local/list', (req, res) => {
  let dirPath = req.query.path || os.homedir();

  if (dirPath === '/' && process.platform === 'win32') {
    const drives = getDriveLetters();
    if (drives) {
      const items = drives.map(d => ({
        name: d,
        path: d,
        size: 0,
        modifiedDate: new Date().toISOString(),
        isDirectory: true,
        permissions: '777',
        type: 'drive'
      }));
      return res.json({ path: '/', items, parent: null });
    }
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        items.push({
          name: entry.name,
          path: fullPath,
          size: stat.size,
          modifiedDate: stat.mtime.toISOString(),
          isDirectory: entry.isDirectory(),
          permissions: stat.mode.toString(8).slice(-3),
          type: entry.isDirectory() ? 'directory' : path.extname(entry.name).slice(1) || 'file'
        });
      } catch (e) {}
    }

    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    const parent = path.dirname(dirPath);
    res.json({
      path: dirPath,
      items,
      parent: parent !== dirPath ? parent : (process.platform === 'win32' ? '/' : null)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/local/mkdir', (req, res) => {
  const { dirPath } = req.body;
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/local/delete', (req, res) => {
  const { filePath } = req.body;
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/local/rename', (req, res) => {
  const { oldPath, newPath } = req.body;
  try {
    fs.renameSync(oldPath, newPath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/local/info', (req, res) => {
  const filePath = req.query.path;
  try {
    const stat = fs.statSync(filePath);
    res.json({
      name: path.basename(filePath),
      path: filePath,
      size: stat.size,
      modifiedDate: stat.mtime.toISOString(),
      createdDate: stat.birthtime.toISOString(),
      isDirectory: stat.isDirectory(),
      permissions: stat.mode.toString(8).slice(-3),
      type: stat.isDirectory() ? 'directory' : path.extname(filePath).slice(1) || 'file'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== CONNECTION ROUTES ====================

app.post('/api/connect', async (req, res) => {
  const { host, port, username, password, protocol, privateKey } = req.body;
  const connId = randomUUID();

  try {
    if (protocol === 'sftp') {
      const sftp = new SftpClient();
      const connectOptions = { host, port: port || 22, username };
      if (privateKey) {
        connectOptions.privateKey = privateKey;
      } else {
        connectOptions.password = password;
      }
      await sftp.connect(connectOptions);
      connections[connId] = { type: 'sftp', client: sftp, host, username };
    } else {
      const client = new ftp.Client();
      client.ftp.verbose = false;
      await client.access({
        host,
        port: port || 21,
        user: username,
        password: password || '',
        secure: protocol === 'ftps'
      });
      connections[connId] = { type: 'ftp', client, host, username };
    }

    res.json({ success: true, connId, message: `Connected to ${host}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/disconnect', async (req, res) => {
  const { connId } = req.body;
  try {
    if (connections[connId]) {
      if (connections[connId].type === 'sftp') {
        await connections[connId].client.end();
      } else {
        connections[connId].client.close();
      }
      delete connections[connId];
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== REMOTE FILE SYSTEM ROUTES ====================

app.get('/api/remote/list', async (req, res) => {
  const { connId, path: remotePath } = req.query;

  if (!connections[connId]) {
    return res.status(400).json({ error: 'Not connected' });
  }

  try {
    const conn = connections[connId];
    let items = [];
    let currentPath = remotePath || '/';

    if (conn.type === 'sftp') {
      const list = await conn.client.list(currentPath);
      items = list.map(item => ({
        name: item.name,
        path: currentPath === '/' ? '/' + item.name : currentPath + '/' + item.name,
        size: item.size,
        modifiedDate: new Date(item.modifyTime).toISOString(),
        isDirectory: item.type === 'd',
        permissions: item.rights ? `${item.rights.user}${item.rights.group}${item.rights.other}` : '---',
        owner: item.owner || '-',
        group: item.group || '-',
        type: item.type === 'd' ? 'directory' : (item.name.split('.').pop() || 'file')
      }));
    } else {
      await conn.client.cd(currentPath);
      currentPath = await conn.client.pwd();
      const list = await conn.client.list();
      items = list.map(item => ({
        name: item.name,
        path: currentPath === '/' ? '/' + item.name : currentPath + '/' + item.name,
        size: item.size,
        modifiedDate: item.rawModifiedAt || new Date(item.modifiedAt).toISOString(),
        isDirectory: item.isDirectory,
        permissions: item.permissions ? item.permissions.toString() : '---',
        owner: item.user || '-',
        group: item.group || '-',
        type: item.isDirectory ? 'directory' : (item.name.split('.').pop() || 'file')
      }));
    }

    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    items = items.filter(i => i.name !== '.' && i.name !== '..');

    const parent = currentPath === '/' ? null : currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
    res.json({ path: currentPath, items, parent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/remote/mkdir', async (req, res) => {
  const { connId, dirPath } = req.body;
  if (!connections[connId]) return res.status(400).json({ error: 'Not connected' });

  try {
    const conn = connections[connId];
    if (conn.type === 'sftp') {
      await conn.client.mkdir(dirPath, true);
    } else {
      await conn.client.ensureDir(dirPath);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/remote/delete', async (req, res) => {
  const { connId, filePath, isDirectory } = req.body;
  if (!connections[connId]) return res.status(400).json({ error: 'Not connected' });

  try {
    const conn = connections[connId];
    if (conn.type === 'sftp') {
      if (isDirectory) {
        await conn.client.rmdir(filePath, true);
      } else {
        await conn.client.delete(filePath);
      }
    } else {
      if (isDirectory) {
        await conn.client.removeDir(filePath);
      } else {
        await conn.client.remove(filePath);
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/remote/rename', async (req, res) => {
  const { connId, oldPath, newPath } = req.body;
  if (!connections[connId]) return res.status(400).json({ error: 'Not connected' });

  try {
    const conn = connections[connId];
    if (conn.type === 'sftp') {
      await conn.client.rename(oldPath, newPath);
    } else {
      await conn.client.rename(oldPath, newPath);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/remote/chmod', async (req, res) => {
  const { connId, filePath, mode } = req.body;
  if (!connections[connId]) return res.status(400).json({ error: 'Not connected' });

  try {
    const conn = connections[connId];
    if (conn.type === 'sftp') {
      await conn.client.chmod(filePath, parseInt(mode, 8));
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'chmod not supported for FTP' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== TRANSFER ROUTES ====================

app.post('/api/transfer/upload', upload.single('file'), async (req, res) => {
  const { connId, remotePath } = req.body;
  if (!connections[connId]) return res.status(400).json({ error: 'Not connected' });

  const transferId = randomUUID();

  try {
    const conn = connections[connId];
    const localFilePath = req.file.path;
    const remoteFilePath = remotePath + '/' + req.file.originalname;

    transferQueue[transferId] = {
      id: transferId, type: 'upload', fileName: req.file.originalname,
      size: req.file.size, status: 'transferring', progress: 0
    };
    broadcastTransferUpdate(transferId);

    if (conn.type === 'sftp') {
      await conn.client.fastPut(localFilePath, remoteFilePath);
    } else {
      await conn.client.uploadFrom(localFilePath, remoteFilePath);
    }

    transferQueue[transferId].status = 'completed';
    transferQueue[transferId].progress = 100;
    broadcastTransferUpdate(transferId);
    fs.unlinkSync(localFilePath);

    res.json({ success: true, transferId });
  } catch (e) {
    if (transferQueue[transferId]) {
      transferQueue[transferId].status = 'failed';
      transferQueue[transferId].error = e.message;
      broadcastTransferUpdate(transferId);
    }
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/transfer/upload-local', async (req, res) => {
  const { connId, localPath, remotePath } = req.body;
  if (!connections[connId]) return res.status(400).json({ error: 'Not connected' });

  const transferId = randomUUID();
  const fileName = path.basename(localPath);

  try {
    const stat = fs.statSync(localPath);
    const conn = connections[connId];
    const remoteFilePath = remotePath === '/' ? '/' + fileName : remotePath + '/' + fileName;

    transferQueue[transferId] = {
      id: transferId, type: 'upload', fileName, size: stat.size,
      status: 'transferring', progress: 0, localPath, remotePath: remoteFilePath
    };
    broadcastTransferUpdate(transferId);

    if (stat.isDirectory()) {
      await uploadDirRecursive(conn, localPath, remoteFilePath);
    } else {
      if (conn.type === 'sftp') {
        await conn.client.fastPut(localPath, remoteFilePath);
      } else {
        await conn.client.uploadFrom(localPath, remoteFilePath);
      }
    }

    transferQueue[transferId].status = 'completed';
    transferQueue[transferId].progress = 100;
    broadcastTransferUpdate(transferId);
    res.json({ success: true, transferId });
  } catch (e) {
    if (transferQueue[transferId]) {
      transferQueue[transferId].status = 'failed';
      transferQueue[transferId].error = e.message;
      broadcastTransferUpdate(transferId);
    }
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/transfer/download', async (req, res) => {
  const { connId, remotePath, localPath } = req.body;
  if (!connections[connId]) return res.status(400).json({ error: 'Not connected' });

  const transferId = randomUUID();
  const fileName = path.basename(remotePath);

  try {
    const conn = connections[connId];
    const localFilePath = path.join(localPath, fileName);

    transferQueue[transferId] = {
      id: transferId, type: 'download', fileName,
      status: 'transferring', progress: 0, localPath: localFilePath, remotePath
    };
    broadcastTransferUpdate(transferId);

    if (conn.type === 'sftp') {
      await conn.client.fastGet(remotePath, localFilePath);
    } else {
      await conn.client.downloadTo(localFilePath, remotePath);
    }

    transferQueue[transferId].status = 'completed';
    transferQueue[transferId].progress = 100;
    broadcastTransferUpdate(transferId);
    res.json({ success: true, transferId });
  } catch (e) {
    if (transferQueue[transferId]) {
      transferQueue[transferId].status = 'failed';
      transferQueue[transferId].error = e.message;
      broadcastTransferUpdate(transferId);
    }
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/transfer/download-dir', async (req, res) => {
  const { connId, remotePath, localPath } = req.body;
  if (!connections[connId]) return res.status(400).json({ error: 'Not connected' });

  const transferId = randomUUID();
  const dirName = path.basename(remotePath);

  try {
    const conn = connections[connId];
    const localDirPath = path.join(localPath, dirName);

    transferQueue[transferId] = {
      id: transferId, type: 'download', fileName: dirName,
      status: 'transferring', progress: 0, localPath: localDirPath, remotePath
    };
    broadcastTransferUpdate(transferId);

    fs.mkdirSync(localDirPath, { recursive: true });
    await downloadDirRecursive(conn, remotePath, localDirPath);

    transferQueue[transferId].status = 'completed';
    transferQueue[transferId].progress = 100;
    broadcastTransferUpdate(transferId);
    res.json({ success: true, transferId });
  } catch (e) {
    if (transferQueue[transferId]) {
      transferQueue[transferId].status = 'failed';
      transferQueue[transferId].error = e.message;
      broadcastTransferUpdate(transferId);
    }
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/transfers', (req, res) => {
  res.json(Object.values(transferQueue));
});

app.post('/api/transfers/clear', (req, res) => {
  for (const id of Object.keys(transferQueue)) {
    if (transferQueue[id].status === 'completed' || transferQueue[id].status === 'failed') {
      delete transferQueue[id];
    }
  }
  res.json({ success: true });
});

// ==================== SITE MANAGER ROUTES ====================

app.get('/api/sites', (req, res) => {
  res.json(loadSites());
});

app.post('/api/sites', (req, res) => {
  const sites = loadSites();
  const site = { id: randomUUID(), ...req.body };
  sites.push(site);
  saveSites(sites);
  res.json(site);
});

app.put('/api/sites/:id', (req, res) => {
  const sites = loadSites();
  const idx = sites.findIndex(s => s.id === req.params.id);
  if (idx >= 0) {
    sites[idx] = { ...sites[idx], ...req.body };
    saveSites(sites);
    res.json(sites[idx]);
  } else {
    res.status(404).json({ error: 'Site not found' });
  }
});

app.delete('/api/sites/:id', (req, res) => {
  let sites = loadSites();
  sites = sites.filter(s => s.id !== req.params.id);
  saveSites(sites);
  res.json({ success: true });
});

// ==================== HELPERS ====================

async function uploadDirRecursive(conn, localDir, remoteDir) {
  if (conn.type === 'sftp') {
    try { await conn.client.mkdir(remoteDir); } catch (e) {}
  } else {
    await conn.client.ensureDir(remoteDir);
  }
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const lp = path.join(localDir, entry.name);
    const rp = remoteDir + '/' + entry.name;
    if (entry.isDirectory()) {
      await uploadDirRecursive(conn, lp, rp);
    } else {
      if (conn.type === 'sftp') await conn.client.fastPut(lp, rp);
      else await conn.client.uploadFrom(lp, rp);
    }
  }
}

async function downloadDirRecursive(conn, remoteDir, localDir) {
  fs.mkdirSync(localDir, { recursive: true });
  let items;
  if (conn.type === 'sftp') {
    items = (await conn.client.list(remoteDir)).map(i => ({ name: i.name, isDirectory: i.type === 'd' }));
  } else {
    await conn.client.cd(remoteDir);
    items = (await conn.client.list()).filter(i => i.name !== '.' && i.name !== '..').map(i => ({ name: i.name, isDirectory: i.isDirectory }));
  }
  for (const item of items) {
    const rp = remoteDir + '/' + item.name;
    const lp = path.join(localDir, item.name);
    if (item.isDirectory) {
      await downloadDirRecursive(conn, rp, lp);
    } else {
      if (conn.type === 'sftp') await conn.client.fastGet(rp, lp);
      else await conn.client.downloadTo(lp, rp);
    }
  }
}

// ==================== WEBSOCKET ====================

const wsClients = new Set();
let server;

if (!isVercel) {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`FileZilla Pro running at http://localhost:${PORT}`);
    console.log(`Access from other devices at http://${require('os').networkInterfaces()['Ethernet']?.[0]?.address || require('os').networkInterfaces()['Wi-Fi']?.[0]?.address || 'your-ip'}:${PORT}`);
  });

  const wss = new WebSocket.Server({ server });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
  });
}

function broadcastTransferUpdate(transferId) {
  const data = JSON.stringify({ type: 'transfer-update', transfer: transferQueue[transferId] });
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

if (!isVercel) {
  process.on('SIGINT', async () => {
    for (const connId of Object.keys(connections)) {
      try {
        if (connections[connId].type === 'sftp') await connections[connId].client.end();
        else connections[connId].client.close();
      } catch (e) {}
    }
    process.exit();
  });
}

module.exports = app;
