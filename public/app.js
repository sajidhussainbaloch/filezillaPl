// ==================== State ====================
let connId = null;
let localPath = '';
let remotePath = '/';
let localFiles = [];
let remoteFiles = [];
let localSort = { column: 'name', asc: true };
let remoteSort = { column: 'name', asc: true };
let selectedLocal = null;
let selectedRemote = null;
let sites = [];
let currentSiteId = null;
let transfers = [];
let ws = null;

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', () => {
  initLocalBrowser();
  initWebSocket();
  loadSites();
  loadSettings();
  initSplitter();
  initContextMenu();
  initQueueTabs();
});

// ==================== WebSocket ====================
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'transfer-update') {
      updateTransferItem(data.transfer);
    }
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 3000);
  };
}

// ==================== Local File Browser ====================
async function initLocalBrowser() {
  try {
    const res = await fetch('/api/local/list?path=');
    const data = await res.json();
    localPath = data.path;
    document.getElementById('local-path').value = data.path;
    localFiles = data.items;
    renderLocalFiles();
  } catch (e) {
    log('Error loading local files: ' + e.message, 'error');
  }
}

function renderLocalFiles() {
  const list = document.getElementById('local-file-list');
  
  // Sort files
  const sorted = [...localFiles].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    let valA = a[localSort.column];
    let valB = b[localSort.column];
    if (localSort.column === 'size' || localSort.column === 'date') {
      valA = new Date(valA).getTime();
      valB = new Date(valB).getTime();
    }
    if (valA < valB) return localSort.asc ? -1 : 1;
    if (valA > valB) return localSort.asc ? 1 : -1;
    return 0;
  });

  list.innerHTML = sorted.map(file => `
    <div class="file-item ${selectedLocal === file.path ? 'selected' : ''}" 
         data-path="${file.path}" 
         data-is-dir="${file.isDirectory}"
         onclick="selectLocal('${file.path}', event)"
         ondblclick="localDoubleClick('${file.path}', ${file.isDirectory})"
         oncontextmenu="showContextMenu(event, 'local', '${file.path}', ${file.isDirectory})">
      <div class="col-icon"><i class="fas ${getFileIcon(file)} file-icon ${getFileIconClass(file)}"></i></div>
      <div class="col-name">${file.name}</div>
      <div class="col-size">${formatSize(file.size)}</div>
      <div class="col-type">${file.type}</div>
      <div class="col-date">${formatDate(file.modifiedDate)}</div>
      <div class="col-perm">${file.permissions}</div>
    </div>
  `).join('');

  updateLocalStatus();
}

function selectLocal(path, event) {
  selectedLocal = path;
  if (event.ctrlKey) {
    // Multi-select logic could be added here
  }
  renderLocalFiles();
}

function localDoubleClick(path, isDirectory) {
  if (isDirectory) {
    navigateLocal(path);
  } else {
    // Open file preview (could be expanded)
    showProperties(path, 'local');
  }
}

async function navigateLocal(path) {
  try {
    const res = await fetch('/api/local/list?path=' + encodeURIComponent(path));
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    localPath = data.path;
    document.getElementById('local-path').value = data.path;
    localFiles = data.items;
    selectedLocal = null;
    renderLocalFiles();
  } catch (e) {
    log('Error navigating: ' + e.message, 'error');
  }
}

function localGoUp() {
  const parent = localPath.substring(0, localPath.lastIndexOf('\\'));
  if (parent) navigateLocal(parent || '/');
}

function sortLocal(column) {
  if (localSort.column === column) {
    localSort.asc = !localSort.asc;
  } else {
    localSort.column = column;
    localSort.asc = true;
  }
  renderLocalFiles();
}

// ==================== Remote File Browser ====================
async function navigateRemote(path) {
  if (!connId) return;
  try {
    const res = await fetch(`/api/remote/list?connId=${connId}&path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    remotePath = data.path;
    document.getElementById('remote-path').value = data.path;
    remoteFiles = data.items;
    selectedRemote = null;
    renderRemoteFiles();
  } catch (e) {
    log('Error navigating remote: ' + e.message, 'error');
  }
}

function renderRemoteFiles() {
  const list = document.getElementById('remote-file-list');
  
  if (!connId) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-plug"></i>
        <p>Not connected to any server</p>
        <p class="hint">Use Quick Connect or Site Manager to connect</p>
      </div>
    `;
    return;
  }

  // Sort files
  const sorted = [...remoteFiles].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    let valA = a[remoteSort.column];
    let valB = b[remoteSort.column];
    if (remoteSort.column === 'size' || remoteSort.column === 'date') {
      valA = new Date(valA).getTime();
      valB = new Date(valB).getTime();
    }
    if (valA < valB) return remoteSort.asc ? -1 : 1;
    if (valA > valB) return remoteSort.asc ? 1 : -1;
    return 0;
  });

  list.innerHTML = sorted.map(file => `
    <div class="file-item ${selectedRemote === file.path ? 'selected' : ''}" 
         data-path="${file.path}" 
         data-is-dir="${file.isDirectory}"
         onclick="selectRemote('${file.path}', event)"
         ondblclick="remoteDoubleClick('${file.path}', ${file.isDirectory})"
         oncontextmenu="showContextMenu(event, 'remote', '${file.path}', ${file.isDirectory})">
      <div class="col-icon"><i class="fas ${getFileIcon(file)} file-icon ${getFileIconClass(file)}"></i></div>
      <div class="col-name">${file.name}</div>
      <div class="col-size">${formatSize(file.size)}</div>
      <div class="col-type">${file.type}</div>
      <div class="col-date">${formatDate(file.modifiedDate)}</div>
      <div class="col-perm">${file.permissions}</div>
    </div>
  `).join('');

  updateRemoteStatus();
}

