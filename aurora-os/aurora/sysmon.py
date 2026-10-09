"""
aurora.sysmon - pure standard-library system metrics.

Replaces psutil with ctypes + the Windows API and /proc on POSIX.
Same function names and return shapes, so call sites do not change.

Public API:
    cpu_percent(interval=None)        system CPU usage percent
    cpu_freq()                       -> (current, min, max) MHz or None
    cpu_count(logical=True)          core / thread count
    virtual_memory()                 -> (total, available, percent, used, free)
    disk_usage(path)                 -> (total, used, free, percent)
    boot_time()                      unix timestamp of boot
    pids()                           list of running pids
    process_iter(attrs)              iterator of Process
    Process                          .pid .name() .username() .status
                                    .cpu_percent(interval) .memory_info()
                                    .create_time() .num_threads() .info
    NoSuchProcess, AccessDenied      exceptions
"""

import os
import time
import shutil
from collections import namedtuple

IS_WIN = os.name == 'nt'

svmem = namedtuple('svmem', ['total', 'available', 'percent', 'used', 'free'])
sdisk = namedtuple('sdisk', ['total', 'used', 'free', 'percent'])
scpu_freq = namedtuple('scpufreq', ['current', 'min', 'max'])
pmem = namedtuple('pmem', ['rss', 'vms', 'shared', 'text', 'lib', 'data', 'dirty'])
popen = namedtuple('popen', ['pid', 'name', 'ppid', 'username', 'create_time', 'num_threads'])


class Error(Exception):
    pass


class NoSuchProcess(Error):
    pass


class AccessDenied(Error):
    pass


class ZombieProcess(NoSuchProcess):
    pass


def _roundup1024(n):
    if n <= 0:
        return 0
    return (n + 1023) & ~1023


