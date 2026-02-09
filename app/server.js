/**
 * S5Gate - SOCKS5 代理网关服务
 * 支持直连和 VPNGate 模式切换
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const vpngate = require('./vpngate');
const proxyManager = require('./proxy-manager');

const app = express();

// 配置
const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = process.env.AUTH_TOKEN || generateToken();
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7天

// 会话存储
const sessions = new Map();

// 生成随机 Token
function generateToken() {
  const token = crypto.randomBytes(16).toString('hex');
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  🔐 Auth Token: ${token}  ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  return token;
}

// 创建会话
function createSession() {
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, { createdAt: Date.now() });
  return sessionId;
}

// 验证会话
function validateSession(sessionId) {
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    sessions.delete(sessionId);
    return false;
  }
  return true;
}

// 解析 cookies
function parseCookies(cookieHeader) {
  const cookies = {};
  (cookieHeader || '').split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) cookies[name] = value;
  });
  return cookies;
}

// 认证中间件
function authMiddleware(req, res, next) {
  if (req.path === '/api/login' || req.path === '/login' || req.path === '/login.html') {
    return next();
  }
  
  if (req.path.endsWith('.css') || (req.path.endsWith('.js') && !req.path.startsWith('/api/'))) {
    return next();
  }
  
  const urlToken = req.query.token;
  if (urlToken && urlToken === AUTH_TOKEN) {
    const sessionId = createSession();
    res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly; Max-Age=${SESSION_MAX_AGE / 1000}`);
    return res.redirect('/');
  }
  
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies['session'];
  
  if (validateSession(sessionId)) {
    return next();
  }
  
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  return res.redirect('/login.html');
}

// 中间件
app.use(express.json());
app.use(authMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// API: Token 登录
app.post('/api/login', (req, res) => {
  const { token } = req.body;
  if (token === AUTH_TOKEN) {
    const sessionId = createSession();
    res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly; Max-Age=${SESSION_MAX_AGE / 1000}`);
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// API: 登出
app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies['session'];
  if (sessionId) sessions.delete(sessionId);
  res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true });
});

// API: 获取当前状态
app.get('/api/status', async (req, res) => {
  try {
    const status = await proxyManager.getStatus();
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 获取 SOCKS5 配置信息
app.get('/api/socks5-config', (req, res) => {
  const config = proxyManager.getSocks5Config();
  res.json({ success: true, config });
});

// API: 获取节点列表
app.get('/api/servers', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const result = await vpngate.getGroupedServers(forceRefresh);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[API] Error fetching servers:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 切换到 VPNGate 节点
app.post('/api/connect', async (req, res) => {
  try {
    const { hostName, ip, countryLong, countryShort, uptimeDays, uptimeHours, configBase64 } = req.body;
    
    if (!configBase64) {
      return res.status(400).json({ success: false, error: 'Missing configBase64' });
    }
    
    const ovpnContent = vpngate.decodeOvpnConfig(configBase64);
    const server = { hostName, ip, countryLong, countryShort, uptimeDays, uptimeHours };
    
    const status = await proxyManager.switchToVPN(server, ovpnContent);
    res.json({ success: true, status });
  } catch (error) {
    console.error('[API] Error connecting:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 切换到直连模式
app.post('/api/disconnect', async (req, res) => {
  try {
    const status = await proxyManager.switchToDirect();
    res.json({ success: true, status });
  } catch (error) {
    console.error('[API] Error disconnecting:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 获取 IP 信息
app.get('/api/ip-info', async (req, res) => {
  try {
    const ipInfo = await proxyManager.getIPInfo();
    res.json({ success: true, ipInfo });
  } catch (error) {
    console.error('[API] Error getting IP info:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 缓存状态
app.get('/api/cache-status', (req, res) => {
  const cacheStatus = vpngate.getCacheStatus();
  res.json({ success: true, ...cacheStatus });
});

// API: 获取连接信息
app.get('/api/connections', async (req, res) => {
  try {
    const connections = await proxyManager.getConnections();
    res.json({ success: true, ...connections });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 获取黑名单
app.get('/api/blacklist', (req, res) => {
  const list = proxyManager.getBlacklist();
  res.json({ success: true, blacklist: list });
});

// API: 封禁 IP
app.post('/api/block', async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) {
      return res.status(400).json({ success: false, error: 'Missing IP' });
    }
    const result = await proxyManager.blockIP(ip);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: 解封 IP
app.post('/api/unblock', async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) {
      return res.status(400).json({ success: false, error: 'Missing IP' });
    }
    const result = await proxyManager.unblockIP(ip);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  const config = proxyManager.getSocks5Config();
  console.log(`
========================================
  S5Gate - SOCKS5 Proxy Gateway
========================================
  WebUI:      http://0.0.0.0:${PORT}
  SOCKS5:     0.0.0.0:${config.port}
  User:       ${config.user}
  Pass:       ${config.pass}
  
  🔐 WebUI Token: ${AUTH_TOKEN}
  
  💡 Quick login URL:
     http://HOST:${PORT}/?token=${AUTH_TOKEN}
========================================
`);
});
