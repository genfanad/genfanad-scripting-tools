cd /d "%~dp0"
call npm install
start cmd /k node ./editor/main.js
timeout /T 5 /NOBREAK
start "" http://localhost:7782/