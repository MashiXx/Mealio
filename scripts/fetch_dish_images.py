#!/usr/bin/env python3
"""Tải ảnh minh hoạ món ăn từ Wikimedia Commons (chỉ giấy phép mở) về public/dishes/.

- Tra cứu Commons API theo từ khoá của từng slug, chọn ảnh đầu tiên có giấy phép
  mở (CC0 / CC BY / CC BY-SA / Public domain), tải bản thumbnail ~1024px.
- Ghi manifest public/dishes/credits.json: slug -> {file, license, artist, source}.
- Idempotent: bỏ qua slug đã có ảnh (trừ khi chạy với --force).

Cần mạng. Chạy: python scripts/fetch_dish_images.py
"""
import urllib.request, urllib.parse, json, os, re, sys, socket, time

socket.setdefaulttimeout(40)
UA = {"User-Agent": "MealioCatalogBot/1.0 (https://github.com/mashi/mealio; mashicrypto@gmail.com)"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "dishes")
# Manifest ghi công nằm cạnh dữ liệu catalog để index.ts import & overlay ảnh.
MANIFEST_PATH = os.path.join(ROOT, "src", "data", "catalog", "image-credits.json")
FORCE = "--force" in sys.argv

# Giấy phép chấp nhận (khớp không phân biệt hoa thường trên LicenseShortName).
OPEN_LICENSE = ("cc0", "cc by", "cc-by", "public domain", "pdm")

# slug -> danh sách từ khoá tìm (ưu tiên từ đầu). Chỉ những món có ảnh Commons tốt.
SEARCH = {
    "pho-bo": ["Phở bò", "Pho bo beef noodle soup"],
    "bun-cha": ["Bún chả", "Bun cha Hanoi"],
    "thit-kho-tau": ["Thịt kho", "Thit kho tau braised pork egg"],
    "ca-kho-to": ["Cá kho tộ", "Vietnamese braised fish clay pot"],
    "goi-cuon-tom-thit": ["Gỏi cuốn", "Vietnamese summer rolls goi cuon"],
    "nem-ran": ["Chả giò", "Vietnamese fried spring rolls nem ran"],
    "com-tam-suon": ["Cơm tấm", "Com tam broken rice"],
    "bun-bo-hue": ["Bún bò Huế", "Bun bo Hue"],
    "banh-canh-cua": ["Bánh canh cua", "Banh canh"],
    "bun-rieu-cua": ["Bún riêu", "Bun rieu"],
    "chao-ga": ["Cháo gà", "Vietnamese chicken congee chao ga"],
    "canh-chua-ca": ["Canh chua", "Vietnamese sour soup canh chua"],
    "xoi-xeo": ["Xôi xéo", "Xoi xeo sticky rice"],
    "com-ga-hoi-an": ["Cơm gà Hội An", "Com ga Hoi An chicken rice"],
    "com-chien-duong-chau": ["Cơm chiên Dương Châu", "Vietnamese fried rice"],
    "rau-muong-xao-toi": ["Rau muống xào tỏi", "stir fried water spinach garlic"],
    "bo-luc-lac": ["Bò lúc lắc", "Shaking beef bo luc lac"],
    "ca-tim-nuong-mo-hanh": ["Cà tím nướng", "Vietnamese grilled eggplant scallion"],
    "goi-ga-bap-cai": ["Gỏi gà", "Vietnamese chicken cabbage salad goi ga"],
    "che-chuoi": ["Chè chuối", "Che chuoi banana dessert"],
    "che-dau-xanh": ["Chè đậu xanh", "mung bean sweet soup che"],
    "chuoi-chien": ["Chuối chiên", "Vietnamese fried banana"],
    "banh-trang-cuon-thit-heo": ["Bánh tráng cuốn thịt heo", "Banh trang cuon thit heo"],
    "lau-thai-hai-san": ["Lẩu", "Vietnamese hotpot lau seafood"],
    "ga-chien-nuoc-mam": ["Vietnamese fish sauce chicken wings", "cánh gà chiên nước mắm"],
    "tom-rim-thit": ["Tôm rim", "Vietnamese caramelized shrimp tom rim"],
    "dau-hu-sot-ca": ["Đậu hũ sốt cà chua", "tofu tomato sauce"],
    "trai-cay-theo-mua": ["Vietnamese fruit plate", "tropical fruit platter"],
}


def api(params):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request("https://commons.wikimedia.org/w/api.php?" + q, headers=UA)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def is_open(lic):
    l = (lic or "").lower()
    return any(k in l for k in OPEN_LICENSE)


def find_image(term):
    d = api({
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6",
        "gsrlimit": "8", "gsrsearch": term, "prop": "imageinfo",
        "iiprop": "url|extmetadata|mime", "iiurlwidth": "1024",
    })
    pages = d.get("query", {}).get("pages", {})
    # search trả về theo index; sắp theo 'index' để giữ thứ tự liên quan.
    for p in sorted(pages.values(), key=lambda x: x.get("index", 999)):
        ii = (p.get("imageinfo") or [{}])[0]
        if ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        em = ii.get("extmetadata", {})
        lic = em.get("LicenseShortName", {}).get("value")
        if not is_open(lic):
            continue
        turl = ii.get("thumburl") or ii.get("url")
        return {
            "title": p["title"],
            "thumburl": turl,
            "license": lic,
            "artist": strip_html(em.get("Artist", {}).get("value")) or "Không rõ",
            "source": ii.get("descriptionurl") or ii.get("url"),
        }
    return None


def download(url, path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req) as r:
        data = r.read()
    if data[:2].hex() != "ffd8" and data[:8].hex() != "89504e470d0a1a0a":
        raise ValueError("không phải JPEG/PNG")
    with open(path, "wb") as f:
        f.write(data)
    return len(data)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest_path = MANIFEST_PATH
    manifest = {}
    if os.path.exists(manifest_path):
        manifest = json.load(open(manifest_path, encoding="utf-8"))

    ok, skip, fail = 0, 0, 0
    for slug, terms in SEARCH.items():
        dest = os.path.join(OUT, slug + ".jpg")
        if os.path.exists(dest) and not FORCE:
            skip += 1
            continue
        found = None
        for t in terms:
            try:
                found = find_image(t)
            except Exception as e:
                print(f"[{slug}] lỗi API ({t}): {e}")
                found = None
            if found:
                break
            time.sleep(0.5)
        if not found:
            print(f"[{slug}] KHÔNG tìm được ảnh giấy phép mở")
            fail += 1
            continue
        try:
            kb = round(download(found["thumburl"], dest) / 1024)
        except Exception as e:
            print(f"[{slug}] tải lỗi: {e}")
            fail += 1
            continue
        manifest[slug] = {
            "file": f"/dishes/{slug}.jpg",
            "license": found["license"],
            "artist": found["artist"],
            "source": found["source"],
            "title": found["title"],
        }
        print(f"[{slug}] OK {kb}KB · {found['license']} · {found['artist'][:40]} · {found['title'][:50]}")
        ok += 1
        time.sleep(0.4)

    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nXong: {ok} tải mới, {skip} bỏ qua (đã có), {fail} thất bại. Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
