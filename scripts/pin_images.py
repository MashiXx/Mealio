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
#
# Chỉ ghim file nào NHÌN RA đúng món. Tìm tự động bằng fetch_dish_images.py rất
# hay trúng ảnh sai: dò "Cá chiên sả" ra bản đồ sao Canis Major, "Su su xào" ra
# con trâu, "Lẩu nấm chay" ra ca sĩ Lưu Đức Hoa. Ảnh sai món tệ hơn nhiều so với
# nền gradient sạch sẽ, nên thà bỏ trống.
PINS = {
    "chao-ga": "File:Cháo gà nhà làm, tháng 5 năm 2020 (1).jpg",
    "che-chuoi": "File:Chè chuối 20201125.jpg",
    "chuoi-chien": "File:Chuối chiên.JPG",
    "com-ga-hoi-an": "File:Cơm gà Tam Kỳ, Quảng Nam.JPG",
    "lau-thai-hai-san": "File:Lẩu hải sản tại Aellmall năm 2016 (4).jpg",
    "ga-chien-nuoc-mam": "File:Cánh gà chiên nước mắm, tháng 8 năm 2018 (1).JPG",
    "trai-cay-theo-mua": "File:Tropical Fruit Platter.JPG",
    # --- đợt 2 (2026-07-26): đã soi từng ảnh trong kết quả probe_images.py ---
    "suon-xao-chua-ngot": "File:Suon xao chua ngot bac ninh.jpg",
    "thit-rang-chay-canh": "File:Thit rang chay canh.jpg",
    "muc-xao-dua-can": "File:Món mực xào, tháng 4 năm 2018 (1).jpg",
    "dau-cove-xao-thit": "File:Món ăn cúng mồng 2 Tết 2022 (đậu cô ve xào cà rốt) (1).jpg",
    "nam-dui-ga-xao": "File:Món ăn cúng đưa, Tết 2022 (món nấm xào chay) (1).jpg",
    "canh-khoai-mo": "File:Canh Khoai Mỡ.jpg",
    "canh-mang-suon": "File:Canh măng hầm thịt heo.jpg",
    "rau-cau-dua": "File:Rau câu dừa tươi ở BiC Phú Thạnh tháng 10 năm 2018 (1).jpg",
}

# Đã tải về rồi LOẠI sau khi xem tận mắt — giữ lại đây để lần sau không ghim lại:
#   suon-nuong-mat-ong  File:Sườn nướng.jpg
#       -> bếp nướng vỉa hè, trong khung có xe máy và chân người, không ra món ăn.
#   rau-cai-luoc        File:Tết 2020, Luộc rau ở nhà mình, ng3th2n2020 (1).jpg
#       -> rau mồng tơi SỐNG đang bỏ vào nồi, không phải đĩa rau đã luộc.
#   canh-mong-toi-ngao  File:Món cúng Tết năm 2019 tại Đông Hà (canh cá dìa...) (1).jpg
#       -> nguyên con cá còn đầu, mà món này là canh NGAO, sai đạm.

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
