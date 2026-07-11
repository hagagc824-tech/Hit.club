const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Cấu hình cơ bản
const HOST = '0.0.0.0';
const PORT = process.env.PORT || 8000;
const POLL_INTERVAL = 5000; // ms
const RETRY_DELAY = 5000;
const MAX_HISTORY = 50;

// Dữ liệu lưu trữ & Khóa đồng bộ
const lock = {
  lock100: false,
  lock101: false,
  historyLock: false
};

let latestResult100 = {
  Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0,
  Tong: 0, Ket_qua: "Chưa có", id: "@tranhoang2286"
};
let latestResult101 = {
  Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0,
  Tong: 0, Ket_qua: "Chưa có", id: "@tranhoang2286"
};

let history100 = [];
let history101 = [];
let lastSid100 = null;
let lastSid101 = null;
let sidForTx = null;

// --------------------------
// Hàm hỗ trợ
// --------------------------
function getTaiXiu(d1, d2, d3) {
  const total = d1 + d2 + d3;
  return total <= 10 ? "Xỉu" : "Tài";
}

function updateResult(store, history, lockKey, result) {
  const waitLock = () => new Promise(resolve => {
    const check = () => {
      if (!lock[lockKey]) {
        lock[lockKey] = true;
        resolve();
      } else setTimeout(check, 10);
    };
    check();
  });

  waitLock().then(() => {
    Object.assign(store, result);
    history.unshift({...result});
    if (history.length > MAX_HISTORY) history.pop();
    lock[lockKey] = false;
  });
}

// Gọi API lấy dữ liệu
function fetchApi(url) {
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(url);
    https.get(reqUrl, {
      headers: { 'User-Agent': 'Node-Proxy/1.0' },
      timeout: 10000
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error('JSON parse error: ' + err.message));
        }
      });
    }).on('error', err => reject(err))
      .on('timeout', () => reject(new Error('Request timeout')));
  });
}

// Luồng lấy dữ liệu liên tục
async function pollApi(gid, lockKey, resultStore, history, isMd5) {
  const url = `https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=${gid}`;
  
  while (true) {
    try {
      const data = await fetchApi(url);
      if (data?.status === 'OK' && Array.isArray(data?.data)) {
        // Lấy sid cho TX khi cần
        if (!isMd5) {
          for (const game of data.data) {
            if (game.cmd === 1008 && game.sid) sidForTx = game.sid;
          }
        }

        // Xử lý dữ liệu
        for (const game of data.data) {
          const cmd = game.cmd;
          const d1 = game.d1, d2 = game.d2, d3 = game.d3;
          const validDice = [d1, d2, d3].every(v => typeof v === 'number');

          if (isMd5 && cmd === 2006 && game.sid && validDice && game.sid !== lastSid101) {
            lastSid101 = game.sid;
            const total = d1 + d2 + d3;
            const result = {
              Phien: game.sid,
              Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3,
              Tong: total, Ket_qua: getTaiXiu(d1, d2, d3),
              id: "@tranhoang2286"
            };
            updateResult(resultStore, history, lockKey, result);
            console.log(`[MD5] Phiên ${game.sid} - Tổng: ${total}, Kết quả: ${result.Ket_qua}`);
          }

          if (!isMd5 && cmd === 1003 && sidForTx && validDice && sidForTx !== lastSid100) {
            lastSid100 = sidForTx;
            const total = d1 + d2 + d3;
            const result = {
              Phien: sidForTx,
              Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3,
              Tong: total, Ket_qua: getTaiXiu(d1, d2, d3),
              id: "@tranhoang2286"
            };
            updateResult(resultStore, history, lockKey, result);
            console.log(`[TX] Phiên ${sidForTx} - Tổng: ${total}, Kết quả: ${result.Ket_qua}`);
            sidForTx = null;
          }
        }
      }
    } catch (err) {
      console.error(`Lỗi khi lấy dữ liệu API ${gid}:`, err.message);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

// --------------------------
// Khởi tạo Express & API
// --------------------------
const app = express();

// CORS (nếu gọi từ trình duyệt)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  next();
});

// API Endpoints
app.get('/api/taixiu', (req, res) => {
  res.json(latestResult100);
});

app.get('/api/taixiumd5', (req, res) => {
  res.json(latestResult101);
});

app.get('/api/history', (req, res) => {
  res.json({ taixiu: history100, taixiumd5: history101 });
});

app.get('/', (req, res) => {
  res.send("API Server for TaiXiu is running. Endpoints: /api/taixiu, /api/taixiumd5, /api/history");
});

// --------------------------
// Khởi động toàn bộ hệ thống
// --------------------------
console.log("Khởi động hệ thống API Tài Xỉu...");
pollApi("vgmn_100", "lock100", latestResult100, history100, false);
pollApi("vgmn_101", "lock101", latestResult101, history101, true);
console.log("Đã bắt đầu polling dữ liệu.");

http.createServer(app).listen(PORT, HOST, () => {
  console.log(`Server đang chạy tại http://${HOST}:${PORT}`);
});
