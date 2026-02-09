/**
 * S5Gate 前端脚本
 */

let socks5Config = null;
let passwordVisible = false;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadSocks5Config();
  refreshStatus();
  refreshServers();
  refreshConnections();
  refreshBlacklist();
  
  // 每 5 秒刷新连接信息
  setInterval(refreshConnections, 5000);
});

// 加载 SOCKS5 配置
async function loadSocks5Config() {
  try {
    const res = await fetch('/api/socks5-config');
    const data = await res.json();
    if (data.success) {
      socks5Config = data.config;
      document.getElementById('socks5-port-direct').textContent = socks5Config.portDirect;
      document.getElementById('socks5-port-vpn').textContent = socks5Config.portVPN;
      document.getElementById('socks5-user').textContent = socks5Config.user;
      document.getElementById('socks5-pass').textContent = socks5Config.pass;
    }
  } catch (err) {
    console.error('Failed to load SOCKS5 config:', err);
  }
}

// 切换密码可见性
function togglePassword() {
  passwordVisible = !passwordVisible;
  const passEl = document.getElementById('socks5-pass');
  if (passwordVisible) {
    passEl.classList.add('visible');
  } else {
    passEl.classList.remove('visible');
  }
}

// 复制 SOCKS5 配置
function copySocks5Config(type) {
  if (!socks5Config) return;
  
  const port = type === 'vpn' ? socks5Config.portVPN : socks5Config.portDirect;
  const config = `socks5://${socks5Config.user}:${socks5Config.pass}@${window.location.hostname}:${port}`;
  
  navigator.clipboard.writeText(config).then(() => {
    alert(`已复制 ${type === 'vpn' ? 'VPN' : '直连'} SOCKS5 配置`);
  }).catch(err => {
    prompt('复制以下配置:', config);
  });
}

// 刷新状态
async function refreshStatus() {
  try {
    const statusRes = await fetch('/api/status');
    const statusData = await statusRes.json();
    
    if (statusData.success) {
      const status = statusData.status;
      const vpn = status.vpn;
      const connStatusEl = document.getElementById('vpn-conn-status');
      const serverContainer = document.getElementById('vpn-server-container');
      const ipContainer = document.getElementById('vpn-ip-container');
      const disconnectBtn = document.getElementById('btn-disconnect');
      const vpnStatusEl = document.getElementById('vpn-status');
      
      if (vpn.connected) {
        connStatusEl.textContent = '已连接';
        connStatusEl.className = 'mode-badge vpn';
        serverContainer.style.display = 'block';
        ipContainer.style.display = 'block';
        document.getElementById('vpn-server').textContent = 
          `${vpn.server.hostName} (${vpn.server.countryShort})`;
        disconnectBtn.style.display = 'inline-block';
        vpnStatusEl.textContent = `✅ ${vpn.server.countryShort}`;
        vpnStatusEl.className = 'vpn-status connected';
        
        // 获取 VPN IP
        try {
          const ipRes = await fetch('/api/ip-info');
          const ipData = await ipRes.json();
          if (ipData.success && ipData.ipInfo) {
            document.getElementById('vpn-ip').textContent = ipData.ipInfo.ip || '-';
          }
        } catch (e) {}
      } else {
        connStatusEl.textContent = '未连接';
        connStatusEl.className = 'mode-badge direct';
        serverContainer.style.display = 'none';
        ipContainer.style.display = 'none';
        disconnectBtn.style.display = 'none';
        vpnStatusEl.textContent = '未连接';
        vpnStatusEl.className = 'vpn-status';
      }
    }
  } catch (err) {
    console.error('Failed to refresh status:', err);
  }
}

// 刷新节点列表
async function refreshServers(forceRefresh = false) {
  const listEl = document.getElementById('servers-list');
  const countEl = document.getElementById('servers-count');
  const cacheEl = document.getElementById('cache-info');
  
  listEl.innerHTML = '<div class="loading">加载中...</div>';
  
  try {
    const url = forceRefresh ? '/api/servers?refresh=true' : '/api/servers';
    const res = await fetch(url);
    const data = await res.json();
    
    if (!data.success) {
      listEl.innerHTML = `<div class="loading">加载失败: ${data.error}</div>`;
      return;
    }
    
    countEl.textContent = `${data.totalServers} 个节点 / ${data.totalCountries} 个国家`;
    
    if (data.fromCache) {
      cacheEl.textContent = `(缓存 ${data.cacheAge}s)`;
    } else {
      cacheEl.textContent = '';
    }
    
    if (data.message) {
      alert(data.message);
    }
    
    renderServers(data.groups);
  } catch (err) {
    listEl.innerHTML = `<div class="loading">加载失败: ${err.message}</div>`;
  }
}

