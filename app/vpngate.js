/**
 * VPNGate API 模块
 * 获取、解析、分组节点列表
 */
const axios = require('axios');

const VPNGATE_API = 'https://www.vpngate.net/api/iphone/';

// 缓存配置
const CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存
const MIN_REFRESH_INTERVAL = 2 * 60 * 1000; // 最小刷新间隔 2分钟

// 缓存状态
let cachedServers = null;
let cacheTime = 0;
let lastFetchTime = 0;
let fetchCount = 0;

/**
 * 从 VPNGate API 获取原始数据
 */
async function fetchRawData() {
  const response = await axios.get(VPNGATE_API, {
    responseType: 'text',
    timeout: 30000
  });
  return response.data;
}

/**
 * 解析 CSV 数据为服务器对象数组
 */
function parseServers(rawData) {
  const lines = rawData.split('\n');
  let header = null;
  const servers = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('*')) continue;

    if (line.startsWith('#')) {
      header = line.slice(1).split(',');
      continue;
    }

    const fields = line.split(',');
    if (fields.length < 14) continue;

    const server = {
      hostName: fields[0] || '',
      ip: fields[1] || '',
      score: parseInt(fields[2]) || 0,
      ping: parseInt(fields[3]) || 9999,
      speed: parseInt(fields[4]) || 0,
      countryLong: fields[5] || '',
      countryShort: fields[6] || '',
      numVpnSessions: parseInt(fields[7]) || 0,
      uptime: parseInt(fields[8]) || 0,
      totalUsers: parseInt(fields[9]) || 0,
      totalTraffic: parseInt(fields[10]) || 0,
      logType: fields[11] || '',
      operator: fields[12] || '',
      message: fields[13] || '',
      configBase64: fields[14] || ''
    };

    if (!server.ip || !server.configBase64) continue;

    server.uptimeDays = Math.floor(server.uptime / (1000 * 60 * 60 * 24));
    server.uptimeHours = Math.floor((server.uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    server.speedMbps = (server.speed / 1000000).toFixed(2);

    servers.push(server);
  }

  return servers;
}

/**
 * 按国家分组
 */
function groupByCountry(servers) {
  const groups = {};
  for (const server of servers) {
    const country = server.countryLong || 'Unknown';
    if (!groups[country]) {
      groups[country] = {
        countryLong: country,
        countryShort: server.countryShort || '??',
        servers: []
      };
    }
    groups[country].servers.push(server);
  }

  for (const country of Object.keys(groups)) {
    groups[country].servers.sort((a, b) => b.uptime - a.uptime);
  }

  const result = Object.values(groups).sort((a, b) => {
    if (a.countryShort === 'JP') return -1;
    if (b.countryShort === 'JP') return 1;
    return b.servers.length - a.servers.length;
  });

  return result;
}

/**
 * 获取分组后的服务器列表
 */
async function getGroupedServers(forceRefresh = false) {
  const now = Date.now();
  
  const cacheValid = cachedServers && (now - cacheTime) < CACHE_TTL;
  const canRefresh = (now - lastFetchTime) >= MIN_REFRESH_INTERVAL;
  
  if (!forceRefresh && cacheValid) {
    const totalServers = cachedServers.reduce((sum, g) => sum + g.servers.length, 0);
    return {
      totalCountries: cachedServers.length,
      totalServers: totalServers,
      groups: cachedServers,
      fromCache: true,
      cacheAge: Math.floor((now - cacheTime) / 1000),
      nextRefreshIn: Math.max(0, Math.floor((MIN_REFRESH_INTERVAL - (now - lastFetchTime)) / 1000))
    };
  }
  
  if (forceRefresh && !canRefresh && cachedServers) {
    const totalServers = cachedServers.reduce((sum, g) => sum + g.servers.length, 0);
    const waitTime = Math.ceil((MIN_REFRESH_INTERVAL - (now - lastFetchTime)) / 1000);
    return {
      totalCountries: cachedServers.length,
      totalServers: totalServers,
      groups: cachedServers,
      fromCache: true,
      rateLimited: true,
      cacheAge: Math.floor((now - cacheTime) / 1000),
      nextRefreshIn: waitTime,
      message: `请等待 ${waitTime} 秒后再刷新`
    };
  }

  console.log('[VPNGate] Fetching server list from API...');
  const rawData = await fetchRawData();
  const servers = parseServers(rawData);
  const grouped = groupByCountry(servers);

  cachedServers = grouped;
  cacheTime = now;
  lastFetchTime = now;
  fetchCount++;
  
  console.log(`[VPNGate] Fetched ${servers.length} servers from ${grouped.length} countries`);

  const totalServers = grouped.reduce((sum, g) => sum + g.servers.length, 0);
  return {
    totalCountries: grouped.length,
    totalServers: totalServers,
    groups: grouped,
    fromCache: false,
    cacheAge: 0,
    nextRefreshIn: Math.floor(MIN_REFRESH_INTERVAL / 1000)
  };
}

/**
 * 解码 .ovpn 配置
 */
function decodeOvpnConfig(base64Config) {
  return Buffer.from(base64Config, 'base64').toString('utf-8');
}

/**
 * 获取缓存状态
 */
function getCacheStatus() {
  const now = Date.now();
  return {
    hasCachedData: !!cachedServers,
    cacheAge: cachedServers ? Math.floor((now - cacheTime) / 1000) : null,
    cacheTTL: CACHE_TTL / 1000,
    minRefreshInterval: MIN_REFRESH_INTERVAL / 1000,
    nextRefreshIn: Math.max(0, Math.floor((MIN_REFRESH_INTERVAL - (now - lastFetchTime)) / 1000)),
    totalFetches: fetchCount
  };
}

module.exports = {
  getGroupedServers,
  decodeOvpnConfig,
  getCacheStatus
};
