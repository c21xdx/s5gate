/**
 * 代理管理模块
 * 管理 Dante SOCKS5 和 OpenVPN 的切换
 */
const fs = require('fs');
const { exec, spawn } = require('child_process');
const path = require('path');
const https = require('https');
const http = require('http');

const OVPN_CONFIG_PATH = '/etc/openvpn/openvpn.ovpn';
const OVPN_DIR = path.dirname(OVPN_CONFIG_PATH);
const CONFIG_PATH = '/run/s5gate/config.json';
const DANTED_TEMPLATE = '/etc/danted.template.conf';
const DANTED_CONF = '/etc/danted.conf';
const BLACKLIST_PATH = '/run/s5gate/blacklist.json';

// IP 黑名单
let blacklist = new Set();

// 读取启动配置
let startupConfig = null;
function getConfig() {
  if (!startupConfig) {
    try {
      startupConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (e) {
      startupConfig = {
        socks5Port: process.env.SOCKS5_PORT || 1080,
        socks5User: process.env.SOCKS5_USER || 's5user',
        socks5Pass: process.env.SOCKS5_PASS || 'changeme',
        defaultInterface: 'eth0',
        webPort: process.env.PORT || 8080
      };
    }
  }
  return startupConfig;
}

// 保存原始网关
let originalGateway = null;

// 当前状态
let currentStatus = {
  mode: 'direct', // 'direct' 或 'vpn'
  server: null,
  connectedAt: null,
  error: null
};

/**
 * 获取 SOCKS5 配置信息
 */
function getSocks5Config() {
  const config = getConfig();
  return {
    port: config.socks5Port,
    user: config.socks5User,
    pass: config.socks5Pass
  };
}

/**
 * 检查 OpenVPN 进程是否运行
 */
function isOpenVPNRunning() {
  return new Promise((resolve) => {
    exec('pgrep -x openvpn', (error, stdout) => {
      resolve(!error && stdout.trim().length > 0);
    });
  });
}

/**
 * 检查 tun 设备是否存在
 */
function isTunActive() {
  return new Promise((resolve) => {
    exec('ip link show tun0', (error) => {
      resolve(!error);
    });
  });
}

/**
 * 写入 .ovpn 配置文件
 */
function writeOvpnConfig(ovpnContent) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(OVPN_DIR)) {
      fs.mkdirSync(OVPN_DIR, { recursive: true });
    }
    
    let modifiedContent = ovpnContent;
    if (!modifiedContent.includes('data-ciphers')) {
      const extraConfig = `# Added for compatibility
data-ciphers AES-256-GCM:AES-128-GCM:AES-128-CBC:CHACHA20-POLY1305
data-ciphers-fallback AES-128-CBC
`;
      modifiedContent = extraConfig + modifiedContent;
    }
    
    fs.writeFile(OVPN_CONFIG_PATH, modifiedContent, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * 停止 OpenVPN
 */
function stopOpenVPN() {
  return new Promise((resolve) => {
    exec('pkill -SIGTERM openvpn', () => {
      setTimeout(resolve, 2000);
    });
  });
}

/**
 * 保存原始网关
 */
function saveOriginalGateway() {
  return new Promise((resolve) => {
    if (originalGateway) {
      resolve(originalGateway);
      return;
    }
    exec('ip route show default | head -1 | awk \'{print $3}\'', (err, stdout) => {
      originalGateway = stdout.trim();
      console.log(`[Route] Saved original gateway: ${originalGateway}`);
      resolve(originalGateway);
    });
  });
}

/**
 * 设置绕过路由
 */
function setupBypassRoutes() {
  return new Promise((resolve) => {
    if (!originalGateway) {
      resolve();
      return;
    }
    
    console.log(`[Route] Setting up bypass routes via ${originalGateway}`);
    
    const bypassIPs = ['130.158.75.44', '130.158.75.45'];
    const privateNetworks = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
    
    exec('getent hosts www.vpngate.net 2>/dev/null | awk \'{print $1}\'', (err, stdout) => {
      const resolvedIPs = stdout.trim().split('\n').filter(ip => ip && ip.match(/^\d/));
      const allIPs = [...new Set([...bypassIPs, ...resolvedIPs])];
      
      let routeCommands = privateNetworks.map(net => 
        `ip route add ${net} via ${originalGateway} 2>/dev/null || true`
      );
      routeCommands = routeCommands.concat(allIPs.map(ip => 
        `ip route add ${ip}/32 via ${originalGateway} 2>/dev/null || true`
      ));
      
      let completed = 0;
      const total = routeCommands.length;
      
      if (total === 0) {
        resolve();
        return;
      }
      
      routeCommands.forEach(cmd => {
        exec(cmd, () => {
          completed++;
          if (completed === total) resolve();
        });
      });
    });
  });
}

/**
 * 重启 Dante（切换接口）
 */
function restartDante(externalInterface) {
  return new Promise((resolve, reject) => {
    const config = getConfig();
    
    // 生成新配置
    let template = fs.readFileSync(DANTED_TEMPLATE, 'utf-8');
    template = template.replace(/\$\{SOCKS5_PORT\}/g, config.socks5Port);
    template = template.replace(/\$\{EXTERNAL_INTERFACE\}/g, externalInterface);
    fs.writeFileSync(DANTED_CONF, template);
    
    // 停止旧进程
    exec('pkill danted 2>/dev/null || true', () => {
      setTimeout(() => {
        // 启动新进程
        const dante = spawn('danted', ['-f', DANTED_CONF], {
          detached: true,
          stdio: 'ignore'
        });
        dante.unref();
        console.log(`[Dante] Restarted with external interface: ${externalInterface}`);
        setTimeout(resolve, 500);
      }, 500);
    });
  });
}

/**
 * 启动 OpenVPN
 */
function startOpenVPN() {
  return new Promise((resolve, reject) => {
    const openvpn = spawn('openvpn', ['--config', OVPN_CONFIG_PATH], {
      detached: true,
      stdio: 'ignore'
    });
    openvpn.unref();
    
    let attempts = 0;
    const maxAttempts = 30;
    
    const checkConnection = setInterval(async () => {
      attempts++;
      const tunActive = await isTunActive();
      
      if (tunActive) {
        clearInterval(checkConnection);
        await setupBypassRoutes();
        await restartDante('tun0');
        resolve();
      } else if (attempts >= maxAttempts) {
        clearInterval(checkConnection);
        reject(new Error('OpenVPN connection timeout'));
      }
    }, 1000);
  });
}

/**
 * 切换到 VPN 模式
 */
async function switchToVPN(server, ovpnContent) {
  try {
    currentStatus.error = null;
    
    await saveOriginalGateway();
    
    const isRunning = await isOpenVPNRunning();
    if (isRunning) {
      console.log('[OpenVPN] Stopping current connection...');
      await stopOpenVPN();
    }
    
    console.log(`[OpenVPN] Writing config for ${server.hostName} (${server.ip})...`);
    await writeOvpnConfig(ovpnContent);
    
    console.log('[OpenVPN] Starting OpenVPN...');
    await startOpenVPN();
    
    currentStatus = {
      mode: 'vpn',
      server: {
        hostName: server.hostName,
        ip: server.ip,
        countryLong: server.countryLong,
        countryShort: server.countryShort,
        uptimeDays: server.uptimeDays,
        uptimeHours: server.uptimeHours
      },
      connectedAt: new Date().toISOString(),
      error: null
    };
    
    console.log(`[OpenVPN] Connected to ${server.hostName} (${server.countryLong})`);
    return currentStatus;
    
  } catch (error) {
    currentStatus.error = error.message;
    console.error('[OpenVPN] Error:', error.message);
    throw error;
  }
}

/**
 * 切换到直连模式
 */
async function switchToDirect() {
  const config = getConfig();
  
  // 停止 OpenVPN
  await stopOpenVPN();
  
  // 重启 Dante 使用默认接口
  await restartDante(config.defaultInterface);
  
  currentStatus = {
    mode: 'direct',
    server: null,
    connectedAt: null,
    error: null
  };
  
  console.log('[Proxy] Switched to direct mode');
  return currentStatus;
}

/**
 * 获取当前状态
 */
async function getStatus() {
  const running = await isOpenVPNRunning();
  const tunActive = await isTunActive();
  const config = getConfig();
  
  return {
    ...currentStatus,
    processRunning: running,
    tunActive: tunActive,
    defaultInterface: config.defaultInterface
  };
}

/**
 * 获取 IP 信息
 */
async function getIPInfo() {
  const services = [
    {
      url: 'http://ip-api.com/json/?lang=zh-CN',
      parser: (data) => ({
        ip: data.query,
        country: data.country,
        countryCode: data.countryCode,
        region: data.regionName,
        city: data.city,
        isp: data.isp,
        org: data.org
      })
    },
    {
      url: 'https://ipinfo.io/json',
      parser: (data) => ({
        ip: data.ip,
        country: data.country,
        region: data.region,
        city: data.city,
        isp: data.org,
        org: data.org
      })
    }
  ];
  
  for (const service of services) {
    try {
      const data = await fetchJSON(service.url, 5000);
      if (data) {
        const parsed = service.parser(data);
        console.log(`[IPInfo] Got IP info: ${parsed.ip} (${parsed.country})`);
        return parsed;
      }
    } catch (error) {
      console.log(`[IPInfo] Service ${service.url} failed: ${error.message}`);
    }
  }
  
  return { error: 'Failed to get IP info' };
}

function fetchJSON(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const lib = isHttps ? https : http;
    
    const req = lib.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

/**
 * 加载黑名单
 */
function loadBlacklist() {
  try {
    if (fs.existsSync(BLACKLIST_PATH)) {
      const data = JSON.parse(fs.readFileSync(BLACKLIST_PATH, 'utf-8'));
      blacklist = new Set(data);
      console.log(`[Blacklist] Loaded ${blacklist.size} IPs`);
    }
  } catch (e) {
    console.error('[Blacklist] Failed to load:', e.message);
  }
}

/**
 * 保存黑名单
 */
function saveBlacklist() {
  try {
    fs.writeFileSync(BLACKLIST_PATH, JSON.stringify([...blacklist]));
  } catch (e) {
    console.error('[Blacklist] Failed to save:', e.message);
  }
}

/**
 * 添加 IP 到黑名单
 */
async function blockIP(ip) {
  blacklist.add(ip);
  saveBlacklist();
  
  // 使用 iptables 立即封禁
  return new Promise((resolve) => {
    const config = getConfig();
    exec(`iptables -A INPUT -s ${ip} -p tcp --dport ${config.socks5Port} -j DROP`, (err) => {
      if (err) {
        console.error(`[Blacklist] Failed to block ${ip}:`, err.message);
      } else {
        console.log(`[Blacklist] Blocked IP: ${ip}`);
      }
      resolve({ success: !err, ip });
    });
  });
}

/**
 * 从黑名单移除 IP
 */
async function unblockIP(ip) {
  blacklist.delete(ip);
  saveBlacklist();
  
  // 使用 iptables 解除封禁
  return new Promise((resolve) => {
    const config = getConfig();
    exec(`iptables -D INPUT -s ${ip} -p tcp --dport ${config.socks5Port} -j DROP`, (err) => {
      if (err) {
        console.error(`[Blacklist] Failed to unblock ${ip}:`, err.message);
      } else {
        console.log(`[Blacklist] Unblocked IP: ${ip}`);
      }
      resolve({ success: !err, ip });
    });
  });
}

/**
 * 获取黑名单
 */
function getBlacklist() {
  return [...blacklist];
}

/**
 * 应用黑名单规则（启动时调用）
 */
async function applyBlacklist() {
  loadBlacklist();
  const config = getConfig();
  
  for (const ip of blacklist) {
    await new Promise((resolve) => {
      exec(`iptables -A INPUT -s ${ip} -p tcp --dport ${config.socks5Port} -j DROP`, () => resolve());
    });
  }
  
  if (blacklist.size > 0) {
    console.log(`[Blacklist] Applied ${blacklist.size} block rules`);
  }
}

// 启动时加载黑名单
setTimeout(applyBlacklist, 1000);

/**
 * 获取当前 SOCKS5 连接信息
 */
async function getConnections() {
  return new Promise((resolve) => {
    const config = getConfig();
    const port = config.socks5Port;
    
    // 使用 ss 命令获取连接信息
    exec(`ss -tn state established '( sport = :${port} )'`, (err, stdout) => {
      if (err) {
        resolve({ count: 0, clients: [] });
        return;
      }
      
      const lines = stdout.trim().split('\n').slice(1); // 跳过标题行
      const connections = [];
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const peer = parts[4];
          
          // 解析 peer 地址 (格式: ip:port 或 [ipv6]:port)
          const peerMatch = peer.match(/^\[?([^\]]+)\]?:(\d+)$/) || peer.match(/^(.+):(\d+)$/);
          if (peerMatch) {
            connections.push({
              clientIp: peerMatch[1],
              clientPort: peerMatch[2]
            });
          }
        }
      }
      
      // 按 IP 聚合
      const ipCount = {};
      for (const conn of connections) {
        ipCount[conn.clientIp] = (ipCount[conn.clientIp] || 0) + 1;
      }
      
      const clients = Object.entries(ipCount).map(([ip, count]) => ({ ip, connections: count }));
      clients.sort((a, b) => b.connections - a.connections);
      
      resolve({
        count: connections.length,
        clients: clients
      });
    });
  });
}

module.exports = {
  getSocks5Config,
  switchToVPN,
  switchToDirect,
  getStatus,
  getIPInfo,
  getConnections,
  blockIP,
  unblockIP,
  getBlacklist
};
