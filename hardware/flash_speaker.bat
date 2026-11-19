@echo off
setlocal enabledelayedexpansion
title YHealth Audio Board Flasher & MAC Identifier
color 0b

echo =====================================================================
echo       YHEALTH ESP32-S3 AUDIO BOARD FLASHER & MAC IDENTIFIER
echo =====================================================================
echo.

set PORT=%1
if "%PORT%"=="" (
    set PORT=COM6
)

echo [TARGET PORT] %PORT%
echo (If you want another port, run: flash_speaker.bat COM3)
echo.

echo [1/2] Reading Factory Hardware MAC Address...
python -m esptool --port %PORT% read-mac
echo.

echo [2/2] Flashing YHealth Assistant Firmware to %PORT%...
python -m esptool --chip esp32s3 -p %PORT% -b 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_size 2MB --flash_freq 80m 0x0 build/bootloader/bootloader.bin 0x8000 build/partition_table/partition-table.bin 0x10000 build/gemini_voice_assistant.bin

if %ERRORLEVEL% EQU 0 (
    echo.
    echo =====================================================================
    echo   [SUCCESS] Audio board on %PORT% flashed successfully!
    echo =====================================================================
) else (
    echo.
    echo [NOTE] If connecting timed out:
    echo   1. Hold the BOOT button on the ESP32-S3 board.
    echo   2. Press and release the RESET (RST/EN) button.
    echo   3. Release the BOOT button, then run this script again.
)
echo.
