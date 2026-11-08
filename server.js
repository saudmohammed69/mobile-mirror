// Live screen mirror relay.
// Wire protocol (matches the Android app's ScreenMirror):
//   - Phone connects, sends TEXT "READY"
//   - Phone sends BINARY messages = one raw JPEG frame each
//   - Phone listens for TEXT: START / STOP / SCREENSHOT / START_PROJECTION
//   - Every other socket is a viewer; binary frames are broadcast to all viewers.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const full = path.join(__dirname, file);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

let phone = null;
const viewers = new Set();
const COMMANDS = new Set(['START', 'STOP', 'SCREENSHOT', 'START_PROJECTION']);

wss.on('connection', (ws) => {
  ws.isPhone = false;
  viewers.add(ws);
  console.log('client connected (viewer)');

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // A JPEG frame from the phone → relay to every viewer.
      if (ws.isPhone) {
        for (const v of viewers) {
          if (v.readyState === 1) v.send(data);
        }
      }
      return;
    }

    const text = data.toString().trim();

    // First socket to say READY becomes the phone.
    if (text === 'READY' && !ws.isPhone) {
      if (phone && phone !== ws) { try { phone.close(); } catch (e) {} }
      ws.isPhone = true;
      phone = ws;
      viewers.delete(ws);
      console.log('phone connected');
      return;
    }

    // A viewer sends a command → forward it to the phone only.
    if (!ws.isPhone) {
      const cmd = text.toUpperCase();
      if (COMMANDS.has(cmd) && phone && phone.readyState === 1) {
        phone.send(cmd);
        console.log('cmd ->', cmd);
      }
    }
  });

  ws.on('close', () => {
    if (ws.isPhone) { phone = null; console.log('phone disconnected'); }
    else viewers.delete(ws);
  });

  ws.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => console.log('mobile-mirror listening on ' + PORT));
