import { describe, expect, it } from "vitest";
import { checkFictionalNames, generate } from "../src/index.js";

describe("fictional-name registry screening", () => {
  it("normalizes punctuation and legal suffixes and catches near matches", () => {
    const dataset = generate({ industry: "trailer-dealer", seed: 42 });
    dataset.company.name = "Acme Trailer, LLC";
    const matches = checkFictionalNames(dataset, ["Acme Trailers Inc."]);
    expect(matches).toContainEqual(expect.objectContaining({ recordId: dataset.company.id, registryName: "Acme Trailers Inc." }));
  });
  it("screens business customers as well as the company", () => {
    const dataset = generate({ industry: "marketing-agency", seed: 42 });
    dataset.customers[0]!.name = "Acme Trailer LLC";
    expect(checkFictionalNames(dataset, ["Acme Trailer Inc"])).toContainEqual(expect.objectContaining({ recordId: dataset.customers[0]!.id }));
  });
  it("does not conflate unrelated names or silently use an empty registry", () => {
    const dataset = generate({ industry: "home-services", seed: 42 });
    expect(checkFictionalNames(dataset, ["Distinctive Industrial Automation Holdings"])).toEqual([]);
    expect(() => checkFictionalNames(dataset, [])).toThrow(/registry/);
  });
});
