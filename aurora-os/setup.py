"""
Aurora OS Installer
===================
Installs Aurora OS on your PC.
- Copies all files to the install directory
- Creates desktop shortcut
- Creates Start Menu entry
- Sets up autostart option
- Protects user data across reinstalls

Usage:
    python setup.py
    python setup.py --install-type alongside
    python setup.py --install-type erase
    python setup.py --uninstall
    python setup.py --install-dir "C:\\Aurora OS"
"""

import os
import sys
import shutil
import ctypes
import argparse
import subprocess
import winreg
from pathlib import Path

APP_NAME = "Aurora OS"
APP_VERSION = "0.1.0"
DEFAULT_DIR = os.path.join(os.path.expanduser("~"), "AuroraOS")
SOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
SHORTCUT_NAME = "Aurora OS"
AUTORUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False


def print_header():
    print()
    print("  ╔══════════════════════════════════════╗")
    print("  ║         Aurora OS Installer          ║")
    print("  ║          v" + APP_VERSION + "  (Dawn)           ║")
    print("  ╚══════════════════════════════════════╝")
    print()


def print_step(num, msg):
    print(f"  [{num}] {msg}")


def print_ok(msg):
    print(f"      ✓ {msg}")


def print_err(msg):
    print(f"      ✗ {msg}")


def print_info(msg):
    print(f"      → {msg}")


def copy_files(src, dst, exclude=None):
    exclude = exclude or set()
    count = 0
    if not os.path.exists(dst):
        os.makedirs(dst, exist_ok=True)
    for item in os.listdir(src):
        if item in exclude or item == '__pycache__' or item.endswith('.pyc'):
            continue
        s = os.path.join(src, item)
        d = os.path.join(dst, item)
        if os.path.isfile(s):
            shutil.copy2(s, d)
            count += 1
        elif os.path.isdir(s):
            count += copy_files(s, d, exclude)
    return count


def create_shortcut(target, shortcut_path, icon_path=None, description=""):
    """Create a Windows shortcut (.lnk) using PowerShell."""
    ps_script = f'''
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("{shortcut_path}")
$Shortcut.TargetPath = "{target}"
$Shortcut.WorkingDirectory = os.path.dirname(target)
if "{icon_path}":
    $Shortcut.IconLocation = "{icon_path}"
$Shortcut.Description = "{description}"
$Shortcut.Save()
'''
    try:
        subprocess.run(
            ["powershell", "-Command", ps_script],
            capture_output=True, text=True, timeout=10
        )
        return True
    except:
        return False


def create_shortcut_vbs(target, shortcut_path, icon_path="", description=""):
    """Create a .lnk shortcut using VBScript (more reliable)."""
    vbs = f'''
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "{shortcut_path}"
Set oLink = oWS.CreateShortcut(sLinkFile)
    oLink.TargetPath = "{target}"
    oLink.WorkingDirectory = "{os.path.dirname(target)}"
    oLink.Description = "{description}"
    oLink.Save
'''
    vbs_path = os.path.join(os.environ.get('TEMP', '.'), '_create_shortcut.vbs')
    try:
        with open(vbs_path, 'w') as f:
            f.write(vbs)
        subprocess.run(["cscript", "//nologo", vbs_path], capture_output=True, timeout=10)
        os.remove(vbs_path)
        return True
    except:
        return False


def add_to_autorun(install_dir):
    """Add Aurora OS to Windows startup."""
    run_script = os.path.join(install_dir, 'run_aurora.bat')
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTORUN_KEY, 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(key, "AuroraOS", 0, winreg.REG_SZ, f'"{run_script}" --minimized')
        winreg.CloseKey(key)
        return True
    except:
        return False


def remove_from_autorun():
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTORUN_KEY, 0, winreg.KEY_SET_VALUE)
        winreg.DeleteValue(key, "AuroraOS")
        winreg.CloseKey(key)
        return True
    except:
        return False


def create_run_bat(install_dir):
    """Create the launcher batch file."""
    bat_path = os.path.join(install_dir, 'run_aurora.bat')
    python_exe = sys.executable
    run_script = os.path.join(install_dir, 'run.py')
    content = f'''@echo off
title Aurora OS
cd /d "{install_dir}"
"{python_exe}" "{run_script}" %*
'''
    with open(bat_path, 'w') as f:
        f.write(content)
    return bat_path


