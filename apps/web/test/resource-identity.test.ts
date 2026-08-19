import { describe, expect, it } from "vitest";
import { resolveSupplierLookupId } from "../src/utils/resourceIdentity";

describe("identidade de recursos da composição", () => {
  it("resolve o recurso da empresa pela familyKey mesmo depois de rename", () => {
    const lookup = resolveSupplierLookupId(
      { refId: "global-1", familyKey: "fam-cimento" },
      [
        { id: "company-9", familyKey: "fam-cimento" },
        { id: "global-1", familyKey: "fam-cimento" },
      ],
    );
    expect(lookup).toBe("company-9");
  });

  it("não usa o nome como identidade", () => {
    const lookup = resolveSupplierLookupId(
      { refId: "a", familyKey: "fam-aco" },
      [{ id: "b", familyKey: "fam-areia" }, { id: "c", familyKey: "fam-aco" }],
    );
    expect(lookup).toBe("c");
  });
});
