#!/bin/bash
set -e

# 设置默认值
export SOCKS5_PORT=${SOCKS5_PORT:-1080}
export SOCKS5_USER=${SOCKS5_USER:-s5user}
export PORT=${PORT:-8080}

# 生成强密码（如果未设置）
if [ -z "$SOCKS5_PASS" ]; then
    export SOCKS5_PASS=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)
fi

echo "========================================"
echo "  S5Gate - SOCKS5 Proxy Service"
echo "========================================"
echo "  SOCKS5 Port: ${SOCKS5_PORT}"
echo "  SOCKS5 User: ${SOCKS5_USER}"
echo "  SOCKS5 Pass: ${SOCKS5_PASS}"
echo "  WebUI Port:  ${PORT}"
echo "========================================"

# 创建系统用户用于 Dante 认证
echo "[1/4] Setting up SOCKS5 user..."
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
echo "[2/4] TUN device ready"

# 获取默认网络接口
export DEFAULT_INTERFACE=$(ip route show default | awk '/default/ {print $5}' | head -1)
if [ -z "$DEFAULT_INTERFACE" ]; then
    export DEFAULT_INTERFACE="eth0"
fi
echo "[3/4] Default interface: ${DEFAULT_INTERFACE}"

# 生成初始 Dante 配置（使用默认接口）
export EXTERNAL_INTERFACE="$DEFAULT_INTERFACE"
envsubst < /etc/danted.template.conf > /etc/danted.conf

# 启动 Dante
echo "[4/4] Starting Dante SOCKS5 proxy..."
danted -f /etc/danted.conf &
DANTE_PID=$!
sleep 1

if kill -0 $DANTE_PID 2>/dev/null; then
    echo "  - Dante is running (PID: $DANTE_PID)"
else
    echo "  - WARNING: Dante may have failed to start"
fi

echo ""
echo "========================================"
echo "  Services Ready:"
echo "  - SOCKS5:   0.0.0.0:${SOCKS5_PORT}"
echo "  - WebUI:    http://0.0.0.0:${PORT}"
echo "  - Mode:     Direct (${DEFAULT_INTERFACE})"
echo "========================================"
echo ""

# 保存配置到文件供 Node.js 读取
cat > /run/s5gate/config.json << EOF
{
    "socks5Port": ${SOCKS5_PORT},
    "socks5User": "${SOCKS5_USER}",
    "socks5Pass": "${SOCKS5_PASS}",
    "defaultInterface": "${DEFAULT_INTERFACE}",
    "webPort": ${PORT}
}
EOF

cd /app && exec node server.js