function selectRemote(path, event) {
  selectedRemote = path;
  renderRemoteFiles();
}

function remoteDoubleClick(path, isDirectory) {
  if (isDirectory) {
    navigateRemote(path);
  } else {
    showProperties(path, 'remote');
  }
}

function remoteGoUp() {
  if (remotePath !== '/') {
    const parent = remotePath.substring(0, remotePath.lastIndexOf('/')) || '/';
    navigateRemote(parent);
  }
}

function sortRemote(column) {
  if (remoteSort.column === column) {
    remoteSort.asc = !remoteSort.asc;
  } else {
    remoteSort.column = column;
    remoteSort.asc = true;
  }
  renderRemoteFiles();
}

// ==================== Connection ====================
async function quickConnect() {
  const host = document.getElementById('qc-host').value.trim();
  const username = document.getElementById('qc-username').value.trim();
  const password = document.getElementById('qc-password').value;
  const port = document.getElementById('qc-port').value;
  const protocol = document.getElementById('qc-protocol').value;

  if (!host) {
    log('Please enter a host', 'warning');
    return;
  }

  log(`Connecting to ${host}...`, 'info');

  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: port || undefined, username, password, protocol })
    });
    const data = await res.json();
    if (data.success) {
      connId = data.connId;
      log(`Connected to ${host}`, 'success');
      document.getElementById('btn-quickconnect').style.display = 'none';
      document.getElementById('btn-disconnect').style.display = 'flex';
      enableRemoteControls();
      navigateRemote('/');
    } else {
      log('Connection failed: ' + data.error, 'error');
    }
  } catch (e) {
    log('Connection error: ' + e.message, 'error');
  }
}

async function disconnect() {
  if (!connId) return;
  try {
    await fetch('/api/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connId })
    });
    connId = null;
    remoteFiles = [];
    remotePath = '/';
    document.getElementById('btn-quickconnect').style.display = 'flex';
    document.getElementById('btn-disconnect').style.display = 'none';
    document.getElementById('remote-path').value = '/';
    disableRemoteControls();
    renderRemoteFiles();
    log('Disconnected', 'info');
  } catch (e) {
    log('Disconnect error: ' + e.message, 'error');
  }
}

function enableRemoteControls() {
  document.getElementById('remote-path').disabled = false;
  document.getElementById('btn-remote-mkdir').disabled = false;
  document.getElementById('btn-remote-refresh').disabled = false;
  document.getElementById('btn-remote-delete').disabled = false;
  document.getElementById('btn-remote-rename').disabled = false;
  document.getElementById('btn-remote-chmod').disabled = false;
  document.getElementById('btn-remote-download').disabled = false;
}

function disableRemoteControls() {
  document.getElementById('remote-path').disabled = true;
  document.getElementById('btn-remote-mkdir').disabled = true;
  document.getElementById('btn-remote-refresh').disabled = true;
  document.getElementById('btn-remote-delete').disabled = true;
  document.getElementById('btn-remote-rename').disabled = true;
  document.getElementById('btn-remote-chmod').disabled = true;
  document.getElementById('btn-remote-download').disabled = true;
}

// ==================== File Operations ====================

// Local operations
async function localCreateDir() {
  const name = prompt('Enter directory name:');
  if (!name) return;
  const dirPath = localPath + '\\' + name;
  try {
    const res = await fetch('/api/local/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirPath })
    });
    const data = await res.json();
    if (data.success) {
      localRefresh();
      log(`Created directory: ${name}`, 'success');
    } else {
      log('Error: ' + data.error, 'error');
    }
  } catch (e) {
    log('Error: ' + e.message, 'error');
  }
}

async function localDelete() {
  if (!selectedLocal) {
    log('Please select a file or directory', 'warning');
    return;
  }
  if (!confirm('Are you sure you want to delete this item?')) return;
  try {
    const res = await fetch('/api/local/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: selectedLocal })
    });
    const data = await res.json();
    if (data.success) {
      selectedLocal = null;
      localRefresh();
      log('Item deleted', 'success');
    } else {
      log('Error: ' + data.error, 'error');
    }
  } catch (e) {
    log('Error: ' + e.message, 'error');
  }
}

async function localRename() {
  if (!selectedLocal) {
    log('Please select a file or directory', 'warning');
    return;
  }
  const oldName = selectedLocal.split('\\').pop();
  const newName = prompt('Enter new name:', oldName);
  if (!newName || newName === oldName) return;
  const newPath = selectedLocal.substring(0, selectedLocal.lastIndexOf('\\') + 1) + newName;
  try {
    const res = await fetch('/api/local/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: selectedLocal, newPath })
    });
    const data = await res.json();
    if (data.success) {
      selectedLocal = newPath;
      localRefresh();
      log(`Renamed to: ${newName}`, 'success');
    } else {
      log('Error: ' + data.error, 'error');
    }
  } catch (e) {
    log('Error: ' + e.message, 'error');
  }
}

