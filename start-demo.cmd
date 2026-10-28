@echo off
cd /d "%~dp0"
echo WorkBuddy Local v0.2 - http://127.0.0.1:7863/panel/
echo Set the management password on first launch in the local panel.
workbuddy-local.exe -demo
if errorlevel 1 pause
