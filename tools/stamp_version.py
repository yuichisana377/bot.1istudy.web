#!/usr/bin/env python3
"""
stamp_version.py — キャッシュ対策用のバージョンを HTML / JS に埋め込む（2026/11/08 追加）

JS・CSS の中身から版（SHA1の先頭10桁）を作り、次を一括で更新する:
  ・各 *.html : <meta name="app-version">、Version.js の読み込み、
                全ての自サイト <script src> / <link href=*.css> の ?v=版
  ・各 *.js   : 1行目の先頭に自分の版を刻む（改行は足さない＝行番号がずれない）
  ・version.json : {"v": "版"}（Version.js が最新版かどうかを確認するのに使う）
JS・CSS を1文字でも変えたら、コミット前に必ずこのスクリプトを実行すること:
    python tools/stamp_version.py          # 更新する
    python tools/stamp_version.py --check  # 更新が必要なら終了コード1（何も書き換えない）
版は「中身から決まる」ので、何も変えずに何度実行しても結果は同じ（差分は出ない）。
"""
import hashlib
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
NO_STAMP = {"Version.js"}  # チェッカー本体は版を刻まない（?v= で必ず新しく読み込まれる）

# 刻印は「既存の1行目の先頭に、改行なしで」足す（行番号をずらさないため。
# 解説リポジトリ 1istudy.system.explanation がコードの行番号を引用している）。
#   /*@ver*/(window.__jsVer=window.__jsVer||{})["X.js"]="版";/*@end*/元の1行目…
STAMP_NEW_RE = re.compile(
    rb'^/\*@ver\*/\(window\.__jsVer=window\.__jsVer\|\|\{\}\)\["[^"]*"\]="[0-9a-z]+";/\*@end\*/'
)
# 旧方式（刻印だけの独立した1行）。移行のために取り除く。
STAMP_OLD_RE = re.compile(rb"^/\*@ver\*/(?!.*/\*@end\*/)[^\r\n]*(\r\n|\n)")


def strip_stamp(data: bytes) -> bytes:
    data = STAMP_OLD_RE.sub(b"", data, count=1)
    return STAMP_NEW_RE.sub(b"", data, count=1)


def make_stamp(name: str, ver: str) -> bytes:
    return ('/*@ver*/(window.__jsVer=window.__jsVer||{})["%s"]="%s";/*@end*/' % (name, ver)).encode("utf-8")


def compute_version(files) -> str:
    h = hashlib.sha1()
    for p in sorted(files, key=lambda x: x.name):
        h.update(p.name.encode("utf-8") + b"\0")
        h.update(strip_stamp(p.read_bytes()).replace(b"\r\n", b"\n"))  # 改行コードの違いで版が変わらないように
        h.update(b"\0")
    return h.hexdigest()[:10]


def stamp_js(path: Path, ver: str) -> bool:
    data = path.read_bytes()
    new = make_stamp(path.name, ver) + strip_stamp(data)
    if new == data:
        return False
    path.write_bytes(new)
    return True


SCRIPT_SRC_RE = re.compile(r'(<script\b[^>]*?\bsrc=")(?!//)(?![A-Za-z][A-Za-z0-9+.-]*:)([^"?#]+\.js)(?:\?v=[^"]*)?(")')
LINK_CSS_RE = re.compile(r'(<link\b[^>]*?\bhref=")(?!//)(?![A-Za-z][A-Za-z0-9+.-]*:)([^"?#]+\.css)(?:\?v=[^"]*)?(")')
META_RE = re.compile(r'[ \t]*<meta name="app-version" content="[^"]*">[ \t]*\r?\n?')
VERJS_RE = re.compile(r'[ \t]*<script src="/Version\.js(?:\?v=[^"]*)?"></script>[ \t]*\r?\n?')
CHARSET_RE = re.compile(r'(<meta charset="[^"]*">)([ \t]*)(\r?\n)', re.I)


def stamp_html(path: Path, ver: str) -> bool:
    text = path.read_bytes().decode("utf-8")
    nl = "\r\n" if "\r\n" in text else "\n"
    new = META_RE.sub("", text)
    new = VERJS_RE.sub("", new)
    m = CHARSET_RE.search(new)
    if not m:
        print(f"[警告] {path.name}: <meta charset> が見つからないため版を埋め込めません")
        return False
    inject = (f'{m.group(1)}{m.group(2)}{m.group(3)}'
              f'<meta name="app-version" content="{ver}">{nl}'
              f'<script src="/Version.js?v={ver}"></script>{nl}')
    new = new[:m.start()] + inject + new[m.end():]
    new = SCRIPT_SRC_RE.sub(lambda mm: f"{mm.group(1)}{mm.group(2)}?v={ver}{mm.group(3)}", new)
    new = LINK_CSS_RE.sub(lambda mm: f"{mm.group(1)}{mm.group(2)}?v={ver}{mm.group(3)}", new)
    if new == text:
        return False
    path.write_bytes(new.encode("utf-8"))
    return True


def main() -> int:
    check_only = "--check" in sys.argv
    js_files = sorted(ROOT.glob("*.js"))
    css_files = sorted(ROOT.glob("*.css"))
    ver = compute_version(js_files + css_files)
    changed = []

    if check_only:
        for p in js_files:
            if p.name in NO_STAMP:
                continue
            data = p.read_bytes()
            if make_stamp(p.name, ver) + strip_stamp(data) != data:
                changed.append(p.name)
        for p in sorted(ROOT.glob("*.html")):
            if f'<meta name="app-version" content="{ver}">' not in p.read_text(encoding="utf-8"):
                changed.append(p.name)
        vj = ROOT / "version.json"
        if not vj.exists() or json.loads(vj.read_text(encoding="utf-8")).get("v") != ver:
            changed.append("version.json")
        if changed:
            print(f"版 {ver} の埋め込みが必要です: " + ", ".join(changed))
            print("→ python tools/stamp_version.py を実行してください")
            return 1
        print(f"版 {ver}: 最新です")
        return 0

    for p in js_files:
        if p.name not in NO_STAMP and stamp_js(p, ver):
            changed.append(p.name)
    for p in sorted(ROOT.glob("*.html")):
        if stamp_html(p, ver):
            changed.append(p.name)
    vj = ROOT / "version.json"
    body = json.dumps({"v": ver}) + "\n"
    if not vj.exists() or vj.read_text(encoding="utf-8") != body:
        vj.write_text(body, encoding="utf-8")
        changed.append("version.json")
    print(f"版: {ver}")
    print(("更新: " + ", ".join(changed)) if changed else "変更なし")
    return 0


if __name__ == "__main__":
    sys.exit(main())
