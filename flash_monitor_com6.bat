@echo off
title ESP-IDF Flash & Monitor COM6
echo Initializing ESP-IDF v5.5.5 Environment...
call C:\esp\v5.5.5\esp-idf\export.bat
echo.
echo Flashing and opening monitor on COM6...
idf.py -p COM6 flash monitor
