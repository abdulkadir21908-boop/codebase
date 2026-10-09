"""Aurora OS - Web UI Server."""

import os
import sys
import json
import time
import ssl
import hashlib
import collections
import asyncio
import webbrowser
import threading
import subprocess
from http.server import SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from http.server import HTTPServer
from urllib.parse import urlparse, parse_qs, urlunparse
from urllib.request import urlopen, Request
from urllib.error import URLError

_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE


class _LRUCache:
    def __init__(self, maxsize=64, ttl=300):
        self._cache = collections.OrderedDict()
        self._maxsize = maxsize
        self._ttl = ttl
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            if key in self._cache:
                val, ts = self._cache.pop(key)
                if time.time() - ts < self._ttl:
                    self._cache[key] = (val, ts)
                    return val
                del self._cache[key]
            return None

    def put(self, key, val):
        with self._lock:
            if key in self._cache:
                del self._cache[key]
            elif len(self._cache) >= self._maxsize:
                self._cache.popitem(last=False)
            self._cache[key] = (val, time.time())

    def clear(self):
        with self._lock:
            self._cache.clear()


_proxy_cache = _LRUCache(maxsize=64, ttl=300)
_search_cache = _LRUCache(maxsize=64, ttl=600)


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from aurora.filesystem import AuroraFS
from aurora.shell import Shell
from aurora import sysmon as psutil  # pure-stdlib drop-in for psutil

fs = AuroraFS()
shell = Shell(fs)


class AuroraHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        try:
            self._do_GET_inner()
        except Exception as e:
            try:
                import traceback as _tb
                try:
                    _logd = os.path.join(os.path.dirname(__file__), 'aurora', 'data', 'logs')
                    os.makedirs(_logd, exist_ok=True)
                    with open(os.path.join(_logd, 'server_errors.log'), 'a', encoding='utf-8') as _lf:
                        _lf.write(time.strftime('%Y-%m-%d %H:%M:%S') + ' ' + self.path + '\n')
                        _tb.print_exc(file=_lf)
                        _lf.write('\n')
                except Exception:
                    pass
                self._json({"error": str(e)}, 500)
            except Exception:
                pass

    def _do_GET_inner(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            self._serve_file("web/index.html", "text/html")
        elif path == "/api/fs/ls":
            params = parse_qs(parsed.query)
            dirpath = params.get("path", [None])[0]
            items = fs.ls(dirpath)
            data = [{"name": n.name, "is_dir": n.is_dir, "size": n.size} for n in items]
            self._json(data)
        elif path == "/api/fs/pwd":
            self._json({"path": fs.pwd()})
        elif path == "/api/fs/cat":
            params = parse_qs(parsed.query)
            fpath = params.get("path", [""])[0]
            content = fs.cat(fpath)
            self._json({"content": content, "exists": content is not None})
        elif path == "/api/fs/tree":
            params = parse_qs(parsed.query)
            dirpath = params.get("path", [None])[0]
            lines = fs.tree(dirpath)
            self._json({"lines": lines})
        elif path == "/api/time":
            self._json({"time": time.strftime("%H:%M"), "date": time.strftime("%a %b %d"),
                         "full": time.strftime("%a %b %d  %H:%M")})
        elif path == "/api/system/stats":
            self._system_stats()
        elif path == "/api/system/procs":
            self._system_procs()
        elif path == "/api/system/aurora":
            self._system_aurora()
        elif path == "/api/search":
            params = parse_qs(parsed.query)
            query = params.get("q", [""])[0]
            self._search_ddg(query)
        elif path == "/api/proxy":
            params = parse_qs(parsed.query)
            url = params.get("url", [""])[0]
            lite = params.get("lite", [""])[0].lower() in ("1", "true", "yes")
            self._proxy_fetch(url, lite)
        elif path == "/api/open-external":
            params = parse_qs(parsed.query)
            url = params.get("url", [""])[0]
            if url:
                webbrowser.open(url)
            self.send_response(302)
            self.send_header("Location", "/")
            self.end_headers()
        elif path == "/api/open-external":
            params = parse_qs(parsed.query)
            url = params.get("url", [""])[0]
            if url:
                webbrowser.open(url)
            self._json({"ok": True})
        elif path == "/api/wifi/scan":
            self._wifi_scan()
        elif path == "/api/installer/backup":
            self._installer_backup()
        elif path == "/api/installer/reinstall":
            self._installer_reinstall()
        elif path == "/api/installer/status":
            self._installer_status()
        elif path == "/api/store/apps":
            self._store_apps()
        elif path == "/api/store/installed":
            self._store_installed()
        elif path == "/api/store/dev-apps":
            self._store_dev_apps()
        elif path == "/api/photos":
            self._photos_list()
        elif path == "/api/photo":
            params = parse_qs(parsed.query)
            fpath = params.get("path", [""])[0]
            self._photo_serve(fpath)
        elif path == "/api/weather":
            self._weather_fetch()
        elif path == "/api/music/scan":
            self._music_scan()
        elif path == "/api/audio":
            params = parse_qs(parsed.query)
            fpath = params.get("path", [""])[0]
            self._audio_serve(fpath)
        elif path == "/api/wallpaper":
            self._wallpaper_get()
        elif path == "/api/notes":
            self._notes_get()
        elif path == "/api/stocks":
            self._stocks_fetch()
        elif path == "/api/set-wallpaper":
            params = parse_qs(parsed.query)
            wp = params.get("id", ["aurora"])[0]
            self._wallpaper_set(wp)
        elif path == "/api/files/list":
            params = parse_qs(parsed.query)
            dirpath = params.get("path", [os.path.expanduser("~")])[0]
            try:
                entries = []
                for name in sorted(os.listdir(dirpath)):
                    fp = os.path.join(dirpath, name)
                    is_dir = os.path.isdir(fp)
                    try:
                        size = os.path.getsize(fp) if not is_dir else 0
                    except Exception:
                        size = 0
                    entries.append({"name": name, "is_dir": is_dir, "size": size})
                self._json({"path": dirpath, "entries": entries})
            except Exception as e:
                self._json({"error": str(e), "entries": []})
        elif path == "/api/files/read":
            params = parse_qs(parsed.query)
            fpath = params.get("path", [""])[0]
            try:
                with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                self._json({"content": content, "path": fpath})
            except Exception as e:
                self._json({"error": str(e), "content": ""})
        elif path == "/api/files/tree":
            params = parse_qs(parsed.query)
            dirpath = params.get("path", [os.path.expanduser("~")])[0]
            max_depth = int(params.get("depth", ["2"])[0])
            def _build_tree(d, depth):
                if depth > max_depth:
                    return []
                items = []
                try:
                    for name in sorted(os.listdir(d)):
                        fp = os.path.join(d, name)
                        if name.startswith('.'):
                            continue
                        is_dir = os.path.isdir(fp)
                        node = {"name": name, "path": fp, "is_dir": is_dir}
                        if is_dir:
                            node["children"] = _build_tree(fp, depth + 1)
                        items.append(node)
                except Exception:
                    pass
                return items
            self._json({"path": dirpath, "tree": _build_tree(dirpath, 0)})
        elif path == "/api/favicon.ico":
            self.send_response(204)
            self.end_headers()
        elif path.startswith("/web/"):
            ext = path.rsplit(".", 1)[-1] if "." in path else "txt"
            ct = {"js": "application/javascript", "css": "text/css",
                  "png": "image/png", "svg": "image/svg+xml"}.get(ext, "text/plain")
            self._serve_file(path.lstrip("/"), ct)
        else:
            # Try serving from web/ directory for app scripts
            web_path = "web" + path
            fpath = os.path.join(os.path.dirname(__file__), web_path)
            if os.path.isfile(fpath):
                ext = path.rsplit(".", 1)[-1] if "." in path else "txt"
                ct = {"js": "application/javascript", "css": "text/css",
                      "png": "image/png", "svg": "image/svg+xml"}.get(ext, "text/plain")
                self._serve_file(web_path, ct)
            else:
                self._json({"error": "not found"}, 404)

    def do_POST(self):
        try:
            self._do_POST_inner()
        except Exception as e:
            try:
                self._json({"error": str(e)}, 500)
            except Exception:
                pass

    def _do_POST_inner(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if parsed.path == "/api/exec":
            result = self._exec_cmd(body.get("cmd", ""))
            self._json(result)
        elif parsed.path == "/api/complete":
            partial = body.get("partial", "")
            completions = shell.get_completions(partial)
            self._json({"completions": completions})
        elif parsed.path == "/api/fs/write":
            fpath = body.get("path", "")
            content = body.get("content", "")
            fs.write(fpath, content)
            self._json({"ok": True})
        elif parsed.path == "/api/fs/mkdir":
            fpath = body.get("path", "")
            result = fs.mkdir(fpath)
            self._json({"ok": result is not None})
        elif parsed.path == "/api/fs/rm":
            fpath = body.get("path", "")
            self._json({"ok": fs.rm(fpath)})
        elif parsed.path == "/api/fs/cd":
            fpath = body.get("path", "")
            self._json({"ok": fs.cd(fpath), "path": fs.pwd()})
        elif parsed.path == "/api/store/install":
            app_id = body.get("app_id", "")
            self._store_install(app_id)
        elif parsed.path == "/api/store/uninstall":
            app_id = body.get("app_id", "")
            self._store_uninstall(app_id)
        elif parsed.path == "/api/store/dev-submit":
            self._store_dev_submit(body)
        elif parsed.path == "/api/store/dev-install":
            app_id = body.get("app_id", "")
            self._store_dev_install(app_id)
        elif parsed.path == "/api/store/dev-uninstall":
            app_id = body.get("app_id", "")
            self._store_dev_uninstall(app_id)
        elif parsed.path == "/api/store/dev-launch":
            self._store_dev_launch(body)
        elif parsed.path == "/api/store/dev-update":
            self._store_dev_update(body)
        elif parsed.path == "/api/wifi/connect":
            ssid = body.get("ssid", "")
            password = body.get("password", "")
            self._wifi_connect(ssid, password)
        elif parsed.path == "/api/wifi/disconnect":
            self._wifi_disconnect()
        elif parsed.path == "/api/wifi/status":
            self._wifi_status()
        elif parsed.path == "/api/notes/save":
            self._notes_save(body.get("notes", []))
        elif parsed.path == "/api/files/write":
            fpath = body.get("path", "")
            content = body.get("content", "")
            try:
                os.makedirs(os.path.dirname(fpath), exist_ok=True)
                with open(fpath, "w", encoding="utf-8") as f:
                    f.write(content)
                self._json({"ok": True, "path": fpath})
            except Exception as e:
                self._json({"ok": False, "error": str(e)})
        elif parsed.path == "/api/files/mkdir":
            dirpath = body.get("path", "")
            try:
                os.makedirs(dirpath, exist_ok=True)
                self._json({"ok": True})
            except Exception as e:
                self._json({"ok": False, "error": str(e)})
        elif parsed.path == "/api/files/delete":
            fpath = body.get("path", "")
            try:
                if os.path.isdir(fpath):
                    os.rmdir(fpath)
                else:
                    os.remove(fpath)
                self._json({"ok": True})
            except Exception as e:
                self._json({"ok": False, "error": str(e)})
        else:
            self._json({"error": "not found"}, 404)

    def _exec_cmd(self, cmd):
        try:
            output = shell.execute(cmd)
            return {"output": output, "path": fs.pwd()}
        except Exception as e:
            return {"output": "Error: " + str(e), "path": fs.pwd()}

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, filepath, content_type):
        fpath = os.path.join(os.path.dirname(__file__), filepath)
        if os.path.exists(fpath):
            with open(fpath, "rb") as f:
                body = f.read()
            enc = ''
            try:
                ae = self.headers.get('Accept-Encoding', '') or ''
                if 'gzip' in ae and len(body) > 1024 and content_type.split(';')[0].strip() in (
                        'text/html', 'application/javascript', 'text/css', 'application/json',
                        'image/svg+xml', 'text/plain'):
                    import gzip as _gz
                    body = _gz.compress(body, compresslevel=6)
                    enc = 'gzip'
            except Exception:
                pass
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", len(body))
            self.send_header("Cache-Control", "public, max-age=60")
            if enc:
                self.send_header("Content-Encoding", enc)
            self.end_headers()
            self.wfile.write(body)
        else:
            self._json({"error": "not found"}, 404)

    def _proxy_fetch(self, url, lite=False):
        if not url:
            self._json({"error": "no url"}, 400)
            return
        _ckey = ("lite:" if lite else "page:") + url
        cached = _proxy_cache.get(_ckey)
        if cached:
            self.send_response(200)
            self.send_header("Content-Type", cached[1])
            self.send_header("Content-Length", len(cached[0]))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "public, max-age=300")
            self.end_headers()
            self.wfile.write(cached[0])
            return

        blocked_markers = ["please wait for verification", "checking if the site connection is secure",
                           "cloudflare", "cf-browser-verification", "_cf_chl_opt", "challenge-platform",
                           "just a moment", "verify you are human", "attention required"]
        bot_challenge = False

        try:
            req = Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "identity",
                "Cache-Control": "no-cache",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
            })
            with urlopen(req, timeout=15, context=_ssl_ctx) as resp:
                content_type = resp.headers.get("Content-Type", "text/html")
                body = resp.read()

            if "text/html" in content_type:
                import re as _re
                from urllib.parse import urljoin as _urljoin, quote as _quote
                # Charset: respect the response header first, then <meta charset>, default utf-8.
                _charset = "utf-8"
                try:
                    _mct = _re.search(r'charset\s*=\s*["\']?([a-zA-Z0-9_\-:]+)', content_type, _re.IGNORECASE)
                    if _mct:
                        _charset = _mct.group(1).strip().lower()
                except Exception:
                    _charset = "utf-8"
                try:
                    html = body.decode(_charset, errors="replace")
                except Exception:
                    _charset = "utf-8"
                    html = body.decode("utf-8", errors="replace")
                if _charset == "utf-8":
                    try:
                        _mmeta = _re.search(r'<meta[^>]+charset\s*=\s*["\']?([a-zA-Z0-9_\-:]+)', html, _re.IGNORECASE)
                        if _mmeta:
                            _found = _mmeta.group(1).strip().lower()
                            if _found and _found != "utf-8":
                                try:
                                    html = body.decode(_found, errors="replace")
                                    _charset = _found
                                except Exception:
                                    pass
                    except Exception:
                        pass
                html_lower = html.lower()
                for marker in blocked_markers:
                    if marker in html_lower:
                        bot_challenge = True
                        break

                if bot_challenge:
                    display_url = url
                    try:
                        parsed_display = urlparse(url)
                        display_url = parsed_display.netloc + parsed_display.path
                    except Exception:
                        pass
                    display_url = display_url.replace("<", "&lt;").replace(">", "&gt;")
                    _open_href = "/api/open-external?url=" + _quote(url, safe="")
                    _js_url = url.replace("\\", "\\\\").replace("'", "\\'")
                    err_html = (
                        '<html><head><meta charset="utf-8"><style>'
                        'body{background:#0c0c14;color:#cdd6f4;font-family:system-ui,-apple-system,sans-serif;'
                        'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}'
                        '.box{text-align:center;max-width:520px;padding:40px}'
                        'h2{color:#f9e2af;margin-bottom:12px}'
                        'p{color:#a6adc8;line-height:1.6;margin:8px 0}'
                        '.url{color:#89b4fa;font-size:12px;word-break:break-all;margin:12px 0}'
                        '.btn{display:inline-block;padding:10px 24px;border-radius:10px;'
                        'font-size:14px;font-weight:600;cursor:pointer;border:none;margin:8px 6px;'
                        'transition:all .2s cubic-bezier(.2,.8,.3,1.2);text-decoration:none}'
                        '.btn:hover{transform:scale(1.05)}'
                        '.btn-primary{background:#89b4fa;color:#11111b}'
                        '.btn-secondary{background:#313244;color:#cdd6f4}'
                        '.shield{font-size:48px;margin-bottom:16px}'
                        '.tip{font-size:12px;color:#6c7086;background:rgba(137,180,250,.07);'
                        'border:1px solid rgba(137,180,250,.18);border-radius:10px;padding:10px 14px;margin:14px 0}'
                        '</style></head><body>'
                        '<div class="box">'
                        '<div class="shield">&#128737;</div>'
                        '<h2>Site Protected by Bot Detection</h2>'
                        '<p>This site uses Cloudflare or similar protection that blocks automated requests.</p>'
                        '<div class="url">' + display_url + '</div>'
                        '<p style="font-size:13px;color:#6c7086">You can open this site in your system browser to view it.</p>'
                        '<div class="tip">Tip: in Aurora Browser, use the pill or menu toggle to '
                        '<b>Retry via Direct</b> &mdash; embed-friendly sites (Wikipedia, OpenStreetMap, '
                        'example.com) often load best in Direct mode. JS-heavy sites may still need the system browser.</div>'
                        '<a class="btn btn-primary" href="' + _open_href + '" target="_blank" rel="noopener" '
                        'onclick="window.open(\'' + _open_href + '\',\'_blank\');return false">Open in System Browser</a>'
                        '<a class="btn btn-secondary" href="#" onclick="history.back();return false">Go Back</a>'
                        '<button class="btn btn-secondary" onclick="try{navigator.clipboard.writeText(\'' + _js_url + '\');this.textContent=\'Copied\';}catch(e){}">Copy link</button>'
                        '</div></body></html>'
                    )
                    err_bytes = err_html.encode("utf-8", errors="replace")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", len(err_bytes))
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(err_bytes)
                    return

                parsed_url = urlparse(url)
                if lite:
                    # Lite mode: strip scripts, styles, media and frames for a tiny fast page.
                    html = _re.sub(r'<script\b[^>]*>.*?</script\s*>', '', html, flags=_re.IGNORECASE | _re.DOTALL)
                    html = _re.sub(r'<style\b[^>]*>.*?</style\s*>', '', html, flags=_re.IGNORECASE | _re.DOTALL)
                    html = _re.sub(r'<noscript\b[^>]*>.*?</noscript\s*>', '', html, flags=_re.IGNORECASE | _re.DOTALL)
                    html = _re.sub(r'<iframe\b[^>]*>.*?</iframe\s*>', '', html, flags=_re.IGNORECASE | _re.DOTALL)
                    html = _re.sub(r'<link\b[^>]*rel\s*=\s*["\']?stylesheet["\']?[^>]*>', '', html, flags=_re.IGNORECASE)
                    html = _re.sub(r'<img\b([^>]*)>', lambda m: '<span class="aurora-img">' + (_re.search(r'alt\s*=\s*["\'](.*?)["\']', m.group(1), _re.IGNORECASE).group(1) if _re.search(r'alt\s*=\s*["\'](.*?)["\']', m.group(1), _re.IGNORECASE) else 'image') + '</span>', html, flags=_re.IGNORECASE)
                    html = _re.sub(r'</?(video|audio|source|track|embed|picture|canvas|svg)\b[^>]*>', '', html, flags=_re.IGNORECASE)
                    html = _re.sub(r'\s+(on\w+|data-[\w-]+)\s*=\s*(["\']).*?\2', '', html, flags=_re.IGNORECASE)
                    html_lower = html.lower()
                # Base uses the full page URL so relative links resolve like a browser.
                _safe_base = url.replace('"', '%22')
                base_tag = '<base href="' + _safe_base + '">'
                # Strip frame-busting / CSP meta so proxied pages can render in an iframe.
                # (http-equiv refresh is intentionally kept.)
                html = _re.sub(r'<meta[^>]+http-equiv=["\']?Content-Security-Policy["\']?[^>]*>', '', html, flags=_re.IGNORECASE)
                html = _re.sub(r'<meta[^>]+content=["\']?[^\"]*frame-ancestors[^"\']*["\'][^>]*>', '', html, flags=_re.IGNORECASE)
                # --- URL rewriting: absolutize everything, proxy safe subresources ---
                # NOTE: JS fetch()/XHR inside pages is NOT rewritten (scripts run live
                # in the iframe); JS-heavy sites (Google/YouTube/GitHub) may still fail
                # or show bot walls. Direct mode in the browser pill can help for
                # embed-friendly sites.
                def _is_skip(u):
                    if not u:
                        return True
                    s = u.strip()
                    if not s:
                        return True
                    low = s.lower()
                    for _p in ("data:", "blob:", "javascript:", "mailto:", "tel:", "about:", "file:"):
                        if low.startswith(_p):
                            return True
                    if s.startswith("#"):
                        return True
                    if s.startswith("/api/proxy") or s.startswith("/api/open-external"):
                        return True
                    return False

                def _to_abs(u):
                    try:
                        s = u.strip()
                        if not s:
                            return u
                        if s.startswith("//"):
                            return parsed_url.scheme + ":" + s
                        return _urljoin(url, s)
                    except Exception:
                        return u

                def _to_proxy(u):
                    try:
                        return "/api/proxy?url=" + _quote(_to_abs(u), safe="")
                    except Exception:
                        return u

                # 1) srcset="a.jpg 1x, /b.jpg 2x" -> absolute + proxied each candidate.
                def _fix_srcset(m):
                    q = m.group(1)
                    val = m.group(2)
                    parts = []
                    for _part in val.split(","):
                        _part = _part.strip()
                        if not _part:
                            continue
                        _toks = _part.split()
                        _u = _toks[0]
                        _rest = " ".join(_toks[1:])
                        if _is_skip(_u):
                            parts.append(_part)
                        else:
                            _nu = _to_proxy(_u)
                            parts.append((_nu + (" " + _rest if _rest else "")).strip())
                    if not parts:
                        return m.group(0)
                    return "srcset=" + q + ", ".join(parts) + q
                if not lite and "srcset" in html_lower:
                    html = _re.sub(r'srcset\s*=\s*(["\'])(.*?)\1', _fix_srcset, html, flags=_re.IGNORECASE | _re.DOTALL)
                # 2) CSS url(...) inside <style> blocks and style="..." attributes.
                def _fix_css_url(m):
                    q = m.group(1) or ""
                    raw = m.group(2).strip().strip("\"'")
                    if not raw or _is_skip(raw):
                        return m.group(0)
                    try:
                        low = raw.lower()
                        if low.startswith("http://") or low.startswith("https://") or low.startswith("//") or not raw.startswith("/api/"):
                            return "url(" + q + _to_proxy(raw) + q + ")"
                        return "url(" + q + _to_abs(raw) + q + ")"
                    except Exception:
                        return m.group(0)
                if not lite and "url(" in html:
                    html = _re.sub(r'url\(\s*(["\']?)([^"\'\)]+?)\1\s*\)', _fix_css_url, html, flags=_re.IGNORECASE)
                # 3) Safe page subresources (img/script/link/video/audio/source/track/embed)
                #    are routed through /api/proxy so they load inside the iframe.
                #    Single pass over all target tags (was one scan per tag).
                def _mk_tag_fix(_m):
                    _full = _m.group(0)
                    def _rep_attr(_am):
                        _an = _am.group(1)
                        _q = _am.group(2)
                        _v = _am.group(3)
                        if _is_skip(_v):
                            return _am.group(0)
                        return _an + "=" + _q + _to_proxy(_v) + _q
                    return _re.sub(r'\b(src|href|poster|data)\s*=\s*(["\'])(.*?)\2', _rep_attr, _full, flags=_re.IGNORECASE)
                if not lite:
                    html = _re.sub(r'<(img|script|link|video|audio|source|track|embed)\b[^>]*>', _mk_tag_fix, html, flags=_re.IGNORECASE | _re.DOTALL)
                # 4) All remaining relative URLs (a[href], form[action], video[poster],
                #    object[data], etc.) are absolutized so links/forms keep working.
                def _fix_abs_attr(m):
                    _an = m.group(1)
                    _q = m.group(2)
                    _v = m.group(3)
                    if _is_skip(_v):
                        return m.group(0)
                    _low = _v.strip().lower()
                    if _low.startswith("http://") or _low.startswith("https://"):
                        return m.group(0)
                    return _an + "=" + _q + _to_abs(_v) + _q
                html = _re.sub(r'\b(href|src|action|poster|data|formaction|cite|background|longdesc|profile|usemap)\s*=\s*(["\'])(.*?)\2', _fix_abs_attr, html, flags=_re.IGNORECASE)
                head_match = _re.search(r'<head[^>]*>', html, _re.IGNORECASE)
                if head_match:
                    insert_pos = head_match.end()
                    html = html[:insert_pos] + base_tag + html[insert_pos:]
                elif '<html' in html_lower:
                    idx = html_lower.find('<html')
                    close = html.find('>', idx)
                    if close != -1:
                        html = html[:close+1] + '<head>' + base_tag + '</head>' + html[close+1:]
                    else:
                        html = html[:idx+5] + '<head>' + base_tag + '</head>' + html[idx+5:]
                else:
                    html = base_tag + html
                try:
                    body = html.encode(_charset, errors="replace")
                except Exception:
                    body = html.encode("utf-8", errors="replace")
                    _charset = "utf-8"
                content_type = "text/html; charset=" + _charset

            _proxy_cache.put(_ckey, (body, content_type))
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", len(body))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "public, max-age=300")
            self.end_headers()
            self.wfile.write(body)
        except URLError as e:
            err_html = '<html><body style="background:#0c0c14;color:#f38ba8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column"><h2>&#128269; Unable to load page</h2><p style="color:#a6adc8">' + str(e.reason) + '</p><p style="color:#6c7086;font-size:12px">URL: ' + url + '</p><a href="#" onclick="history.back();return false" style="color:#89b4fa;margin-top:16px;text-decoration:none">Go Back</a></body></html>'
            err_bytes = err_html.encode("utf-8", errors="replace")
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", len(err_bytes))
            self.end_headers()
            self.wfile.write(err_bytes)
        except Exception as e:
            err_html = '<html><body style="background:#0c0c14;color:#f38ba8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column"><h2>&#9888; Error</h2><p>' + str(e) + '</p></body></html>'
            err_bytes = err_html.encode("utf-8", errors="replace")
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", len(err_bytes))
            self.end_headers()
            self.wfile.write(err_bytes)

    def _search_ddg(self, query):
        if not query:
            self._json({"results": [], "query": ""})
            return
        cached = _search_cache.get("q:" + query.lower())
        if cached:
            self._json(cached)
            return
        try:
            url = "https://html.duckduckgo.com/html/?q=" + query.replace(" ", "+")
            req = Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                "Accept": "text/html",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "identity",
            })
            with urlopen(req, timeout=10, context=_ssl_ctx) as resp:
                html = resp.read().decode("utf-8", errors="replace")

            results = []
            import re
            result_blocks = re.findall(
                r'<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>.*?'
                r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
                html, re.DOTALL
            )
            for href, title, snippet in result_blocks[:15]:
                real_url = href
                m = re.search(r'uddg=([^&]+)', href)
                if m:
                    from urllib.parse import unquote
                    real_url = unquote(m.group(1))
                clean_title = re.sub(r'<[^>]+>', '', title).strip()
                clean_snippet = re.sub(r'<[^>]+>', '', snippet).strip()
                if clean_title:
                    results.append({
                        "title": clean_title,
                        "url": real_url,
                        "snippet": clean_snippet
                    })
            data = {"results": results, "query": query}
            _search_cache.put("q:" + query.lower(), data)
            self._json(data)
        except Exception as e:
            self._json({"results": [], "query": query, "error": str(e)})

    def _wifi_scan(self):
        networks = []
        try:
            result = subprocess.run(
                ["netsh", "wlan", "show", "networks"],
                capture_output=True, text=True, timeout=5, encoding="utf-8", errors="replace"
            )
            output = result.stdout
            current = {}
            for line in output.split("\n"):
                line = line.strip()
                if line.startswith("SSID") and "BSSID" not in line:
                    if current.get("ssid"):
                        networks.append(current)
                    ssid = line.split(":", 1)[1].strip() if ":" in line else ""
                    current = {"ssid": ssid, "signal": "0%", "auth": "", "enc": "", "channel": ""}
                elif "Authentication" in line and ":" in line:
                    current["auth"] = line.split(":", 1)[1].strip()
                elif "Encryption" in line and ":" in line:
                    current["enc"] = line.split(":", 1)[1].strip()
                elif "Signal" in line and ":" in line:
                    current["signal"] = line.split(":", 1)[1].strip()
                elif "Channel" in line and ":" in line:
                    current["channel"] = line.split(":", 1)[1].strip()
            if current.get("ssid"):
                networks.append(current)
            connected = subprocess.run(
                ["netsh", "wlan", "show", "interfaces"],
                capture_output=True, text=True, timeout=5, encoding="utf-8", errors="replace"
            )
            conn_ssid = ""
            for line in connected.stdout.split("\n"):
                if "SSID" in line and "BSSID" not in line and ":" in line:
                    val = line.split(":", 1)[1].strip()
                    if val:
                        conn_ssid = val
                        break
            self._json({"networks": networks, "connected": conn_ssid})
        except Exception as e:
            self._json({"networks": [], "connected": "", "error": str(e)})

    def _wifi_connect(self, ssid, password):
        try:
            if not ssid:
                self._json({"ok": False, "error": "No SSID provided"}, 400)
                return
            profile = '<?xml version="1.0"?>\n<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">\n  <name>' + ssid + '</name>\n  <SSIDConfig>\n    <SSID>\n      <name>' + ssid + '</name>\n    </SSID>\n  </SSIDConfig>\n  <connectionType>ESS</connectionType>\n  <connectionMode>auto</connectionMode>\n  <MSM>\n    <security>\n      <authEncryption>\n        <authentication>WPA2PSK</authentication>\n        <encryption>AES</encryption>\n        <useOneX>false</useOneX>\n      </authEncryption>\n      <sharedKey>\n        <keyType>passPhrase</keyType>\n        <protected>false</protected>\n        <keyMaterial>' + password + '</keyMaterial>\n      </sharedKey>\n    </security>\n  </MSM>\n</WLANProfile>'
            profile_path = os.path.join(os.path.dirname(__file__), '.wifi_profile.xml')
            with open(profile_path, 'w') as f:
                f.write(profile)
            add_result = subprocess.run(
                ["netsh", "wlan", "add", "profile", "filename=" + profile_path],
                capture_output=True, text=True, timeout=10, encoding="utf-8", errors="replace"
            )
            connect_result = subprocess.run(
                ["netsh", "wlan", "connect", "name=" + ssid],
                capture_output=True, text=True, timeout=15, encoding="utf-8", errors="replace"
            )
            ok = "successfully" in connect_result.stdout.lower() or connect_result.returncode == 0
            msg = connect_result.stdout.strip() if connect_result.stdout.strip() else connect_result.stderr.strip()
            try:
                os.remove(profile_path)
            except Exception:
                pass
            self._json({"ok": ok, "message": msg})
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 500)

    def _wifi_disconnect(self):
        try:
            result = subprocess.run(
                ["netsh", "wlan", "disconnect"],
                capture_output=True, text=True, timeout=10, encoding="utf-8", errors="replace"
            )
            self._json({"ok": True, "message": result.stdout.strip()})
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 500)

    def _wifi_status(self):
        try:
            result = subprocess.run(
                ["netsh", "wlan", "show", "interfaces"],
                capture_output=True, text=True, timeout=5, encoding="utf-8", errors="replace"
            )
            connected = False
            ssid = ""
            signal = ""
            for line in result.stdout.split("\n"):
                line = line.strip()
                if "State" in line and ":" in line:
                    val = line.split(":", 1)[1].strip()
                    connected = val.lower() == "connected"
                if "SSID" in line and "BSSID" not in line and ":" in line:
                    val = line.split(":", 1)[1].strip()
                    if val:
                        ssid = val
                if "Signal" in line and ":" in line:
                    signal = line.split(":", 1)[1].strip()
            self._json({"connected": connected, "ssid": ssid, "signal": signal})
        except Exception as e:
            self._json({"connected": False, "ssid": "", "signal": "", "error": str(e)})

    def _installer_backup(self):
        try:
            backup_dir = os.path.join(os.path.dirname(__file__), '.aurora_backup')
            os.makedirs(backup_dir, exist_ok=True)
            user_dir = os.path.join(os.path.dirname(__file__), 'aurora', 'data', 'home', 'user')
            backed = []
            if os.path.isdir(user_dir):
                for item in os.listdir(user_dir):
                    src = os.path.join(user_dir, item)
                    dst = os.path.join(backup_dir, item)
                    if os.path.isfile(src):
                        with open(src, 'rb') as f: data = f.read()
                        with open(dst, 'wb') as f: f.write(data)
                        backed.append(item)
                    elif os.path.isdir(src):
                        import shutil
                        shutil.copytree(src, dst, dirs_exist_ok=True)
                        backed.append(item + '/')
            self._json({"ok": True, "backed_up": backed, "count": len(backed)})
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 500)

    def _installer_reinstall(self):
        try:
            backup_dir = os.path.join(os.path.dirname(__file__), '.aurora_backup')
            base_dir = os.path.dirname(__file__)
            user_dir = os.path.join(base_dir, 'aurora', 'data', 'home', 'user')
            cache_dir = os.path.join(base_dir, 'aurora', 'data', 'cache')
            sys_dir = os.path.join(base_dir, 'aurora', 'data', 'system')
            logs_dir = os.path.join(base_dir, 'aurora', 'data', 'logs')
            for d in [cache_dir, logs_dir]:
                if os.path.isdir(d):
                    import shutil
                    for item in os.listdir(d):
                        fp = os.path.join(d, item)
                        if os.path.isfile(fp): os.remove(fp)
                        elif os.path.isdir(fp): shutil.rmtree(fp)
            if os.path.isdir(sys_dir):
                for item in os.listdir(sys_dir):
                    fp = os.path.join(sys_dir, item)
                    if os.path.isfile(fp): os.remove(fp)
            os.makedirs(user_dir, exist_ok=True)
            restored = []
            if os.path.isdir(backup_dir):
                for item in os.listdir(backup_dir):
                    src = os.path.join(backup_dir, item)
                    dst = os.path.join(user_dir, item)
                    if os.path.isfile(src):
                        with open(src, 'rb') as f: data = f.read()
                        with open(dst, 'wb') as f: f.write(data)
                        restored.append(item)
                    elif os.path.isdir(src):
                        import shutil
                        shutil.copytree(src, dst, dirs_exist_ok=True)
                        restored.append(item + '/')
            default_files = {
                'welcome.txt': 'Welcome to Aurora OS!\n\nThis is a fresh installation.\nYour files have been restored from backup.\n\nEnjoy exploring Aurora!',
                'notes.txt': 'My Notes\n------\nThis is a new note.\nStart writing here...',
                'todo.txt': 'My To-Do List\n------------\n- Explore Aurora OS\n- Try the terminal\n- Customize settings\n- Have fun!'
            }
            for fname, content in default_files.items():
                fpath = os.path.join(user_dir, fname)
                if not os.path.exists(fpath):
                    with open(fpath, 'w') as f: f.write(content)
            self._json({"ok": True, "restored": restored, "message": "Aurora OS has been reinstalled. Your files were preserved."})
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 500)

    def _installer_status(self):
        backup_dir = os.path.join(os.path.dirname(__file__), '.aurora_backup')
        has_backup = os.path.isdir(backup_dir) and len(os.listdir(backup_dir)) > 0
        backup_count = len(os.listdir(backup_dir)) if has_backup else 0
        user_dir = os.path.join(os.path.dirname(__file__), 'aurora', 'data', 'home', 'user')
        user_count = len(os.listdir(user_dir)) if os.path.isdir(user_dir) else 0
        self._json({"has_backup": has_backup, "backup_count": backup_count, "user_count": user_count})

    STORE_APPS = [
        {"id": "weather", "name": "Weather", "icon": "&#127780;", "color": "linear-gradient(135deg,#74c7ec,#89dceb)", "desc": "Real-time weather with live forecasts from your location", "category": "Utilities", "size": "14 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.9},
        {"id": "music", "name": "Music", "icon": "&#127925;", "color": "linear-gradient(135deg,#f38ba8,#eba0ac)", "desc": "Play music from your library with waveform visualizer", "category": "Entertainment", "size": "16 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.8},
        {"id": "photos", "name": "Photos", "icon": "&#128247;", "color": "linear-gradient(135deg,#a6e3a1,#94e2d5)", "desc": "Browse your real photos with gallery view", "category": "Photography", "size": "12 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.7},
        {"id": "maps", "name": "Maps", "icon": "&#128506;", "color": "linear-gradient(135deg,#a6e3a1,#40a02b)", "desc": "Interactive world map with search and navigation", "category": "Navigation", "size": "10 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.5},
        {"id": "clock_app", "name": "Clock", "icon": "&#128336;", "color": "linear-gradient(135deg,#f9e2af,#fab387)", "desc": "World clock, stopwatch, and countdown timer", "category": "Utilities", "size": "14 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.8},
        {"id": "weather2", "name": "Stocks", "icon": "&#128200;", "color": "linear-gradient(135deg,#a6e3a1,#40a02b)", "desc": "Live stock prices and market charts", "category": "Finance", "size": "11 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.4},
        {"id": "textedit", "name": "TextEdit", "icon": "&#9998;", "color": "linear-gradient(135deg,#cdd6f4,#bac2de)", "desc": "Rich text editor with formatting tools", "category": "Productivity", "size": "8 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.6},
        {"id": "calculator2", "name": "Scientific Calc", "icon": "&#129518;", "color": "linear-gradient(135deg,#cba6f7,#b4befe)", "desc": "Scientific calculator with full keyboard support", "category": "Utilities", "size": "6 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.9},
        {"id": "terminal2", "name": "iTerm", "icon": "&#128187;", "color": "linear-gradient(135deg,#1e1e2e,#313244)", "desc": "Full bash terminal with tab support", "category": "Developer", "size": "11 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.9},
        {"id": "books", "name": "Books", "icon": "&#128218;", "color": "linear-gradient(135deg,#fab387,#f9e2af)", "desc": "E-book reader with progress tracking", "category": "Entertainment", "size": "13 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.6},
        {"id": "diskutil", "name": "Disk Utility", "icon": "&#128190;", "color": "linear-gradient(135deg,#6c7086,#585b70)", "desc": "Monitor real disk usage with visual charts", "category": "Utilities", "size": "9 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.5},
        {"id": "emoji", "name": "Emoji Viewer", "icon": "&#128578;", "color": "linear-gradient(135deg,#f9e2af,#f38ba8)", "desc": "Browse and copy emoji with categories", "category": "Utilities", "size": "7 KB", "version": "2.0", "author": "Aurora Team", "rating": 4.8},
    ]

    def _store_apps(self):
        installed_file = os.path.join(os.path.dirname(__file__), 'aurora', 'data', '.store_installed')
        installed = []
        if os.path.exists(installed_file):
            with open(installed_file, 'r') as f:
                installed = [l.strip() for l in f.readlines() if l.strip()]
        apps = []
        for a in self.STORE_APPS:
            app = dict(a)
            app['installed'] = app['id'] in installed
            apps.append(app)
        self._json({"apps": apps})

    def _store_installed(self):
        installed_file = os.path.join(os.path.dirname(__file__), 'aurora', 'data', '.store_installed')
        installed = []
        if os.path.exists(installed_file):
            with open(installed_file, 'r') as f:
                installed = [l.strip() for l in f.readlines() if l.strip()]
        self._json({"installed": installed})

    def _store_install(self, app_id):
        installed_file = os.path.join(os.path.dirname(__file__), 'aurora', 'data', '.store_installed')
        installed = []
        if os.path.exists(installed_file):
            with open(installed_file, 'r') as f:
                installed = [l.strip() for l in f.readlines() if l.strip()]
        if app_id not in installed:
            installed.append(app_id)
            os.makedirs(os.path.dirname(installed_file), exist_ok=True)
            with open(installed_file, 'w') as f:
                f.write('\n'.join(installed))
        self._json({"ok": True})

    def _store_uninstall(self, app_id):
        installed_file = os.path.join(os.path.dirname(__file__), 'aurora', 'data', '.store_installed')
        installed = []
        if os.path.exists(installed_file):
            with open(installed_file, 'r') as f:
                installed = [l.strip() for l in f.readlines() if l.strip()]
        if app_id in installed:
            installed.remove(app_id)
            with open(installed_file, 'w') as f:
                f.write('\n'.join(installed))
        self._json({"ok": True})

    def _dev_apps_file(self):
        return os.path.join(os.path.dirname(__file__), 'aurora', 'data', '.dev_apps.json')

    def _load_dev_apps(self):
        fpath = self._dev_apps_file()
        if os.path.exists(fpath):
            try:
                with open(fpath, 'r') as f:
                    return json.loads(f.read())
            except Exception:
                pass
        return []

    def _save_dev_apps(self, apps):
        fpath = self._dev_apps_file()
        os.makedirs(os.path.dirname(fpath), exist_ok=True)
        with open(fpath, 'w') as f:
            f.write(json.dumps(apps, indent=2))

    def _dev_installed_file(self):
        return os.path.join(os.path.dirname(__file__), 'aurora', 'data', '.dev_installed')

    def _load_dev_installed(self):
        fpath = self._dev_installed_file()
        if os.path.exists(fpath):
            with open(fpath, 'r') as f:
                return [l.strip() for l in f.readlines() if l.strip()]
        return []

    def _save_dev_installed(self, ids):
        fpath = self._dev_installed_file()
        with open(fpath, 'w') as f:
            f.write('\n'.join(ids))

    def _store_dev_apps(self):
        apps = self._load_dev_apps()
        installed = self._load_dev_installed()
        for a in apps:
            a['installed'] = a['id'] in installed
        self._json({"apps": apps})

    def _store_dev_submit(self, body):
        name = body.get('name', '').strip()
        desc = body.get('desc', '').strip()
        author = body.get('author', '').strip() or 'Anonymous'
        category = body.get('category', 'Utilities')
        icon = body.get('icon', '&#128296;')
        color = body.get('color', 'linear-gradient(135deg,#89b4fa,#cba6f7)')
        content = body.get('content', '').strip()
        if not name or not desc:
            self._json({"ok": False, "error": "Name and description are required"}, 400)
            return
        dev_id = 'dev_' + str(int(time.time() * 1000))
        app = {
            "id": dev_id, "name": name, "icon": icon, "color": color,
            "desc": desc, "category": category, "author": author,
            "size": str(len(content.encode())) + " B", "version": "1.0",
            "rating": 0, "content": content, "downloads": 0,
            "submitted": time.strftime("%Y-%m-%d %H:%M")
        }
        apps = self._load_dev_apps()
        apps.insert(0, app)
        self._save_dev_apps(apps)
        self._json({"ok": True, "app": app})

    def _store_dev_install(self, app_id):
        apps = self._load_dev_apps()
        installed = self._load_dev_installed()
        for a in apps:
            if a['id'] == app_id:
                a['downloads'] = a.get('downloads', 0) + 1
                break
        self._save_dev_apps(apps)
        if app_id not in installed:
            installed.append(app_id)
            self._save_dev_installed(installed)
        self._json({"ok": True})

    def _store_dev_uninstall(self, app_id):
        installed = self._load_dev_installed()
        if app_id in installed:
            installed.remove(app_id)
            self._save_dev_installed(installed)
        self._json({"ok": True})

    def _store_dev_launch(self, body):
        content = body.get('content', '').strip()
        name = body.get('name', '').strip() or 'Untitled App'
        if not content:
            self._json({"ok": False, "error": "No code to launch"}, 400)
            return
        dev_id = 'dev_' + str(int(time.time() * 1000))
        app = {
            "id": dev_id, "name": name, "icon": body.get('icon', '&#128296;'),
            "color": body.get('color', 'linear-gradient(135deg,#a6e3a1,#94e2d5)'),
            "desc": body.get('desc', ''), "category": body.get('category', 'Developer'),
            "author": body.get('author', 'Developer'),
            "size": str(len(content.encode())) + " B", "version": "1.0",
            "rating": 0, "content": content, "downloads": 0,
            "submitted": time.strftime("%Y-%m-%d %H:%M"),
            "draft": body.get('draft', True)
        }
        apps = self._load_dev_apps()
        apps.insert(0, app)
        self._save_dev_apps(apps)
        self._json({"ok": True, "app": app})

    def _store_dev_update(self, body):
        app_id = body.get('id', '').strip()
        if not app_id:
            self._json({"ok": False, "error": "No app id"}, 400)
            return
        apps = self._load_dev_apps()
        for a in apps:
            if a['id'] == app_id:
                for k in ['name', 'desc', 'author', 'category', 'icon', 'content', 'color']:
                    if k in body and body[k] is not None:
                        a[k] = body[k]
                a['draft'] = False
                a['size'] = str(len(a.get('content', '').encode())) + " B"
                self._save_dev_apps(apps)
                self._json({"ok": True, "app": a})
                return
        self._json({"ok": False, "error": "App not found"}, 404)

    def _photos_list(self):
        import glob as _glob
        home = os.path.expanduser("~")
        scan_dirs = [
            os.path.join(home, "Pictures"),
            os.path.join(home, "Downloads"),
            os.path.join(home, "Desktop"),
            "C:/Windows/Web/Wallpaper",
            "C:/Windows/Web/Screen",
        ]
        exts = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.ico'}
        photos = []
        seen = set()
        for d in scan_dirs:
            if not os.path.isdir(d):
                continue
            for root, _, files in os.walk(d):
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext not in exts:
                        continue
                    fp = os.path.join(root, f).replace("\\", "/")
                    if fp in seen:
                        continue
                    seen.add(fp)
                    try:
                        sz = os.path.getsize(fp)
                        if sz < 2000:
                            continue
                        mt = os.path.getmtime(fp)
                        folder = os.path.basename(os.path.dirname(fp))
                        photos.append({
                            "path": fp,
                            "name": f,
                            "folder": folder,
                            "size": sz,
                            "date": time.strftime("%Y-%m-%d %H:%M", time.localtime(mt))
                        })
                    except Exception:
                        continue
        photos.sort(key=lambda p: p["date"], reverse=True)
        self._json({"photos": photos, "count": len(photos)})

    def _photo_serve(self, fpath):
        if not fpath or '..' in fpath:
            self.send_response(403)
            self.end_headers()
            return
        fpath = fpath.replace("\\", "/")
        if not os.path.isfile(fpath):
            self.send_response(404)
            self.end_headers()
            return
        ext = os.path.splitext(fpath)[1].lower()
        mime_map = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
            '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.tiff': 'image/tiff',
        }
        mime = mime_map.get(ext, 'application/octet-stream')
        try:
            with open(fpath, 'rb') as fh:
                data = fh.read()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", len(data))
            self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            self.send_response(500)
            self.end_headers()

    def _audio_serve(self, fpath):
        # Serve audio files for the Music app. Mirrors _photo_serve with
        # audio MIME types plus Range support so seeking works. Handles
        # Windows paths (backslashes normalized; drive-letter absolutes OK).
        if not fpath or '..' in fpath:
            self.send_response(403)
            self.end_headers()
            return
        fpath = fpath.replace("\\", "/")
        if not os.path.isfile(fpath):
            self.send_response(404)
            self.end_headers()
            return
        ext = os.path.splitext(fpath)[1].lower()
        mime_map = {
            '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wave': 'audio/wav',
            '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
            '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
            '.wma': 'audio/x-ms-wma', '.mid': 'audio/midi', '.midi': 'audio/midi',
        }
        mime = mime_map.get(ext, 'application/octet-stream')
        try:
            size = os.path.getsize(fpath)
            range_hdr = self.headers.get('Range')
            start, end = 0, size - 1
            status = 200
            if range_hdr and range_hdr.startswith('bytes='):
                try:
                    spec = range_hdr[6:].split('-')
                    if spec[0]:
                        start = int(spec[0])
                    if len(spec) > 1 and spec[1]:
                        end = min(int(spec[1]), size - 1)
                    else:
                        end = size - 1
                    if start >= size:
                        self.send_response(416)
                        self.send_header("Content-Range", "bytes */" + str(size))
                        self.end_headers()
                        return
                    status = 206
                except ValueError:
                    start, end = 0, size - 1
                    status = 200
            length = end - start + 1
            with open(fpath, 'rb') as fh:
                fh.seek(start)
                data = fh.read(length)
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", len(data))
            self.send_header("Accept-Ranges", "bytes")
            if status == 206:
                self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
            self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            self.send_response(500)
            self.end_headers()

    _weather_cache = None
    _weather_cache_time = 0

    def _weather_fetch(self):
        now = time.time()
        if AuroraHandler._weather_cache and (now - AuroraHandler._weather_cache_time) < 600:
            self._json(AuroraHandler._weather_cache)
            return
        try:
            req = Request("https://wttr.in/?format=j1", headers={
                "User-Agent": "curl/7.0",
                "Accept": "application/json",
            })
            with urlopen(req, timeout=10, context=_ssl_ctx) as resp:
                data = json.loads(resp.read())
            cc = data["current_condition"][0]
            loc = data["nearest_area"][0]
            city = loc["areaName"][0]["value"]
            country = loc["country"][0]["value"]
            forecasts = []
            for f in data.get("weather", [])[:7]:
                hour_desc = f["hourly"][4]["weatherDesc"][0]["value"]
                hour_code = f["hourly"][4]["weatherCode"]
                forecasts.append({
                    "date": f["date"],
                    "max": int(f["maxtempC"]),
                    "min": int(f["mintempC"]),
                    "desc": hour_desc,
                    "code": hour_code
                })
            result = {
                "city": city,
                "country": country,
                "temp_c": int(cc["temp_C"]),
                "temp_f": int(cc["temp_F"]),
                "feels_c": int(cc["FeelsLikeC"]),
                "feels_f": int(cc["FeelsLikeF"]),
                "desc": cc["weatherDesc"][0]["value"],
                "code": cc["weatherCode"],
                "humidity": int(cc["humidity"]),
                "wind_kmph": int(cc["windspeedKmph"]),
                "wind_dir": cc["winddir16Point"],
                "wind_mph": int(cc["windspeedMiles"]),
                "uv": int(cc["uvIndex"]),
                "visibility_km": int(cc["visibility"]),
                "pressure": int(cc["pressure"]),
                "cloud_cover": int(cc["cloudcover"]),
                "precip_mm": cc.get("precipMM", "0"),
                "observation": cc.get("observation_time", ""),
                "forecasts": forecasts
            }
            AuroraHandler._weather_cache = result
            AuroraHandler._weather_cache_time = now
            self._json(result)
        except Exception as e:
            self._json({"error": str(e), "city": "Unknown", "temp_c": 0, "desc": "Unavailable"})

    _stocks_cache = None
    _stocks_cache_time = 0

    def _stocks_fetch(self):
        import time as _time
        now = _time.time()
        if AuroraHandler._stocks_cache and (now - AuroraHandler._stocks_cache_time) < 60:
            self._json(AuroraHandler._stocks_cache)
            return
        symbols = ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA", "TSLA", "META", "BTC-USD"]
        result = []
        try:
            for sym in symbols:
                try:
                    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + sym + "?interval=1d&range=1d"
                    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
                    with urlopen(req, timeout=8, context=_ssl_ctx) as resp:
                        data = json.loads(resp.read())
                    meta = data["chart"]["result"][0]["meta"]
                    price = meta.get("regularMarketPrice", 0)
                    prev = meta.get("chartPreviousClose", meta.get("previousClose", price))
                    change = price - prev if prev else 0
                    pct = (change / prev * 100) if prev else 0
                    result.append({"sym": sym, "price": round(price, 2), "change": round(change, 2), "pct": round(pct, 2)})
                except Exception:
                    result.append({"sym": sym, "price": 0, "change": 0, "pct": 0})
            if result:
                AuroraHandler._stocks_cache = result
                AuroraHandler._stocks_cache_time = now
        except Exception:
            pass
        self._json(result if result else [{"sym": s, "price": 0, "change": 0, "pct": 0} for s in symbols])

    def _music_scan(self):
        home = os.path.expanduser("~")
        scan_dirs = [
            os.path.join(home, "Music"),
            os.path.join(home, "Downloads"),
            os.path.join(home, "Desktop"),
            "C:/ProgramData/Microsoft/Windows/Start Menu/Programs",
        ]
        exts = {'.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.opus'}
        tracks = []
        seen = set()
        for d in scan_dirs:
            if not os.path.isdir(d):
                continue
            for root, _, files in os.walk(d):
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext not in exts:
                        continue
                    fp = os.path.join(root, f).replace("\\", "/")
                    if fp in seen:
                        continue
                    seen.add(fp)
                    try:
                        sz = os.path.getsize(fp)
                        if sz < 10000:
                            continue
                        name = os.path.splitext(f)[0]
                        tracks.append({
                            "path": fp,
                            "name": name,
                            "size": sz,
                            "ext": ext[1:].upper()
                        })
                    except Exception:
                        continue
        tracks.sort(key=lambda t: t["name"])
        self._json({"tracks": tracks, "count": len(tracks)})

    def _wallpaper_file(self):
        return os.path.join(os.path.dirname(__file__), 'aurora', 'data', '.wallpaper')

    def _notes_file(self):
        return os.path.join(os.path.dirname(__file__), 'aurora', 'data', 'notes.json')

    def _notes_get(self):
        nf = self._notes_file()
        notes = []
        try:
            if os.path.exists(nf):
                with open(nf, 'r', encoding='utf-8') as f:
                    notes = json.loads(f.read())
        except Exception:
            pass
        self._json(notes)

    def _notes_save(self, notes):
        nf = self._notes_file()
        try:
            os.makedirs(os.path.dirname(nf), exist_ok=True)
            with open(nf, 'w', encoding='utf-8') as f:
                f.write(json.dumps(notes, ensure_ascii=False, indent=1))
        except Exception as e:
            self._json({"error": str(e)})
            return
        self._json({"ok": True})

    def _wallpaper_get(self):
        wf = self._wallpaper_file()
        wp = 'aurora'
        try:
            if os.path.exists(wf):
                with open(wf, 'r') as f:
                    wp = f.read().strip() or 'aurora'
        except Exception:
            pass
        self._json({"wallpaper": wp})

    def _wallpaper_set(self, wp_id):
        wf = self._wallpaper_file()
        try:
            os.makedirs(os.path.dirname(wf), exist_ok=True)
            with open(wf, 'w') as f:
                f.write(wp_id)
        except Exception:
            pass
        self._json({"ok": True, "wallpaper": wp_id})

    def _system_stats(self):
        try:
            cpu_pct = psutil.cpu_percent(interval=0.1)
            cpu_freq = psutil.cpu_freq()
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            uptime_sec = time.time() - psutil.boot_time()
            days = int(uptime_sec // 86400)
            hours = int((uptime_sec % 86400) // 3600)
            mins = int((uptime_sec % 3600) // 60)
            uptime_str = ""
            if days > 0:
                uptime_str = f"{days}d {hours}h {mins}m"
            elif hours > 0:
                uptime_str = f"{hours}h {mins}m"
            else:
                uptime_str = f"{mins}m"
            self._json({
                "cpu_percent": cpu_pct,
                "cpu_freq": cpu_freq.current if cpu_freq else 0,
                "cpu_cores": psutil.cpu_count(logical=False) or 0,
                "cpu_threads": psutil.cpu_count(logical=True) or 0,
                "mem_total": mem.total,
                "mem_used": mem.used,
                "mem_percent": mem.percent,
                "disk_total": disk.total,
                "disk_used": disk.used,
                "disk_percent": disk.percent,
                "uptime": uptime_str,
                "pid_count": len(psutil.pids()),
                "boot_time": psutil.boot_time()
            })
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def _system_procs(self):
        try:
            procs = []
            win_system_names = {
                'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe',
                'services.exe', 'lsass.exe', 'lsm.exe', 'svchost.exe',
                'winlogon.exe', 'dwm.exe', 'fontdrvhost.exe', 'sihost.exe',
                'ctfmon.exe', 'taskhostw.exe', 'conhost.exe', 'RuntimeBroker.exe',
                'ShellExperienceHost.exe', 'SearchUI.exe', 'StartMenuExperienceHost.exe',
                'MicrosoftEdge.exe', 'MicrosoftEdgeCP.exe', 'msedgewebview2.exe',
                'SearchIndexer.exe', 'SearchProtocolHost.exe', 'SearchFilterHost.exe',
                'spoolsv.exe', 'WmiPrvSE.exe', 'MsMpEng.exe', 'NisSrv.exe',
                'dllhost.exe', 'WUDFHost.exe', 'audiodg.exe', 'dasHost.exe',
                'Memory Compression', 'SecurityHealthService.exe',
                'MsSense.exe', 'SenseIR.exe', 'SenseCncProxy.exe',
                'YourPhone.exe', 'PhoneExperienceHost.exe',
                'GameBarPresenceWriter.exe', 'GameBar.exe',
                'SecurityHealthSystray.exe', 'ctfmon.exe',
                'Text Input Host.exe', 'MoUSO Core Worker.exe',
            }
            current_user = os.getenv("USERNAME", "").lower()
            for p in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent', 'status', 'username', 'create_time']):
                try:
                    info = p.info
                    name = info.get("name", "Unknown")
                    if name.lower() in win_system_names:
                        continue
                    user = info.get("username", "") or ""
                    cpu_val = round(info.get("cpu_percent", 0) or 0, 1)
                    mem_val = round(info.get("memory_percent", 0) or 0, 1)
                    if cpu_val < 0.1 and mem_val < 0.1:
                        continue
                    procs.append({
                        "pid": info.get("pid", 0),
                        "name": name,
                        "cpu": cpu_val,
                        "mem": mem_val,
                        "status": info.get("status", "unknown"),
                        "user": user,
                    })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            procs.sort(key=lambda x: x.get("cpu", 0) + x.get("mem", 0), reverse=True)
            self._json({"processes": procs[:60]})
        except Exception as e:
            self._json({"processes": [], "error": str(e)})

    def _system_aurora(self):
        """Usage of Aurora OS itself: this server process only, never the host."""
        try:
            p = psutil.Process()
            cpu = p.cpu_percent(interval=0.1)
            mem = p.memory_info()
            vm = psutil.virtual_memory()
            uptime_sec = time.time() - p.create_time()
            days = int(uptime_sec // 86400)
            hours = int((uptime_sec % 86400) // 3600)
            mins = int((uptime_sec % 3600) // 60)
            if days > 0:
                uptime_str = f"{days}d {hours}h {mins}m"
            elif hours > 0:
                uptime_str = f"{hours}h {mins}m"
            else:
                uptime_str = f"{mins}m"
            try:
                threads = p.num_threads()
            except Exception:
                threads = 0
            self._json({
                "pid": p.pid,
                "cpu_percent": cpu,
                "mem_rss": mem.rss,
                "mem_percent": round(mem.rss / vm.total * 100, 1) if vm.total else 0,
                "threads": threads,
                "uptime": uptime_str,
                "uptime_sec": int(uptime_sec),
            })
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def log_message(self, fmt, *args):
        pass


def main():
    port = 8080
    print()
    print("  Aurora OS")
    print(f"  Starting server on http://localhost:{port}")
    print("  Opening browser...")
    print()

    server = ThreadingHTTPServer(("127.0.0.1", port), AuroraHandler)
    threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{port}")).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Aurora OS shutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