function localRefresh() {
  navigateLocal(localPath);
}

// Remote operations
async function remoteCreateDir() {
  if (!connId) return;
  const name = prompt('Enter directory name:');
  if (!name) return;
  const dirPath = remotePath === '/' ? '/' + name : remotePath + '/' + name;
  try {
    const res = await fetch('/api/remote/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connId, dirPath })
    });
    const data = await res.json();
    if (data.success) {
      navigateRemote(remotePath);
      log(`Created directory: ${name}`, 'success');
    } else {
      log('Error: ' + data.error, 'error');
    }
  } catch (e) {
    log('Error: ' + e.message, 'error');
  }
}

async function remoteDelete() {
  if (!selectedRemote || !connId) return;
  if (!confirm('Are you sure you want to delete this item?')) return;
  const file = remoteFiles.find(f => f.path === selectedRemote);
  try {
    const res = await fetch('/api/remote/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connId, filePath: selectedRemote, isDirectory: file?.isDirectory })
    });
    const data = await res.json();
    if (data.success) {
      selectedRemote = null;
      navigateRemote(remotePath);
      log('Item deleted', 'success');
    } else {
      log('Error: ' + data.error, 'error');
    }
  } catch (e) {
    log('Error: ' + e.message, 'error');
  }
}

async function remoteRename() {
  if (!selectedRemote || !connId) return;
  const file = remoteFiles.find(f => f.path === selectedRemote);
  const oldName = file?.name;
  const newName = prompt('Enter new name:', oldName);
  if (!newName || newName === oldName) return;
  const newPath = selectedRemote.substring(0, selectedRemote.lastIndexOf('/') + 1) + newName;
  try {
    const res = await fetch('/api/remote/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connId, oldPath: selectedRemote, newPath })
    });
    const data = await res.json();
    if (data.success) {
      selectedRemote = newPath;
      navigateRemote(remotePath);
      log(`Renamed to: ${newName}`, 'success');
    } else {
      log('Error: ' + data.error, 'error');
    }
  } catch (e) {
    log('Error: ' + e.message, 'error');
  }
}

function remoteRefresh() {
  if (connId) navigateRemote(remotePath);
}

// ==================== Transfers ====================
async function uploadSelected() {
  if (!selectedLocal || !connId) {
    log('Select a local file to upload', 'warning');
    return;
  }
  try {
    const res = await fetch('/api/transfer/upload-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connId, localPath: selectedLocal, remotePath })
    });
    const data = await res.json();
    if (data.success) {
      log('Upload started', 'info');
      navigateRemote(remotePath);
    } else {
      log('Upload error: ' + data.error, 'error');
    }
  } catch (e) {
    log('Upload error: ' + e.message, 'error');
  }
}

async function downloadSelected() {
  if (!selectedRemote || !connId) {
    log('Select a remote file to download', 'warning');
    return;
  }
  try {
    const res = await fetch('/api/transfer/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connId, remotePath: selectedRemote, localPath })
    });
    const data = await res.json();
    if (data.success) {
      log('Download started', 'info');
      localRefresh();
    } else {
      log('Download error: ' + data.error, 'error');
    }
  } catch (e) {
    log('Download error: ' + e.message, 'error');
  }
}

// Drag and drop
function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

async function handleDropLocal(event) {
  event.preventDefault();
  // Handle files dropped from local system
}

async function handleDropRemote(event) {
  event.preventDefault();
  if (!connId) return;
  // Handle files dropped from local panel
}

// ==================== Transfer Queue ====================
function toggleTransferQueue() {
  const queue = document.getElementById('transfer-queue');
  queue.classList.toggle('collapsed');
}

async function loadTransfers() {
  try {
    const res = await fetch('/api/transfers');
    transfers = await res.json();
    renderTransferQueue();
  } catch (e) {
    console.error('Error loading transfers:', e);
  }
}

function renderTransferQueue() {
  const list = document.getElementById('queue-list');
  if (transfers.length === 0) {
    list.innerHTML = '<div class="queue-empty">No transfers in queue</div>';
    return;
  }

  list.innerHTML = transfers.map(t => `
    <div class="queue-item">
      <i class="fas fa-${t.type === 'download' ? 'arrow-down' : 'arrow-up'} transfer-icon ${t.type}"></i>
      <div class="transfer-info">
        <div class="transfer-name">${t.fileName}</div>
        <div class="transfer-path">${t.localPath || t.remotePath || ''}</div>
      </div>
      <div class="transfer-status ${t.status}">${t.status}</div>
      <div class="transfer-progress">
        <div class="transfer-progress-bar ${t.status}" style="width: ${t.progress}%"></div>
      </div>
    </div>
  `).join('');
}

function updateTransferItem(transfer) {
  const idx = transfers.findIndex(t => t.id === transfer.id);
  if (idx >= 0) {
    transfers[idx] = transfer;
  } else {
    transfers.push(transfer);
  }
  renderTransferQueue();
}

async function clearCompletedTransfers() {
  try {
    await fetch('/api/transfers/clear', { method: 'POST' });
    loadTransfers();
  } catch (e) {
    console.error('Error clearing transfers:', e);
  }
}

