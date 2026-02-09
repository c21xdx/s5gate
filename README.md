# 🔐 S5Gate - Dual SOCKS5 Proxy Gateway

> 同时提供直连和 VPNGate 两个 SOCKS5 代理端口

## ✨ 特性

- ✅ **双端口服务** - 直连 (1080) + VPN (1081) 同时运行
- ✅ **强密码认证** - SOCKS5 使用用户名密码认证
- ✅ **WebUI 管理** - 美观的网页管理界面
- ✅ **VPNGate 节点** - 可切换全球免费 VPN 节点
- ✅ **自动生成密码** - 启动时自动生成 24 位强密码

## 🌟 架构

```
端口 1080 (直连):
客户端 -> SOCKS5 -> eth0 -> 本机网络

端口 1081 (VPN):
客户端 -> SOCKS5 -> tun0 -> VPNGate 节点
```

## 🚀 快速开始

### Portainer Stack (推荐)

在 Portainer 中创建 Stack，粘贴以下内容：

```yaml
version: '3.8'

services:
  s5gate:
    image: c21xdx/s5gate:latest
    container_name: s5gate
    restart: unless-stopped
    ports:
      - "8080:8080"    # WebUI
      - "1080:1080"    # Direct SOCKS5
      - "1081:1081"    # VPN SOCKS5
    environment:
      - PORT=8080
      - SOCKS5_PORT_DIRECT=1080
      - SOCKS5_PORT_VPN=1081
      - SOCKS5_USER=s5user
      # - SOCKS5_PASS=YourStrongPassword123!  # 不设置则自动生成
      # - AUTH_TOKEN=your-webui-token         # 不设置则自动生成
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    sysctls:
      - net.ipv4.ip_forward=1
```

### Docker Compose

```bash
cd /path/to/s5gate
docker-compose up -d

# 查看日志获取密码和 Token
docker logs s5gate
```

### Docker 直接运行

```bash
docker run -d --name s5gate \
  --cap-add=NET_ADMIN \
  --device=/dev/net/tun \
  --sysctl net.ipv4.ip_forward=1 \
  -p 8080:8080 \
  -p 1080:1080 \
  -p 1081:1081 \
  c21xdx/s5gate:latest
```

## 🔑 认证配置

### SOCKS5 认证

启动时会在日志中显示:

```
Direct Port: 1080
VPN Port:    1081
User:        s5user
Pass:        <自动生成的24位强密码>
```

客户端连接:
```bash
# 直连模式 (本机网络)
socks5://s5user:密码@HOST:1080

# VPN 模式 (需先在 WebUI 连接节点)
socks5://s5user:密码@HOST:1081
```

### WebUI 认证

访问 `http://HOST:8080/?token=YOUR_TOKEN` 自动登录。

### 自定义配置

```bash
docker run ... \
  -e SOCKS5_PORT_DIRECT=1080 \
  -e SOCKS5_PORT_VPN=1081 \
  -e SOCKS5_USER="myuser" \
  -e SOCKS5_PASS="MyStrongPassword123!" \
  -e AUTH_TOKEN="my-webui-token" \
  c21xdx/s5gate
```

## 📊 组件说明

| 组件 | 用途 | 端口 |
|------|------|------|
| **Dante (Direct)** | 直连 SOCKS5 | 0.0.0.0:1080 |
| **Dante (VPN)** | VPN SOCKS5 | 0.0.0.0:1081 |
| **OpenVPN** | VPN 客户端 | - |
| **Express** | WebUI 和 API | 0.0.0.0:8080 |

## 📡 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | Token 登录 |
| POST | `/api/logout` | 登出 |
| GET | `/api/status` | 获取当前状态 |
| GET | `/api/socks5-config` | 获取 SOCKS5 配置 |
| GET | `/api/servers` | 获取 VPNGate 节点列表 |
| POST | `/api/connect` | 切换到 VPN 模式 |
| POST | `/api/disconnect` | 切换到直连模式 |
| GET | `/api/ip-info` | 获取出口 IP 信息 |

## 🛠️ 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 8080 | WebUI 端口 |
| `SOCKS5_PORT_DIRECT` | 1080 | 直连 SOCKS5 端口 |
| `SOCKS5_PORT_VPN` | 1081 | VPN SOCKS5 端口 |
| `SOCKS5_USER` | s5user | SOCKS5 用户名 |
| `SOCKS5_PASS` | 自动生成 | SOCKS5 密码 |
| `AUTH_TOKEN` | 自动生成 | WebUI 登录 Token |

## 📁 文件结构

```
s5gate/
├── Dockerfile
├── docker-compose.yml
├── stack.yml              # Portainer 部署配置
├── entrypoint.sh
├── dante/
│   ├── danted-direct.template.conf  # 直连端口配置
│   └── danted-vpn.template.conf     # VPN端口配置
└── app/
    ├── server.js
    ├── vpngate.js
    ├── proxy-manager.js
    ├── package.json
    └── public/
```

## 📝 许可证

MIT License
