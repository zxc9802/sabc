import { expect, it } from "vitest";

import { CATEGORY_IDS, DIMENSIONS, getRubric, RUBRIC_VERSION } from "./catalog";

it("uses seven dimensions whose weights total 100", () => {
  expect(DIMENSIONS).toHaveLength(7);
  expect(DIMENSIONS.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
});

it.each(CATEGORY_IDS)("provides 2 to 4 evidence slots for %s", (category) => {
  const rubric = getRubric(category);

  for (const dimension of DIMENSIONS) {
    const count = rubric.slots[dimension.key].length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(4);
  }
});

it("falls back to the general rubric without changing the version", () => {
  expect(getRubric("general").version).toBe(RUBRIC_VERSION);
});

it("uses category-specific return evidence", () => {
  expect(
    getRubric("software").slots.return_potential.map((slot) => slot.id),
  ).toEqual(
    expect.arrayContaining([
      "software_pricing",
      "software_acquisition",
      "software_retention",
      "software_maintenance",
    ]),
  );
  expect(
    getRubric("internal_efficiency").slots.return_potential.map(
      (slot) => slot.id,
    ),
  ).toEqual(
    expect.arrayContaining([
      "efficiency_time_saved",
      "efficiency_people",
      "efficiency_errors",
      "efficiency_payback",
    ]),
  );
});
