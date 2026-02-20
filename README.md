# filezillaPl

A web-based FTP/FTPS/SFTP file manager inspired by desktop file transfer clients. It provides dual-pane browsing (local + remote), quick connection, site management, and transfer queue tracking in a browser UI.

## Features

- Connect to remote servers using **FTP**, **FTPS**, or **SFTP**
- Browse local and remote directories in a dual-pane interface
- Upload and download files and folders
- Manage remote files and folders (create, rename, delete, chmod for SFTP)
- Track transfer progress in real time via WebSocket updates
- Save and reuse server profiles with built-in Site Manager

## Tech Stack

- **Backend:** Node.js, Express
- **Protocols/Libraries:** `basic-ftp`, `ssh2-sftp-client`, `multer`
- **Realtime:** `ws` (WebSocket)
- **Frontend:** Vanilla JavaScript, HTML, CSS

## Prerequisites

- Node.js 18+ (recommended)
- npm
- Network access to target FTP/FTPS/SFTP hosts

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. Open the app in your browser:

   - Local: `http://localhost:3000`
   - LAN (from other devices): `http://<your-ip>:3000`

## How to Use

1. Enter connection details in **Quick Connect** (host, protocol, username, password/key, port).
2. Connect and browse remote files in the right pane.
3. Navigate local files in the left pane.
4. Transfer files/folders between local and remote.
5. Monitor progress and status in the transfer queue panel.

## Project Structure

```text
filezillaPl/
├─ public/
│  ├─ index.html       # Frontend UI
│  ├─ app.js           # Frontend logic and API/WebSocket integration
│  └─ styles.css       # Styling
├─ server.js           # Express server, protocol handlers, API routes, WebSocket
├─ package.json
├─ package-lock.json
├─ temp_uploads/       # Temporary upload staging directory
└─ sites.json          # Auto-created site profiles (when using Site Manager)
```

## API Overview

### Local File System

- `GET /api/local/list`
- `POST /api/local/mkdir`
- `POST /api/local/delete`
- `POST /api/local/rename`
- `GET /api/local/info`

### Connection

- `POST /api/connect`
- `POST /api/disconnect`

### Remote File System

- `GET /api/remote/list`
- `POST /api/remote/mkdir`
- `POST /api/remote/delete`
- `POST /api/remote/rename`
- `POST /api/remote/chmod` (SFTP)

### Transfers

- `POST /api/transfer/upload`
- `POST /api/transfer/upload-local`
- `POST /api/transfer/download`
- `POST /api/transfer/download-dir`
- `GET /api/transfers`
- `POST /api/transfers/clear`

### Site Manager

- `GET /api/sites`
- `POST /api/sites`
- `PUT /api/sites/:id`
- `DELETE /api/sites/:id`

## Security Notes

- This project is currently optimized for local/self-hosted use.
- Site profile data may include sensitive credentials; protect access to the host machine and repository.
- Avoid exposing this service publicly without adding authentication, authorization, and transport hardening.

## Troubleshooting

- **Port in use:** change `PORT` in `server.js`.
- **Connection fails:** verify protocol/port/credentials and firewall access.
- **Permission errors:** run with appropriate OS permissions for local filesystem paths.

## License

ISC
