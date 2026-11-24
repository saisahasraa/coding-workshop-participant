/** Geometry of the dependency graph. */
export const NODE_W = 200;
export const NODE_H = 68;
const COL_GAP = 72;
const ROW_GAP = 14;

/** Place every node in the column of its depth; returns positions by key and the canvas size. */
export function layout(nodes) {
  const rowOf = {};
  const positions = {};
  let rows = 0;
  let columns = 0;
  nodes.forEach((n) => {
    rowOf[n.depth] = (rowOf[n.depth] ?? -1) + 1;
    positions[n.key] = { x: n.depth * (NODE_W + COL_GAP), y: rowOf[n.depth] * (NODE_H + ROW_GAP) };
    rows = Math.max(rows, rowOf[n.depth] + 1);
    columns = Math.max(columns, n.depth + 1);
  });
  return { positions, width: columns * NODE_W + (columns - 1) * COL_GAP, height: rows * NODE_H + (rows - 1) * ROW_GAP };
}
