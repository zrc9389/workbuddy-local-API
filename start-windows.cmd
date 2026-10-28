@echo off
chcp 65001 >nul
title WorkBuddy Local Gateway & Management Panel

echo ========================================================
echo   WorkBuddy Local Commercial Gateway (127.0.0.1:7863)
echo ========================================================
echo.

if not exist config.json (
    if exist config.example.json (
        echo [INFO] 未检测到 config.json，正在基于 config.example.json 自动初始化...
        copy config.example.json config.json >nul
    ) else (
        echo [ERROR] 缺少配置文件模板 config.example.json！
        pause
        exit /b 1
    )
)

echo [START] 正在启动网关与控制面板服务...
echo [TIPS] 首次登录时输入的任意密码将自动成为正式访问密码！
echo.

start "" http://127.0.0.1:7863/panel/
wb2api.exe -config config.json
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] 服务异常退出，错误码: %errorlevel%
    pause
)
