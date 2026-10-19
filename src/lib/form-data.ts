/** Read a text field from FormData as a string ("" when missing or a File). */
export function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** Read every value of a repeated field (e.g. checkboxes sharing a name). */
export function fields(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === "string");
}
