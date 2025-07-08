#!/bin/bash

# AI Platform 服务管理脚本

case "\$1" in
start)
    echo "启动 AI Platform 服务..."
    pm2 start ecosystem.config.js
    ;;
stop)
    echo "停止 AI Platform 服务..."
    pm2 stop all
    ;;
restart)
    echo "重启 AI Platform 服务..."
    pm2 restart all
    ;;
reload)
    echo "重新加载 AI Platform 配置..."
    pm2 reload ecosystem.config.js
    ;;
status)
    echo "AI Platform 服务状态:"
    pm2 status
    ;;
logs)
    echo "查看 AI Platform 服务日志:"
    pm2 logs
    ;;
build)
    echo "构建前端生产版本..."
    cd /var/www/ai-platform/frontend
    npm run build
    ;;
*)
    echo "用法: \$0 {start|stop|restart|reload|status|logs|build}"
    echo ""
    echo "命令说明:"
    echo "  start   - 启动所有服务"
    echo "  stop    - 停止所有服务" 
    echo "  restart - 重启所有服务"
    echo "  reload  - 重新加载配置"
    echo "  status  - 查看服务状态"
    echo "  logs    - 查看服务日志"
    echo "  build   - 构建前端"
    exit 1
    ;;
esac
