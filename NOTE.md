# S5Gate 开发笔记

## 项目概述

S5Gate 是一个双端口 SOCKS5 代理网关服务，同时提供直连和 VPNGate 两个独立的代理端口。

## 开发时间线

### 2024-02-09

**初始版本**
- 基于 xgate 项目重构，移除 Xray 组件
- 使用 Dante 直接提供带认证的 SOCKS5 服务
- WebUI 管理界面（Token 认证）
- 自动生成 24 位强密码

**功能迭代 1 - 连接监控**
- API: `GET /api/connections`
- 显示当前连接数和客户端 IP 列表
- 每 5 秒自动刷新

**功能迭代 2 - IP 黑名单**
- API: `GET /api/blacklist`, `POST /api/block`, `POST /api/unblock`
- 使用 iptables 实现 IP 封禁
- 黑名单持久化存储，重启后自动恢复

**功能迭代 3 - 双端口架构**
- 改为双端口独立服务，不再切换模式
- 端口 1080: 直连 SOCKS5（始终可用）
- 端口 1081: VPN SOCKS5（连接 VPNGate 后可用）
- 两个端口共用同一套用户名密码
- 更新 WebUI 显示双端口配置

**功能迭代 4 - 策略路由修复**
- 修复 VPN 连接后直连端口被劫持的问题
- 使用源 IP 策略路由（`ip rule add from <eth0_ip> table 100`）
- 直连端口流量绕过 VPN 隧道，始终走本机网络
- 测试确认节点切换功能正常（JP → KR）

**部署准备**
- 添加 GitHub Actions workflow（手动触发）
- 支持多架构构建 (amd64/arm64)
- 添加 Portainer stack.yml 配置
- 推送到 GitHub: https://github.com/c21xdx/s5gate

## 架构

```
端口 1080 (直连 - 始终可用):
客户端 → SOCKS5 (Dante) → eth0 → 本机网络

端口 1081 (VPN - 连接后可用):
客户端 → SOCKS5 (Dante) → tun0 → VPNGate 节点
```

## 技术栈

- **基础镜像**: debian:bookworm-slim
- **SOCKS5 代理**: Dante (danted) x2 实例
- **VPN 客户端**: OpenVPN
- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JS
- **IP 封禁**: iptables

## 文件结构

```
s5gate/
├── Dockerfile
├── docker-compose.yml
├── stack.yml                # Portainer 部署配置
├── entrypoint.sh
├── README.md
├── NOTE.md
├── .gitignore
├── .github/
│   └── workflows/
│       └── docker.yml       # GitHub Actions (手动触发)
├── dante/
│   ├── danted-direct.template.conf  # 直连端口配置
│   └── danted-vpn.template.conf     # VPN端口配置
└── app/
    ├── server.js
    ├── vpngate.js
    ├── proxy-manager.js
    ├── package.json
    └── public/
        ├── index.html
        ├── login.html
        ├── style.css
        └── app.js
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/login | Token 登录 |
| POST | /api/logout | 登出 |
| GET | /api/status | 获取当前状态 |
| GET | /api/socks5-config | 获取 SOCKS5 配置 |
| GET | /api/servers | 获取 VPNGate 节点列表 |
| POST | /api/connect | 连接 VPN 节点 |
| POST | /api/disconnect | 断开 VPN |
| GET | /api/ip-info | 获取出口 IP 信息 |
| GET | /api/connections | 获取当前连接信息 |
| GET | /api/blacklist | 获取 IP 黑名单 |
| POST | /api/block | 封禁 IP |
| POST | /api/unblock | 解封 IP |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 8080 | WebUI 端口 |
| SOCKS5_PORT_DIRECT | 1080 | 直连 SOCKS5 端口 |
| SOCKS5_PORT_VPN | 1081 | VPN SOCKS5 端口 |
| SOCKS5_USER | s5user | SOCKS5 用户名 |
| SOCKS5_PASS | 自动生成 | SOCKS5 密码 |
| AUTH_TOKEN | 自动生成 | WebUI 登录 Token |

## 部署

### Portainer Stack

```yaml
version: '3.8'

services:
  s5gate:
    image: c21xdx/s5gate:latest
    container_name: s5gate
    restart: unless-stopped
    ports:
      - "8080:8080"
      - "1080:1080"
      - "1081:1081"
    environment:
      - SOCKS5_PASS=YourPassword
      - AUTH_TOKEN=YourToken
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    sysctls:
      - net.ipv4.ip_forward=1
```

## 测试记录

### 2024-02-09 双端口测试

| 测试项 | 结果 |
|--------|------|
| 直连 1080 (VPN 前) | ✅ US IP |
| 直连 1080 (VPN 后) | ✅ US IP (不变) |
| VPN 1081 (JP 节点) | ✅ Japan IP |
| VPN 1081 (切换 KR) | ✅ Korea IP |
| 节点切换 | ✅ 自动重启 VPN Dante |

## TODO

- [ ] 流量统计
- [ ] 连接日志记录
- [ ] 多用户支持
- [ ] 限速功能
- [ ] 自动重连 VPN
- [ ] VPN 节点健康检查
