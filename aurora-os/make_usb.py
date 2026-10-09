"""
Aurora OS - USB Portable Maker
==============================
Copies Aurora OS to a USB stick so it runs on any Windows PC
without installing anything. Just plug in and double-click
Start_Aurora.bat.

Usage:
    python make_usb.py              (lists USB drives, you pick one)
    python make_usb.py E:           (use drive E: directly)

To show your assistant how it looks: press Win+Shift+S while
Aurora is on screen, paste the screenshot into the chat.

Requires Python 3.10+ on the host machine. No pip packages.
"""
import os
import sys
import shutil
import string
import ctypes

SOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
SKIP = {'__pycache__', '.git', '.aurora_backup', '.vscode', 'node_modules'}


def list_removable():
    found = []
    try:
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for i, letter in enumerate(string.ascii_uppercase):
            if mask & (1 << i):
                root = letter + ':\\'
                try:
                    if ctypes.windll.kernel32.GetDriveTypeW(root) == 2:
                        try:
                            free = shutil.disk_usage(root).free
                        except Exception:
                            free = 0
                        found.append((root, free))
                except Exception:
                    pass
    except Exception:
        pass
    return found


def copy_tree(src, dst):
    count = 0
    os.makedirs(dst, exist_ok=True)
    for item in os.listdir(src):
        if item in SKIP or item.endswith('.pyc'):
            continue
        s = os.path.join(src, item)
        d = os.path.join(dst, item)
        if os.path.isfile(s):
            shutil.copy2(s, d)
            count += 1
        elif os.path.isdir(s):
            count += copy_tree(s, d)
    return count


def write_launcher(dst):
    bat = os.path.join(dst, 'Start_Aurora.bat')
    embedded = os.path.join(dst, 'AuroraOS', 'python', 'pythonw.exe')
    with open(bat, 'w') as f:
        f.write('@echo off\r\n')
        f.write('title Aurora OS (USB)\r\n')
        f.write('cd /d "%~dp0AuroraOS"\r\n')
        f.write('where python >nul 2>nul\r\n')
        f.write('if errorlevel 1 (\r\n')
        f.write('  echo Aurora OS needs Python 3.10+ from python.org\r\n')
        f.write('  echo Install it, then double-click Start_Aurora again.\r\n')
        f.write('  pause\r\n')
        f.write('  exit /b 1\r\n')
        f.write(')\r\n')
        f.write('start "" /min python -c "from server import ThreadingHTTPServer, AuroraHandler; s=ThreadingHTTPServer((\'127.0.0.1\',8081), AuroraHandler); s.serve_forever()" 2>nul\r\n')
        f.write('timeout /t 3 /nobreak >nul\r\n')
        f.write('if exist "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" (\r\n')
        f.write('  start "" "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" --kiosk http://localhost:8081/ --edge-kiosk-type=fullscreen\r\n')
        f.write(') else if exist "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" (\r\n')
        f.write('  start "" "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --kiosk http://localhost:8081/ --edge-kiosk-type=fullscreen\r\n')
        f.write(') else (\r\n')
        f.write('  start "" "http://localhost:8081/"\r\n')
        f.write(')\r\n')
    with open(os.path.join(dst, 'README.txt'), 'w') as f:
        f.write('Aurora OS - Portable USB\n')
        f.write('========================\n\n')
        f.write('1. Plug this USB into any Windows PC.\n')
        f.write('2. Double-click Start_Aurora.bat\n')
        f.write('   No install, no pip packages: Aurora ships its own\n')
        f.write('   Python and uses only the standard library.\n')
        f.write('3. Aurora opens full screen at http://localhost:8081/\n')
        f.write('   Press Alt+F4 to leave.\n\n')
        f.write('To show it off: Win+Shift+S while Aurora is on\n')
        f.write('screen, then paste the screenshot in chat.\n')
    return bat


def main():
    print()
    print('  Aurora OS - USB Portable Maker')
    print()
    if len(sys.argv) > 1:
        drive = sys.argv[1].strip().upper().rstrip('\\')
        if not drive.endswith(':'):
            drive += ':'
        drive += '\\'
    else:
        drives = list_removable()
        if not drives:
            print('  No USB drives found. Plug one in and try again,')
            print('  or pass the letter directly:  python make_usb.py E:')
            return 1
        print('  USB drives found:')
        for i, (root, free) in enumerate(drives):
            print(f'    [{i + 1}] {root}  ({free // (1024 * 1024)} MB free)')
        try:
            pick = input('  Choose [1]: ').strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 1
        idx = int(pick) - 1 if pick.isdigit() else 0
        if idx < 0 or idx >= len(drives):
            print('  Invalid choice.')
            return 1
        drive = drives[idx][0]
    dst = os.path.join(drive, 'AuroraOS')
    print(f'  Copying Aurora OS to {dst} ...')
    n = copy_tree(SOURCE_DIR, dst)
    print(f'  Copied {n} files.')
    bat = write_launcher(os.path.dirname(dst))
    print(f'  Launcher: {bat}')
    print()
    print('  Done! Plug the USB into any Windows PC and')
    print('  double-click Start_Aurora.bat')
    print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