function initQueueTabs() {
  document.querySelectorAll('.queue-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.queue-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      // Filter transfers by tab
      const filter = tab.dataset.tab;
      renderFilteredTransfers(filter);
    });
  });
}

function renderFilteredTransfers(filter) {
  const list = document.getElementById('queue-list');
  let filtered = transfers;
  if (filter === 'active') filtered = transfers.filter(t => t.status === 'transferring');
  else if (filter === 'completed') filtered = transfers.filter(t => t.status === 'completed');
  else if (filter === 'failed') filtered = transfers.filter(t => t.status === 'failed');

  if (filtered.length === 0) {
    list.innerHTML = '<div class="queue-empty">No transfers in queue</div>';
    return;
  }

  list.innerHTML = filtered.map(t => `
    <div class="queue-item">
      <i class="fas fa-${t.type === 'download' ? 'arrow-down' : 'arrow-up'} transfer-icon ${t.type}"></i>
      <div class="transfer-info">
        <div class="transfer-name">${t.fileName}</div>
        <div class="transfer-path">${t.localPath || t.remotePath || ''}</div>
      </div>
      <div class="transfer-status ${t.status}">${t.status}</div>
      <div class="transfer-progress">
        <div class="transfer-progress-bar ${t.status}" style="width: ${t.progress}%"></div>
      </div>
    </div>
  `).join('');
}

// ==================== Site Manager ====================
async function loadSites() {
  try {
    const res = await fetch('/api/sites');
    sites = await res.json();
    renderSiteList();
  } catch (e) {
    console.error('Error loading sites:', e);
  }
}

function renderSiteList() {
  const list = document.getElementById('site-list');
  if (sites.length === 0) {
    list.innerHTML = '<div class="site-empty">No saved sites</div>';
    return;
  }

  list.innerHTML = sites.map(site => `
    <div class="site-item ${currentSiteId === site.id ? 'active' : ''}" onclick="selectSite('${site.id}')">
      <i class="fas fa-server"></i> ${site.name}
    </div>
  `).join('');
}

function showSiteManager() {
  document.getElementById('site-manager-modal').style.display = 'flex';
  loadSites();
}

function closeSiteManager() {
  document.getElementById('site-manager-modal').style.display = 'none';
  currentSiteId = null;
  document.getElementById('site-details-form').style.display = 'none';
  document.getElementById('site-details-empty').style.display = 'block';
}

function selectSite(id) {
  currentSiteId = id;
  const site = sites.find(s => s.id === id);
  if (!site) return;

  document.getElementById('site-name').value = site.name;
  document.getElementById('site-protocol').value = site.protocol;
  document.getElementById('site-host').value = site.host;
  document.getElementById('site-port').value = site.port || '';
  document.getElementById('site-username').value = site.username;
  document.getElementById('site-password').value = site.password || '';
  document.getElementById('site-remote-dir').value = site.remoteDir || '/';

  document.getElementById('site-details-form').style.display = 'block';
  document.getElementById('site-details-empty').style.display = 'none';
  renderSiteList();
}

function addNewSite() {
  currentSiteId = null;
  document.getElementById('site-name').value = '';
  document.getElementById('site-protocol').value = 'ftp';
  document.getElementById('site-host').value = '';
  document.getElementById('site-port').value = '';
  document.getElementById('site-username').value = '';
  document.getElementById('site-password').value = '';
  document.getElementById('site-remote-dir').value = '/';

  document.getElementById('site-details-form').style.display = 'block';
  document.getElementById('site-details-empty').style.display = 'none';
}

