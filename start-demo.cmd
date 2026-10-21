@echo off
cd /d "%~dp0"
echo WorkBuddy Local v0.2 - http://127.0.0.1:7863/panel/
echo Initial management password: 123456
workbuddy-local.exe -demo
if errorlevel 1 pause
