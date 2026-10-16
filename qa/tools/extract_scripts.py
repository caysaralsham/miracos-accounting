#!/usr/bin/env python3
"""استخراج سكربتات <script> المضمّنة من ملفات HTML إلى ملفات .js حتى يفحصها Semgrep."""
import re, sys, pathlib

src_root = pathlib.Path(sys.argv[1]).resolve()
out_root = pathlib.Path(sys.argv[2]).resolve()
pat = re.compile(r"<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>", re.S | re.I)

count = 0
for html in src_root.rglob("*.html"):
    if ".git" in html.parts:
        continue
    text = html.read_text(encoding="utf-8", errors="replace")
    for i, m in enumerate(pat.finditer(text)):
        attrs, body = m.group(1), m.group(2)
        if "json" in attrs.lower() or not body.strip():
            continue
        # نحافظ على أرقام الأسطر: نسبق الكود بأسطر فارغة بعدد الأسطر قبله
        line = text.count("\n", 0, m.start(2))
        rel = html.relative_to(src_root)
        dest = out_root / src_root.name / f"{rel}.script{i}.js"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("\n" * line + body, encoding="utf-8")
        count += 1
print(f"{src_root.name}: {count} scripts")
