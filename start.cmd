@echo off

cd /d "%~dp0"

echo WorkBuddy Local 3.0.1 - http://127.0.0.1:7863/panel/

echo Set the management password on first launch in the local panel.

wb2api.exe

if errorlevel 1 pause