if IS_WIN:
    import ctypes
    from ctypes import wintypes

    _kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    _psapi = ctypes.WinDLL('psapi', use_last_error=True)
    _advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)

    class _FILETIME(ctypes.Structure):
        _fields_ = [('low', wintypes.DWORD), ('high', wintypes.DWORD)]

        @property
        def value(self):
            return (self.high << 32) | self.low

    class _MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [
            ('dwLength', wintypes.DWORD),
            ('dwMemoryLoad', wintypes.DWORD),
            ('ullTotalPhys', ctypes.c_ulonglong),
            ('ullAvailPhys', ctypes.c_ulonglong),
            ('ullTotalPageFile', ctypes.c_ulonglong),
            ('ullAvailPageFile', ctypes.c_ulonglong),
            ('ullTotalVirtual', ctypes.c_ulonglong),
            ('ullAvailVirtual', ctypes.c_ulonglong),
            ('ullAvailExtendedVirtual', ctypes.c_ulonglong),
        ]

    class _PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ('dwSize', wintypes.DWORD),
            ('cntUsage', wintypes.DWORD),
            ('th32ProcessID', wintypes.DWORD),
            ('th32DefaultHeapID', ctypes.c_size_t),
            ('th32ModuleID', wintypes.DWORD),
            ('cntThreads', wintypes.DWORD),
            ('th32ParentProcessID', wintypes.DWORD),
            ('pcPriClassBase', ctypes.c_long),
            ('dwFlags', wintypes.DWORD),
            ('szExeFile', wintypes.WCHAR * 260),
        ]

    class _PROCESS_MEMORY_COUNTERS(ctypes.Structure):
        _fields_ = [
            ('cb', wintypes.DWORD),
            ('PageFaultCount', wintypes.DWORD),
            ('PeakWorkingSetSize', ctypes.c_size_t),
            ('WorkingSetSize', ctypes.c_size_t),
            ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
            ('QuotaPagedPoolUsage', ctypes.c_size_t),
            ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
            ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
            ('PagefileUsage', ctypes.c_size_t),
            ('PeakPagefileUsage', ctypes.c_size_t),
        ]

    class _SID_AND_ATTRIBUTES(ctypes.Structure):
        _fields_ = [('Sid', ctypes.c_void_p), ('Attributes', wintypes.DWORD)]

    class _TOKEN_USER(ctypes.Structure):
        _fields_ = [('User', _SID_AND_ATTRIBUTES)]

    _GetSystemTimes = _kernel32.GetSystemTimes
    _GetSystemTimes.argtypes = [ctypes.POINTER(_FILETIME), ctypes.POINTER(_FILETIME), ctypes.POINTER(_FILETIME)]
    _GetSystemTimes.restype = wintypes.BOOL

    _GlobalMemoryStatusEx = _kernel32.GlobalMemoryStatusEx
    _GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(_MEMORYSTATUSEX)]
    _GlobalMemoryStatusEx.restype = wintypes.BOOL

    _GetDiskFreeSpaceExW = _kernel32.GetDiskFreeSpaceExW
    _GetDiskFreeSpaceExW.argtypes = [wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    _GetDiskFreeSpaceExW.restype = wintypes.BOOL

    _GetTickCount64 = _kernel32.GetTickCount64
    _GetTickCount64.restype = ctypes.c_ulonglong

    _CreateToolhelp32Snapshot = _kernel32.CreateToolhelp32Snapshot
    _CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    _CreateToolhelp32Snapshot.restype = wintypes.HANDLE

    _Process32FirstW = _kernel32.Process32FirstW
    _Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_PROCESSENTRY32W)]
    _Process32FirstW.restype = wintypes.BOOL

    _Process32NextW = _kernel32.Process32NextW
    _Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_PROCESSENTRY32W)]
    _Process32NextW.restype = wintypes.BOOL

    _CloseHandle = _kernel32.CloseHandle
    _CloseHandle.argtypes = [wintypes.HANDLE]
    _CloseHandle.restype = wintypes.BOOL

    _OpenProcess = _kernel32.OpenProcess
    _OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    _OpenProcess.restype = wintypes.HANDLE

    _GetProcessTimes = _kernel32.GetProcessTimes
    _GetProcessTimes.argtypes = [wintypes.HANDLE, ctypes.POINTER(_FILETIME), ctypes.POINTER(_FILETIME),
                                 ctypes.POINTER(_FILETIME), ctypes.POINTER(_FILETIME)]
    _GetProcessTimes.restype = wintypes.BOOL

    _GetProcessMemoryInfo = _psapi.GetProcessMemoryInfo
    _GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(_PROCESS_MEMORY_COUNTERS), wintypes.DWORD]
    _GetProcessMemoryInfo.restype = wintypes.BOOL

    _OpenProcessToken = _advapi32.OpenProcessToken
    _OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    _OpenProcessToken.restype = wintypes.BOOL

    _GetTokenInformation = _advapi32.GetTokenInformation
    _GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
                                     ctypes.POINTER(wintypes.DWORD)]
    _GetTokenInformation.restype = wintypes.BOOL

    # No argtypes on purpose: ctypes marshals create_unicode_buffer objects
    # correctly here, and declaring LPWSTR made the call fault.
    _LookupAccountSidW = _advapi32.LookupAccountSidW
    _LookupAccountSidW.restype = wintypes.BOOL

    _TH32CS_SNAPPROCESS = 0x00000002
    _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    _PROCESS_VM_READ = 0x0010
    _TOKEN_QUERY = 0x0008
    _TOKEN_USER_CLASS = 1
    _INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

    _sys_cpu_last = None
    _proc_cpu_last = {}
    _user_cache = {}

    # ------------------------------------------------------------------ CPU

    def _system_times():
        idle = _FILETIME()
        kernel = _FILETIME()
        user = _FILETIME()
        if not _GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            raise OSError(ctypes.get_last_error(), 'GetSystemTimes failed')
        return idle.value, kernel.value + user.value, kernel.value

    def cpu_percent(interval=None):
        global _sys_cpu_last
        if interval:
            time.sleep(interval)
        idle, total, _ = _system_times()
        last = _sys_cpu_last
        _sys_cpu_last = (idle, total)
        if last is None:
            return 0.0
        d_idle = idle - last[0]
        d_total = total - last[1]
        if d_total <= 0:
            return 0.0
        return round(max(0.0, min(100.0, (1.0 - d_idle / d_total) * 100.0)), 1)

    def cpu_freq():
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                 r'HARDWARE\DESCRIPTION\System\CentralProcessor\0')
            try:
                mhz = float(winreg.QueryValueEx(key, '~MHz')[0])
            finally:
                winreg.CloseKey(key)
            return scpu_freq(current=mhz, min=0.0, max=mhz)
        except Exception:
            return None

    def cpu_count(logical=True):
        """Logical = thread count. Windows exposes no cheap, stable physical
        core count through ctypes, so non-logical requests fall back to the
        thread count rather than returning a wrong number."""
        return os.cpu_count() or 1

    # -------------------------------------------------------------- memory

    def virtual_memory():
        st = _MEMORYSTATUSEX()
        st.dwLength = ctypes.sizeof(st)
        if not _GlobalMemoryStatusEx(ctypes.byref(st)):
            raise OSError(ctypes.get_last_error(), 'GlobalMemoryStatusEx failed')
        total = st.ullTotalPhys
        avail = st.ullAvailPhys
        used = total - avail
        pct = used * 100.0 / total if total else 0.0
        return svmem(total=total, available=avail, percent=round(pct, 1),
                     used=used, free=avail)

    def disk_usage(path):
        target = path or os.path.abspath(os.sep)
        if not os.path.isdir(target):
            target = os.path.abspath(os.sep)
        free_to_caller = ctypes.c_ulonglong(0)
        total = ctypes.c_ulonglong(0)
        ok = _GetDiskFreeSpaceExW(target, ctypes.byref(free_to_caller), ctypes.byref(total), None)
        if not ok:
            raise OSError(ctypes.get_last_error(), 'GetDiskFreeSpaceExW failed')
        free = free_to_caller.value
        used = total.value - free
        pct = used * 100.0 / total.value if total.value else 0.0
        return sdisk(total=total.value, used=used, free=free, percent=round(pct, 1))

    def boot_time():
        return time.time() - (_GetTickCount64() / 1000.0)

    # ------------------------------------------------------------ processes

    def pids():
        out = []
        snap = _CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
        if snap == _INVALID_HANDLE_VALUE:
            raise OSError(ctypes.get_last_error(), 'CreateToolhelp32Snapshot failed')
        try:
            entry = _PROCESSENTRY32W()
            entry.dwSize = ctypes.sizeof(entry)
            if _Process32FirstW(snap, ctypes.byref(entry)):
                while True:
                    out.append(entry.th32ProcessID)
                    entry = _PROCESSENTRY32W()
                    entry.dwSize = ctypes.sizeof(entry)
                    if not _Process32NextW(snap, ctypes.byref(entry)):
                        break
        finally:
            _CloseHandle(snap)
        return out

    def _open(pid):
        h = _OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION | _PROCESS_VM_READ, False, pid)
        if not h:
            err = ctypes.get_last_error()
            if err == 5:
                raise AccessDenied(err, 'OpenProcess denied for pid %s' % pid)
            raise NoSuchProcess(err, 'OpenProcess failed for pid %s' % pid)
        return h

    def _proc_times(h):
        created = _FILETIME()
        exited = _FILETIME()
        kernel = _FILETIME()
        user = _FILETIME()
        if not _GetProcessTimes(h, ctypes.byref(created), ctypes.byref(exited),
                                ctypes.byref(kernel), ctypes.byref(user)):
            err = ctypes.get_last_error()
            if err == 5:
                raise AccessDenied(err, 'GetProcessTimes denied')
            raise NoSuchProcess(err, 'GetProcessTimes failed')
        return created.value, kernel.value + user.value

    _FILETIME_EPOCH_DELTA = 116444736000000000

    def _ft_to_unix(ft):
        return (ft - _FILETIME_EPOCH_DELTA) / 10000000.0

    def _username(h, pid):
        cached = _user_cache.get(pid)
        if cached is not None:
            return cached
        name = ''
        token = wintypes.HANDLE()
        if _OpenProcessToken(h, _TOKEN_QUERY, ctypes.byref(token)):
            try:
                need = wintypes.DWORD(0)
                _GetTokenInformation(token, _TOKEN_USER_CLASS, None, 0, ctypes.byref(need))
                if need.value:
                    buf = ctypes.create_string_buffer(need.value)
                    if _GetTokenInformation(token, _TOKEN_USER_CLASS, buf, need.value, ctypes.byref(need)):
                        tu = ctypes.cast(buf, ctypes.POINTER(_TOKEN_USER)).contents
                        uname = ctypes.create_unicode_buffer(256)
                        unamelen = wintypes.DWORD(256)
                        domain = ctypes.create_unicode_buffer(256)
                        domlen = wintypes.DWORD(256)
                        sidtype = wintypes.DWORD(1)
                        if _LookupAccountSidW(None, ctypes.c_void_p(tu.User.Sid), uname,
                                              ctypes.byref(unamelen), domain,
                                              ctypes.byref(domlen), ctypes.byref(sidtype)):
                            name = uname.value
                            if domlen.value and domain.value:
                                name = domain.value + '\\' + name
            except Exception:
                name = ''
            finally:
                _CloseHandle(token)
        _user_cache[pid] = name
        return name

    def _snapshot_names():
        """pid -> (exe name, ppid, thread count) in one cheap sweep."""
        table = {}
        snap = _CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
        if snap == _INVALID_HANDLE_VALUE:
            return table
        try:
            entry = _PROCESSENTRY32W()
            entry.dwSize = ctypes.sizeof(entry)
            if _Process32FirstW(snap, ctypes.byref(entry)):
                while True:
                    table[entry.th32ProcessID] = (entry.szExeFile,
                                                  entry.th32ParentProcessID,
                                                  entry.cntThreads)
                    entry = _PROCESSENTRY32W()
                    entry.dwSize = ctypes.sizeof(entry)
                    if not _Process32NextW(snap, ctypes.byref(entry)):
                        break
        finally:
            _CloseHandle(snap)
        return table

    def process_iter(attrs=None, ad_value=None):
        table = _snapshot_names()
        vmem = virtual_memory()
        for pid, (name, ppid, threads) in table.items():
            yield Process(pid, _name=name, _ppid=ppid, _threads=threads, _vmem=vmem)

    class Process(object):
        def __init__(self, pid=None, _name=None, _ppid=None, _threads=None, _vmem=None):
            if pid is None:
                pid = os.getpid()
            self.pid = pid
            self._cached_name = _name
            self._cached_ppid = _ppid
            self._cached_threads = _threads
            self._cached_vmem = _vmem
            self._info = None

        # -- basics
        def name(self):
            if self._cached_name is None:
                self._cached_name = self._sweep().get(self.pid, ('Unknown', 0, 0))[0]
            return self._cached_name

        def ppid(self):
            if self._cached_ppid is None:
                self._cached_ppid = self._sweep().get(self.pid, ('Unknown', 0, 0))[1]
            return self._cached_ppid

        def num_threads(self):
            if self._cached_threads is None:
                self._cached_threads = self._sweep().get(self.pid, ('Unknown', 0, 0))[2]
            return self._cached_threads

        def _sweep(self):
            try:
                return _snapshot_names()
            except Exception:
                return {}

        def is_running(self):
            try:
                h = _open(self.pid)
            except NoSuchProcess:
                return False
            except AccessDenied:
                return True
            _CloseHandle(h)
            return True

        def status(self):
            return 'running' if self.is_running() else 'zombie'

        def create_time(self):
            h = _open(self.pid)
            try:
                created, _ = _proc_times(h)
            finally:
                _CloseHandle(h)
            return _ft_to_unix(created)

        def username(self):
            """Best effort; protected processes report an empty name, which
            matches psutil returning None for unowned processes."""
            try:
                h = _open(self.pid)
            except (AccessDenied, NoSuchProcess):
                return ''
            try:
                return _username(h, self.pid)
            except (AccessDenied, NoSuchProcess):
                return ''
            finally:
                _CloseHandle(h)

        # -- metrics
        def memory_info(self):
            h = _open(self.pid)
            try:
                cnt = _PROCESS_MEMORY_COUNTERS()
                cnt.cb = ctypes.sizeof(cnt)
                if not _GetProcessMemoryInfo(h, ctypes.byref(cnt), ctypes.sizeof(cnt)):
                    raise NoSuchProcess('GetProcessMemoryInfo failed')
                rss = cnt.WorkingSetSize
                return pmem(rss=rss, vms=cnt.PagefileUsage + rss, shared=0,
                            text=0, lib=0, data=0, dirty=0)
            finally:
                _CloseHandle(h)

        def memory_percent(self):
            vmem = self._cached_vmem or virtual_memory()
            if not vmem.total:
                return 0.0
            return round(self.memory_info().rss * 100.0 / vmem.total, 2)

        def cpu_percent(self, interval=None):
            now = time.perf_counter()
            try:
                h = _open(self.pid)
            except AccessDenied:
                return 0.0
            except NoSuchProcess:
                return 0.0
            try:
                _, cpu_time = _proc_times(h)
            finally:
                _CloseHandle(h)
            if interval:
                time.sleep(interval)
                now = time.perf_counter()
                try:
                    h = _open(self.pid)
                except (AccessDenied, NoSuchProcess):
                    return 0.0
                try:
                    _, cpu_time2 = _proc_times(h)
                finally:
                    _CloseHandle(h)
                cpu_time = cpu_time2
            hz = 10000000.0
            last = _proc_cpu_last.get(self.pid)
            _proc_cpu_last[self.pid] = (now, cpu_time)
            if last is None:
                return 0.0
            dt = now - last[0]
            dc = (cpu_time - last[1]) / hz
            if dt <= 0:
                return 0.0
            return round(dc * 100.0 / dt, 1)

        def as_dict(self, attrs=None, ad_value=None):
            if self._info is not None:
                return dict(self._info)
            info = {
                'pid': self.pid,
                'name': self.name(),
                'ppid': self.ppid(),
                'num_threads': self.num_threads(),
                'status': self.status(),
                'create_time': 0.0,
                'username': '',
                'cpu_percent': 0.0,
                'memory_percent': 0.0,
            }
            for getter, key in ((self.create_time, 'create_time'),
                                (self.username, 'username')):
                try:
                    info[key] = getter()
                except Exception:
                    info[key] = '' if key == 'username' else 0.0
            try:
                info['cpu_percent'] = self.cpu_percent()
            except Exception:
                pass
            try:
                info['memory_percent'] = self.memory_percent()
            except Exception:
                pass
            self._info = info
            return dict(info)

        @property
        def info(self):
            if self._info is None:
                self._info = self.as_dict()
            return self._info

        def __repr__(self):
            try:
                return 'psutil.Process(pid=%d, name=%r)' % (self.pid, self.name())
            except Exception:
                return 'psutil.Process(pid=%d)' % self.pid