def choose_install_type(cli_value):
    """Ask which installation type to use. Returns 'alongside' or 'erase'."""
    if cli_value in ('alongside', 'erase'):
        return cli_value
    print()
    print("  Installation type:")
    print("    [1] Install alongside Windows (recommended)")
    print("        Keeps Windows and all your files. Aurora OS runs on your PC.")
    print("        You can switch anytime by reinstalling and picking the other option.")
    print("    [2] Erase disk and install Aurora OS")
    print("        Removes Windows and EVERYTHING on this disk.")
    try:
        import sys as _sys
        if not _sys.stdin.isatty():
            print_info("Non-interactive session, defaulting to 'alongside'")
            return 'alongside'
    except Exception:
        return 'alongside'
    while True:
        try:
            choice = input("  Choose [1/2] (default 1): ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 'alongside'
        if choice in ('', '1'):
            return 'alongside'
        if choice == '2':
            return 'erase'
        print("  Please type 1 or 2.")


def install(install_dir, create_shortcuts=True, add_autostart=False, install_type=None):
    print_header()
    install_type = choose_install_type(install_type)
    print_info(f"Installation type: {install_type}")
    if install_type == 'erase':
        print()
        print("  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print("  WARNING: 'Erase disk' removes Windows and ALL")
        print("  files on this disk. This cannot be undone.")
        print("  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print()
        print_info("Note: this installer runs inside Windows, so it cannot")
        print_info("format the running system drive. 'Erase' here performs a")
        print_info("fully clean Aurora OS install (all previous Aurora files,")
        print_info("including user data, are removed). Windows itself is left")
        print_info("untouched. A true bare-metal install needs bootable media.")
        try:
            confirm = input('  Type ERASE to confirm, or anything else to switch to alongside: ').strip()
        except (EOFError, KeyboardInterrupt):
            print()
            confirm = ''
        if confirm != 'ERASE':
            print_info("Switched to 'alongside' install")
            install_type = 'alongside'
    print_step(1, "Preparing installation...")
    print_info(f"Install directory: {install_dir}")
    print_info(f"Source: {SOURCE_DIR}")

    if install_type == 'erase' and os.path.exists(install_dir):
        print_info("Erase selected: removing previous Aurora OS files completely")
        shutil.rmtree(install_dir, ignore_errors=True)
        print_ok("Previous installation wiped")
    elif os.path.exists(install_dir):
        user_dir = os.path.join(install_dir, 'aurora', 'data', 'home', 'user')
        has_user_data = os.path.isdir(user_dir) and len(os.listdir(user_dir)) > 0
        if has_user_data:
            print_info(f"Existing installation found with user data")
            print_info("User files will be preserved")
        else:
            print_info("Existing installation found (no user data)")
    else:
        print_ok("Fresh installation")

    print()
    print_step(2, "Copying Aurora OS files...")
    exclude = {'__pycache__', '.git', '.aurora_backup', 'setup.py', '*.pyc', '.vscode', 'node_modules'}
    file_count = copy_files(SOURCE_DIR, install_dir, exclude)
    print_ok(f"Copied {file_count} files")

    print()
    print_step(3, "Creating launcher...")
    bat = create_run_bat(install_dir)
    print_ok(f"Created {os.path.basename(bat)}")

    print()
    print_step(4, "Creating shortcuts...")
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    startmenu = os.path.join(os.environ.get('APPDATA', ''), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    bat_full = os.path.join(install_dir, 'run_aurora.bat')

    if create_shortcuts:
        sc_desktop = os.path.join(desktop, f"{SHORTCUT_NAME}.lnk")
        sc_start = os.path.join(startmenu, f"{SHORTCUT_NAME}.lnk")
        ok1 = create_shortcut_vbs(bat_full, sc_desktop, description="Launch Aurora OS")
        ok2 = create_shortcut_vbs(bat_full, sc_start, description="Launch Aurora OS")
        if ok1: print_ok(f"Desktop shortcut")
        else: print_info("Desktop shortcut (may need admin)")
        if ok2: print_ok(f"Start Menu shortcut")
        else: print_info("Start Menu shortcut (may need admin)")
    else:
        print_info("Skipped")

    if add_autostart:
        print()
        print_step(5, "Adding to startup...")
        if add_to_autorun(install_dir):
            print_ok("Aurora OS will start with Windows")
        else:
            print_info("Could not add to startup (may need admin)")

    print()
    print("  ═══════════════════════════════════════")
    print("  Installation Complete!")
    print("  ═══════════════════════════════════════")
    print()
    print(f"  Location:  {install_dir}")
    print(f"  Launcher:  {bat}")
    print(f"  Version:   Aurora OS v{APP_VERSION} (Dawn)")
    print(f"  Type:      {install_type}")
    print()
    print("  To launch Aurora OS:")
    print(f"    Double-click 'Aurora OS' on your Desktop")
    print(f"    Or run: {bat}")
    print()
    print("  To switch installation type, rerun setup and pick the other option:")
    print(f"    python setup.py --install-type alongside")
    print(f"    python setup.py --install-type erase")
    print()
    print("  To uninstall:")
    print(f"    python setup.py --uninstall")
    print()


def uninstall(install_dir):
    print_header()
    print_step(1, "Preparing uninstall...")

    user_dir = os.path.join(install_dir, 'aurora', 'data', 'home', 'user')
    has_user_data = os.path.isdir(user_dir) and len(os.listdir(user_dir)) > 0

    if has_user_data:
        print_info(f"Found {len(os.listdir(user_dir))} user file(s)")
        resp = input("  Keep user files? (Y/n): ").strip().lower()
        keep_files = resp != 'n'
    else:
        keep_files = False

    print()
    print_step(2, "Removing shortcuts...")
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    startmenu = os.path.join(os.environ.get('APPDATA', ''), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    for sc in [os.path.join(desktop, f"{SHORTCUT_NAME}.lnk"), os.path.join(startmenu, f"{SHORTCUT_NAME}.lnk")]:
        if os.path.exists(sc):
            os.remove(sc)
            print_ok(f"Removed {os.path.basename(sc)}")

    print()
    print_step(3, "Removing from startup...")
    if remove_from_autorun():
        print_ok("Removed from startup")
    else:
        print_info("Not in startup registry")

    print()
    print_step(4, "Removing files...")
    if keep_files:
        backup_dir = os.path.join(os.path.expanduser("~"), ".aurora_backup")
        if not os.path.exists(backup_dir):
            os.makedirs(backup_dir, exist_ok=True)
        for item in os.listdir(user_dir):
            src = os.path.join(user_dir, item)
            dst = os.path.join(backup_dir, item)
            if os.path.isfile(src):
                shutil.copy2(src, dst)
            elif os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
        print_ok(f"Backed up {len(os.listdir(user_dir))} file(s) to ~/.aurora_backup")

    shutil.rmtree(install_dir, ignore_errors=True)
    if not os.path.exists(install_dir):
        print_ok("Installation directory removed")
    else:
        print_err("Could not fully remove directory (try running as admin)")

    print()
    print("  Uninstall Complete!")
    if keep_files:
        print("  Your files are safe at: ~/.aurora_backup")
    print()


def main():
    parser = argparse.ArgumentParser(description="Aurora OS Installer")
    parser.add_argument("--install-dir", default=DEFAULT_DIR, help="Installation directory")
    parser.add_argument("--uninstall", action="store_true", help="Uninstall Aurora OS")
    parser.add_argument("--no-shortcuts", action="store_true", help="Don't create shortcuts")
    parser.add_argument("--autostart", action="store_true", help="Start with Windows")
    parser.add_argument("--minimized", action="store_true", help="Start server minimized")
    parser.add_argument("--install-type", choices=["alongside", "erase"], default=None,
                        help="Installation type: alongside Windows (default) or erase disk")
    args = parser.parse_args()

    if args.minimized:
        run_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'run.py')
        if os.path.exists(run_script):
            subprocess.Popen(
                [sys.executable, run_script],
                cwd=os.path.dirname(os.path.abspath(__file__)),
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        return

    if args.uninstall:
        uninstall(args.install_dir)
    else:
        install(args.install_dir, create_shortcuts=not args.no_shortcuts, add_autostart=args.autostart,
                install_type=args.install_type)


if __name__ == "__main__":
    main()
