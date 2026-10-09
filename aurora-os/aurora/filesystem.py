"""In-memory filesystem with directories, files, permissions."""

import time


class FileNode:
    def __init__(self, name, is_dir=False, content=b"", parent=None):
        self.name = name
        self.is_dir = is_dir
        self.content = content
        self.parent = parent
        self.children = {} if is_dir else None
        self.created = time.time()
        self.modified = time.time()
        self.size = len(content)

    def write(self, data):
        if isinstance(data, str):
            data = data.encode()
        self.content = data
        self.size = len(data)
        self.modified = time.time()

    def read(self):
        return self.content

    def read_text(self):
        return self.content.decode(errors="replace")

    def add_child(self, child):
        if self.is_dir:
            child.parent = self
            self.children[child.name] = child

    def remove_child(self, name):
        if self.is_dir and name in self.children:
            del self.children[name]

    def get_child(self, name):
        if self.is_dir:
            return self.children.get(name)
        return None


class AuroraFS:
    def __init__(self):
        self.root = FileNode("/", is_dir=True)
        self.cwd = self.root
        self._seed()

    def _seed(self):
        home = FileNode("home", is_dir=True)
        user = FileNode("user", is_dir=True)
        docs = FileNode("Documents", is_dir=True)
        pics = FileNode("Pictures", is_dir=True)
        music = FileNode("Music", is_dir=True)
        desktop = FileNode("Desktop", is_dir=True)
        downloads = FileNode("Downloads", is_dir=True)
        sys_dir = FileNode("System", is_dir=True)

        readme = FileNode("Welcome.txt")
        readme.write("Welcome to Aurora OS!\n\nThis is your personal operating system.\nExplore the apps, customize your desktop, and enjoy.\n\nAurora OS v1.0\n")
        journal = FileNode("Journal.txt")
        journal.write("Monday\nJust set up Aurora OS. The desktop looks beautiful.\nThe wallpaper orbs are mesmerizing.\n\nTuesday\nTried the terminal today. It supports pipes and chaining.\nVery powerful for a custom OS.\n\nWednesday\nExplored the file system. Everything feels snappy.\nLooking forward to more features.\n")
        shopping = FileNode("Shopping List.txt")
        shopping.write("- Coffee beans\n- Oat milk\n- Dark chocolate\n- Fresh bread\n- Avocados\n- Olive oil\n- Lemons\n- Rice\n")
        project = FileNode("Project Ideas.txt")
        project.write("1. Build a weather widget for the menu bar\n2. Create a music visualizer app\n3. Design custom icon themes\n4. Write a markdown editor\n5. Make a pomodoro timer\n")
        poem = FileNode("Poem.txt")
        poem.write("Beneath the aurora sky so wide,\nWhere digital stars and circuits glide,\nA world of wonder, code, and light,\nAurora OS shines through the night.\n\nWith spring-animated grace it flows,\nA liquid dream that softly glows,\nFrom boot to desktop, sleek and fast,\nThe future built to truly last.\n")
        todo = FileNode("Todo.txt")
        todo.write("[ ] Learn more terminal commands\n[ ] Customize the wallpaper\n[x] Set up Aurora OS\n[ ] Explore system settings\n[ ] Try the calculator app\n")

        photos_note = FileNode("Photo Notes.txt")
        photos_note.write("Trip to the mountains - Summer 2025\nBeautiful sunset over the peaks.\nGot some great shots with the new camera.\n\nBirthday Party - March 2025\nGreat time with friends and family.\nThe cake was incredible.\n")

        music_note = FileNode("Playlist.txt")
        music_note.write("Currently Playing:\n- Aurora Dreams\n- Midnight Coding\n- Digital Rain\n- Neon Horizons\n- Starlight Serenade\n- Electric Sunset\n- Crystal Waves\n")

        download_log = FileNode("Download Log.txt")
        download_log.write("Downloads folder is empty.\nFiles downloaded from Aurora Store will appear here.\n")

        docs.add_child(readme)
        docs.add_child(journal)
        docs.add_child(shopping)
        docs.add_child(project)
        docs.add_child(poem)
        docs.add_child(todo)
        pics.add_child(photos_note)
        music.add_child(music_note)
        downloads.add_child(download_log)
        user.add_child(docs)
        user.add_child(pics)
        user.add_child(music)
        user.add_child(desktop)
        user.add_child(downloads)
        home.add_child(user)
        sys_dir.add_child(FileNode("kernel.sys"))
        sys_dir.add_child(FileNode("config.sys"))

        self.root.add_child(home)
        self.root.add_child(sys_dir)

    def _resolve(self, path):
        if path.startswith("/"):
            parts = [p for p in path.split("/") if p]
            node = self.root
        else:
            parts = path.split("/")
            node = self.cwd

        for part in parts:
            if part == "..":
                node = node.parent if node.parent else node
            elif part == ".":
                continue
            else:
                if not node.is_dir:
                    return None
                child = node.get_child(part)
                if child is None:
                    return None
                node = child
        return node

    def ls(self, path=None):
        node = self._resolve(path) if path else self.cwd
        if not node or not node.is_dir:
            return []
        return sorted(node.children.values(), key=lambda n: (not n.is_dir, n.name))

    def cd(self, path):
        node = self._resolve(path)
        if node and node.is_dir:
            self.cwd = node
            return True
        return False

    def pwd(self):
        parts = []
        node = self.cwd
        while node and node != self.root:
            parts.append(node.name)
            node = node.parent
        return "/" + "/".join(reversed(parts))

    def cat(self, path):
        node = self._resolve(path)
        if node and not node.is_dir:
            return node.read_text()
        return None

    def write(self, path, content):
        parts = path.rsplit("/", 1)
        if len(parts) == 2:
            parent = self._resolve(parts[0])
            name = parts[1]
        else:
            parent = self.cwd
            name = parts[0]

        if parent and parent.is_dir:
            existing = parent.get_child(name)
            if existing and not existing.is_dir:
                existing.write(content)
                return existing
            new_file = FileNode(name)
            new_file.write(content)
            parent.add_child(new_file)
            return new_file
        return None

    def mkdir(self, path):
        parts = path.rsplit("/", 1)
        if len(parts) == 2:
            parent = self._resolve(parts[0])
            name = parts[1]
        else:
            parent = self.cwd
            name = parts[0]

        if parent and parent.is_dir:
            new_dir = FileNode(name, is_dir=True)
            parent.add_child(new_dir)
            return new_dir
        return None

    def rm(self, path):
        node = self._resolve(path)
        if node and node.parent:
            node.parent.remove_child(node.name)
            return True
        return False

    def exists(self, path):
        return self._resolve(path) is not None

    def tree(self, path=None, prefix="", depth=3):
        node = self._resolve(path) if path else self.cwd
        if not node or not node.is_dir or depth <= 0:
            return []
        lines = []
        items = sorted(node.children.values(), key=lambda n: (not n.is_dir, n.name))
        for i, child in enumerate(items):
            connector = "+-- " if i < len(items) - 1 else "\\-- "
            if child.is_dir:
                lines.append(f"{prefix}{connector}{child.name}/")
                ext = "|   " if i < len(items) - 1 else "    "
                lines.extend(self.tree(None, prefix + ext, depth - 1))
            else:
                lines.append(f"{prefix}{connector}{child.name}  ({child.size}b)")
        return lines
