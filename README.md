# 🔐 S5Gate - SOCKS5 Proxy Gateway

> 支持直连和 VPNGate 切换的 SOCKS5 代理网关

## ✨ 特性

- ✅ **强密码认证** - SOCKS5 使用用户名密码认证，安全暴露公网
- ✅ **双模式切换** - 直连模式 / VPNGate 模式
- ✅ **WebUI 管理** - 美观的网页管理界面
- ✅ **Token 认证** - WebUI 使用 Token 登录
- ✅ **自动生成密码** - 启动时自动生成 24 位强密码

## 🌟 架构

```
直连模式:
客户端 -> SOCKS5 (Dante, 带认证) -> eth0 -> 本机网络

VPN 模式:
客户端 -> SOCKS5 (Dante, 带认证) -> tun0 -> VPNGate 节点
```

## 🚀 快速开始

### Portainer Stack (推荐)

在 Portainer 中创建 Stack，粘贴以下内容：

```yaml
version: '3.8'

services:
  s5gate:
    image: crazygao/s5gate:latest
    container_name: s5gate
    restart: unless-stopped
    ports:
      - "8080:8080"    # WebUI
      - "1080:1080"    # SOCKS5
    environment:
      - PORT=8080
      - SOCKS5_PORT=1080
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
  crazygao/s5gate:latest
```

## 🔑 认证配置

### SOCKS5 认证

启动时会在日志中显示:

```
SOCKS5 Port: 1080
SOCKS5 User: s5user
SOCKS5 Pass: <自动生成的24位强密码>
```

客户端连接时使用:
```
socks5://s5user:密码@HOST:1080
```

### WebUI 认证

访问 `http://HOST:8080/?token=YOUR_TOKEN` 自动登录。

### 自定义密码

```bash
docker run ... \
  -e SOCKS5_USER="myuser" \
  -e SOCKS5_PASS="MyStrongPassword123!" \
  -e AUTH_TOKEN="my-webui-token" \
  s5gate
```

## 📊 组件说明

| 组件 | 用途 | 端口 |
|------|------|------|
| **Dante** | SOCKS5 代理 | 0.0.0.0:1080 |
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
| `SOCKS5_PORT` | 1080 | SOCKS5 端口 |
| `SOCKS5_USER` | s5user | SOCKS5 用户名 |
| `SOCKS5_PASS` | 自动生成 | SOCKS5 密码 |
| `AUTH_TOKEN` | 自动生成 | WebUI 登录 Token |

## 📁 文件结构

```
s5gate/
├── Dockerfile           # Docker 构建文件
├── docker-compose.yml   # Docker Compose 配置
├── entrypoint.sh        # 启动脚本
├── dante/
│   └── danted.template.conf  # Dante 配置模板
└── app/
    ├── server.js        # Express 主服务
    ├── vpngate.js       # VPNGate API 模块
    ├── proxy-manager.js # 代理管理模块
    ├── package.json
    └── public/
        ├── index.html   # 主页面
        ├── login.html   # 登录页
        ├── style.css    # 样式
        └── app.js       # 前端脚本
```

## 📝 许可证

MIT License
