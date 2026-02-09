#!/bin/bash
set -e

# 设置默认值
export SOCKS5_PORT_DIRECT=${SOCKS5_PORT_DIRECT:-1080}
export SOCKS5_PORT_VPN=${SOCKS5_PORT_VPN:-1081}
export SOCKS5_USER=${SOCKS5_USER:-s5user}
export PORT=${PORT:-8080}

# 生成强密码（如果未设置）
if [ -z "$SOCKS5_PASS" ]; then
    export SOCKS5_PASS=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)
fi

echo "========================================"
echo "  S5Gate - Dual SOCKS5 Proxy Service"
echo "========================================"
echo "  Direct Port: ${SOCKS5_PORT_DIRECT}"
echo "  VPN Port:    ${SOCKS5_PORT_VPN}"
echo "  User:        ${SOCKS5_USER}"
echo "  Pass:        ${SOCKS5_PASS}"
echo "  WebUI Port:  ${PORT}"
echo "========================================"

# 创建系统用户用于 Dante 认证
echo "[1/5] Setting up SOCKS5 user..."
if ! id "$SOCKS5_USER" &>/dev/null; then
    useradd -r -s /bin/false "$SOCKS5_USER"
fi
echo "${SOCKS5_USER}:${SOCKS5_PASS}" | chpasswd
echo "  - User ${SOCKS5_USER} ready"

# 确保目录存在
mkdir -p /etc/openvpn
mkdir -p /dev/net
mkdir -p /run/s5gate

# 创建 tun 设备（如果不存在）
if [ ! -c /dev/net/tun ]; then
    mknod /dev/net/tun c 10 200
    chmod 600 /dev/net/tun
fi
echo "[2/5] TUN device ready"

# 获取默认网络接口
export DEFAULT_INTERFACE=$(ip route show default | awk '/default/ {print $5}' | head -1)
if [ -z "$DEFAULT_INTERFACE" ]; then
    export DEFAULT_INTERFACE="eth0"
fi
echo "[3/5] Default interface: ${DEFAULT_INTERFACE}"

# 生成直连模式 Dante 配置
envsubst < /etc/danted-direct.template.conf > /etc/danted-direct.conf

# 启动直连 Dante
echo "[4/5] Starting Direct SOCKS5 (port ${SOCKS5_PORT_DIRECT})..."
danted -f /etc/danted-direct.conf -p /run/danted-direct.pid &
sleep 1
echo "  - Direct SOCKS5 running"

echo "[5/5] VPN SOCKS5 will start after connecting to VPNGate"

echo ""
echo "========================================"
echo "  Services Ready:"
echo "  - Direct SOCKS5: 0.0.0.0:${SOCKS5_PORT_DIRECT}"
echo "  - VPN SOCKS5:    0.0.0.0:${SOCKS5_PORT_VPN} (after VPN connect)"
echo "  - WebUI:         http://0.0.0.0:${PORT}"
echo "========================================"
echo ""

# 保存配置到文件供 Node.js 读取
cat > /run/s5gate/config.json << EOF
{
    "socks5PortDirect": ${SOCKS5_PORT_DIRECT},
    "socks5PortVPN": ${SOCKS5_PORT_VPN},
    "socks5User": "${SOCKS5_USER}",
    "socks5Pass": "${SOCKS5_PASS}",
    "defaultInterface": "${DEFAULT_INTERFACE}",
    "webPort": ${PORT}
}
EOF

cd /app && exec node server.js
