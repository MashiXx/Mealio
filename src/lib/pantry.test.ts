import { describe, it, expect } from "vitest";
import {
  matchKey,
  toPantrySet,
  missingFor,
  mergeNeeds,
  suggestFromPantry,
  verifyMenuAgainstPantry,
  violationNote,
  kindLookupFrom,
} from "./pantry";

describe("matchKey", () => {
  it("bỏ dấu và hạ chữ thường", () => {
    expect(matchKey("Cà Chua")).toBe("ca chua");
  });

  it("quy tên đồng nghĩa về tên chuẩn", () => {
    expect(matchKey("hành hoa")).toBe("hanh la");
    expect(matchKey("đậu hũ")).toBe("dau phu");
  });
});

describe("toPantrySet", () => {
  it("bỏ qua tên rỗng sau chuẩn hoá, không để nó âm thầm khớp mọi thứ", () => {
    const pantry = toPantrySet(["!!!", "cà chua"]);
    expect(pantry.has("")).toBe(false);
    expect(pantry.size).toBe(1);
  });
});

describe("missingFor", () => {
  const pantry = toPantrySet(["cá thu", "đậu phụ", "cà chua"]);

  it("trả rỗng khi kho có đủ nguyên liệu chính", () => {
    const needs = [
      { name: "Cá thu", quantity: 500, unit: "g" },
      { name: "Cà chua", quantity: 2, unit: "quả" },
    ];
    expect(missingFor(needs, pantry)).toEqual([]);
  });

  it("chỉ ra nguyên liệu chính không có trong kho", () => {
    const needs = [
      { name: "Thịt bò", quantity: 300, unit: "g" },
      { name: "Cá thu", quantity: 500, unit: "g" },
    ];
    expect(missingFor(needs, pantry).map((n) => n.name)).toEqual(["Thịt bò"]);
  });

  it("không bao giờ coi gia vị là thiếu", () => {
    const needs = [
      { name: "Nước mắm", quantity: 2, unit: "thìa" },
      { name: "Tỏi", quantity: 3, unit: "tép" },
      { name: "Hành lá", quantity: 1, unit: "nhánh" },
    ];
    expect(missingFor(needs, pantry)).toEqual([]);
  });

  it("khớp qua bảng đồng nghĩa", () => {
    const needs = [{ name: "Đậu hũ", quantity: 1, unit: "bìa" }];
    expect(missingFor(needs, pantry)).toEqual([]);
  });

  it("tên rỗng sau chuẩn hoá luôn coi là thiếu, kể cả khi kho có mục rỗng", () => {
    const pantryWithEmpty = new Set(["", "ca chua"]);
    const needs = [{ name: "!!!", quantity: 1, unit: "cái" }];
    expect(missingFor(needs, pantryWithEmpty).map((n) => n.name)).toEqual(["!!!"]);
  });

  it("cờ IngredientKind của gia đình ghi đè bảng tĩnh: gia vị đánh MAIN thì báo thiếu", () => {
    const kindOf = kindLookupFrom([{ name: "ớt", kind: "MAIN" }]);
    const needs = [{ name: "Ớt", quantity: 3, unit: "quả" }];
    expect(missingFor(needs, toPantrySet([]), kindOf).map((n) => n.name)).toEqual(["Ớt"]);
  });

  it("cờ IngredientKind của gia đình ghi đè bảng tĩnh: nguyên liệu chính đánh SEASONING thì bỏ qua", () => {
    const kindOf = kindLookupFrom([{ name: "riềng", kind: "SEASONING" }]);
    const needs = [{ name: "Riềng", quantity: 1, unit: "củ" }];
    expect(missingFor(needs, toPantrySet([]), kindOf)).toEqual([]);
  });
});

describe("kindLookupFrom", () => {
  it("nguyên liệu chưa có cờ trong kho thì rơi về bảng tĩnh", () => {
    const kindOf = kindLookupFrom([]);
    expect(kindOf(matchKey("tỏi"))).toBe("SEASONING");
    expect(kindOf(matchKey("cá thu"))).toBe("MAIN");
  });
});

