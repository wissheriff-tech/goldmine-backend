@echo off
echo Killing all Node.js processes on port 5000...
FOR /F "tokens=5" %%P IN ('netstat -ano ^| findstr :5000') DO TaskKill /PID %%P /F
echo Done! Port 5000 is now free.
echo You can now run: npm run dev
pause
