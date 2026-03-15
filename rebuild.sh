#!/bin/bash
# ============================================================
# 星云AI平台 - 重构部署脚本 v1.0
# 用法: ./rebuild.sh [--full|--restart|--build|--check]
#   --full    完整重构（默认）: 环境检查→构建→重启→验证
#   --restart 只重启服务: 停止→清理日志→启动→验证
#   --build   只构建前端: 不重启服务
#   --check   只做环境检查: 不构建不重启
# ============================================================

set -euo pipefail

# ==================== 配置区 ====================
PROJECT_DIR="/var/www/ai-platform"
ECOSYSTEM="${PROJECT_DIR}/ecosystem.config.js"
HEALTH_URL="https://ai.xingyuncl.com/health"
FRONTEND_DIR="${PROJECT_DIR}/frontend"
BACKEND_DIR="${PROJECT_DIR}/backend"
LOG_DIR="${PROJECT_DIR}/logs"
NODE_MEM="4096"           # 前端构建内存(MB)
HEALTH_RETRIES=10         # 健康检查重试次数
HEALTH_INTERVAL=3         # 健康检查间隔(秒)
DISK_WARN_PERCENT=85      # 磁盘使用率告警阈值

# ==================== 颜色 ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ==================== 工具函数 ====================
TOTAL_START=$(date +%s)
STEP_NUM=0
TOTAL_STEPS=0
STEP_START=$(date +%s)

# 步骤标题：显示当前步骤编号和描述
step() {
    STEP_NUM=$((STEP_NUM + 1))
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}[${STEP_NUM}/${TOTAL_STEPS}]${NC} $1"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    STEP_START=$(date +%s)
}

# 步骤完成：显示耗时
step_done() {
    local elapsed=$(( $(date +%s) - STEP_START ))
    echo -e "${GREEN}✅ 完成${NC} (${elapsed}秒)"
}

# 告警信息（黄色）
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }

# 致命错误（红色，退出）
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# 普通信息（缩进显示）
info() { echo -e "   $1"; }

# ==================== 环境检查 ====================
check_environment() {
    local has_warning=0

    # --- 磁盘空间 ---
    echo -e "\n${BLUE}📀 磁盘空间${NC}"
    local disk_usage
    disk_usage=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
    local disk_avail
    disk_avail=$(df -h / | awk 'NR==2 {print $4}')
    if [ "$disk_usage" -ge "$DISK_WARN_PERCENT" ]; then
        warn "磁盘使用率 ${disk_usage}%（剩余 ${disk_avail}）- 建议清理"
        has_warning=1
    else
        info "使用率 ${disk_usage}%，剩余 ${disk_avail}"
    fi

    # --- MySQL ---
    echo -e "\n${BLUE}🗄️  MySQL${NC}"
    if mysqladmin ping -u ai_user -p'AiPlatform@2025!' --silent 2>/dev/null; then
        local db_size
        db_size=$(mysql -u ai_user -p'AiPlatform@2025!' -N -e \
            "SELECT ROUND(SUM(data_length + index_length)/1024/1024, 1) FROM information_schema.tables WHERE table_schema='ai_platform';" 2>/dev/null || echo "未知")
        info "连接正常，数据库大小: ${db_size}MB"
    else
        warn "MySQL 连接失败"
        has_warning=1
    fi

    # --- Redis ---
    echo -e "\n${BLUE}📦 Redis${NC}"
    if redis-cli ping 2>/dev/null | grep -q PONG; then
        local redis_mem
        redis_mem=$(redis-cli info memory 2>/dev/null | grep used_memory_human | cut -d: -f2 | tr -d '[:space:]' || echo "未知")
        info "连接正常，内存使用: ${redis_mem}"
    else
        warn "Redis 连接失败（服务可降级运行）"
        has_warning=1
    fi

    # --- Nginx ---
    echo -e "\n${BLUE}🌐 Nginx${NC}"
    local nginx_test_output
    nginx_test_output=$(nginx -t 2>&1) || true
    if echo "$nginx_test_output" | grep -q "syntax is ok"; then
        info "配置语法正常"
    else
        warn "Nginx 配置检查失败"
        echo "$nginx_test_output" | head -3
        has_warning=1
    fi
    if systemctl is-active --quiet nginx; then
        info "服务运行中"
    else
        warn "Nginx 未运行"
        has_warning=1
    fi

    # --- SSL 证书 ---
    echo -e "\n${BLUE}🔒 SSL 证书${NC}"
    local cert_file="/etc/letsencrypt/live/ai.xingyuncl.com/fullchain.pem"
    if [ -f "$cert_file" ]; then
        local expire_date
        expire_date=$(openssl x509 -enddate -noout -in "$cert_file" 2>/dev/null | cut -d= -f2)
        local expire_epoch
        expire_epoch=$(date -d "$expire_date" +%s 2>/dev/null || echo 0)
        local now_epoch
        now_epoch=$(date +%s)
        local days_left=$(( (expire_epoch - now_epoch) / 86400 ))
        if [ "$days_left" -lt 7 ]; then
            warn "证书将在 ${days_left} 天后过期！"
            has_warning=1
        else
            info "有效期剩余 ${days_left} 天（到期: ${expire_date}）"
        fi
    else
        warn "证书文件不存在"
        has_warning=1
    fi

    # --- 网络出口（测试外部API可达性） ---
    echo -e "\n${BLUE}🌍 网络出口${NC}"
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 https://api.openai.com 2>/dev/null || echo "000")
    if [ "$http_code" != "000" ]; then
        info "外部 API 可达（OpenAI → HTTP ${http_code}）"
    else
        warn "无法连接外部 API（可能影响 AI 对话）"
        has_warning=1
    fi

    # --- PM2 当前进程状态 ---
    echo -e "\n${BLUE}⚙️  PM2 进程${NC}"
    if command -v pm2 &>/dev/null; then
        local pm2_list
        pm2_list=$(pm2 jlist 2>/dev/null || echo "[]")
        local proc_count
        proc_count=$(echo "$pm2_list" | jq 'length' 2>/dev/null || echo 0)
        if [ "$proc_count" -gt 0 ]; then
            echo "$pm2_list" | jq -r '.[] | "   \(.name): \(.pm2_env.status) (pid: \(.pid), 内存: \(.monit.memory / 1024 / 1024 | floor)MB, 重启: \(.pm2_env.restart_time)次)"' 2>/dev/null || info "进程数: ${proc_count}"
        else
            info "无运行中的进程"
        fi
    else
        warn "pm2 未安装"
        has_warning=1
    fi

    # --- 系统内存 ---
    echo -e "\n${BLUE}💾 系统内存${NC}"
    free -h | awk 'NR==2 {printf "   总计: %s  已用: %s  可用: %s\n", $2, $3, $7}'

    # --- 汇总 ---
    echo ""
    if [ "$has_warning" -eq 1 ]; then
        warn "存在告警项，请确认后继续"
    else
        echo -e "${GREEN}✅ 环境检查全部通过${NC}"
    fi

    return $has_warning
}

