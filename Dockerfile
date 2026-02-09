FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive

# 安装基础包
RUN apt-get update && apt-get install -y --no-install-recommends \
    openvpn \
    dante-server \
    iproute2 \
    iptables \
    curl \
    ca-certificates \
    gettext-base \
    procps \
    && rm -rf /var/lib/apt/lists/*

# 安装 Node.js 20.x
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# 复制 Dante 配置模板
COPY dante/danted-direct.template.conf /etc/danted-direct.template.conf
COPY dante/danted-vpn.template.conf /etc/danted-vpn.template.conf

# 复制应用
COPY app/ /app/

# 安装 Node.js 依赖
WORKDIR /app
RUN npm install --production

# 复制启动脚本
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 环境变量
ENV PORT=8080
ENV SOCKS5_PORT_DIRECT=1080
ENV SOCKS5_PORT_VPN=1081
ENV SOCKS5_USER=s5user
# SOCKS5_PASS 如果不设置会自动生成

# 暴露端口
EXPOSE 8080 1080 1081

ENTRYPOINT ["/entrypoint.sh"]