// 渲染节点列表
function renderServers(groups) {
  const listEl = document.getElementById('servers-list');
  listEl.innerHTML = '';
  
  groups.forEach((group, index) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'country-group';
    
    const flag = getCountryFlag(group.countryShort);
    
    groupEl.innerHTML = `
      <div class="country-header" onclick="toggleCountry(${index})">
        <span class="country-flag">${flag}</span>
        <span class="country-name">${group.countryLong}</span>
        <span class="country-count">${group.servers.length}</span>
      </div>
      <div class="country-servers" id="country-${index}">
        ${group.servers.map(server => `
          <div class="server-item" onclick='connectServer(${JSON.stringify(server).replace(/'/g, "&#39;")})'>
            <div class="server-info">
              <div class="server-name">${server.hostName || server.ip}</div>
              <div class="server-meta">${server.ip} · ${server.speedMbps} Mbps</div>
            </div>
            <div class="server-uptime">${server.uptimeDays}d ${server.uptimeHours}h</div>
          </div>
        `).join('')}
      </div>
    `;
    
    listEl.appendChild(groupEl);
  });
  
  // 默认展开第一个国家
  if (groups.length > 0) {
    document.getElementById('country-0').classList.add('expanded');
  }
}

// 切换国家展开/收起
function toggleCountry(index) {
  const el = document.getElementById(`country-${index}`);
  el.classList.toggle('expanded');
}

// 获取国旗 emoji
function getCountryFlag(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '🌐';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt());
  return String.fromCodePoint(...codePoints);
}

// 连接节点
async function connectServer(server) {
  if (!confirm(`确认切换到 VPN 节点?\n\n${server.hostName}\n${server.countryLong}\n在线: ${server.uptimeDays}天 ${server.uptimeHours}小时`)) {
    return;
  }
  
  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(server)
    });
    
    const data = await res.json();
    
    if (data.success) {
      alert('切换成功!');
      refreshStatus();
    } else {
      alert('切换失败: ' + data.error);
    }
  } catch (err) {
    alert('切换失败: ' + err.message);
  }
}

// 断开 VPN
async function disconnect() {
  if (!confirm('确认断开 VPN?')) {
    return;
  }
  
  try {
    const res = await fetch('/api/disconnect', { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      alert('VPN 已断开');
      refreshStatus();
    } else {
      alert('断开失败: ' + data.error);
    }
  } catch (err) {
    alert('断开失败: ' + err.message);
  }
}

// 刷新连接信息
async function refreshConnections() {
  try {
    const res = await fetch('/api/connections');
    const data = await res.json();
    
    if (data.success) {
      const countEl = document.getElementById('conn-count');
      const listEl = document.getElementById('connections-list');
      
      countEl.textContent = data.count;
      
      if (data.clients && data.clients.length > 0) {
        listEl.innerHTML = data.clients.map(client => `
          <div class="client-item">
            <span class="client-ip">${client.ip}</span>
            <div>
              <span class="client-count">${client.connections} 连接</span>
              <button class="btn-block" onclick="blockIP('${client.ip}')">封禁</button>
            </div>
          </div>
        `).join('');
      } else {
        listEl.innerHTML = '<div class="no-connections">暂无连接</div>';
      }
    }
  } catch (err) {
    console.error('Failed to refresh connections:', err);
  }
}

// 刷新黑名单
async function refreshBlacklist() {
  try {
    const res = await fetch('/api/blacklist');
    const data = await res.json();
    
    if (data.success) {
      const countEl = document.getElementById('blacklist-count');
      const listEl = document.getElementById('blacklist-list');
      
      countEl.textContent = data.blacklist.length;
      
      if (data.blacklist.length > 0) {
        listEl.innerHTML = data.blacklist.map(ip => `
          <div class="blacklist-item">
            <span class="blacklist-ip">${ip}</span>
            <button class="btn-unblock" onclick="unblockIP('${ip}')">解封</button>
          </div>
        `).join('');
      } else {
        listEl.innerHTML = '<div class="no-blacklist">无封禁 IP</div>';
      }
    }
  } catch (err) {
    console.error('Failed to refresh blacklist:', err);
  }
}

// 封禁 IP
async function blockIP(ip) {
  if (!confirm(`确认封禁 IP: ${ip}?`)) return;
  
  try {
    const res = await fetch('/api/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });
    const data = await res.json();
    
    if (data.success) {
      refreshBlacklist();
      refreshConnections();
    } else {
      alert('封禁失败: ' + data.error);
    }
  } catch (err) {
    alert('封禁失败: ' + err.message);
  }
}

// 手动输入封禁
function blockIPManual() {
  const input = document.getElementById('block-ip-input');
  const ip = input.value.trim();
  
  if (!ip) {
    alert('请输入 IP 地址');
    return;
  }
  
  // 简单验证 IP 格式
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    alert('IP 地址格式不正确');
    return;
  }
  
  blockIP(ip).then(() => {
    input.value = '';
  });
}

// 解封 IP
async function unblockIP(ip) {
  if (!confirm(`确认解封 IP: ${ip}?`)) return;
  
  try {
    const res = await fetch('/api/unblock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });
    const data = await res.json();
    
    if (data.success) {
      refreshBlacklist();
    } else {
      alert('解封失败: ' + data.error);
    }
  } catch (err) {
    alert('解封失败: ' + err.message);
  }
}

// 登出
async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
}