else:
    # ------------------------------------------------------------------ POSIX
    import resource

    _HZ = os.sysconf('SC_CLK_TCK') if hasattr(os, 'sysconf') else 100
    _PAGE = os.sysconf('SC_PAGE_SIZE') if hasattr(os, 'sysconf') else 4096
    _sys_cpu_last = None
    _proc_cpu_last = {}

    def _read(path):
        try:
            with open(path) as f:
                return f.read()
        except Exception:
            return ''

    def _meminfo():
        d = {}
        for line in _read('/proc/meminfo').splitlines():
            parts = line.split(':')
            if len(parts) == 2:
                d[parts[0].strip()] = float(parts[1].strip().split()[0]) * 1024
        return d

    def virtual_memory():
        d = _meminfo()
        total = d.get('MemTotal', 0)
        avail = d.get('MemAvailable', d.get('MemFree', 0))
        used = total - avail
        pct = used * 100.0 / total if total else 0.0
        return svmem(total=int(total), available=int(avail), percent=round(pct, 1),
                     used=int(used), free=int(avail))

    def disk_usage(path):
        d = shutil.disk_usage(path or os.sep)
        pct = d.used * 100.0 / d.total if d.total else 0.0
        return sdisk(total=d.total, used=d.used, free=d.free, percent=round(pct, 1))

    def boot_time():
        raw = _read('/proc/uptime').split()
        if raw:
            return time.time() - float(raw[0])
        return time.time()

    def cpu_count(logical=True):
        return os.cpu_count() or 1

    def cpu_freq():
        raw = ''
        for line in _read('/proc/cpuinfo').splitlines():
            if line.lower().startswith('cpu mhz'):
                raw = line.split(':')[1].strip()
                break
        if raw:
            mhz = float(raw)
            return scpu_freq(current=mhz, min=0.0, max=mhz)
        return None

    def _cpu_jiffies():
        for line in _read('/proc/stat').splitlines():
            if line.startswith('cpu '):
                f = [int(x) for x in line.split()[1:]]
                idle = f[3] + (f[4] if len(f) > 4 else 0)
                return sum(f), idle
        return None

    def cpu_percent(interval=None):
        global _sys_cpu_last
        if interval:
            time.sleep(interval)
        cur = _cpu_jiffies()
        if cur is None:
            return 0.0
        last = _sys_cpu_last
        _sys_cpu_last = cur
        if last is None:
            return 0.0
        d_total = cur[0] - last[0]
        d_idle = cur[1] - last[1]
        if d_total <= 0:
            return 0.0
        return round(max(0.0, min(100.0, (1.0 - d_idle / d_total) * 100.0)), 1)

    def pids():
        out = []
        for name in os.listdir('/proc'):
            if name.isdigit():
                out.append(int(name))
        return out

    def process_iter(attrs=None, ad_value=None):
        vmem = virtual_memory()
        for pid in pids():
            yield Process(pid, _vmem=vmem)

    class Process(object):
        def __init__(self, pid=None, _vmem=None):
            self.pid = os.getpid() if pid is None else pid
            self._cached_vmem = _vmem
            self._info = None

        def _stat(self):
            raw = _read('/proc/%d/stat' % self.pid)
            if not raw:
                raise NoSuchProcess('pid %d gone' % self.pid)
            return raw[raw.rindex(')') + 2:].split()

        def name(self):
            try:
                return os.path.basename(_read('/proc/%d/comm' % self.pid).strip()) or 'Unknown'
            except Exception:
                raise NoSuchProcess('pid %d gone' % self.pid)

        def ppid(self):
            return int(self._stat()[1])

        def num_threads(self):
            return int(self._stat()[17])

        def is_running(self):
            try:
                return self._stat()[0] != 'Z'
            except Exception:
                return False

        def status(self):
            return 'running' if self.is_running() else 'zombie'

        def create_time(self):
            stat = os.stat('/proc/%d' % self.pid)
            return stat.st_ctime

        def username(self):
            try:
                import pwd
                uid = os.stat('/proc/%d' % self.pid).st_uid
                return pwd.getpwuid(uid).pw_name
            except Exception:
                return ''

        def memory_info(self):
            raw = _read('/proc/%d/statm' % self.pid).split()
            rss = int(raw[1]) * _PAGE if len(raw) > 1 else 0
            vms = int(raw[0]) * _PAGE if raw else 0
            return pmem(rss=rss, vms=vms, shared=0, text=0, lib=0, data=0, dirty=0)

        def memory_percent(self):
            vmem = self._cached_vmem or virtual_memory()
            if not vmem.total:
                return 0.0
            return round(self.memory_info().rss * 100.0 / vmem.total, 2)

        def cpu_percent(self, interval=None):
            now = time.perf_counter()
            if interval:
                time.sleep(interval)
                now = time.perf_counter()
            try:
                t = sum(os.times()[:2])
            except Exception:
                t = 0.0
            last = _proc_cpu_last.get(self.pid)
            _proc_cpu_last[self.pid] = (now, t)
            if last is None:
                return 0.0
            dt = now - last[0]
            dc = t - last[1]
            if dt <= 0:
                return 0.0
            return round(dc * 100.0 / dt, 1)

        def as_dict(self, attrs=None, ad_value=None):
            if self._info is not None:
                return dict(self._info)
            info = {'pid': self.pid, 'name': self.name(), 'ppid': self.ppid(),
                    'num_threads': self.num_threads(), 'status': self.status(),
                    'create_time': self.create_time(), 'username': self.username(),
                    'cpu_percent': self.cpu_percent(),
                    'memory_percent': self.memory_percent()}
            self._info = info
            return dict(info)

        @property
        def info(self):
            if self._info is None:
                self._info = self.as_dict()
            return self._info

        def __repr__(self):
            return 'psutil.Process(pid=%d)' % self.pid
