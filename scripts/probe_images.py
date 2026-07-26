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
    # --- đợt 2: 42 món còn thiếu ảnh (2026-07-26) ---
    "suon-xao-chua-ngot": ["Sườn xào chua ngọt", "sweet and sour pork ribs"],
    "ga-kho-gung": ["Gà kho gừng", "Vietnamese ginger chicken"],
    "thit-rang-chay-canh": ["Thịt rang cháy cạnh", "Vietnamese caramelized pork belly"],
    "ca-rot-thit-kho": ["Thịt kho củ cải", "Vietnamese braised pork radish"],
    "trung-chien-thit": ["Trứng chiên thịt", "Vietnamese omelette minced pork"],
    "ca-basa-chien-sa": ["Cá chiên sả", "Vietnamese fried fish lemongrass"],
    "cha-lua-chien": ["Chả lụa", "Vietnamese pork sausage cha lua"],
    "muc-nhoi-thit-hap": ["Mực nhồi thịt", "Vietnamese stuffed squid"],
    "suon-nuong-mat-ong": ["Sườn nướng", "Vietnamese grilled pork ribs honey"],
    "ca-basa-kho-tieu": ["Cá kho tiêu", "Vietnamese braised fish pepper"],
    "thit-bo-xao-can-toi": ["Bò xào cần tây", "beef stir fry celery"],
    "muc-xao-dua-can": ["Mực xào", "Vietnamese stir fried squid"],
    "ga-xao-sa-ot": ["Gà xào sả ớt", "Vietnamese lemongrass chili chicken"],
    "dau-cove-xao-thit": ["Đậu cô ve xào", "stir fried green beans pork"],
    "bap-cai-xao-trung": ["Bắp cải xào", "stir fried cabbage egg"],
    "mien-xao-thap-cam": ["Miến xào", "Vietnamese stir fried glass noodles"],
    "su-su-xao-thit": ["Su su xào", "stir fried chayote beef"],
    "nam-dui-ga-xao": ["Nấm xào chay", "stir fried king oyster mushroom"],
    "long-ga-xao-mien": ["Giá đỗ xào", "stir fried bean sprouts"],
    "canh-cua-rau-day": ["Canh cua rau đay", "Vietnamese crab soup jute"],
    "canh-bi-do-nau-tom": ["Canh bí đỏ", "Vietnamese pumpkin soup shrimp"],
    "canh-rau-ngot-thit-bam": ["Canh rau ngót", "Vietnamese katuk soup"],
    "canh-khoai-mo": ["Canh khoai mỡ", "Vietnamese purple yam soup"],
    "canh-mang-suon": ["Canh măng", "Vietnamese bamboo shoot soup ribs"],
    "canh-cai-nau-ca-ro": ["Canh cải cá rô", "Vietnamese mustard green fish soup"],
    "sup-ga-ngo": ["Súp gà", "Vietnamese chicken soup corn"],
    "canh-mong-toi-ngao": ["Canh mồng tơi", "Vietnamese malabar spinach soup"],
    "canh-dau-hu-he": ["Canh đậu hũ hẹ", "Vietnamese tofu chive soup"],
    "rau-cai-luoc": ["Rau luộc", "Vietnamese boiled greens"],
    "rau-lang-luoc": ["Rau lang luộc", "boiled sweet potato leaves"],
    "nom-du-du-bo-kho": ["Nộm đu đủ", "Vietnamese green papaya salad"],
    "sup-lo-luoc": ["Súp lơ luộc", "boiled cauliflower broccoli"],
    "dau-bap-luoc": ["Đậu bắp luộc", "boiled okra"],
    "goi-ngo-sen-tom-thit": ["Gỏi ngó sen", "Vietnamese lotus stem salad"],
    "lau-ga-la-e": ["Lẩu gà lá é", "Vietnamese chicken hotpot"],
    "lau-rieu-cua-bap-bo": ["Lẩu riêu cua", "Vietnamese crab hotpot"],
    "lau-nam-chay": ["Lẩu nấm", "Vietnamese mushroom hotpot vegetarian"],
    "rau-cau-dua": ["Rau câu dừa", "Vietnamese coconut jelly agar"],
    "dua-cai-chua": ["Dưa cải chua", "Vietnamese pickled mustard greens"],
    "do-chua-ca-rot-cu-cai": ["Đồ chua", "Vietnamese pickled carrot daikon"],
    "ca-phao-muoi": ["Cà pháo", "Vietnamese pickled eggplant"],
}
for slug in (sys.argv[1:] or TERMS.keys()):
    print("\n### " + slug)
    for t in TERMS[slug]:
        print(" ~ " + t)
        for title, lic in probe(t)[:6]:
            print(f"    - {lic:18s} {title}")
