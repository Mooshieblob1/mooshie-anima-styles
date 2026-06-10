export function formatCopiedTag(tag: string): string {
  return `@${tag
    .replace(/^@+/, "")
    .replace(/_/g, " ")
    .replace(/[()]/g, "\\$&")},`;
}