# ==================== 构建前端 ====================
build_frontend() {
    cd "$FRONTEND_DIR"
    NODE_OPTIONS="--max-old-space-size=${NODE_MEM}" npm run build
    cd "$PROJECT_DIR"
}

# ==================== 重启服务 ====================
restart_services() {
    # 停止所有PM2进程
    pm2 delete all 2>/dev/null || true

    # 清理日志文件
    pm2 flush 2>/dev/null || true
    rm -rf ~/.pm2/logs/*
    rm -f "${LOG_DIR}"/backend/auth/*.log "${LOG_DIR}"/frontend/*.log 2>/dev/null || true
    mkdir -p "${LOG_DIR}/backend/auth" "${LOG_DIR}/frontend"
    info "日志已清理"

    # 启动服务
    pm2 start "$ECOSYSTEM"
    info "等待服务启动（5秒）..."
    sleep 5
}

# ==================== 健康检查（带重试） ====================
health_check() {
    local attempt=1
    local http_code

    while [ $attempt -le $HEALTH_RETRIES ]; do
        http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$HEALTH_URL" 2>/dev/null || echo "000")

        if [ "$http_code" = "200" ]; then
            info "HTTP ${http_code} ✓"
            curl -s "$HEALTH_URL" | jq '.' 2>/dev/null || true
            return 0
        fi

        info "第 ${attempt}/${HEALTH_RETRIES} 次，HTTP ${http_code}，${HEALTH_INTERVAL}秒后重试..."
        sleep $HEALTH_INTERVAL
        attempt=$((attempt + 1))
    done

    warn "健康检查未通过（最终 HTTP ${http_code}）"
    return 1
}

# ==================== 最终报告 ====================
final_report() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}📊 最终状态${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    pm2 status
    echo ""
    echo -e "${BLUE}📝 最新日志（15行）${NC}"
    pm2 logs --lines 15 --nostream 2>/dev/null || true

    # 计算总耗时
    local total_elapsed=$(( $(date +%s) - TOTAL_START ))
    local mins=$((total_elapsed / 60))
    local secs=$((total_elapsed % 60))
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ 部署完成！总耗时: ${mins}分${secs}秒${NC}"
    echo -e "${GREEN}   完成时间: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
}

# ==================== 主流程 ====================
MODE="${1:---full}"

# 头部信息
echo -e "${CYAN}════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}   星云AI平台 部署脚本 v1.0${NC}"
echo -e "${CYAN}   模式: ${MODE}${NC}"
echo -e "${CYAN}   时间: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════${NC}"

# 根据模式执行对应流程
case "$MODE" in
    --check)
        # 仅环境检查
        TOTAL_STEPS=1
        step "环境检查"
        check_environment || true
        step_done
        ;;

    --build)
        # 仅构建前端，不重启
        TOTAL_STEPS=2
        step "环境检查"
        check_environment || true
        step_done

        step "构建前端（${NODE_MEM}MB 内存）"
        build_frontend
        step_done
        echo -e "\n${GREEN}✅ 构建完成，服务未重启${NC}"
        ;;

    --restart)
        # 仅重启服务，不构建
        TOTAL_STEPS=4
        step "环境检查"
        check_environment || true
        step_done

        step "重启服务"
        restart_services
        step_done

        step "健康检查"
        health_check || warn "服务可能未完全就绪，请手动检查"
        step_done

        step "最终报告"
        final_report
        ;;

    --full|*)
        # 完整重构：构建 + 重启 + 验证
        TOTAL_STEPS=5
        step "环境检查"
        check_environment || true
        step_done

        step "构建前端（${NODE_MEM}MB 内存）"
        build_frontend
        step_done

        step "重启服务"
        restart_services
        step_done

        step "健康检查"
        health_check || warn "服务可能未完全就绪，请手动检查"
        step_done

        step "最终报告"
        final_report
        ;;
esac
