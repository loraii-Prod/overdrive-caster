@echo off
rem Copy this file to settings.bat and fill in what you need. start.cmd reads it on every start.
rem Leave a line out (or empty) to keep the default.

rem Passwords. If empty, the server makes one on first start and prints it in the window.
set CONTROLLER_PASSWORD=
set ADMIN_PASSWORD=

rem Port of the controller and OBS sources (default 8787).
set PORT=8787

rem OBS WebSocket (OBS: Tools > WebSocket Server Settings). Leave empty to set it in the controller.
set OBS_WS_URL=
set OBS_WS_PASSWORD=

rem Twitch predictions & polls: Client ID of your Twitch app (or paste it in the controller, Twitch tab).
set TWITCH_CLIENT_ID=
