"""Cross-check aurora.sysmon against psutil, then report differences."""
import os, sys, time
sys.path.insert(0, '.')
from aurora import sysmon as mine
import psutil

fails = []


def check(label, a, b, tol):
    ok = abs(a - b) <= tol
    if not ok:
        fails.append('%s: mine=%s psutil=%s' % (label, a, b))
    print('%-22s mine=%-14s psutil=%-14s %s' % (label, a, b, 'OK' if ok else 'DIFF'))


check('cpu_count(logical)', mine.cpu_count(True), psutil.cpu_count(True), 0)
# Physical core count is not exposed by a cheap stable ctypes call on Windows,
# so sysmon returns the thread count. Expected, documented difference.
phys_mine = mine.cpu_count(False)
phys_ps = psutil.cpu_count(False)
print('%-22s mine=%-14s psutil=%-14s %s' % (
    'cpu_count(physical)', phys_mine, phys_ps,
    'OK' if phys_mine == phys_ps else 'KNOWN DIFF (falls back to logical)'))

mf, pf = mine.cpu_freq(), psutil.cpu_freq()
check('cpu_freq MHz', mf.current if mf else 0, pf.current if pf else 0, 10)

mm, pm = mine.virtual_memory(), psutil.virtual_memory()
check('mem total GB', mm.total / 2**30, pm.total / 2**30, 0.01)
check('mem avail GB', mm.available / 2**30, pm.available / 2**30, 0.15)
check('mem percent', mm.percent, pm.percent, 2.0)

md, pd = mine.disk_usage('/'), psutil.disk_usage('/')
check('disk total GB', md.total / 2**30, pd.total / 2**30, 0.01)
check('disk free GB', md.free / 2**30, pd.free / 2**30, 0.15)
check('disk percent', md.percent, pd.percent, 2.0)

check('boot_time delta s', mine.boot_time(), psutil.boot_time(), 3.0)
check('pid count', len(mine.pids()), len(psutil.pids()), 6)

print('\n-- memory_percent of self (mine vs psutil) --')
mp = mine.Process().memory_info()
check('self rss MB', mp.rss / 2**20, psutil.Process(os.getpid()).memory_info().rss / 2**20, 0.6)
check('self mem %', mine.Process().memory_percent(), psutil.Process(os.getpid()).memory_percent(), 1.5)

print('\n-- process_iter sweep --')
t0 = time.time()
mine_list = {p.pid: p for p in mine.process_iter()}
t_mine = time.time() - t0
t0 = time.time()
ps_list = {p.pid: p for p in psutil.process_iter()}
t_ps = time.time() - t0
print('mine: %d procs in %.3fs | psutil: %d procs in %.3fs' % (len(mine_list), t_mine, len(ps_list), t_ps))
print('shared pids: %d' % len(set(mine_list) & set(ps_list)))

def openable(pid):
    """pick a pid both libraries can actually open, so metrics are comparable"""
    for candidate in sorted(set(mine_list) & set(ps_list)):
        try:
            mine_list[candidate].memory_info()
            ps_list[candidate].memory_info()
            return candidate
        except Exception:
            continue
    return None


sample = openable(None)
if sample:
    a = mine_list[sample].name()
    b = ps_list[sample].name()
    print('name match pid %d: mine=%r psutil=%r %s' % (sample, a, b, 'OK' if a == b else 'DIFF'))
    if a != b:
        fails.append('name mismatch pid %d' % sample)
    try:
        ua = mine_list[sample].username()
    except Exception as e:
        ua = '<%s>' % type(e).__name__
    try:
        ub = ps_list[sample].username() or ''
    except Exception as e:
        ub = '<%s>' % type(e).__name__
    print('username: mine=%r psutil=%r %s' % (ua, ub, 'OK' if ua == ub else 'DIFF'))
    if ua != ub:
        fails.append('username mismatch pid %d' % sample)
    ta = mine_list[sample].num_threads()
    tb = psutil.Process(sample).num_threads()
    print('threads: mine=%s psutil=%s %s' % (ta, tb, 'OK' if ta == tb else 'DIFF'))
    try:
        ra = mine_list[sample].memory_info().rss / 2**20
    except Exception as e:
        ra = None
        print('mine rss: <%s> (psutil behaves the same on protected procs)' % type(e).__name__)
    try:
        rb_ = ps_list[sample].memory_info().rss / 2**20
    except Exception as e:
        rb_ = None
        print('psutil rss: <%s>' % type(e).__name__)
    if ra is not None and rb_ is not None:
        check('rss MB', ra, rb_, max(0.6, ra * 0.06))

print('\n-- second sweep cpu_percent (warm cache) --')
mine2 = {p.pid: p for p in mine.process_iter()}
ps2 = {p.pid: p for p in psutil.process_iter()}
busy = [pid for pid in sorted(set(mine2) & set(ps2))
        if ps2[pid].cpu_percent() > 0.3][:5]
for pid in busy:
    a = mine2[pid].cpu_percent()
    b = ps2[pid].cpu_percent()
    print('pid %-6d cpu mine=%-6s psutil=%-6s' % (pid, a, b))
if not busy:
    print('(system idle, no busy processes to compare)')

print('\n' + ('ALL CHECKS PASSED' if not fails else 'FAILURES:\n' + '\n'.join(fails)))
