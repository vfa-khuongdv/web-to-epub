import { describe, expect, it } from "vitest";
import { ListItemLike, matchesQuery, parseQuery, stateCounts, withState } from "./query";

const items: ListItemLike[] = [
  { number: 482, title: "feat(budget): báo cáo chênh lệch", author: "hoang-nm", labels: [{ name: "enhancement" }, { name: "backend" }], state: "open" },
  { number: 481, title: "fix(invoice): sai kỳ hoá đơn", author: "minh-dq", labels: [{ name: "bug" }], state: "open" },
  { number: 479, title: "chore(deps): bump money-format", author: "team-bot", labels: [{ name: "dependencies" }], state: "merged" },
  { number: 470, title: "docs: hướng dẫn chạy local", author: "lan-pt", labels: [{ name: "needs qa" }], state: "closed" },
];

const numbers = (query: string) => items.filter((item) => matchesQuery(item, parseQuery(query))).map((item) => item.number);

describe("parseQuery", () => {
  it("reads state, labels, author and words", () => {
    expect(parseQuery('is:pr is:open label:bug label:"needs qa" author:Lan-PT chênh  lệch')).toEqual({
      state: "open",
      merged: false,
      labels: ["bug", "needs qa"],
      author: "lan-pt",
      words: ["chênh", "lệch"],
    });
    expect(parseQuery("is:merged")).toMatchObject({ state: "closed", merged: true });
  });
});

describe("matchesQuery", () => {
  it("filters like the site's list", () => {
    expect(numbers("is:pr is:open")).toEqual([482, 481]);
    expect(numbers("is:pr is:closed")).toEqual([479, 470]);
    expect(numbers("is:merged")).toEqual([479]);
    expect(numbers("label:backend")).toEqual([482]);
    expect(numbers('label:"needs qa"')).toEqual([470]);
    expect(numbers("author:minh-dq")).toEqual([481]);
    expect(numbers("HOÁ ĐƠN")).toEqual([481]);
    expect(numbers("#479")).toEqual([479]);
    expect(numbers("")).toEqual([482, 481, 479, 470]);
  });
});

describe("withState", () => {
  it("rewrites the state and keeps the rest", () => {
    expect(withState("is:pr is:open label:bug", "closed")).toBe("is:pr is:closed label:bug");
    expect(withState("is:issue state:closed", "open")).toBe("is:issue is:open");
    expect(withState("variance", "open")).toBe("is:open variance");
    expect(withState("is:pr is:merged", "open")).toBe("is:pr is:open");
  });
});

describe("stateCounts", () => {
  it("counts open and closed for the rest of the query", () => {
    expect(stateCounts(items, parseQuery("is:pr is:open"))).toEqual({ open: 2, closed: 2 });
    expect(stateCounts(items, parseQuery("is:open label:bug"))).toEqual({ open: 1, closed: 0 });
  });
});
