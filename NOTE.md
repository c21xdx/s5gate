# S5Gate 开发笔记

## 项目概述

S5Gate 是一个 SOCKS5 代理网关服务，支持直连和 VPNGate 模式切换。

## 开发时间线

### 2024-02-09

**初始版本**
- 基于 xgate 项目重构，移除 Xray 组件
- 使用 Dante 直接提供带认证的 SOCKS5 服务
- 实现双模式切换：直连模式 / VPNGate 模式
- WebUI 管理界面（Token 认证）
- 自动生成 24 位强密码

**功能迭代**
1. 添加连接监控功能
   - API: `GET /api/connections`
   - 显示当前连接数和客户端 IP 列表
   - 每 5 秒自动刷新

2. 添加 IP 黑名单功能
   - API: `GET /api/blacklist`, `POST /api/block`, `POST /api/unblock`
   - 使用 iptables 实现 IP 封禁
   - 黑名单持久化存储
   - 重启后自动恢复封禁规则

## 架构

```
直连模式:
客户端 → SOCKS5 (Dante+认证) → eth0 → 本机网络

VPN 模式:
客户端 → SOCKS5 (Dante+认证) → tun0 → VPNGate 节点
```

## 技术栈

- **基础镜像**: debian:bookworm-slim
- **SOCKS5 代理**: Dante (danted)
- **VPN 客户端**: OpenVPN
- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JS
- **IP 封禁**: iptables

## 文件结构

```
s5gate/
├── Dockerfile
├── docker-compose.yml
├── entrypoint.sh
├── README.md
├── NOTE.md              # 本文件
├── dante/
│   └── danted.template.conf
└── app/
    ├── server.js        # Express API
    ├── vpngate.js       # VPNGate 节点获取
    ├── proxy-manager.js # 代理管理、连接监控、IP 黑名单
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
| POST | /api/connect | 切换到 VPN 模式 |
| POST | /api/disconnect | 切换到直连模式 |
| GET | /api/ip-info | 获取出口 IP 信息 |
| GET | /api/connections | 获取当前连接信息 |
| GET | /api/blacklist | 获取 IP 黑名单 |
| POST | /api/block | 封禁 IP |
| POST | /api/unblock | 解封 IP |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 8080 | WebUI 端口 |
| SOCKS5_PORT | 1080 | SOCKS5 端口 |
| SOCKS5_USER | s5user | SOCKS5 用户名 |
| SOCKS5_PASS | 自动生成 | SOCKS5 密码 |
| AUTH_TOKEN | 自动生成 | WebUI 登录 Token |

## TODO

- [ ] 流量统计
- [ ] 连接日志记录
- [ ] 多用户支持
- [ ] 限速功能
