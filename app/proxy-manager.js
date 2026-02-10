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
const DANTED_VPN_TEMPLATE = '/etc/danted-vpn.template.conf';
const DANTED_VPN_CONF = '/etc/danted-vpn.conf';
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
        socks5PortDirect: process.env.SOCKS5_PORT_DIRECT || 1080,
        socks5PortVPN: process.env.SOCKS5_PORT_VPN || 1081,
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

// 当前 VPN 状态
let vpnStatus = {
  connected: false,
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
    portDirect: config.socks5PortDirect,
    portVPN: config.socks5PortVPN,
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
 * 设置绕过路由和策略路由
 * 使用源 IP 策略路由让直连端口绕过 VPN
 */
function setupBypassRoutes() {
  return new Promise((resolve) => {
    if (!originalGateway) {
      resolve();
      return;
    }
    
    const config = getConfig();
    const defaultIface = config.defaultInterface;
    
    console.log(`[Route] Setting up policy routing via ${originalGateway}`);
    
    // 获取 eth0 IP 地址
    exec(`ip addr show ${defaultIface} | grep "inet " | awk '{print $2}' | cut -d/ -f1`, (err, stdout) => {
      const ethIP = stdout.trim();
      
      const commands = [
        // 创建路由表 100 用于直连流量
        `ip route add default via ${originalGateway} dev ${defaultIface} table 100 2>/dev/null || true`,
        
        // 从 eth0 IP 出去的流量使用路由表 100（绕过 VPN）
        `ip rule add from ${ethIP} table 100 pref 40 2>/dev/null || true`,
        
        // VPNGate API 绕过 VPN
        `ip route add 130.158.75.0/24 via ${originalGateway} 2>/dev/null || true`,
        
        // 私有网络绕过 VPN
        `ip route add 10.0.0.0/8 via ${originalGateway} 2>/dev/null || true`,
        `ip route add 172.16.0.0/12 via ${originalGateway} 2>/dev/null || true`,
        `ip route add 192.168.0.0/16 via ${originalGateway} 2>/dev/null || true`,
      ];
      
      let completed = 0;
      commands.forEach(cmd => {
        exec(cmd, (err) => {
          completed++;
          if (completed === commands.length) {
            console.log(`[Route] Policy routing configured for ${ethIP}`);
            resolve();
          }
        });
      });
    });
  });
}

/**
 * 启动 VPN Dante
 */
function startVPNDante() {
  return new Promise((resolve, reject) => {
    const config = getConfig();
    
    // 生成 VPN Dante 配置
    let template = fs.readFileSync(DANTED_VPN_TEMPLATE, 'utf-8');
    template = template.replace(/\$\{SOCKS5_PORT_VPN\}/g, config.socks5PortVPN);
    fs.writeFileSync(DANTED_VPN_CONF, template);
    
    // 停止旧的 VPN Dante
    exec('pkill -f "danted -f /etc/danted-vpn.conf" 2>/dev/null || true', () => {
      setTimeout(() => {
        const dante = spawn('danted', ['-f', DANTED_VPN_CONF], {
          detached: true,
          stdio: 'ignore'
        });
        dante.unref();
        console.log(`[Dante] VPN SOCKS5 started on port ${config.socks5PortVPN}`);
        setTimeout(resolve, 500);
      }, 500);
    });
  });
}

/**
 * 停止 VPN Dante
 */
function stopVPNDante() {
  return new Promise((resolve) => {
    exec('pkill -f "danted -f /etc/danted-vpn.conf" 2>/dev/null || true', () => {
      console.log('[Dante] VPN SOCKS5 stopped');
      setTimeout(resolve, 500);
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
    const maxAttempts = 60;
    
    const checkConnection = setInterval(async () => {
      attempts++;
      const tunActive = await isTunActive();
      
      if (tunActive) {
        clearInterval(checkConnection);
        await setupBypassRoutes();
        await startVPNDante();
        resolve();
      } else if (attempts >= maxAttempts) {
        clearInterval(checkConnection);
        reject(new Error('OpenVPN connection timeout'));
      }
    }, 1000);
  });
}

/**
 * 连接 VPN 节点
 */
async function connectVPN(server, ovpnContent) {
  try {
    vpnStatus.error = null;
    
    await saveOriginalGateway();
    
    const isRunning = await isOpenVPNRunning();
    if (isRunning) {
      console.log('[OpenVPN] Stopping current connection...');
      await stopOpenVPN();
      await stopVPNDante();
    }
    
    console.log(`[OpenVPN] Writing config for ${server.hostName} (${server.ip})...`);
    await writeOvpnConfig(ovpnContent);
    
    console.log('[OpenVPN] Starting OpenVPN...');
    await startOpenVPN();
    
    vpnStatus = {
      connected: true,
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
    return vpnStatus;
    
  } catch (error) {
    vpnStatus.error = error.message;
    console.error('[OpenVPN] Error:', error.message);
    throw error;
  }
}

/**
 * 断开 VPN
 */
async function disconnectVPN() {
  await stopOpenVPN();
  await stopVPNDante();
  
  vpnStatus = {
    connected: false,
    server: null,
    connectedAt: null,
    error: null
  };
  
  console.log('[VPN] Disconnected');
  return vpnStatus;
}

/**
 * 获取当前状态
 */
async function getStatus() {
  const running = await isOpenVPNRunning();
  const tunActive = await isTunActive();
  const config = getConfig();
  
  return {
    vpn: vpnStatus,
    processRunning: running,
    tunActive: tunActive,
    ports: {
      direct: config.socks5PortDirect,
      vpn: config.socks5PortVPN
    }
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
    const portDirect = config.socks5PortDirect;
    const portVPN = config.socks5PortVPN;
    exec(`iptables -A INPUT -s ${ip} -p tcp --dport ${portDirect} -j DROP && iptables -A INPUT -s ${ip} -p tcp --dport ${portVPN} -j DROP`, (err) => {
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
    const portDirect = config.socks5PortDirect;
    const portVPN = config.socks5PortVPN;
    exec(`iptables -D INPUT -s ${ip} -p tcp --dport ${portDirect} -j DROP; iptables -D INPUT -s ${ip} -p tcp --dport ${portVPN} -j DROP`, (err) => {
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
      const portDirect = config.socks5PortDirect;
      const portVPN = config.socks5PortVPN;
      exec(`iptables -A INPUT -s ${ip} -p tcp --dport ${portDirect} -j DROP; iptables -A INPUT -s ${ip} -p tcp --dport ${portVPN} -j DROP`, () => resolve());
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
    const portDirect = config.socks5PortDirect;
    const portVPN = config.socks5PortVPN;
    
    // 使用 ss 命令获取两个端口的连接信息
    exec(`ss -tn state established '( sport = :${portDirect} or sport = :${portVPN} )'`, (err, stdout) => {
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
  connectVPN,
  disconnectVPN,
  getStatus,
  getIPInfo,
  getConnections,
  blockIP,
  unblockIP,
  getBlacklist
};
