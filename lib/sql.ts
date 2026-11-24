/** Flattens rows into a parameterised multi-row VALUES list: ($1,$2),($3,$4)... */
export function placeholders(rowCount: number, colCount: number): string {
  return Array.from({ length: rowCount }, (_, r) =>
    `(${Array.from({ length: colCount }, (_, c) => `$${r * colCount + c + 1}`).join(',')})`
  ).join(',')
}
