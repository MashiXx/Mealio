#!/usr/bin/env python3
"""Dò ứng viên ảnh (chỉ liệt kê tên + giấy phép mở) cho các từ khoá, KHÔNG tải.
Dùng để kiểm tra thủ công trước khi pin ảnh đúng."""
import urllib.request, urllib.parse, json, re, socket, sys

socket.setdefaulttimeout(40)
UA = {"User-Agent": "MealioCatalogBot/1.0 (https://github.com/mashi/mealio; mashicrypto@gmail.com)"}
OPEN = ("cc0", "cc by", "cc-by", "public domain", "pdm")

def api(params):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request("https://commons.wikimedia.org/w/api.php?" + q, headers=UA)
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def probe(term):
    d = api({"action": "query", "format": "json", "generator": "search", "gsrnamespace": "6",
             "gsrlimit": "10", "gsrsearch": term, "prop": "imageinfo",
             "iiprop": "url|extmetadata|mime"})
    out = []
    for p in sorted(d.get("query", {}).get("pages", {}).values(), key=lambda x: x.get("index", 999)):
        ii = (p.get("imageinfo") or [{}])[0]
        if ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        lic = ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value") or ""
        if not any(k in lic.lower() for k in OPEN):
            continue
        out.append((p["title"], lic))
    return out

TERMS = {
    "chao-ga": ["Cháo gà", "Vietnamese rice porridge chicken"],
    "goi-ga-bap-cai": ["Gỏi gà", "Vietnamese chicken salad"],
    "che-chuoi": ["Chè chuối", "Vietnamese banana coconut dessert"],
    "chuoi-chien": ["Chuối chiên", "Vietnamese fried banana"],
    "com-ga-hoi-an": ["Cơm gà", "Vietnamese chicken rice Hoi An"],
    "lau-thai-hai-san": ["Lẩu hải sản", "Vietnamese hot pot", "seafood hotpot"],
    "ga-chien-nuoc-mam": ["Cánh gà chiên", "fried chicken wings fish sauce"],
    "trai-cay-theo-mua": ["Vietnamese fruit platter", "tropical fruit plate"],
}
for slug in (sys.argv[1:] or TERMS.keys()):
    print("\n### " + slug)
    for t in TERMS[slug]:
        print(" ~ " + t)
        for title, lic in probe(t)[:6]:
            print(f"    - {lic:18s} {title}")
