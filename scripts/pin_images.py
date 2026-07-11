#!/usr/bin/env python3
"""Tải ảnh theo tên File chính xác (đã kiểm tra thủ công) và cập nhật credits.json."""
import urllib.request, urllib.parse, json, os, re, socket

socket.setdefaulttimeout(40)
UA = {"User-Agent": "MealioCatalogBot/1.0 (https://github.com/mashi/mealio; mashicrypto@gmail.com)"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "dishes")
MANIFEST_PATH = os.path.join(ROOT, "src", "data", "catalog", "image-credits.json")
OPEN = ("cc0", "cc by", "cc-by", "public domain", "pdm")

# slug -> tên File chính xác trên Commons (đã xác minh đúng món).
PINS = {
    "chao-ga": "File:Cháo gà nhà làm, tháng 5 năm 2020 (1).jpg",
    "che-chuoi": "File:Chè chuối 20201125.jpg",
    "chuoi-chien": "File:Chuối chiên.JPG",
    "com-ga-hoi-an": "File:Cơm gà Tam Kỳ, Quảng Nam.JPG",
    "lau-thai-hai-san": "File:Lẩu hải sản tại Aellmall năm 2016 (4).jpg",
    "ga-chien-nuoc-mam": "File:Cánh gà chiên nước mắm, tháng 8 năm 2018 (1).JPG",
    "trai-cay-theo-mua": "File:Tropical Fruit Platter.JPG",
}

def api(params):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request("https://commons.wikimedia.org/w/api.php?" + q, headers=UA)
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()

manifest_path = MANIFEST_PATH
manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {}

for slug, title in PINS.items():
    d = api({"action": "query", "format": "json", "titles": title, "prop": "imageinfo",
             "iiprop": "url|extmetadata|mime", "iiurlwidth": "1024"})
    pages = list(d.get("query", {}).get("pages", {}).values())
    ii = (pages[0].get("imageinfo") or [{}])[0] if pages else {}
    em = ii.get("extmetadata", {})
    lic = em.get("LicenseShortName", {}).get("value") or ""
    if not any(k in lic.lower() for k in OPEN):
        print(f"[{slug}] BỎ: license không mở ({lic})")
        continue
    url = ii.get("thumburl") or ii.get("url")
    try:
        req = urllib.request.Request(url, headers=UA)
        data = urllib.request.urlopen(req).read()
    except Exception as e:
        print(f"[{slug}] tải lỗi: {e}")
        continue
    ext = ".jpg"
    with open(os.path.join(OUT, slug + ext), "wb") as f:
        f.write(data)
    manifest[slug] = {
        "file": f"/dishes/{slug}{ext}",
        "license": lic,
        "artist": strip_html(em.get("Artist", {}).get("value")) or "Không rõ",
        "source": ii.get("descriptionurl") or ii.get("url"),
        "title": title,
    }
    print(f"[{slug}] OK {round(len(data)/1024)}KB · {lic} · {manifest[slug]['artist'][:40]}")

json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"\nManifest có {len(manifest)} ảnh.")
