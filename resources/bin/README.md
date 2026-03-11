Place ffmpeg and ffprobe binaries for packaged runtime here.

Required files for Windows packaging:
- resources/bin/ffmpeg.exe
- resources/bin/ffprobe.exe

Required files for macOS packaging:
- resources/bin/ffmpeg
- resources/bin/ffprobe

The app runtime resolves binaries in this order:
1) FFMPEG_PATH / FFPROBE_PATH env vars
2) packaged resources/bin
3) system PATH