async function saveSite() {
  const site = {
    name: document.getElementById('site-name').value,
    protocol: document.getElementById('site-protocol').value,
    host: document.getElementById('site-host').value,
    port: document.getElementById('site-port').value,
    username: document.getElementById('site-username').value,
    password: document.getElementById('site-password').value,
    remoteDir: document.getElementById('site-remote-dir').value
  };

  if (!site.name || !site.host) {
    log('Please enter site name and host', 'warning');
    return;
  }

  try {
    if (currentSiteId) {
      await fetch(`/api/sites/${currentSiteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(site)
      });
    } else {
      await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(site)
      });
    }
    loadSites();
    log('Site saved', 'success');
  } catch (e) {
    log('Error saving site: ' + e.message, 'error');
  }
}

async function connectToSite() {
  const site = {
    name: document.getElementById('site-name').value,
    protocol: document.getElementById('site-protocol').value,
    host: document.getElementById('site-host').value,
    port: document.getElementById('site-port').value,
    username: document.getElementById('site-username').value,
    password: document.getElementById('site-password').value
  };

  if (!site.host) {
    log('Please enter host', 'warning');
    return;
  }

  // Fill quick connect fields
  document.getElementById('qc-host').value = site.host;
  document.getElementById('qc-port').value = site.port;
  document.getElementById('qc-username').value = site.username;
  document.getElementById('qc-password').value = site.password;
  document.getElementById('qc-protocol').value = site.protocol;

  closeSiteManager();
  quickConnect();
}

async function deleteSite() {
  if (!currentSiteId) return;
  if (!confirm('Are you sure you want to delete this site?')) return;

  try {
    await fetch(`/api/sites/${currentSiteId}`, { method: 'DELETE' });
    currentSiteId = null;
    loadSites();
    document.getElementById('site-details-form').style.display = 'none';
    document.getElementById('site-details-empty').style.display = 'block';
    log('Site deleted', 'success');
  } catch (e) {
    log('Error deleting site: ' + e.message, 'error');
  }
}

// ==================== Properties ====================
async function showProperties(path, type) {
  if (type === 'local') {
    try {
      const res = await fetch('/api/local/info?path=' + encodeURIComponent(path));
      const data = await res.json();
      document.getElementById('properties-body').innerHTML = `
        <div class="property-row"><span class="property-label">Name</span><span class="property-value">${data.name}</span></div>
        <div class="property-row"><span class="property-label">Path</span><span class="property-value">${data.path}</span></div>
        <div class="property-row"><span class="property-label">Size</span><span class="property-value">${formatSize(data.size)}</span></div>
        <div class="property-row"><span class="property-label">Type</span><span class="property-value">${data.isDirectory ? 'Directory' : data.type}</span></div>
        <div class="property-row"><span class="property-label">Modified</span><span class="property-value">${formatDate(data.modifiedDate)}</span></div>
        <div class="property-row"><span class="property-label">Created</span><span class="property-value">${formatDate(data.createdDate)}</span></div>
        <div class="property-row"><span class="property-label">Permissions</span><span class="property-value">${data.permissions}</span></div>
      `;
      document.getElementById('properties-modal').style.display = 'flex';
    } catch (e) {
      log('Error: ' + e.message, 'error');
    }
  }
}

function closeProperties() {
  document.getElementById('properties-modal').style.display = 'none';
}

// ==================== Chmod ====================
let chmodPath = null;

function remoteChmod() {
  if (!selectedRemote || !connId) return;
  chmodPath = selectedRemote;
  const file = remoteFiles.find(f => f.path === selectedRemote);
  document.getElementById('chmod-filename').textContent = file?.name;
  
  // Parse current permissions
  const perms = file?.permissions || '---';
  document.getElementById('chmod-owner-r').checked = perms[0] === 'r';
  document.getElementById('chmod-owner-w').checked = perms[1] === 'w';
  document.getElementById('chmod-owner-x').checked = perms[2] === 'x';
  document.getElementById('chmod-group-r').checked = perms[3] === 'r';
  document.getElementById('chmod-group-w').checked = perms[4] === 'w';
  document.getElementById('chmod-group-x').checked = perms[5] === 'x';
  document.getElementById('chmod-other-r').checked = perms[6] === 'r';
  document.getElementById('chmod-other-w').checked = perms[7] === 'w';
  document.getElementById('chmod-other-x').checked = perms[8] === 'x';
  updateChmodValue();

  document.getElementById('chmod-modal').style.display = 'flex';
}

function updateChmodValue() {
  let value = '';
  value += document.getElementById('chmod-owner-r').checked ? '4' : '0';
  value += document.getElementById('chmod-owner-w').checked ? '2' : '0';
  value += document.getElementById('chmod-owner-x').checked ? '1' : '0';
  value += document.getElementById('chmod-group-r').checked ? '4' : '0';
  value += document.getElementById('chmod-group-w').checked ? '2' : '0';
  value += document.getElementById('chmod-group-x').checked ? '1' : '0';
  value += document.getElementById('chmod-other-r').checked ? '4' : '0';
  value += document.getElementById('chmod-other-w').checked ? '2' : '0';
  value += document.getElementById('chmod-other-x').checked ? '1' : '0';
  document.getElementById('chmod-value').value = value;
}

function updateChmodCheckboxes() {
  const value = document.getElementById('chmod-value').value.padStart(3, '0');
  document.getElementById('chmod-owner-r').checked = value[0] >= '4';
  document.getElementById('chmod-owner-w').checked = (value[0] % 4) >= '2';
  document.getElementById('chmod-owner-x').checked = (value[0] % 2) === '1';
  document.getElementById('chmod-group-r').checked = value[1] >= '4';
  document.getElementById('chmod-group-w').checked = (value[1] % 4) >= '2';
  document.getElementById('chmod-group-x').checked = (value[1] % 2) === '1';
  document.getElementById('chmod-other-r').checked = value[2] >= '4';
  document.getElementById('chmod-other-w').checked = (value[2] % 4) >= '2';
  document.getElementById('chmod-other-x').checked = (value[2] % 2) === '1';
}

async function applyChmod() {
  const mode = document.getElementById('chmod-value').value;
  try {
    const res = await fetch('/api/remote/chmod', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connId, filePath: chmodPath, mode })
    });
    const data = await res.json();
    if (data.success) {
      log('Permissions changed', 'success');
      closeChmod();
      navigateRemote(remotePath);
    } else {
      log('Error: ' + data.error, 'error');
    }
  } catch (e) {
    log('Error: ' + e.message, 'error');
  }
}

function closeChmod() {
  document.getElementById('chmod-modal').style.display = 'none';
  chmodPath = null;
}

// ==================== Context Menu ====================
function initContextMenu() {
  document.addEventListener('click', () => {
    document.getElementById('context-menu').style.display = 'none';
  });
}

function showContextMenu(event, type, path, isDir) {
  event.preventDefault();
  event.stopPropagation();

  const menu = document.getElementById('context-menu');
  const items = document.getElementById('context-menu-items');

  let menuItems = [];

  if (type === 'local') {
    menuItems = [
      { icon: 'fa-folder-open', label: 'Open', action: () => isDir ? navigateLocal(path) : showProperties(path, 'local') },
      { icon: 'fa-folder-plus', label: 'Create Directory', action: localCreateDir },
      { divider: true },
      { icon: 'fa-upload', label: 'Upload to Remote', action: () => { selectedLocal = path; uploadSelected(); } },
      { divider: true },
      { icon: 'fa-edit', label: 'Rename', action: localRename },
      { icon: 'fa-trash', label: 'Delete', action: localDelete },
      { divider: true },
      { icon: 'fa-info-circle', label: 'Properties', action: () => showProperties(path, 'local') }
    ];
  } else {
    if (!connId) return;
    menuItems = [
      { icon: 'fa-folder-open', label: 'Open', action: () => isDir ? navigateRemote(path) : showProperties(path, 'remote') },
      { divider: true },
      { icon: 'fa-download', label: 'Download to Local', action: () => { selectedRemote = path; downloadSelected(); } },
      { divider: true },
      { icon: 'fa-edit', label: 'Rename', action: remoteRename },
      { icon: 'fa-lock', label: 'Change Permissions', action: remoteChmod },
      { icon: 'fa-trash', label: 'Delete', action: remoteDelete },
      { divider: true },
      { icon: 'fa-info-circle', label: 'Properties', action: () => showProperties(path, 'remote') }
    ];
  }

  items.innerHTML = menuItems.map(item => {
    if (item.divider) return '<div class="context-menu-divider"></div>';
    return `<div class="context-menu-item" onclick="this.style.display='none';${item.action.toString().replace(/function\s*\(\)\s*\{/, '').replace(/\}$/, '')}"><i class="fas ${item.icon}"></i>${item.label}</div>`;
  }).join('');

  menu.style.display = 'block';
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
}

// ==================== Settings ====================
const DEFAULT_SETTINGS = {
  // General
  theme: 'dark',
  language: 'en',
  showHidden: false,
  confirmDelete: true,
  confirmOverwrite: true,
  minimizeToTray: false,
  startMinimized: false,
  autoUpdate: true,
  // Connection
  connTimeout: 30,
  keepaliveInterval: 60,
  retryAttempts: 3,
  retryDelay: 5,
  ftpMode: 'passive',
  autoReconnect: true,
  compression: true,
  encoding: 'utf8',
  // Transfer
  transferMode: 'auto',
  maxConcurrent: 3,
  maxPerServer: 2,
  downloadLimit: 0,
  uploadLimit: 0,
  defaultLocal: '',
  conflictAction: 'ask',
  preserveTimestamp: true,
  verifyTransfer: false,
  useTempFiles: true,
  // Security
  tlsVersion: 'auto',
  verifyCert: true,
  verifyHost: true,
  kexAlgo: 'auto',
  cipher: 'auto',
  clearSessions: false,
  encryptSites: false,
  // Interface
  listView: 'detailed',
  dblclickAction: 'open',
  dateFormat: 'locale',
  sizeFormat: 'binary',
  showTree: false,
  animations: true,
  soundEffects: false,
  logLevel: 'info',
  // Advanced
  enableSync: false,
  syncMethod: 'size',
  followSymlinks: false,
  showDotfiles: true,
  caseSensitive: false,
  bufferSize: 64,
  socketBuffer: 256,
  parallelConnections: true,
  ipv6: false,
  proxySupport: false,
  proxyType: 'none',
  proxyHost: '',
  proxyPort: 8080
};

function showSettings() {
  document.getElementById('settings-modal').style.display = 'flex';
  loadSettings();
}

function closeSettings() {
  document.getElementById('settings-modal').style.display = 'none';
}

function switchSettingsTab(tab) {
  // Update tab buttons
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.settings-tab[data-tab="${tab}"]`).classList.add('active');
  
  // Update panels
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`settings-${tab}`).classList.add('active');
}

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  saveSettings();
}