describe("mergeNeeds", () => {
  it("cộng số lượng khi cùng nguyên liệu và cùng đơn vị", () => {
    const merged = mergeNeeds([
      { name: "Cà chua", quantity: 2, unit: "quả" },
      { name: "cà chua", quantity: 3, unit: "quả" },
    ]);
    expect(merged).toEqual([{ name: "Cà chua", quantity: 5, unit: "quả" }]);
  });

  it("tách dòng khi khác đơn vị", () => {
    const merged = mergeNeeds([
      { name: "Thịt lợn", quantity: 300, unit: "g" },
      { name: "Thịt lợn", quantity: 1, unit: "kg" },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("gộp đơn vị dù khác dấu/khoảng trắng, đơn vị hiển thị giữ dấu của bản ghi đầu tiên", () => {
    const merged = mergeNeeds([
      { name: "Cà chua", quantity: 2, unit: "Quả" },
      { name: "cà chua", quantity: 3, unit: " qua " }, // không dấu, dư khoảng trắng
    ]);
    expect(merged).toEqual([{ name: "Cà chua", quantity: 5, unit: "Quả" }]);
  });

  it("chọn tên chuẩn (không phải đồng nghĩa) làm tên hiển thị, không phụ thuộc thứ tự", () => {
    const forward = mergeNeeds([
      { name: "đậu hũ", quantity: 1, unit: "bìa" },
      { name: "Đậu phụ", quantity: 2, unit: "bìa" },
    ]);
    const backward = mergeNeeds([
      { name: "Đậu phụ", quantity: 2, unit: "bìa" },
      { name: "đậu hũ", quantity: 1, unit: "bìa" },
    ]);
    expect(forward[0].name).toBe("Đậu phụ");
    expect(backward[0].name).toBe("Đậu phụ");
  });

  it("không làm biến đổi mảng đầu vào", () => {
    const needs = [
      { name: "Cà chua", quantity: 2, unit: "quả" },
      { name: "cà chua", quantity: 3, unit: "quả" },
    ];
    const snapshot = JSON.parse(JSON.stringify(needs));
    mergeNeeds(needs);
    expect(needs).toEqual(snapshot);
  });
});

describe("suggestFromPantry", () => {
  const dishes = [
    { name: "Cá thu kho", ingredients: [{ name: "cá thu" }, { name: "riềng" }] },
    { name: "Bò xào", ingredients: [{ name: "thịt bò" }, { name: "cần tây" }] },
    { name: "Đậu sốt cà", ingredients: [{ name: "đậu phụ" }, { name: "cà chua" }] },
  ];

  it("chỉ giữ món có nguyên liệu chính trùng kho, nhiều trùng đứng trước", () => {
    const pantry = toPantrySet(["cá thu", "đậu phụ", "cà chua"]);
    expect(suggestFromPantry(dishes, pantry).map((d) => d.name)).toEqual([
      "Đậu sốt cà",
      "Cá thu kho",
    ]);
  });

  it("kho rỗng thì không gợi ý gì", () => {
    expect(suggestFromPantry(dishes, toPantrySet([]))).toEqual([]);
  });

  it("chấm theo tỉ lệ phủ: món nấu được trọn vẹn đứng trước món trùng nhiều hơn nhưng phủ ít hơn", () => {
    const pantry = toPantrySet(["đậu phụ", "cà chua", "nấm", "cá thu"]);
    const ranked = [
      {
        name: "Đậu sốt cà", // 2/2 nguyên liệu chính có -> phủ 100%
        ingredients: [{ name: "đậu phụ" }, { name: "cà chua" }],
      },
      {
        name: "Lẩu thập cẩm", // 3/9 nguyên liệu chính có -> phủ ~33%, dù trùng nhiều hơn về số tuyệt đối
        ingredients: [
          { name: "cá thu" },
          { name: "nấm" },
          { name: "đậu phụ" },
          { name: "tôm" },
          { name: "mực" },
          { name: "ngao" },
          { name: "thịt bò" },
          { name: "cải thảo" },
          { name: "đậu que" },
        ],
      },
    ];
    expect(suggestFromPantry(ranked, pantry).map((d) => d.name)).toEqual([
      "Đậu sốt cà",
      "Lẩu thập cẩm",
    ]);
  });

  it("khai lặp một nguyên liệu nhiều dòng không được thổi điểm", () => {
    const pantry = toPantrySet(["cà chua", "đậu phụ"]);
    const withDup = [
      {
        name: "Trùng lặp cà chua",
        ingredients: [{ name: "cà chua" }, { name: "Cà chua" }, { name: "cà chua bi" }],
      },
      {
        name: "Hai thứ khác nhau",
        ingredients: [{ name: "cà chua" }, { name: "đậu phụ" }],
      },
    ];
    // "Trùng lặp cà chua" chỉ thật sự trùng đúng 1 nguyên liệu phân biệt (3 dòng
    // đều quy về "ca chua") nên phải thua "Hai thứ khác nhau" (trùng 2 phân biệt).
    expect(suggestFromPantry(withDup, pantry).map((d) => d.name)).toEqual([
      "Hai thứ khác nhau",
      "Trùng lặp cà chua",
    ]);
  });

  it("kindOf loại nguyên liệu gia đình đánh SEASONING khỏi tỉ lệ phủ, có thể đổi cả thứ hạng", () => {
    const pantry = toPantrySet(["cá thu", "đậu phụ"]);
    const dishesWithRieng = [
      {
        name: "Cá thu kho riềng",
        ingredients: [{ name: "cá thu" }, { name: "riềng" }],
      },
      {
        name: "Cá thu sốt đậu cà rốt",
        ingredients: [{ name: "cá thu" }, { name: "đậu phụ" }, { name: "cà rốt" }],
      },
    ];

    // Mặc định: riềng tính là nguyên liệu chính còn thiếu -> "Cá thu kho riềng"
    // chỉ phủ 1/2, thua "Cá thu sốt đậu cà rốt" phủ 2/3.
    expect(suggestFromPantry(dishesWithRieng, pantry).map((d) => d.name)).toEqual([
      "Cá thu sốt đậu cà rốt",
      "Cá thu kho riềng",
    ]);

    // Gia đình đánh riềng là SEASONING (nút "đổi nhóm"): riềng bị loại khỏi mẫu
    // số -> "Cá thu kho riềng" phủ 1/1 = 100%, vượt lên trước.
    const kindOf = kindLookupFrom([{ name: "riềng", kind: "SEASONING" }]);
    expect(suggestFromPantry(dishesWithRieng, pantry, kindOf).map((d) => d.name)).toEqual([
      "Cá thu kho riềng",
      "Cá thu sốt đậu cà rốt",
    ]);
  });
});

describe("verifyMenuAgainstPantry", () => {
  const pantry = toPantrySet(["cá thu", "đậu phụ", "cà chua"]);

  const menu = {
    meals: [
      {
        date: "2026-07-26",
        mealType: "DINNER" as const,
        dishes: [
          {
            name: "Cá thu kho tộ",
            ingredients: [
              { name: "cá thu", quantity: 500, unit: "g" },
              { name: "nước mắm", quantity: 2, unit: "thìa" },
            ],
          },
          {
            name: "Bò xào cần tỏi",
            ingredients: [
              { name: "thịt bò", quantity: 300, unit: "g" },
              { name: "cần tây", quantity: 1, unit: "bó" },
            ],
          },
        ],
      },
    ],
  };

  it("chỉ báo món dùng nguyên liệu chính ngoài kho", () => {
    const v = verifyMenuAgainstPantry(menu, pantry);
    expect(v).toHaveLength(1);
    expect(v[0].dishName).toBe("Bò xào cần tỏi");
    expect(v[0].missing.map((m) => m.name)).toEqual(["thịt bò", "cần tây"]);
  });

  it("mâm hợp lệ thì trả rỗng", () => {
    const ok = {
      meals: [
        {
          date: "2026-07-26",
          mealType: "DINNER" as const,
          dishes: [
            {
              name: "Đậu sốt cà",
              ingredients: [
                { name: "đậu phụ", quantity: 2, unit: "bìa" },
                { name: "cà chua", quantity: 3, unit: "quả" },
                { name: "hành lá", quantity: 1, unit: "nhánh" },
              ],
            },
          ],
        },
      ],
    };
    expect(verifyMenuAgainstPantry(ok, pantry)).toEqual([]);
  });

  it("món trùng tên qua nhiều bữa gộp thành một Violation, khử trùng theo matchKey", () => {
    const pantryForDup = toPantrySet([]);
    const menuDup = {
      meals: [
        {
          date: "2026-07-26",
          mealType: "LUNCH" as const,
          dishes: [
            {
              name: "Canh chua",
              ingredients: [{ name: "cá lóc", quantity: 1, unit: "con" }],
            },
          ],
        },
        {
          date: "2026-07-26",
          mealType: "DINNER" as const,
          dishes: [
            {
              name: "Canh chua",
              ingredients: [
                { name: "Cá lóc", quantity: 1, unit: "con" }, // cùng nguyên liệu, khác hoa/thường
                { name: "dứa", quantity: 1, unit: "quả" },
              ],
            },
          ],
        },
      ],
    };
    const v = verifyMenuAgainstPantry(menuDup, pantryForDup);
    expect(v).toHaveLength(1);
    expect(v[0].dishName).toBe("Canh chua");
    expect(v[0].missing.map((m) => matchKey(m.name)).sort()).toEqual(["ca loc", "dua"]);
  });

  it("kindOf truyền tiếp xuống missingFor", () => {
    const kindOf = kindLookupFrom([{ name: "riềng", kind: "SEASONING" }]);
    const menuWithRieng = {
      meals: [
        {
          date: "2026-07-26",
          mealType: "DINNER" as const,
          dishes: [
            {
              name: "Cá kho riềng",
              ingredients: [{ name: "riềng", quantity: 1, unit: "củ" }],
            },
          ],
        },
      ],
    };
    expect(verifyMenuAgainstPantry(menuWithRieng, toPantrySet([]), kindOf)).toEqual([]);
  });
});

describe("violationNote", () => {
  it("trả rỗng khi không có vi phạm", () => {
    expect(violationNote([], ["cá thu"])).toBe("");
  });
});

describe("seasonings: bẫy trùng dấu sau chuẩn hoá", () => {
  it("ngô (bắp) không bị coi là gia vị dù trùng normalize với ngò", () => {
    const needs = [{ name: "Ngô", quantity: 2, unit: "bắp" }];
    expect(missingFor(needs, toPantrySet([])).map((n) => n.name)).toEqual(["Ngô"]);
  });

  it("mè không bị coi là gia vị dù trùng normalize với 'me' (quả me)", () => {
    const needs = [{ name: "Mè", quantity: 50, unit: "g" }];
    expect(missingFor(needs, toPantrySet([])).map((n) => n.name)).toEqual(["Mè"]);
  });
});
