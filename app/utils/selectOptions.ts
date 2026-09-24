// Shared by InputSegmented.vue and InputSelect.vue: both accept either a bare
// string or an explicit {value,label} pair for each option, and both need the
// same normalization before rendering. Extracted here rather than duplicated
// in each component (fallow's duplication check flagged the original copy).
export type SelectOption = string | { value: string; label: string };

export type NormalizedSelectOption = { value: string; label: string };

export function normalizeSelectOptions(
  options: readonly SelectOption[],
): NormalizedSelectOption[] {
  return options.map((option) => {
    if (typeof option === "string") {
      return { value: option, label: option };
    }
    return option;
  });
}