function loadSettings() {
  const settings = JSON.parse(localStorage.getItem('filezilla-settings') || '{}');
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  
  // General
  document.body.setAttribute('data-theme', merged.theme);
  setValue('setting-theme', merged.theme);
  setValue('setting-language', merged.language);
  setChecked('setting-show-hidden', merged.showHidden);
  setChecked('setting-confirm-delete', merged.confirmDelete);
  setChecked('setting-confirm-overwrite', merged.confirmOverwrite);
  setChecked('setting-minimize-to-tray', merged.minimizeToTray);
  setChecked('setting-start-minimized', merged.startMinimized);
  setChecked('setting-auto-update', merged.autoUpdate);
  
  // Connection
  setValue('setting-conn-timeout', merged.connTimeout);
  setValue('setting-keepalive-interval', merged.keepaliveInterval);
  setValue('setting-retry-attempts', merged.retryAttempts);
  setValue('setting-retry-delay', merged.retryDelay);
  setValue('setting-ftp-mode', merged.ftpMode);
  setChecked('setting-auto-reconnect', merged.autoReconnect);
  setChecked('setting-compression', merged.compression);
  setValue('setting-encoding', merged.encoding);
  
  // Transfer
  setValue('setting-transfer-mode', merged.transferMode);
  setValue('setting-max-concurrent', merged.maxConcurrent);
  setValue('setting-max-per-server', merged.maxPerServer);
  setValue('setting-download-limit', merged.downloadLimit);
  setValue('setting-upload-limit', merged.uploadLimit);
  setValue('setting-default-local', merged.defaultLocal);
  setValue('setting-conflict-action', merged.conflictAction);
  setChecked('setting-preserve-timestamp', merged.preserveTimestamp);
  setChecked('setting-verify-transfer', merged.verifyTransfer);
  setChecked('setting-use-temp-files', merged.useTempFiles);
  
  // Security
  setValue('setting-tls-version', merged.tlsVersion);
  setChecked('setting-verify-cert', merged.verifyCert);
  setChecked('setting-verify-host', merged.verifyHost);
  setValue('setting-kex-algo', merged.kexAlgo);
  setValue('setting-cipher', merged.cipher);
  setChecked('setting-clear-sessions', merged.clearSessions);
  setChecked('setting-encrypt-sites', merged.encryptSites);
  
  // Interface
  setValue('setting-list-view', merged.listView);
  setValue('setting-dblclick-action', merged.dblclickAction);
  setValue('setting-date-format', merged.dateFormat);
  setValue('setting-size-format', merged.sizeFormat);
  setChecked('setting-show-tree', merged.showTree);
  setChecked('setting-animations', merged.animations);
  setChecked('setting-sound-effects', merged.soundEffects);
  setValue('setting-log-level', merged.logLevel);
  
  // Advanced
  setChecked('setting-enable-sync', merged.enableSync);
  setValue('setting-sync-method', merged.syncMethod);
  setChecked('setting-follow-symlinks', merged.followSymlinks);
  setChecked('setting-show-dotfiles', merged.showDotfiles);
  setChecked('setting-case-sensitive', merged.caseSensitive);
  setValue('setting-buffer-size', merged.bufferSize);
  setValue('setting-socket-buffer', merged.socketBuffer);
  setChecked('setting-parallel-connections', merged.parallelConnections);
  setChecked('setting-ipv6', merged.ipv6);
  setChecked('setting-proxy-support', merged.proxySupport);
  setValue('setting-proxy-type', merged.proxyType);
  setValue('setting-proxy-host', merged.proxyHost);
  setValue('setting-proxy-port', merged.proxyPort);
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function setChecked(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

function saveSettings() {
  const settings = {
    // General
    theme: document.getElementById('setting-theme').value,
    language: document.getElementById('setting-language').value,
    showHidden: document.getElementById('setting-show-hidden').checked,
    confirmDelete: document.getElementById('setting-confirm-delete').checked,
    confirmOverwrite: document.getElementById('setting-confirm-overwrite').checked,
    minimizeToTray: document.getElementById('setting-minimize-to-tray').checked,
    startMinimized: document.getElementById('setting-start-minimized').checked,
    autoUpdate: document.getElementById('setting-auto-update').checked,
    // Connection
    connTimeout: parseInt(document.getElementById('setting-conn-timeout').value) || 30,
    keepaliveInterval: parseInt(document.getElementById('setting-keepalive-interval').value) || 60,
    retryAttempts: parseInt(document.getElementById('setting-retry-attempts').value) || 3,
    retryDelay: parseInt(document.getElementById('setting-retry-delay').value) || 5,
    ftpMode: document.getElementById('setting-ftp-mode').value,
    autoReconnect: document.getElementById('setting-auto-reconnect').checked,
    compression: document.getElementById('setting-compression').checked,
    encoding: document.getElementById('setting-encoding').value,
    // Transfer
    transferMode: document.getElementById('setting-transfer-mode').value,
    maxConcurrent: parseInt(document.getElementById('setting-max-concurrent').value) || 3,
    maxPerServer: parseInt(document.getElementById('setting-max-per-server').value) || 2,
    downloadLimit: parseInt(document.getElementById('setting-download-limit').value) || 0,
    uploadLimit: parseInt(document.getElementById('setting-upload-limit').value) || 0,
    defaultLocal: document.getElementById('setting-default-local').value,
    conflictAction: document.getElementById('setting-conflict-action').value,
    preserveTimestamp: document.getElementById('setting-preserve-timestamp').checked,
    verifyTransfer: document.getElementById('setting-verify-transfer').checked,
    useTempFiles: document.getElementById('setting-use-temp-files').checked,
    // Security
    tlsVersion: document.getElementById('setting-tls-version').value,
    verifyCert: document.getElementById('setting-verify-cert').checked,
    verifyHost: document.getElementById('setting-verify-host').checked,
    kexAlgo: document.getElementById('setting-kex-algo').value,
    cipher: document.getElementById('setting-cipher').value,
    clearSessions: document.getElementById('setting-clear-sessions').checked,
    encryptSites: document.getElementById('setting-encrypt-sites').checked,
    // Interface
    listView: document.getElementById('setting-list-view').value,
    dblclickAction: document.getElementById('setting-dblclick-action').value,
    dateFormat: document.getElementById('setting-date-format').value,
    sizeFormat: document.getElementById('setting-size-format').value,
    showTree: document.getElementById('setting-show-tree').checked,
    animations: document.getElementById('setting-animations').checked,
    soundEffects: document.getElementById('setting-sound-effects').checked,
    logLevel: document.getElementById('setting-log-level').value,
    // Advanced
    enableSync: document.getElementById('setting-enable-sync').checked,
    syncMethod: document.getElementById('setting-sync-method').value,
    followSymlinks: document.getElementById('setting-follow-symlinks').checked,
    showDotfiles: document.getElementById('setting-show-dotfiles').checked,
    caseSensitive: document.getElementById('setting-case-sensitive').checked,
    bufferSize: parseInt(document.getElementById('setting-buffer-size').value) || 64,
    socketBuffer: parseInt(document.getElementById('setting-socket-buffer').value) || 256,
    parallelConnections: document.getElementById('setting-parallel-connections').checked,
    ipv6: document.getElementById('setting-ipv6').checked,
    proxySupport: document.getElementById('setting-proxy-support').checked,
    proxyType: document.getElementById('setting-proxy-type').value,
    proxyHost: document.getElementById('setting-proxy-host').value,
    proxyPort: parseInt(document.getElementById('setting-proxy-port').value) || 8080
  };
  localStorage.setItem('filezilla-settings', JSON.stringify(settings));
  log('Settings saved', 'success');
}

function exportSettings() {
  const settings = localStorage.getItem('filezilla-settings') || '{}';
  const sites = localStorage.getItem('filezilla-sites') || '[]';
  const exportData = {
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    settings: JSON.parse(settings),
    sites: JSON.parse(sites)
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `filezilla-settings-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  log('Settings exported', 'success');
}

function importSettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.settings) {
          localStorage.setItem('filezilla-settings', JSON.stringify(data.settings));
        }
        if (data.sites) {
          localStorage.setItem('filezilla-sites', JSON.stringify(data.sites));
        }
        loadSettings();
        loadSites();
        log('Settings imported successfully', 'success');
      } catch (err) {
        log('Failed to import settings: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function resetSettings() {
  if (!confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) return;
  localStorage.removeItem('filezilla-settings');
  loadSettings();
  applyTheme(DEFAULT_SETTINGS.theme);
  log('Settings reset to defaults', 'success');
}

// Get current settings value
function getSetting(key) {
  const settings = JSON.parse(localStorage.getItem('filezilla-settings') || '{}');
  return settings[key] !== undefined ? settings[key] : DEFAULT_SETTINGS[key];
}

// ==================== Splitter ====================
function initSplitter() {
  const splitter = document.getElementById('splitter');
  let isDragging = false;

  splitter.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const container = document.querySelector('.main-content');
    const localPanel = document.querySelector('.local-panel');
    const rect = container.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    localPanel.style.flex = `0 0 ${Math.max(20, Math.min(80, percent))}%`;
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ==================== Utilities ====================
function log(message, type = 'info') {
  const logDiv = document.getElementById('message-log');
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logDiv.appendChild(entry);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function refreshAll() {
  localRefresh();
  if (connId) remoteRefresh();
}

function getFileIcon(file) {
  if (file.isDirectory) return 'fa-folder';
  if (file.type === 'drive') return 'fa-hdd';
  
  const ext = file.type?.toLowerCase() || '';
  const icons = {
    'jpg': 'fa-image', 'jpeg': 'fa-image', 'png': 'fa-image', 'gif': 'fa-image', 'bmp': 'fa-image', 'svg': 'fa-image',
    'mp3': 'fa-music', 'wav': 'fa-music', 'ogg': 'fa-music', 'flac': 'fa-music',
    'mp4': 'fa-video', 'avi': 'fa-video', 'mkv': 'fa-video', 'mov': 'fa-video',
    'zip': 'fa-file-archive', 'rar': 'fa-file-archive', '7z': 'fa-file-archive', 'tar': 'fa-file-archive', 'gz': 'fa-file-archive',
    'js': 'fa-code', 'ts': 'fa-code', 'py': 'fa-code', 'java': 'fa-code', 'c': 'fa-code', 'cpp': 'fa-code', 'h': 'fa-code',
    'html': 'fa-code', 'css': 'fa-code', 'json': 'fa-code', 'xml': 'fa-code',
    'pdf': 'fa-file-pdf', 'doc': 'fa-file-word', 'docx': 'fa-file-word', 'xls': 'fa-file-excel', 'xlsx': 'fa-file-excel',
    'txt': 'fa-file-alt', 'md': 'fa-file-alt'
  };
  
  return icons[ext] || 'fa-file';
}

function getFileIconClass(file) {
  if (file.isDirectory) return 'folder';
  if (file.type === 'drive') return 'drive';
  
  const ext = file.type?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (['mp4', 'avi', 'mkv', 'mov'].includes(ext)) return 'video';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'xml'].includes(ext)) return 'code';
  
  return 'file';
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return (bytes % 1 === 0 ? bytes : bytes.toFixed(1)) + ' ' + units[i];
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function updateLocalStatus() {
  const dirs = localFiles.filter(f => f.isDirectory).length;
  const files = localFiles.filter(f => !f.isDirectory).length;
  document.getElementById('local-status').textContent = `${files} files, ${dirs} directories`;
}

function updateRemoteStatus() {
  if (!connId) {
    document.getElementById('remote-status').textContent = 'Not connected';
    return;
  }
  const dirs = remoteFiles.filter(f => f.isDirectory).length;
  const files = remoteFiles.filter(f => !f.isDirectory).length;
  document.getElementById('remote-status').textContent = `${files} files, ${dirs} directories`;
}

// Load transfers periodically
setInterval(loadTransfers, 2000);
